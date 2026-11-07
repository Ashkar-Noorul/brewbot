import Anthropic, { BetaFallbackState, betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ChatTurn } from "@brewbot/shared";
import { config } from "./config.ts";

export interface AnswerRequest {
  sessionId: string;
  system: string;
  messages: ChatTurn[];
  /** Called with each piece of answer text as it streams in. */
  onText: (text: string) => void;
}

export interface AnswerResult {
  stopReason: string | null;
  /** True when the model declined to answer for safety reasons. */
  refused: boolean;
  servedBy: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Streams an answer from whichever provider LLM_PROVIDER selects. */
export function streamAnswer(request: AnswerRequest): Promise<AnswerResult> {
  return config.LLM_PROVIDER === "gemini" ? streamGemini(request) : streamClaude(request);
}

// --- Gemini -------------------------------------------------------------------

let gemini: GoogleGenAI | undefined;

const geminiThinking: Record<typeof config.CHAT_EFFORT, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

const geminiRefusals = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
]);

async function streamGemini({ system, messages, onText }: AnswerRequest): Promise<AnswerResult> {
  gemini ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const stream = await gemini.models.generateContentStream({
    model: config.CHAT_MODEL,
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    config: {
      systemInstruction: system,
      thinkingConfig: { thinkingLevel: geminiThinking[config.CHAT_EFFORT] },
    },
  });

  let finishReason: string | undefined;
  let blocked = false;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let servedBy = config.CHAT_MODEL;
  for await (const chunk of stream) {
    if (chunk.text) onText(chunk.text);
    finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
    blocked ||= Boolean(chunk.promptFeedback?.blockReason);
    servedBy = chunk.modelVersion ?? servedBy;
    if (chunk.usageMetadata) {
      usage = {
        inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
        outputTokens:
          (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
      };
    }
  }

  return {
    stopReason: finishReason ?? null,
    refused: blocked || (finishReason !== undefined && geminiRefusals.has(finishReason)),
    servedBy,
    usage,
  };
}

// --- Claude (Claude API or Amazon Bedrock) ------------------------------------

let claude: Anthropic | AnthropicBedrockMantle | undefined;

function claudeClient() {
  // On Bedrock the server-side `fallbacks` parameter is unavailable, so a refused
  // request is retried on FALLBACK_MODEL by client-side middleware instead.
  claude ??=
    config.LLM_PROVIDER === "bedrock"
      ? new AnthropicBedrockMantle({
          awsRegion: config.AWS_REGION,
          middleware: [betaRefusalFallbackMiddleware([{ model: config.FALLBACK_MODEL }])],
        })
      : new Anthropic();
  return claude;
}

// Pins each conversation to whichever model last accepted it, so a fallback sticks for the session.
const fallbackStates = new Map<string, BetaFallbackState>();

async function streamClaude({ sessionId, system, messages, onText }: AnswerRequest): Promise<AnswerResult> {
  const params = {
    model: config.CHAT_MODEL,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort: config.CHAT_EFFORT },
  };

  let stream;
  if (config.LLM_PROVIDER === "anthropic") {
    stream = claudeClient().beta.messages.stream({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } else {
    let fallbackState = fallbackStates.get(sessionId);
    if (!fallbackState) {
      fallbackState = new BetaFallbackState();
      fallbackStates.set(sessionId, fallbackState);
    }
    stream = claudeClient().beta.messages.stream(params, { fallbackState });
  }

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    }
  }
  const final = await stream.finalMessage();

  return {
    stopReason: final.stop_reason,
    refused: final.stop_reason === "refusal",
    servedBy: final.model,
    usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
  };
}
