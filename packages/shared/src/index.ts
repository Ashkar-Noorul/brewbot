// Types shared by the API, the widget and the dashboard.

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  /** Stable per-visitor id so analytics can group a conversation. */
  sessionId: string;
  /** Full conversation so far, ending with the visitor's latest message. */
  messages: ChatTurn[];
}

/** A retrieved chunk the answer can cite as [n]. */
export interface Source {
  id: number;
  title: string;
  section: string;
  path: string;
  similarity: number;
}

/** Server-sent events emitted by POST /chat, one JSON object per `data:` line. */
export type ChatStreamEvent =
  | { type: "sources"; sources: Source[]; lowConfidence: boolean }
  | { type: "delta"; text: string }
  | {
      type: "done";
      stopReason: string | null;
      servedBy: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; message: string };
