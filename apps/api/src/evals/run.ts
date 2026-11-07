// Runs the eval cases through the same pipeline as POST /chat and scores each answer.
//
//   npm run eval                          all cases
//   npm run eval -- --category orders     one category
//   npm run eval -- --ids e03,klarna      specific cases (e.g. to resume after hitting a quota)
//   npm run eval -- --delay 8000          wait longer between cases (free-tier rate limits)
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ChatTurn } from "@brewbot/shared";
import { answerQuestion, CLAIMS_HANDOFF, isProviderBusy, type AnswerOutcome, type HandoffReason } from "../answer.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { cases, type EvalCase } from "./cases.ts";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  checks: Check[];
  answer: string;
  toolsUsed: string[];
  handoffOffered: boolean;
  handoffReasons: HandoffReason[];
  retrievalHit: boolean | null;
  cited: boolean | null;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
}

const { values: args } = parseArgs({
  options: {
    ids: { type: "string" },
    category: { type: "string" },
    delay: { type: "string", default: "4000" },
  },
});

const selected = cases.filter(
  (c) => (!args.ids || args.ids.split(",").includes(c.id)) && (!args.category || c.category === args.category),
);
const delayMs = Number(args.delay);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const resultsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../eval-results");
const resultsFile = path.join(resultsDir, `${runId}.json`);

function score(c: EvalCase, outcome: AnswerOutcome): Omit<CaseResult, "latencyMs"> {
  const { answer, sources, result, handoffOffered, handoffReasons } = outcome;
  const checks: Check[] = [];
  const re = (pattern: string) => new RegExp(pattern, "im");

  for (const p of c.includes ?? []) checks.push({ name: `includes /${p}/`, pass: re(p).test(answer) });
  for (const p of c.excludes ?? []) {
    const match = answer.match(re(p));
    checks.push({ name: `excludes /${p}/`, pass: !match, detail: match?.[0] });
  }
  for (const t of c.tools ?? []) checks.push({ name: `calls ${t}`, pass: result.toolsUsed.includes(t) });
  for (const t of c.forbidTools ?? []) checks.push({ name: `doesn't call ${t}`, pass: !result.toolsUsed.includes(t) });
  if (c.handoff !== undefined) {
    checks.push({ name: c.handoff ? "offers handoff" : "no handoff", pass: handoffOffered === c.handoff });
  }

  // Applies to every case: the bot must never claim an action that didn't happen.
  if (CLAIMS_HANDOFF.test(answer)) {
    checks.push({ name: "claimed handoff actually happened", pass: handoffOffered });
  }

  let retrievalHit: boolean | null = null;
  let cited: boolean | null = null;
  if (c.source) {
    retrievalHit = sources.some((s) => s.path.endsWith(c.source!));
    const citedIds = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
    cited = sources.some((s) => citedIds.has(s.id) && s.path.endsWith(c.source!));
    checks.push({ name: `retrieves ${c.source}`, pass: retrievalHit });
    checks.push({ name: `cites ${c.source}`, pass: cited });
  }

  return {
    id: c.id,
    category: c.category,
    pass: checks.every((ch) => ch.pass),
    checks,
    answer,
    toolsUsed: result.toolsUsed,
    handoffOffered,
    handoffReasons,
    retrievalHit,
    cited,
    usage: result.usage,
  };
}

/** Retries rate-limit and overload errors with backoff; anything else (or a daily quota) gives up. */
async function runWithRetry(c: EvalCase, messages: ChatTurn[]): Promise<AnswerOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await answerQuestion(`eval-${runId}-${c.id}`, messages);
    } catch (error) {
      if (!isProviderBusy(error) || attempt === 3) throw error;
      const wait = 15_000 * 2 ** attempt;
      console.log(`    provider busy, retrying in ${wait / 1000}s…`);
      await sleep(wait);
    }
  }
}

console.log(`Running ${selected.length} cases on ${config.LLM_PROVIDER} / ${config.CHAT_MODEL}\n`);
await mkdir(resultsDir, { recursive: true });
const results: CaseResult[] = [];
let stoppedEarly: string[] = [];

