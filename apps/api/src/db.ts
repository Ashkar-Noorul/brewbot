import pg from "pg";
import { config } from "./config.ts";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/** pgvector accepts the text form "[0.1,0.2,...]". */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
