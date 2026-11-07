import { Router } from "express";
import { z } from "zod";
import type { ChatStreamEvent, Source } from "@brewbot/shared";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { streamAnswer } from "../llm.ts";
import { buildMessages, SYSTEM_PROMPT } from "../prompt.ts";
import { search } from "../retrieval.ts";

const chatRequest = z.object({
  sessionId: z.string().min(1).max(100),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40)
    .refine((m) => m.at(-1)?.role === "user", "The last message must be from the user"),
});

const REFUSAL_REPLY =
  "Sorry, I can't help with that one. Would you like me to connect you with our support team?";

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res) => {
  const parsed = chatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { sessionId, messages } = parsed.data;
  const question = messages.at(-1)!.content;
  const started = Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: ChatStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
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
    send({ type: "sources", sources, lowConfidence });

    let answer = "";
    const result = await streamAnswer({
      sessionId,
      system: SYSTEM_PROMPT,
      messages: buildMessages(messages, chunks, lowConfidence),
      onText: (text) => {
        answer += text;
        send({ type: "delta", text });
      },
    });

    if (result.refused) {
      const reply = (answer ? "\n\n" : "") + REFUSAL_REPLY;
      answer += reply;
      send({ type: "delta", text: reply });
    }

    send({ type: "done", stopReason: result.stopReason, servedBy: result.servedBy, usage: result.usage });

    await pool.query(
      `INSERT INTO chat_logs (session_id, question, answer, top_similarity, low_confidence,
                              stop_reason, served_by, input_tokens, output_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId, question, answer, topSimilarity, lowConfidence, result.stopReason, result.servedBy,
        result.usage.inputTokens, result.usage.outputTokens, Date.now() - started,
      ],
    );
  } catch (error) {
    console.error("chat failed", error);
    send({ type: "error", message: "Something went wrong. Please try again in a moment." });
  } finally {
    res.end();
  }
});
