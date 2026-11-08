import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { PeriodStats, StatsResponse, Ticket, WeakQuestion } from "@brewbot/shared";
import { config } from "../config.ts";
import { pool } from "../db.ts";

export const adminRouter = Router();

/** Bearer-token check. Constant-time compare so the token can't be guessed from response timings. */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.ADMIN_TOKEN) {
    res.status(503).json({ error: "Analytics are disabled. Set ADMIN_TOKEN in .env to enable them." });
    return;
  }
  const given = Buffer.from(req.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(config.ADMIN_TOKEN);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  next();
}

adminRouter.use(requireAdmin);

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

async function periodStats(fromDaysAgo: number, toDaysAgo: number): Promise<PeriodStats> {
  const { rows } = await pool.query(
    `SELECT count(*)::int                                        AS questions,
            count(DISTINCT session_id)::int                      AS conversations,
            coalesce(avg(handoff_offered::int), 0)::float        AS handoff_rate,
            coalesce(avg(low_confidence::int), 0)::float         AS low_confidence_rate,
            coalesce(avg(latency_ms), 0)::float                  AS avg_latency_ms,
            count(*) FILTER (WHERE 'get_order_status' = ANY (tools_used))::int AS order_lookups
       FROM chat_logs
      WHERE created_at >= now() - make_interval(days => $1)
        AND created_at <  now() - make_interval(days => $2)`,
    [fromDaysAgo, toDaysAgo],
  );
  const r = rows[0];
  return {
    questions: r.questions,
    conversations: r.conversations,
    handoffRate: r.handoff_rate,
    lowConfidenceRate: r.low_confidence_rate,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    orderLookups: r.order_lookups,
  };
}

adminRouter.get("/stats", async (req, res) => {
  const { days } = daysQuery.parse(req.query);

  const [current, previous, tickets, daily, topics] = await Promise.all([
    periodStats(days, 0),
    periodStats(days * 2, days),
    pool.query("SELECT count(*)::int AS open FROM tickets WHERE status = 'open'"),
    // Every day in the range, including days with no questions, bucketed by UTC date.
    pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              count(c.id) FILTER (WHERE NOT c.handoff_offered)::int AS answered,
              count(c.id) FILTER (WHERE c.handoff_offered)::int     AS handed_off
         FROM generate_series((now() AT TIME ZONE 'UTC')::date - ($1::int - 1), (now() AT TIME ZONE 'UTC')::date, '1 day') AS d(day)
         LEFT JOIN chat_logs c ON (c.created_at AT TIME ZONE 'UTC')::date = d.day
        GROUP BY d.day ORDER BY d.day`,
      [days],
    ),
    pool.query(
      `SELECT coalesce(top_source, 'Not recorded') AS topic, count(*)::int AS questions
         FROM chat_logs
        WHERE created_at >= now() - make_interval(days => $1)
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
      [days],
    ),
  ]);

  res.json({
    days,
    current,
    previous,
    openTickets: tickets.rows[0].open,
    daily: daily.rows.map((r) => ({ day: r.day, answered: r.answered, handedOff: r.handed_off })),
    topics: topics.rows,
  } satisfies StatsResponse);
});

/** Questions the bot struggled with: the list to improve the docs from. */
adminRouter.get("/weak-questions", async (req, res) => {
  const { days } = daysQuery.parse(req.query);
  const { rows } = await pool.query(
    `SELECT id::int, created_at, question, answer, top_similarity, low_confidence, handoff_offered, top_source
       FROM chat_logs
      WHERE created_at >= now() - make_interval(days => $1)
        AND (low_confidence OR handoff_offered)
      ORDER BY created_at DESC LIMIT 100`,
    [days],
  );
  res.json(
    rows.map(
      (r): WeakQuestion => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        question: r.question,
        answer: r.answer,
        topSimilarity: r.top_similarity,
        lowConfidence: r.low_confidence,
        handoffOffered: r.handoff_offered,
        topSource: r.top_source,
      }),
    ),
  );
});

adminRouter.get("/tickets", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id::int, created_at, name, email, message, status, transcript
       FROM tickets ORDER BY (status = 'open') DESC, created_at DESC LIMIT 100`,
  );
  res.json(
    rows.map(
      (r): Ticket => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        name: r.name,
        email: r.email,
        message: r.message,
        status: r.status,
        transcript: r.transcript,
      }),
    ),
  );
});

adminRouter.patch("/tickets/:id", async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const body = z.object({ status: z.enum(["open", "closed"]) }).safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "Expected a ticket id and { status: 'open' | 'closed' }" });
    return;
  }
  const { rowCount } = await pool.query("UPDATE tickets SET status = $1 WHERE id = $2", [body.data.status, id.data]);
  res.status(rowCount ? 204 : 404).end();
});
