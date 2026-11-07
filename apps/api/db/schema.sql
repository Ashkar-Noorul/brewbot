CREATE EXTENSION IF NOT EXISTS vector;

-- One row per chunk of a source document, embedded at 1024 dims.
-- embedding_model records which model made the vector; vectors from different models can't be compared.
CREATE TABLE IF NOT EXISTS chunks (
  id               BIGSERIAL PRIMARY KEY,
  path             TEXT NOT NULL,
  title            TEXT NOT NULL,
  section          TEXT NOT NULL,
  content          TEXT NOT NULL,
  embedding_model  TEXT NOT NULL,
  embedding        vector(1024) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Every question the bot receives, for the analytics dashboard (milestone 4).
CREATE TABLE IF NOT EXISTS chat_logs (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  top_similarity  REAL,
  low_confidence  BOOLEAN NOT NULL,
  stop_reason     TEXT,
  served_by       TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
