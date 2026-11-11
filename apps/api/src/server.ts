import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.ts";
import { migrate, pool } from "./db.ts";
import { adminRouter } from "./routes/admin.ts";
import { chatRouter } from "./routes/chat.ts";
import { handoffRouter } from "./routes/handoff.ts";

const appsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The built widget (brewbot.js) and its demo page, from "npm run build -w @brewbot/widget".
const widgetDir = path.join(appsDir, "widget/dist");
// The analytics dashboard, from "npm run build -w @brewbot/dashboard".
const dashboardDir = path.join(appsDir, "dashboard/dist");

await migrate();

const app = express();
// Behind proxies in production: trust exactly that many X-Forwarded-For hops, so rate limits see the
// visitor's IP. Trusting more than are really there would let visitors fake their IP.
app.set("trust proxy", config.TRUST_PROXY_HOPS);
app.use(express.json({ limit: "100kb" }));

// Per-IP limits: each chat message costs money, and the order lookup shouldn't be brute-forced.
const limit = (windowMinutes: number, max: number) =>
  rateLimit({ windowMs: windowMinutes * 60_000, limit: max, standardHeaders: "draft-8", legacyHeaders: false });

// Liveness only, never touches the database: for the host's health checks and uptime pingers, so
// they keep the app warm without keeping the (scale-to-zero) database awake around the clock.
app.get("/ping", (_req, res) => {
  res.type("text").send("ok");
});

// Readiness: also checks the database and that the docs are ingested.
app.get("/health", async (_req, res) => {
  const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM chunks");
  res.json({ ok: true, provider: config.LLM_PROVIDER, model: config.CHAT_MODEL, chunks: Number(rows[0]?.count) });
});

// Public, called from customers' sites by the widget.
const publicCors = cors({ origin: config.CORS_ORIGIN });
app.use("/chat", publicCors, limit(1, config.CHAT_RATE_LIMIT_PER_MINUTE));
app.use("/handoff", publicCors, limit(60, 5));
app.use(chatRouter);
app.use(handoffRouter);

// Admin API: same origin as the dashboard only (no CORS), token required, and rate limited
// so the token can't be brute-forced.
app.use("/api/admin", limit(1, 60), adminRouter);
app.use("/admin", express.static(dashboardDir));
app.get(/^\/admin(\/.*)?$/, (_req, res) => res.sendFile(path.join(dashboardDir, "index.html")));

app.use(express.static(widgetDir));

app.listen(config.PORT, () => {
  console.log(`BrewBot API on http://localhost:${config.PORT} (${config.LLM_PROVIDER}, ${config.CHAT_MODEL})`);
  console.log(`Analytics: http://localhost:${config.PORT}/admin ${config.ADMIN_TOKEN ? "" : "(disabled: set ADMIN_TOKEN)"}`);
});
