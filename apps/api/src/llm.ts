import Anthropic, { BetaFallbackState, betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { FinishReason, GoogleGenAI, ThinkingLevel, type Content, type FunctionCall, type Part } from "@google/genai";
import { z } from "zod";
import type { ChatTurn } from "@brewbot/shared";
import { config } from "./config.ts";
import { runTool, tools } from "./tools.ts";

export interface AnswerRequest {
  sessionId: string;
  system: string;
  messages: ChatTurn[];
  /** Called with each piece of answer text as it streams in. */
  onText: (text: string) => void;
  /** Called when the model calls a tool, before it runs. */
  onToolCall: (name: string) => void;
}

export interface AnswerResult {
  stopReason: string | null;
  /** True when the model declined to answer for safety reasons. */
  refused: boolean;
  servedBy: string;
  toolsUsed: string[];
  usage: { inputTokens: number; outputTokens: number };
}

// Caps the call-tool / read-result loop so a confused model can't loop forever.
const MAX_TOOL_ROUNDS = 4;

/** Streams an answer from whichever provider LLM_PROVIDER selects, running any tools it calls. */
export function streamAnswer(request: AnswerRequest): Promise<AnswerResult> {
  return config.LLM_PROVIDER === "gemini" ? streamGemini(request) : streamClaude(request);
}

/** JSON Schema for a tool's input, in the strict form both providers accept. */
function inputSchema(input: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(input) as Record<string, unknown>;
  return { ...schema, additionalProperties: false };
}

/** Separates text written before a tool call from the text written after it. */
function textJoiner(onText: (text: string) => void) {
  let last = "";
  let needsBreak = false;
  return {
    write(text: string) {
      if (needsBreak && last && !/\s$/.test(last)) onText("\n\n");
      needsBreak = false;
      last = text;
      onText(text);
    },
    nextRound() {
      needsBreak = true;
    },
  };
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

const geminiTools = [
  {
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: inputSchema(t.input),
    })),
  },
];

async function streamGemini({ system, messages, onText, onToolCall }: AnswerRequest): Promise<AnswerResult> {
  gemini ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const contents: Content[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const text = textJoiner(onText);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const toolsUsed: string[] = [];
  let finishReason: string | undefined;
  let blocked = false;
  let servedBy = config.CHAT_MODEL;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await gemini.models.generateContentStream({
      model: config.CHAT_MODEL,
      contents,
      config: {
        systemInstruction: system,
        thinkingConfig: { thinkingLevel: geminiThinking[config.CHAT_EFFORT] },
        tools: geminiTools,
      },
    });

    // Every part is kept so the model's turn can be sent back as-is: Gemini requires the
    // thought signatures attached to function calls on the follow-up request.
    const parts: Part[] = [];
    const calls: FunctionCall[] = [];
    let roundUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) text.write(part.text);
        if (part.functionCall) calls.push(part.functionCall);
      }
      finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      blocked ||= Boolean(chunk.promptFeedback?.blockReason);
      servedBy = chunk.modelVersion ?? servedBy;
      if (chunk.usageMetadata) {
        roundUsage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens:
            (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
        };
      }
    }
    usage.inputTokens += roundUsage.inputTokens;
    usage.outputTokens += roundUsage.outputTokens;

    if (calls.length === 0 || blocked) break;

    contents.push({ role: "model", parts });
    const responses = await Promise.all(
      calls.map(async (call) => {
        const name = call.name ?? "";
        onToolCall(name);
        toolsUsed.push(name);
        const { result, isError } = await runTool(name, call.args ?? {});
        return { functionResponse: { id: call.id, name, response: isError ? { error: result } : { output: result } } };
      }),
    );
    contents.push({ role: "user", parts: responses });
    text.nextRound();
  }

  return {
    stopReason: finishReason ?? null,
    refused: blocked || (finishReason !== undefined && geminiRefusals.has(finishReason)),
    servedBy,
    toolsUsed,
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

const claudeTools: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: inputSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
  strict: true,
  eager_input_streaming: true,
}));

// Pins each conversation to whichever model last accepted it, so a fallback sticks for the session.
const fallbackStates = new Map<string, BetaFallbackState>();

async function streamClaude({ sessionId, system, messages, onText, onToolCall }: AnswerRequest): Promise<AnswerResult> {
  const conversation: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const text = textJoiner(onText);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const toolsUsed: string[] = [];
  let final: Anthropic.Beta.BetaMessage | undefined;

  let fallbackState = fallbackStates.get(sessionId);
  if (!fallbackState) {
    fallbackState = new BetaFallbackState();
    fallbackStates.set(sessionId, fallbackState);
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const params = {
      model: config.CHAT_MODEL,
      max_tokens: 16000,
      system,
      messages: conversation,
      tools: claudeTools,
      output_config: { effort: config.CHAT_EFFORT },
    };
    const stream =
      config.LLM_PROVIDER === "anthropic"
        ? claudeClient().beta.messages.stream({
            ...params,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          })
        : claudeClient().beta.messages.stream(params, { fallbackState });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text.write(event.delta.text);
      }
    }
    final = await stream.finalMessage();
    usage.inputTokens += final.usage.input_tokens;
    usage.outputTokens += final.usage.output_tokens;

    // Only run tools on a clean tool_use stop: after max_tokens or a refusal the inputs may be incomplete.
    if (final.stop_reason !== "tool_use") break;

    const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    // The assistant turn goes back unchanged (thinking blocks included), as the API requires.
    conversation.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        onToolCall(use.name);
        toolsUsed.push(use.name);
        const { result, isError } = await runTool(use.name, use.input);
        return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result), is_error: isError };
      }),
    );
    conversation.push({ role: "user", content: results });
    text.nextRound();
  }

  return {
    stopReason: final?.stop_reason ?? null,
    refused: final?.stop_reason === "refusal",
    servedBy: final?.model ?? config.CHAT_MODEL,
    toolsUsed,
    usage,
  };
}
