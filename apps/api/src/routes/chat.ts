import { Router } from "express";
import { z } from "zod";
import type { ChatStreamEvent } from "@brewbot/shared";
import { answerQuestion, isProviderBusy } from "../answer.ts";
import { pool } from "../db.ts";

const chatRequest = z.object({
  sessionId: z.string().min(1).max(100),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40)
    .refine((m) => m.at(-1)?.role === "user", "The last message must be from the user"),
});

const BUSY_REPLY =
  "Our assistant is very busy right now. Leave your details below and our team will reply within one working day.";

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res) => {
  const parsed = chatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { sessionId, messages } = parsed.data;
  const started = Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: ChatStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    const outcome = await answerQuestion(sessionId, messages, send);
    const { result } = outcome;
    send({ type: "done", stopReason: result.stopReason, servedBy: result.servedBy, usage: result.usage });

    await pool.query(
      `INSERT INTO chat_logs (session_id, question, answer, top_similarity, low_confidence, stop_reason,
                              served_by, input_tokens, output_tokens, latency_ms, tools_used, handoff_offered,
                              top_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        sessionId, messages.at(-1)!.content, outcome.answer, outcome.topSimilarity, outcome.lowConfidence,
        result.stopReason, result.servedBy, result.usage.inputTokens, result.usage.outputTokens,
        Date.now() - started, result.toolsUsed, outcome.handoffOffered, outcome.sources[0]?.title ?? null,
      ],
    );
  } catch (error) {
    console.error("chat failed", error);
    if (isProviderBusy(error)) {
      // Out of quota or overloaded: rather than a dead end, offer the contact form.
      send({ type: "error", message: BUSY_REPLY });
      send({ type: "handoff" });
    } else {
      send({ type: "error", message: "Something went wrong. Please try again in a moment." });
    }
  } finally {
    res.end();
  }
});
