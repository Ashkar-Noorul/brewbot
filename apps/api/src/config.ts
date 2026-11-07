import { z } from "zod";

const schema = z.object({
  LLM_PROVIDER: z.enum(["gemini", "anthropic", "bedrock"]).default("gemini"),
  EMBEDDING_PROVIDER: z.enum(["gemini", "bedrock"]).default("gemini"),
  AWS_REGION: z.string().default("us-east-1"),
  GEMINI_API_KEY: z.string().optional(),
  CHAT_MODEL: z.string().optional(),
  FALLBACK_MODEL: z.string().optional(),
  CHAT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  EMBEDDING_MODEL: z.string().optional(),
  DATABASE_URL: z.string().default("postgres://brewbot:brewbot@localhost:5433/brewbot"),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(5),
  LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  HANDOFF_WEBHOOK_URL: z.url().or(z.literal("")).optional(),
  PORT: z.coerce.number().int().default(3001),
  CORS_ORIGIN: z.string().default("*"),
});

const env = schema.parse(process.env);

const defaultChatModel = {
  // Flash-Lite has a much larger free-tier daily quota than Flash, which allows only ~20 requests a day.
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-sonnet-5-5",
  // Bedrock model IDs carry an "anthropic." prefix.
  bedrock: "anthropic.claude-sonnet-5-5",
}[env.LLM_PROVIDER];

const defaultEmbeddingModel = {
  gemini: "gemini-embedding-2",
  bedrock: "amazon.titan-embed-text-v2:0",
}[env.EMBEDDING_PROVIDER];

export const config = {
  ...env,
  CHAT_MODEL: env.CHAT_MODEL ?? defaultChatModel,
  // Only used on Bedrock, where refusal fallback runs client-side via middleware.
  FALLBACK_MODEL: env.FALLBACK_MODEL ?? "anthropic.claude-opus-4-8",
  EMBEDDING_MODEL: env.EMBEDDING_MODEL ?? defaultEmbeddingModel,
};
