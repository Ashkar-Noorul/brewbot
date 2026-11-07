import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenAI } from "@google/genai";
import { config } from "./config.ts";

// Must match the vector(1024) column in db/schema.sql.
export const EMBEDDING_DIMENSIONS = 1024;

/** "document" when ingesting chunks, "query" when embedding a visitor's question. */
export type EmbedKind = "document" | "query";

/** Returns a unit-length vector, so cosine similarity is a plain dot product. */
export async function embed(text: string, kind: EmbedKind): Promise<number[]> {
  return config.EMBEDDING_PROVIDER === "gemini" ? embedGemini(text, kind) : embedTitan(text);
}

let gemini: GoogleGenAI | undefined;

async function embedGemini(text: string, kind: EmbedKind): Promise<number[]> {
  gemini ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  // gemini-embedding-2 has no taskType option; the task is written into the text instead.
  const contents = kind === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
  const response = await gemini.models.embedContent({
    model: config.EMBEDDING_MODEL,
    contents,
    config: { outputDimensionality: EMBEDDING_DIMENSIONS },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values) throw new Error("Gemini returned no embedding");
  return values;
}

let bedrock: BedrockRuntimeClient | undefined;

async function embedTitan(text: string): Promise<number[]> {
  bedrock ??= new BedrockRuntimeClient({ region: config.AWS_REGION });
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: config.EMBEDDING_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(response.body)) as { embedding: number[] };
  return body.embedding;
}
