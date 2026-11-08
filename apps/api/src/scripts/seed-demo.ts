// Fills chat_logs and tickets with 60 days of synthetic traffic so the analytics dashboard has
// something to show in a demo. Every row is tagged (session ids start with "demo-seed-") and
// "npm run seed:demo -- --clear" removes them again without touching real conversations.
import { parseArgs } from "node:util";
import { migrate, pool } from "../db.ts";

const { values: args } = parseArgs({ options: { clear: { type: "boolean", default: false } } });

const PREFIX = "demo-seed-";
const DEMO_ANSWER = "(Sample conversation generated for the demo dashboard.)";

interface Template {
  question: string;
  topic: string;
  weight: number;
  lowConfidence?: boolean;
  handoff?: boolean;
  orderLookup?: boolean;
}

// Weighted like a real shop's traffic: shipping and orders dominate; the low-confidence ones are
// realistic gaps in the docs, which is what the dashboard's "couldn't answer well" list is for.
const templates: Template[] = [
  { question: "How much is standard UK delivery?", topic: "Shipping Policy", weight: 9 },
  { question: "When will my next-day order arrive if I order on Friday?", topic: "Shipping Policy", weight: 5 },
  { question: "Do I pay customs on delivery to Ireland?", topic: "Shipping Policy", weight: 3 },
  { question: "Where is my order?", topic: "Payments and Orders", weight: 10, orderLookup: true },
  { question: "Has my grinder been dispatched yet?", topic: "Payments and Orders", weight: 5, orderLookup: true },
  { question: "Can I pay in instalments?", topic: "Payments and Orders", weight: 3 },
  { question: "Can I return a grinder I've used?", topic: "Returns and Refunds", weight: 6 },
  { question: "How long do refunds take?", topic: "Returns and Refunds", weight: 5 },
  { question: "My Aurora shows E03, what should I do?", topic: "Aurora Troubleshooting Guide", weight: 4 },
  { question: "My shots are running too fast", topic: "Aurora Troubleshooting Guide", weight: 5 },
  { question: "Steam wand is spitting water", topic: "Aurora Troubleshooting Guide", weight: 3 },
  { question: "How do I descale the Aurora?", topic: "Care and Cleaning Guide", weight: 5 },
  { question: "How often should I backflush?", topic: "Care and Cleaning Guide", weight: 2 },
  { question: "How long is the warranty on the Aurora?", topic: "Warranty", weight: 4 },
  { question: "Is limescale damage covered?", topic: "Warranty", weight: 2 },
  { question: "What grind setting for espresso on the Nimbus?", topic: "Nimbus 64 Flat Burr Grinder", weight: 4 },
  { question: "How much does the Aurora weigh?", topic: "Aurora Dual Boiler Espresso Machine", weight: 2 },
  { question: "Can I pause my Barrel Club subscription?", topic: "Barrel Club Coffee Subscription", weight: 3 },
  { question: "When is the showroom open?", topic: "About Bean & Barrel Coffee Co.", weight: 2 },
  // Gaps in the docs.
  { question: "Do you sell decaf beans?", topic: "Barrel Club Coffee Subscription", weight: 3, lowConfidence: true },
  { question: "Can the Aurora be plumbed into the mains water?", topic: "Aurora Dual Boiler Espresso Machine", weight: 2, lowConfidence: true },
  { question: "Do you offer a student discount?", topic: "Payments and Orders", weight: 2, lowConfidence: true },
  { question: "Will the Aurora work in the US on 110V?", topic: "Aurora Dual Boiler Espresso Machine", weight: 2, lowConfidence: true, handoff: true },
  { question: "Do you have bulk pricing for offices?", topic: "Payments and Orders", weight: 1, lowConfidence: true, handoff: true },
  // Needs a person.
  { question: "I want to cancel my order", topic: "Payments and Orders", weight: 3, handoff: true },
  { question: "My machine broke after two weeks, I'm not happy", topic: "Warranty", weight: 2, handoff: true },
  { question: "Can I speak to someone please?", topic: "About Bean & Barrel Coffee Co.", weight: 2, handoff: true },
];

const people = [
  ["Amelia Hughes", "amelia.h@example.com"], ["Oliver Bennett", "oliver.b@example.com"],
  ["Priya Shah", "priya.s@example.com"], ["Tom Walsh", "tom.w@example.com"],
  ["Chloe Martin", "chloe.m@example.com"], ["Daniel Okafor", "daniel.o@example.com"],
  ["Sophie Turner", "sophie.t@example.com"], ["Liam Murphy", "liam.m@example.com"],
] as const;

// Deterministic randomness, so every seed produces the same demo.
let state = 42;
const random = () => ((state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);
function pickTemplate(): Template {
  let r = random() * totalWeight;
  for (const t of templates) if ((r -= t.weight) < 0) return t;
  return templates[0]!;
}

await migrate();
await pool.query("DELETE FROM chat_logs WHERE session_id LIKE $1", [`${PREFIX}%`]);
await pool.query("DELETE FROM tickets WHERE session_id LIKE $1", [`${PREFIX}%`]);
if (args.clear) {
  console.log("Removed demo data.");
  await pool.end();
  process.exit(0);
}

const DAYS = 60;
let logs = 0;
let tickets = 0;
for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  // Gentle growth over the period, quieter weekends.
  const volume = Math.round((8 + (DAYS - daysAgo) * 0.18) * (weekend ? 0.6 : 1) * (0.75 + random() * 0.5));

  for (let i = 0; i < volume; i++) {
    const t = pickTemplate();
    const session = `${PREFIX}${daysAgo}-${i}`;
    const at = new Date(date);
    at.setUTCHours(8 + Math.floor(random() * 13), Math.floor(random() * 60), Math.floor(random() * 60));
    if (at > new Date()) at.setTime(Date.now() - random() * 3_600_000);

    const tools = [...(t.orderLookup ? ["get_order_status"] : []), ...(t.handoff ? ["escalate_to_human"] : [])];
    await pool.query(
      `INSERT INTO chat_logs (session_id, question, answer, top_similarity, low_confidence, stop_reason, served_by,
                              input_tokens, output_tokens, latency_ms, tools_used, handoff_offered, top_source, created_at)
       VALUES ($1, $2, $3, $4, $5, 'STOP', 'gemini-3.5-flash-lite', $6, $7, $8, $9, $10, $11, $12)`,
      [
        session, t.question, DEMO_ANSWER,
        t.lowConfidence ? 0.45 + random() * 0.13 : 0.66 + random() * 0.24,
        Boolean(t.lowConfidence), 1100 + Math.floor(random() * 1500), 60 + Math.floor(random() * 200),
        Math.round((t.orderLookup || t.handoff ? 3800 : 2400) + random() * 2200),
        tools, Boolean(t.handoff), t.topic, at,
      ],
    );
    logs++;

    // About two thirds of handoffs turn into a submitted contact form.
    if (t.handoff && random() < 0.65) {
      const [name, email] = pick(people);
      const submitted = new Date(at.getTime() + 60_000 + random() * 240_000);
      await pool.query(
        `INSERT INTO tickets (session_id, name, email, message, transcript, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session, name, email, t.question,
          JSON.stringify([{ question: t.question, answer: DEMO_ANSWER, created_at: at.toISOString() }]),
          daysAgo > 3 ? "closed" : "open", submitted,
        ],
      );
      tickets++;
    }
  }
}

console.log(`Seeded ${logs} questions and ${tickets} tickets over ${DAYS} days (session ids start with "${PREFIX}").`);
await pool.end();
