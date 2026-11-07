import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.ts";
import { migrate, pool } from "./db.ts";
import { chatRouter } from "./routes/chat.ts";
import { handoffRouter } from "./routes/handoff.ts";

// The built widget (brewbot.js) and its demo page, from "npm run build -w @brewbot/widget".
const widgetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../widget/dist");

await migrate();

const app = express();
// Behind a proxy or load balancer in production, so rate limits see the visitor's IP.
app.set("trust proxy", 1);
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

// Per-IP limits: each chat message costs money, and the order lookup shouldn't be brute-forced.
const limit = (windowMinutes: number, max: number) =>
  rateLimit({ windowMs: windowMinutes * 60_000, limit: max, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/health", async (_req, res) => {
  const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM chunks");
  res.json({ ok: true, provider: config.LLM_PROVIDER, model: config.CHAT_MODEL, chunks: Number(rows[0]?.count) });
});

app.use("/chat", limit(1, config.CHAT_RATE_LIMIT_PER_MINUTE));
app.use("/handoff", limit(60, 5));
app.use(chatRouter);
app.use(handoffRouter);
app.use(express.static(widgetDir));

app.listen(config.PORT, () => {
  console.log(`BrewBot API on http://localhost:${config.PORT} (${config.LLM_PROVIDER}, ${config.CHAT_MODEL})`);
});
