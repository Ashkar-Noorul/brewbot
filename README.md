# BrewBot: a RAG support chatbot

BrewBot is a customer-support chatbot for **Bean & Barrel Coffee Co.**, a fictional online shop that sells espresso machines and grinders. It answers **only from the shop's own documents**, cites a source for each answer, and when the answer isn't in the documents it says so instead of guessing.

> Status: **Milestones 1–3**: streaming `/chat` API with citations, an embeddable chat widget, order lookups and human handoff. Analytics and evals are still to come (see the [roadmap](#roadmap)).

## Architecture

```
data/docs/*.md ──► ingest script ──► chunk by heading ──► embeddings ──────► Postgres + pgvector
                                                                                      │
visitor ──► POST /chat (SSE) ──► embed question ──► top-k similarity search ◄──────────┘
                                      │
                                      ▼
                      LLM (Gemini / Claude) with numbered sources ──► streamed answer + [n] citations
                                      │
                                      ▼
                              chat_logs table (analytics)
```

| Piece | Choice | Why |
|---|---|---|
| LLM | Pluggable: Gemini 3.5 Flash-Lite (free tier), Claude Sonnet 5.5 via the Claude API, or Claude on Amazon Bedrock | No vendor lock-in; models can be compared on the same eval set. Bedrock keeps data in the client's AWS account |
| Embeddings | Pluggable: Gemini Embedding 2 or Amazon Titan Text Embeddings V2, 1024 dims, normalised | Each chunk records which model embedded it, so vectors from different models are never mixed |
| Vector store | Postgres + pgvector (HNSW, cosine) | One database for vectors, logs and tickets; no extra managed service to pay for |
| API | Node.js, TypeScript, Express 5, Zod | Typed end to end; types shared with the widget via `packages/shared` |
| Streaming | Server-sent events | Simple, works through most proxies, easy to consume from the widget |

### Design decisions
- **Chunk by markdown heading.** Each chunk covers one topic (for example "Error E03"), so retrieval brings back focused context. The document title is added to the start of every chunk so the embedding knows which product or policy the chunk belongs to.
- **Retrieval uses the last two user messages.** This lets a follow-up like "and for the grinder?" still retrieve the right documents.
- **Low-confidence flag.** If the best match falls below `LOW_CONFIDENCE_THRESHOLD`, the model is told the answer probably isn't in the documents, and the flag is logged. These logs feed the "unanswered questions" report.
- **Provider abstraction.** `llm.ts` and `embeddings.ts` hide each vendor behind one function, so switching is a `.env` change.
- **Refusal handling.** On Bedrock, refused requests are retried on a fallback model through the SDK's `betaRefusalFallbackMiddleware`. On the Claude API, the server-side `fallbacks: "default"` parameter does the same job. If every model refuses, the visitor is offered a human.
- **Stateless API.** The client sends the conversation history, so the API can scale horizontally.

## Project layout

```
apps/api            Express API: ingestion, retrieval, /chat; also serves the widget and demo page
apps/widget         Embeddable React chat widget, built to a single brewbot.js
  db/schema.sql     pgvector tables (chunks, chat_logs)
  src/scripts/ingest.ts
packages/shared     Types shared by the API, widget and dashboard
data/docs           The fictional shop's knowledge base (10 markdown docs)
requests.http       Sample requests (VS Code REST Client)
```

## Running locally

Prerequisites: Node 22+, Docker, and a key for at least one provider. The cheapest is a free Gemini API key from [Google AI Studio](https://aistudio.google.com), which covers both chat and embeddings.

```bash
npm install
cp .env.example .env        # then set GEMINI_API_KEY (or pick other providers, see comments in the file)
npm run smoke               # checks the keys and model access
npm run db:up               # Postgres + pgvector on :5433, schema applied automatically
npm run ingest              # chunk + embed data/docs
npm run dev                 # API on http://localhost:3001
```

Try it:

```bash
curl -N http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo","messages":[{"role":"user","content":"My Aurora is showing E03, what do I do?"}]}'
```

The response is a stream of events:

```
data: {"type":"sources","sources":[{"id":1,"title":"Aurora Troubleshooting Guide","section":"Error E03: temperature sensor fault",...}],"lowConfidence":false}
data: {"type":"delta","text":"E03 means the brew boiler temperature sensor..."}
data: {"type":"done","stopReason":"end_turn","servedBy":"anthropic.claude-sonnet-5-5","usage":{...}}
```

## Tools and human handoff

The model can call two tools, defined once in `apps/api/src/tools.ts` and adapted to each provider:

| Tool | What it does | Safeguards |
|---|---|---|
| `get_order_status` | Looks up an order (mock `orders` table standing in for a Shopify or WooCommerce API) | Needs **both** order number and email; the reply is the same whether the number or the email was wrong, so it can't be used to find out which orders exist; arguments validated with Zod before running |
| `escalate_to_human` | Shows the visitor a contact form | Backed up by a check in code: if the visitor clearly asks for a person, the form is offered even when the model forgets to call the tool |

Submitting the form calls `POST /handoff`, which creates a row in `tickets` with the conversation transcript taken from the server's own `chat_logs` (not from the browser, so it can't be forged), and optionally posts to a Slack-compatible `HANDOFF_WEBHOOK_URL`. The form is also offered when the model refuses, or when the AI provider is rate-limited or down, so the visitor never hits a dead end.

**Guardrails:** per-IP rate limits (`CHAT_RATE_LIMIT_PER_MINUTE`, 5 handoffs an hour), tool loop capped at 4 rounds, tool results and sources treated as data rather than instructions, input length limits, and the database schema is applied automatically on startup (`db/schema.sql` is idempotent).

## The chat widget

Any website can add the bot with one tag:

```html
<script src="https://your-api.example.com/brewbot.js"
        data-title="Bean & Barrel Help" data-color="#7a4b2a" defer></script>
```

- **One file:** React and the CSS are bundled into `brewbot.js` (about 72 KB gzipped).
- **Shadow DOM:** the host site's CSS can't restyle the widget, and the widget's CSS can't leak into the site, so it works on any WordPress or Shopify theme.
- **Configured by `data-*` attributes:** `data-title`, `data-color`, `data-greeting`, and `data-api-url` (defaults to wherever the script was loaded from).
- **Streaming answers** with citation chips and a list of the sources each answer used.
- **Mobile and accessibility:** full screen on phones, dark mode, keyboard support (Enter to send, Escape to close), screen-reader labels, reduced motion.
- The conversation survives page navigation within a tab (sessionStorage); a visitor id in localStorage groups their chats in the logs.

`npm start` builds the widget and serves a demo shop page at http://localhost:3001 with the bot embedded. For widget development, run `npm run dev:widget` (rebuilds on save) alongside `npm run dev`.

## Roadmap

- [x] **M1**: knowledge base, ingestion, RAG `/chat` with citations and streaming, chat logging
- [x] **M2**: embeddable React widget (`<script>` tag) and demo page
- [ ] **M2b**: deploy the API and demo page publicly
- [x] **M3**: human handoff (contact form, tickets, webhook), `get_order_status` tool, guardrails
- [ ] **M4**: analytics dashboard (top questions, unanswered rate, feedback), eval suite with accuracy score, CI/CD and IaC