for (const [i, c] of selected.entries()) {
  const messages: ChatTurn[] = typeof c.messages === "string" ? [{ role: "user", content: c.messages }] : c.messages;
  const started = Date.now();
  try {
    const outcome = await runWithRetry(c, messages);
    const scored = { ...score(c, outcome), latencyMs: Date.now() - started };
    results.push(scored);
    console.log(`${scored.pass ? "✔" : "✘"} ${c.id.padEnd(28)} ${c.category}`);
    for (const ch of scored.checks.filter((ch) => !ch.pass)) {
      console.log(`    failed: ${ch.name}${ch.detail ? ` (found "${ch.detail}")` : ""}`);
    }
    if (!scored.pass) console.log(`    answer: ${scored.answer.replace(/\s+/g, " ").slice(0, 240)}`);
  } catch (error) {
    console.log(`! ${c.id.padEnd(28)} error: ${(error as Error).message.slice(0, 160)}`);
    if (isProviderBusy(error)) {
      // Most likely a daily quota: stop, keep what we have, and say how to resume.
      stoppedEarly = selected.slice(i).map((s) => s.id);
      break;
    }
    results.push({
      id: c.id, category: c.category, pass: false, checks: [], answer: "", toolsUsed: [], handoffOffered: false, handoffReasons: [],
      retrievalHit: null, cited: null, latencyMs: Date.now() - started, usage: { inputTokens: 0, outputTokens: 0 },
      error: (error as Error).message,
    });
  }
  await writeFile(resultsFile, JSON.stringify({ runId, provider: config.LLM_PROVIDER, model: config.CHAT_MODEL, results }, null, 2));
  if (i < selected.length - 1) await sleep(delayMs);
}

// --- Summary ----------------------------------------------------------------------
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const passed = results.filter((r) => r.pass).length;
const withSource = results.filter((r) => r.retrievalHit !== null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

console.log(`\n## Eval results: ${config.CHAT_MODEL}\n`);
console.log(`| Metric | Result |\n|---|---|`);
console.log(`| Cases passed | **${passed}/${results.length} (${pct(passed, results.length)})** |`);
console.log(`| Retrieval hit@${config.RETRIEVAL_TOP_K} | ${withSource.filter((r) => r.retrievalHit).length}/${withSource.length} (${pct(withSource.filter((r) => r.retrievalHit).length, withSource.length)}) |`);
console.log(`| Answer cites the right document | ${withSource.filter((r) => r.cited).length}/${withSource.length} (${pct(withSource.filter((r) => r.cited).length, withSource.length)}) |`);
console.log(`| Average latency | ${(avg(results.map((r) => r.latencyMs)) / 1000).toFixed(1)}s |`);
console.log(`| Average tokens per question | ${avg(results.map((r) => r.usage.inputTokens))} in / ${avg(results.map((r) => r.usage.outputTokens))} out |`);

console.log(`\n| Category | Passed |\n|---|---|`);
for (const category of [...new Set(results.map((r) => r.category))]) {
  const inCategory = results.filter((r) => r.category === category);
  console.log(`| ${category} | ${inCategory.filter((r) => r.pass).length}/${inCategory.length} |`);
}

// How often the model needed a code backstop to reach the contact form: a model-quality signal.
const handoffs = results.filter((r) => r.handoffOffered);
const backstopOnly = handoffs.filter((r) => !r.handoffReasons.includes("tool") && !r.handoffReasons.includes("refused"));
const emptyAnswers = results.filter((r) => r.handoffReasons.includes("empty-answer"));
if (emptyAnswers.length) console.log(`\nEmpty answers after retry: ${emptyAnswers.map((r) => r.id).join(", ")}`);
console.log(
  `\nHandoffs: ${handoffs.length}, of which ${backstopOnly.length} came only from a code backstop: ` +
    (backstopOnly.map((r) => `${r.id} [${r.handoffReasons.join(", ")}]`).join("; ") || "none"),
);

console.log(`\nFull results: ${path.relative(process.cwd(), resultsFile)}`);
if (stoppedEarly.length) {
  console.log(`\nStopped early (provider quota). Resume with:\n  npm run eval -- --ids ${stoppedEarly.join(",")}`);
}

await pool.end();
process.exit(passed === results.length && !stoppedEarly.length ? 0 : 1);
