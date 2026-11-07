-- Idempotent: applied on every API start and ingest run, so it only ever adds what's missing.
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
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS tools_used TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS handoff_offered BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS chat_logs_session_idx ON chat_logs (session_id, id);

-- Requests for a human, created from the widget's contact form.
CREATE TABLE IF NOT EXISTS tickets (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  message     TEXT NOT NULL,
  transcript  JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mock order system for the get_order_status tool. In a real deployment this would be
-- the shop's order API (Shopify, WooCommerce, ...), not a table in the bot's database.
CREATE TABLE IF NOT EXISTS orders (
  order_number    TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL,
  items           TEXT[] NOT NULL,
  placed_at       DATE NOT NULL,
  carrier         TEXT,
  tracking_url    TEXT,
  estimated_delivery DATE
);

INSERT INTO orders VALUES
  ('BB-104233', 'alex@example.com', 'dispatched', ARRAY['Aurora Dual Boiler Espresso Machine'], '2026-11-03',
   'DPD', 'https://track.example.com/dpd/1Z104233', '2026-11-06'),
  ('BB-104512', 'sam@example.com', 'processing', ARRAY['Nimbus 64 Flat Burr Grinder', 'Cleaning tablets (x30)'], '2026-11-06',
   NULL, NULL, '2026-11-10'),
  ('BB-103877', 'priya@example.com', 'delivered', ARRAY['Water filter cartridges (pack of 3)'], '2026-10-28',
   'Royal Mail', 'https://track.example.com/rm/BB103877', '2026-10-30'),
  ('BB-104601', 'jordan@example.com', 'pre-order', ARRAY['Aurora Dual Boiler Espresso Machine'], '2026-11-05',
   NULL, NULL, '2026-11-24'),
  ('BB-102950', 'alex@example.com', 'cancelled', ARRAY['Barrel Club gift card (£50)'], '2026-10-12',
   NULL, NULL, NULL)
ON CONFLICT (order_number) DO NOTHING;
