import type { ChatRequest, ChatStreamEvent, HandoffRequest, HandoffResponse } from "@brewbot/shared";

/** An error whose message is safe and helpful to show the visitor as-is. */
export class FriendlyError extends Error {}

export async function submitHandoff(apiUrl: string, request: HandoffRequest): Promise<HandoffResponse> {
  const response = await fetch(`${apiUrl}/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (response.status === 429) throw new FriendlyError("Too many requests. Please try again later.");
  if (!response.ok) throw new FriendlyError("Please check your name and email and try again.");
  return (await response.json()) as HandoffResponse;
}

/**
 * POSTs to /chat and calls onEvent for each server-sent event.
 * EventSource only supports GET, so the stream is read and parsed by hand.
 */
export async function streamChat(
  apiUrl: string,
  request: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (response.status === 429) {
    throw new FriendlyError("You're sending messages quite quickly. Please wait a minute and try again.");
  }
  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed with status ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Events are separated by a blank line; keep any incomplete event in the buffer.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").find((line) => line.startsWith("data: "));
      if (data) onEvent(JSON.parse(data.slice(6)) as ChatStreamEvent);
    }
  }
}
