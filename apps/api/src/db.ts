import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.ts";

// Hosted Postgres (Neon) hands out "sslmode=require" URLs. node-postgres is changing that mode to
// libpq's meaning (encrypt but don't check the certificate), so ask for full verification explicitly.
const connectionString = config.DATABASE_URL.replace(/([?&])sslmode=require\b/, "$1sslmode=verify-full");

export const pool = new pg.Pool({ connectionString });

/** pgvector accepts the text form "[0.1,0.2,...]". */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/schema.sql");

/** Applies db/schema.sql. Every statement is idempotent, so this is safe on every start. */
export async function migrate(): Promise<void> {
  await pool.query(await readFile(schemaPath, "utf8"));
}
