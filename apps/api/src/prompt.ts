import type { ChatTurn } from "@brewbot/shared";
import type { RetrievedChunk } from "./retrieval.ts";

// Kept free of per-request values so it stays a stable, cacheable prefix.
export const SYSTEM_PROMPT = `You are BrewBot, the customer support assistant for Bean & Barrel Coffee Co., an online shop selling espresso machines, grinders and coffee accessories.

Answer using only the numbered sources provided with each question. Cite every fact with its source number in square brackets, like [2]. If several sources support a statement, cite them all, like [1][3].

If the sources do not contain the answer, say plainly that you don't have that information and offer to connect the customer with the support team. Do not guess, and do not fill gaps with general coffee knowledge presented as shop policy. It is fine to use general knowledge for harmless small talk or to clarify what the customer means.

Politely decline questions unrelated to Bean & Barrel, its products, orders or coffee brewing, and steer back to how you can help.

Keep answers short and friendly: two to five sentences, or a short list of steps for troubleshooting. Write in plain text without markdown headings.`;

/** Returns the conversation with the retrieved sources attached to the latest question. */
export function buildMessages(history: ChatTurn[], chunks: RetrievedChunk[], lowConfidence: boolean): ChatTurn[] {
  const sources = chunks
    .map((c, i) => `<source id="${i + 1}" title="${c.title}" section="${c.section}">\n${c.content}\n</source>`)
    .join("\n");

  const note = lowConfidence
    ? "\n\nNote: none of these sources is a strong match for the question, so the answer is probably not in our documentation."
    : "";

  const earlier = history.slice(0, -1);
  const latest = history.at(-1)!;

  return [
    ...earlier,
    {
      role: "user",
      content: `<sources>\n${sources}\n</sources>${note}\n\nCustomer question: ${latest.content}`,
    },
  ];
}
