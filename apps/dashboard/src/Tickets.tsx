import { useState } from "react";
import type { Ticket } from "@brewbot/shared";
import { api, UnauthorizedError } from "./api.ts";
import { formatDateTime } from "./format.ts";

interface Props {
  tickets: Ticket[];
  token: string;
  onChanged: () => void;
  onUnauthorized: () => void;
}

export function Tickets({ tickets, token, onChanged, onUnauthorized }: Props) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = tickets.filter((t) => t.status === "open").length;
  const shown = filter === "open" ? tickets.filter((t) => t.status === "open") : tickets;

  async function toggle(ticket: Ticket) {
    setPending(ticket.id);
    setError(null);
    try {
      await api.setTicketStatus(token, ticket.id, ticket.status === "open" ? "closed" : "open");
      onChanged();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onUnauthorized();
      setError(`Couldn't update ticket #${ticket.id}: ${(err as Error).message}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="segmented small" role="radiogroup" aria-label="Which tickets">
        <button type="button" role="radio" aria-checked={filter === "open"} className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>
          Open ({open})
        </button>
        <button type="button" role="radio" aria-checked={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          All ({tickets.length})
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!shown.length ? (
        <p className="state empty">{filter === "open" ? "No open tickets. All caught up." : "No tickets yet."}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Customer</th>
                <th scope="col">Message (expand for the chat)</th>
                <th scope="col">Opened</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={t.status === "closed" ? "closed" : undefined}>
                  <td className="num">{t.id}</td>
                  <td className="nowrap">
                    {t.name}
                    <br />
                    <a href={`mailto:${t.email}?subject=${encodeURIComponent(`Re: your support request #${t.id}`)}`}>{t.email}</a>
                  </td>
                  <td className="wide">
                    <details>
                      <summary>{t.message}</summary>
                      {t.transcript.length ? (
                        <ol className="transcript">
                          {t.transcript.map((turn, i) => (
                            <li key={i}>
                              <p>
                                <b>Customer:</b> {turn.question}
                              </p>
                              <p>
                                <b>Bot:</b> {turn.answer}
                              </p>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted small">No chat before this request.</p>
                      )}
                    </details>
                  </td>
                  <td className="nowrap">{formatDateTime(t.createdAt)}</td>
                  <td>
                    <span className={`status ${t.status}`}>{t.status === "open" ? "Open" : "Closed"}</span>
                  </td>
                  <td>
                    <button type="button" className="ghost small" disabled={pending === t.id} onClick={() => toggle(t)}>
                      {t.status === "open" ? "Close" : "Reopen"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
