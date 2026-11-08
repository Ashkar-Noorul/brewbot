import type { TopicCount } from "@brewbot/shared";
import { formatCount, formatPercent } from "./format.ts";

/** Ranked horizontal bars. One series, so the title names it and there's no legend. */
export function TopicsChart({ topics, total }: { topics: TopicCount[]; total: number }) {
  if (!topics.length) return <p className="state empty">No questions in this period yet.</p>;
  const max = topics[0]!.questions;

  return (
    <ol className="ranked" aria-label="Questions per topic, most asked first">
      {topics.map((t) => (
        <li key={t.topic} title={`${t.topic}: ${formatCount(t.questions)} questions`}>
          <span className="ranked-label">{t.topic}</span>
          <span className="ranked-track" aria-hidden="true">
            <span className="ranked-bar" style={{ width: `${(t.questions / max) * 100}%` }} />
          </span>
          <span className="ranked-value">
            {formatCount(t.questions)} <span className="muted">· {formatPercent(total ? t.questions / total : 0)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
