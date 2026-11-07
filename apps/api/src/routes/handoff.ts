import { Router } from "express";
import { z } from "zod";
import type { HandoffResponse } from "@brewbot/shared";
import { config } from "../config.ts";
import { pool } from "../db.ts";

const handoffRequest = z.object({
  sessionId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  message: z.string().trim().min(1).max(2000),
});

export const handoffRouter = Router();

handoffRouter.post("/handoff", async (req, res) => {
  const parsed = handoffRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { sessionId, name, email, message } = parsed.data;

  // The transcript comes from the server's own logs, not from the browser, so it can't be forged.
  const { rows: turns } = await pool.query<{ question: string; answer: string; created_at: Date }>(
    `SELECT question, answer, created_at FROM chat_logs
      WHERE session_id = $1 ORDER BY id DESC LIMIT 20`,
    [sessionId],
  );
  const transcript = turns.reverse();

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tickets (session_id, name, email, message, transcript)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sessionId, name, email, message, JSON.stringify(transcript)],
  );
  const ticketId = Number(rows[0]!.id);

  if (config.HANDOFF_WEBHOOK_URL) {
    // Slack-compatible payload. A failed notification shouldn't fail the visitor's request.
    fetch(config.HANDOFF_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `New support ticket #${ticketId} from ${name} <${email}>\n>${message}\n(${transcript.length} chat turns attached)`,
      }),
    }).catch((error) => console.error("handoff webhook failed", error));
  }

  res.status(201).json({ ticketId } satisfies HandoffResponse);
});
