// Checks that credentials and model access work before running ingestion:
// one embedding call and one short chat call. Costs a fraction of a cent (or nothing on Gemini's free tier).
import { config } from "../config.ts";
import { embed } from "../embeddings.ts";
import { streamAnswer } from "../llm.ts";

try {
  const vector = await embed("Hello from BrewBot", "query");
  console.log(`✔ Embeddings (${config.EMBEDDING_PROVIDER}, ${config.EMBEDDING_MODEL}): ${vector.length} dimensions`);
} catch (error) {
  console.error(`✘ Embeddings (${config.EMBEDDING_PROVIDER}, ${config.EMBEDDING_MODEL}) failed:`, (error as Error).message);
}

try {
  let text = "";
  const result = await streamAnswer({
    sessionId: "smoke",
    system: "Reply in five words or fewer.",
    messages: [{ role: "user", content: "Say hello." }],
    onText: (t) => (text += t),
    onToolCall: () => {},
  });
  console.log(`✔ Chat (${config.LLM_PROVIDER}, ${result.servedBy}): "${text.trim()}"`);
} catch (error) {
  console.error(`✘ Chat (${config.LLM_PROVIDER}, ${config.CHAT_MODEL}) failed:`, (error as Error).message);
}
