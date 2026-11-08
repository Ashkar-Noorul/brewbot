import { useMemo, useState } from "react";
import type { WeakQuestion } from "@brewbot/shared";
import { formatCount, formatDateTime } from "./format.ts";

interface Group {
  question: string;
  count: number;
  lowConfidence: number;
  handedOff: number;
  topSource: string | null;
  latest: WeakQuestion;
}

const INITIAL_ROWS = 10;

/** The same question asked many times is one docs gap, so group by the (normalised) question text. */
function group(rows: WeakQuestion[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = row.question.trim().toLowerCase().replace(/[?!.\s]+$/, "");
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.lowConfidence += Number(row.lowConfidence);
      g.handedOff += Number(row.handoffOffered);
      if (row.createdAt > g.latest.createdAt) g.latest = row;
    } else {
      groups.set(key, {
        question: row.question,
        count: 1,
        lowConfidence: Number(row.lowConfidence),
        handedOff: Number(row.handoffOffered),
        topSource: row.topSource,
        latest: row,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.latest.createdAt.localeCompare(a.latest.createdAt));
}

export function WeakQuestions({ rows }: { rows: WeakQuestion[] }) {
  const groups = useMemo(() => group(rows), [rows]);
  const [showAll, setShowAll] = useState(false);
  if (!groups.length) return <p className="state empty">Nothing to fix: every question in this period had a good answer.</p>;
  const visible = showAll ? groups : groups.slice(0, INITIAL_ROWS);

  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Question (expand for the bot's last answer)</th>
              <th scope="col" className="num">Asked</th>
              <th scope="col">Why it's here</th>
              <th scope="col">Closest doc</th>
              <th scope="col">Last asked</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.latest.id}>
                <td className="wide">
                  <details>
                    <summary>{g.question}</summary>
                    <p className="answer">{g.latest.answer}</p>
                    {g.latest.topSimilarity !== null && (
                      <p className="muted small">Best match score {g.latest.topSimilarity.toFixed(2)}</p>
                    )}
                  </details>
                </td>
                <td className="num">{formatCount(g.count)}</td>
                <td>
                  <span className="tags">
                    {g.lowConfidence > 0 && <span className="tag">No good match</span>}
                    {g.handedOff > 0 && <span className="tag">Handed off</span>}
                  </span>
                </td>
                <td>{g.topSource ?? <span className="muted">None</span>}</td>
                <td className="nowrap">{formatDateTime(g.latest.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groups.length > INITIAL_ROWS && (
        <button type="button" className="link more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${groups.length} questions`}
        </button>
      )}
      {rows.length >= 100 && <p className="muted small">Based on the 100 most recent weak answers.</p>}
    </>
  );
}
