import type { ChatStreamEvent, ChatTurn, Source } from "@brewbot/shared";
import { config } from "./config.ts";
import { streamAnswer, type AnswerResult } from "./llm.ts";
import { buildMessages, SYSTEM_PROMPT } from "./prompt.ts";
import { search } from "./retrieval.ts";
import { ESCALATE_TOOL } from "./tools.ts";

const EMPTY_REPLY =
  "Sorry, I couldn't put together an answer to that. If you leave your details below, our team will get back to you.";

const REFUSAL_REPLY =
  "Sorry, I can't help with that one. If you'd like, leave your details below and our team will get back to you.";

// A deterministic backstop for the escalate_to_human tool: smaller models sometimes reply
// "I've connected you" without calling it, and a visitor asking for a person must always get the form.
const HUMAN_REQUEST =
  /\b(speak|talk|chat|connect me)\b.{0,30}\b(human|person|someone|agent|representative|staff|team)\b|\b(human|agent|representative)\b.{0,30}\b(speak|talk|chat)\b|\breal (person|human)\b/i;

// The answer tells the visitor a form is open or the team is involved. Models sometimes say this
// without calling escalate_to_human; when they do, the form is shown so the claim is true.
export const CLAIMS_HANDOFF =
  /\b(i('ve| have)?|i'll|we('ve| have)?)\b[^.!?]{0,40}\b(opened|pulled up|brought up|connected|transferred|passed (you|this|your)|escalated|forwarded|notified)\b|\b(form|contact form)\b[^.!?]{0,30}\b(has (just )?(opened|appeared)|is now (showing|open))/i;

/** Why the contact form was offered: the model's tool call, or one of the code-level backstops. */
export type HandoffReason = "tool" | "asked-for-human" | "claimed-in-answer" | "refused" | "empty-answer";

export interface AnswerOutcome {
  answer: string;
  sources: Source[];
  topSimilarity: number;
  lowConfidence: boolean;
  handoffOffered: boolean;
  handoffReasons: HandoffReason[];
  result: AnswerResult;
}

/**
 * The whole answering pipeline: retrieve sources, ask the model (running any tools it calls),
 * and decide whether to offer a human. Used by POST /chat and by the eval suite, so evals
 * measure exactly what visitors get.
 */
export async function answerQuestion(
  sessionId: string,
  messages: ChatTurn[],
  onEvent: (event: ChatStreamEvent) => void = () => {},
): Promise<AnswerOutcome> {
  const question = messages.at(-1)!.content;

  // Include the previous user turn so follow-ups like "what about the grinder?" retrieve well.
  const query = messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join("\n");
  const chunks = await search(query);
  const topSimilarity = chunks[0]?.similarity ?? 0;
  const lowConfidence = topSimilarity < config.LOW_CONFIDENCE_THRESHOLD;

  const sources: Source[] = chunks.map((c, i) => ({
    id: i + 1,
    title: c.title,
    section: c.section,
    path: c.path,
    similarity: Number(c.similarity.toFixed(3)),
  }));
  onEvent({ type: "sources", sources, lowConfidence });

  let answer = "";
  const ask = () =>
    streamAnswer({
      sessionId,
      system: SYSTEM_PROMPT,
      messages: buildMessages(messages, chunks, lowConfidence),
      onText: (text) => {
        answer += text;
        onEvent({ type: "delta", text });
      },
      onToolCall: (name) => onEvent({ type: "tool", name }),
    });

  let result = await ask();
  // Models occasionally return an empty completion. Nothing has reached the visitor yet, so retry once.
  let empty = !answer.trim() && !result.refused;
  if (empty) {
    result = await ask();
    empty = !answer.trim() && !result.refused;
  }
  if (empty) {
    answer = EMPTY_REPLY;
    onEvent({ type: "delta", text: EMPTY_REPLY });
  }

  if (result.refused) {
    const reply = (answer ? "\n\n" : "") + REFUSAL_REPLY;
    answer += reply;
    onEvent({ type: "delta", text: reply });
  }

  const handoffReasons: HandoffReason[] = [];
  if (result.toolsUsed.includes(ESCALATE_TOOL)) handoffReasons.push("tool");
  if (HUMAN_REQUEST.test(question)) handoffReasons.push("asked-for-human");
  if (CLAIMS_HANDOFF.test(answer)) handoffReasons.push("claimed-in-answer");
  if (result.refused) handoffReasons.push("refused");
  if (empty) handoffReasons.push("empty-answer");
  const handoffOffered = handoffReasons.length > 0;
  if (handoffOffered) onEvent({ type: "handoff" });

  return { answer, sources, topSimilarity, lowConfidence, handoffOffered, handoffReasons, result };
}

/** Rate-limited (429) or overloaded (503, 529) errors from the model provider; both SDKs expose `status`. */
export function isProviderBusy(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 429 || status === 503 || status === 529;
}
