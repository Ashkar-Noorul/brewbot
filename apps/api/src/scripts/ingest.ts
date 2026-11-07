// Reads every markdown file in data/docs, chunks it, embeds each chunk and
// replaces the contents of the chunks table. Safe to re-run after editing docs.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkMarkdown } from "../chunk.ts";
import { config } from "../config.ts";
import { pool, toVector } from "../db.ts";
import { embed } from "../embeddings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, "../../../../data/docs");

const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md")).sort();
const rows: { path: string; title: string; section: string; content: string; embedding: number[] }[] = [];

for (const file of files) {
  const markdown = await readFile(path.join(docsDir, file), "utf8");
  const chunks = chunkMarkdown(markdown, path.basename(file, ".md"));
  for (const chunk of chunks) {
    rows.push({ path: `data/docs/${file}`, ...chunk, embedding: await embed(chunk.content, "document") });
  }
  console.log(`${file}: ${chunks.length} chunks`);
}

const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query("TRUNCATE chunks");
  for (const r of rows) {
    await db.query(
      `INSERT INTO chunks (path, title, section, content, embedding_model, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [r.path, r.title, r.section, r.content, config.EMBEDDING_MODEL, toVector(r.embedding)],
    );
  }
  await db.query("COMMIT");
  console.log(`Ingested ${rows.length} chunks from ${files.length} documents with ${config.EMBEDDING_MODEL}.`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
