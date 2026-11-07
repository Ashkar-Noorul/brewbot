import cors from "cors";
import express from "express";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { chatRouter } from "./routes/chat.ts";

const app = express();
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

app.get("/health", async (_req, res) => {
  const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM chunks");
  res.json({ ok: true, provider: config.LLM_PROVIDER, model: config.CHAT_MODEL, chunks: Number(rows[0]?.count) });
});

app.use(chatRouter);

app.listen(config.PORT, () => {
  console.log(`BrewBot API on http://localhost:${config.PORT} (${config.LLM_PROVIDER}, ${config.CHAT_MODEL})`);
});
