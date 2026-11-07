import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatTurn } from "@brewbot/shared";
import { FriendlyError, streamChat } from "./api.ts";
import type { WidgetConfig } from "./config.ts";
import { HandoffForm } from "./HandoffForm.tsx";
import { Message, type UiMessage } from "./Message.tsx";
import { load, save, sessionId } from "./storage.ts";

const HISTORY_KEY = "brewbot:history";
// The API accepts up to 40 turns; keep the most recent ones.
const MAX_TURNS = 20;

const TOOL_STATUS: Record<string, string> = {
  get_order_status: "Checking your order…",
  escalate_to_human: "Getting our team…",
};

export function App({ config }: { config: WidgetConfig }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>(() => load(() => sessionStorage, HISTORY_KEY, []));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy) save(() => sessionStorage, HISTORY_KEY, messages);
  }, [messages, busy]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, handoffOpen, toolStatus, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const updateLast = (change: (m: UiMessage) => UiMessage) =>
    setMessages((prev) => [...prev.slice(0, -1), change(prev.at(-1)!)]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const history: ChatTurn[] = [
      ...messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: question },
    ].slice(-MAX_TURNS);

    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      await streamChat(config.apiUrl, { sessionId: sessionId(), messages: history }, (event) => {
        if (event.type === "sources") updateLast((m) => ({ ...m, sources: event.sources }));
        if (event.type === "delta") {
          setToolStatus(null);
          updateLast((m) => ({ ...m, content: m.content + event.text }));
        }
        if (event.type === "tool") setToolStatus(TOOL_STATUS[event.name] ?? "Working on it…");
        if (event.type === "handoff") setHandoffOpen(true);
        if (event.type === "error") updateLast((m) => ({ ...m, content: event.message, error: true }));
      });
    } catch (error) {
      updateLast((m) => ({
        ...m,
        content:
          error instanceof FriendlyError
            ? error.message
            : "Sorry, I couldn't reach our support assistant. Please check your connection and try again.",
        error: true,
      }));
    } finally {
      setBusy(false);
      setToolStatus(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const lastQuestion = messages.findLast((m) => m.role === "user")?.content ?? "";
  const waitingForText = busy && messages.at(-1)?.content === "";

  return (
    <div className="root" style={{ "--brand": config.color } as React.CSSProperties}>
      {open && (
        <section
          className="panel"
          role="dialog"
          aria-label={config.title}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          <header className="header">
            <div>
              <div className="title">{config.title}</div>
              <div className="subtitle">Answers from our help centre</div>
            </div>
            <div className="header-actions">
              <button className="header-btn" onClick={() => setHandoffOpen(true)} disabled={handoffOpen}>
                Talk to a person
              </button>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          <div className="messages" ref={listRef} aria-live="polite">
            <div className="msg msg-bot">
              <div className="msg-text">{config.greeting}</div>
            </div>
            {messages.map((m, i) =>
              // While the answer is still empty, the typing indicator below stands in for it.
              waitingForText && i === messages.length - 1 ? null : (
                <Message key={i} message={m} streaming={busy && i === messages.length - 1} />
              ),
            )}
            {(waitingForText || toolStatus) && (
              <div className="typing" aria-label={toolStatus ?? "BrewBot is typing"}>
                <span className="dots">
                  <span />
                  <span />
                  <span />
                </span>
                {toolStatus && <span className="tool-status">{toolStatus}</span>}
              </div>
            )}
            {handoffOpen && !busy && (
              <HandoffForm
                apiUrl={config.apiUrl}
                sessionId={sessionId()}
                initialMessage={lastQuestion}
                onDone={() => setHandoffOpen(false)}
              />
            )}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={2000}
              placeholder="Ask about orders, returns, machines…"
              aria-label="Your message"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" />
              </svg>
            </button>
          </form>
        </section>
      )}

      <button
        className="launcher"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : `Open ${config.title}`}
        aria-expanded={open}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path
              d="M4 5h16v11H8l-4 4V5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
