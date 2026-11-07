import { useState, type FormEvent } from "react";
import { FriendlyError, submitHandoff } from "./api.ts";
import { load, save } from "./storage.ts";

interface Props {
  apiUrl: string;
  sessionId: string;
  /** Pre-fills the message box, usually with the visitor's last question. */
  initialMessage: string;
  onDone: () => void;
}

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; ticketId: number } | { kind: "error"; message: string };

/** Contact form shown when the bot hands a conversation to the support team. */
export function HandoffForm({ apiUrl, sessionId, initialMessage, onDone }: Props) {
  const remembered = load<{ name?: string; email?: string }>(() => localStorage, "brewbot:contact", {});
  const [name, setName] = useState(remembered.name ?? "");
  const [email, setEmail] = useState(remembered.email ?? "");
  const [message, setMessage] = useState(initialMessage);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "sending" });
    try {
      const { ticketId } = await submitHandoff(apiUrl, { sessionId, name, email, message });
      save(() => localStorage, "brewbot:contact", { name, email });
      setStatus({ kind: "sent", ticketId });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof FriendlyError ? error.message : "Couldn't send right now. Please try again.",
      });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="handoff handoff-sent" role="status">
        <strong>Thanks, {name.split(" ")[0]}!</strong> Your request #{status.ticketId} is with our team. We'll email{" "}
        {email} within one working day.
        <button type="button" className="link-btn" onClick={onDone}>
          Back to chat
        </button>
      </div>
    );
  }

  return (
    <form className="handoff" onSubmit={onSubmit} aria-label="Contact the support team">
      <div className="handoff-title">Talk to our team</div>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={200}
          autoComplete="email"
        />
      </label>
      <label>
        How can we help?
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={2000} rows={3} />
      </label>
      {status.kind === "error" && <div className="handoff-error">{status.message}</div>}
      <div className="handoff-actions">
        <button type="button" className="link-btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary-btn" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? "Sending…" : "Send to team"}
        </button>
      </div>
    </form>
  );
}
