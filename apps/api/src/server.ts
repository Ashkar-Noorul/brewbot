import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { chatRouter } from "./routes/chat.ts";

// The built widget (brewbot.js) and its demo page, from "npm run build -w @brewbot/widget".
const widgetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../widget/dist");

const app = express();
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

app.get("/health", async (_req, res) => {
  const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM chunks");
  res.json({ ok: true, provider: config.LLM_PROVIDER, model: config.CHAT_MODEL, chunks: Number(rows[0]?.count) });
});

app.use(chatRouter);
app.use(express.static(widgetDir));

app.listen(config.PORT, () => {
  console.log(`BrewBot API on http://localhost:${config.PORT} (${config.LLM_PROVIDER}, ${config.CHAT_MODEL})`);
});
