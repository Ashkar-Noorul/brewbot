import { config } from "./config.ts";
import { pool, toVector } from "./db.ts";
import { embed } from "./embeddings.ts";

export interface RetrievedChunk {
  path: string;
  title: string;
  section: string;
  content: string;
  similarity: number;
}

export async function search(query: string, topK = config.RETRIEVAL_TOP_K): Promise<RetrievedChunk[]> {
  const embedding = await embed(query, "query");
  // Vectors from different embedding models aren't comparable, so only search
  // chunks embedded with the model currently configured.
  const { rows } = await pool.query<RetrievedChunk>(
    `SELECT path, title, section, content, 1 - (embedding <=> $1::vector) AS similarity
       FROM chunks
      WHERE embedding_model = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toVector(embedding), config.EMBEDDING_MODEL, topK],
  );
  if (rows.length === 0) {
    throw new Error(`No chunks embedded with ${config.EMBEDDING_MODEL}. Run "npm run ingest" first.`);
  }
  return rows;
}
