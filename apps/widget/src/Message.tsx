import type { Source } from "@brewbot/shared";

export interface UiMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
}

/** Renders an assistant answer, turning "[2]" markers into citation chips and listing the sources cited. */
export function Message({ message, streaming }: { message: UiMessage; streaming: boolean }) {
  if (message.role === "user") {
    return <div className="msg msg-user">{message.content}</div>;
  }

  const cited = new Set<number>();
  const parts = message.content.split(/(\[\d+\])/g).map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part);
    const source = match && message.sources?.find((s) => s.id === Number(match[1]));
    if (!source) return part;
    cited.add(source.id);
    return (
      <sup key={i} className="cite" title={`${source.title} › ${source.section}`}>
        {source.id}
      </sup>
    );
  });
  const citedSources = message.sources?.filter((s) => cited.has(s.id)) ?? [];

  return (
    <div className={`msg msg-bot${message.error ? " msg-error" : ""}`}>
      <div className="msg-text">
        {parts}
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>
      {!streaming && citedSources.length > 0 && (
        <ul className="sources" aria-label="Sources">
          {citedSources.map((s) => (
            <li key={s.id}>
              <span className="source-id">{s.id}</span>
              {s.title} › {s.section}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
