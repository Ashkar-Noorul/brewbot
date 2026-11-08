import type { PeriodStats, StatsResponse } from "@brewbot/shared";
import { formatCount, formatPercent, formatSeconds } from "./format.ts";

type Better = "higher" | "lower" | "neither";

interface Tile {
  label: string;
  value: string;
  current: number;
  previous: number;
  /** Rates compare in percentage points; counts and times compare in percent. */
  kind: "count" | "rate" | "time";
  better: Better;
}

function tiles(current: PeriodStats, previous: PeriodStats): Tile[] {
  return [
    { label: "Questions", value: formatCount(current.questions), current: current.questions, previous: previous.questions, kind: "count", better: "neither" },
    { label: "Conversations", value: formatCount(current.conversations), current: current.conversations, previous: previous.conversations, kind: "count", better: "neither" },
    {
      label: "Handed to a person",
      value: formatPercent(current.handoffRate),
      current: current.handoffRate,
      previous: previous.handoffRate,
      kind: "rate",
      better: "lower",
    },
    {
      label: "No good match in docs",
      value: formatPercent(current.lowConfidenceRate),
      current: current.lowConfidenceRate,
      previous: previous.lowConfidenceRate,
      kind: "rate",
      better: "lower",
    },
    {
      label: "Average reply time",
      value: formatSeconds(current.avgLatencyMs),
      current: current.avgLatencyMs,
      previous: previous.avgLatencyMs,
      kind: "time",
      better: "lower",
    },
    { label: "Order lookups", value: formatCount(current.orderLookups), current: current.orderLookups, previous: previous.orderLookups, kind: "count", better: "neither" },
  ];
}

function Delta({ tile, hasPrevious }: { tile: Tile; hasPrevious: boolean }) {
  const period = "vs previous period";
  if (!hasPrevious) return <p className="delta">No earlier data to compare</p>;
  if (tile.kind !== "rate" && tile.previous === 0) return <p className="delta">None in the previous period</p>;

  const change = tile.kind === "rate" ? (tile.current - tile.previous) * 100 : ((tile.current - tile.previous) / tile.previous) * 100;
  const size = Math.abs(change);
  const text = tile.kind === "rate" ? `${size.toFixed(1)} pts` : `${size.toFixed(0)}%`;
  if (size < 0.05) return <p className="delta">No change {period}</p>;

  const up = change > 0;
  const verdict = tile.better === "neither" ? null : up === (tile.better === "higher") ? "better" : "worse";
  return (
    <p className={`delta ${verdict ?? ""}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span> <span className="sr-only">{up ? "Up" : "Down"}</span> {text} {period}
      {verdict && <span className="verdict"> · {verdict}</span>}
    </p>
  );
}

export function StatTiles({ stats }: { stats: StatsResponse }) {
  return (
    <div className="tiles">
      {tiles(stats.current, stats.previous).map((tile) => (
        <div className="tile" key={tile.label}>
          <p className="tile-label">{tile.label}</p>
          <p className="tile-value">
            {tile.value}
          </p>
          <Delta tile={tile} hasPrevious={stats.previous.questions > 0} />
        </div>
      ))}
      <div className="tile">
        <p className="tile-label">Open tickets</p>
        <p className="tile-value">{formatCount(stats.openTickets)}</p>
        <p className="delta">{stats.openTickets ? "Waiting for a reply" : "All caught up"}</p>
      </div>
    </div>
  );
}
