import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DailyCount } from "@brewbot/shared";
import { formatCount, formatDay, niceTicks } from "./format.ts";

const HEIGHT = 280;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 40 };
const MAX_BAR = 24;
const SEGMENT_GAP = 2;
const RADIUS = 4;

/** A column whose top corners are rounded and whose base stays square on the baseline. */
function topRoundedBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function DailyChart({ daily }: { daily: DailyCount[] }) {
  const [showTable, setShowTable] = useState(false);
  const total = daily.reduce((sum, d) => sum + d.answered + d.handedOff, 0);
  const handedOff = daily.reduce((sum, d) => sum + d.handedOff, 0);

  return (
    <div>
      <div className="chart-head">
        <ul className="legend" aria-label="Legend">
          <li>
            <span className="swatch answered" aria-hidden="true" /> Answered by the bot <span className="muted">{formatCount(total - handedOff)}</span>
          </li>
          <li>
            <span className="swatch handed-off" aria-hidden="true" /> Handed to a person <span className="muted">{formatCount(handedOff)}</span>
          </li>
        </ul>
        <button type="button" className="link" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {showTable ? <DailyTable daily={daily} /> : <Columns daily={daily} />}
    </div>
  );
}

function Columns({ daily }: { daily: DailyCount[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(...daily.map((d) => d.answered + d.handedOff), 0);
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const y = (v: number) => MARGIN.top + plotH - (v / top) * plotH;
  const band = daily.length ? plotW / daily.length : 0;
  const barW = Math.max(1, Math.min(MAX_BAR, band * 0.7));
  const baseline = MARGIN.top + plotH;

  // Label every nth day, counting back from today so the latest day is always labelled.
  const labelEvery = Math.max(1, Math.ceil(64 / Math.max(band, 1)));
  const last = daily.length - 1;

  function onKeyDown(event: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setActive((current) => Math.min(last, Math.max(0, (current ?? last) + move)));
  }

  const activeDay = active === null ? undefined : daily[active];
  const tooltipLeft = active === null ? 0 : MARGIN.left + band * (active + 0.5);

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          tabIndex={0}
          aria-label={`Questions per day, ${daily.length} days. Use the left and right arrow keys to read each day.`}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((current) => current ?? last)}
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {formatCount(t)}
              </text>
            </g>
          ))}

          {daily.map((d, i) => {
            const x = MARGIN.left + band * i + (band - barW) / 2;
            const hA = baseline - y(d.answered);
            const hH = baseline - y(d.handedOff);
            const gap = hA > 0 && hH > 0 ? SEGMENT_GAP : 0;
            return (
              <g key={d.day}>
                {active === i && <rect className="hover-band" x={MARGIN.left + band * i} y={MARGIN.top} width={band} height={plotH} />}
                {hA > 0 && (hH > 0 ? (
                  <rect className="bar answered" x={x} y={baseline - hA} width={barW} height={hA} />
                ) : (
                  <path className="bar answered" d={topRoundedBar(x, baseline - hA, barW, hA)} />
                ))}
                {hH > gap && <path className="bar handed-off" d={topRoundedBar(x, baseline - hA - hH, barW, hH - gap)} />}
                {(last - i) % labelEvery === 0 && (
                  <text
                    className="axis"
                    x={MARGIN.left + band * (i + 0.5)}
                    y={HEIGHT - 8}
                    textAnchor={i === last && band < 32 ? "end" : "middle"}
                  >
                    {formatDay(d.day)}
                  </text>
                )}
                {/* Hit target: the whole column height, wider than the bar. */}
                <rect
                  x={MARGIN.left + band * i}
                  y={MARGIN.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setActive(i)}
                />
              </g>
            );
          })}
          <line className="baseline" x1={MARGIN.left} x2={width - MARGIN.right} y1={baseline} y2={baseline} />
        </svg>
      )}

      {activeDay && (
        <div
          className="tooltip"
          role="status"
          // Beside the hovered column (right of it in the left half, left of it in the right half), never over the legend.
          style={tooltipLeft < width / 2 ? { left: tooltipLeft + band / 2 + 8, top: MARGIN.top } : { left: tooltipLeft - band / 2 - 8, top: MARGIN.top, transform: "translateX(-100%)" }}
        >
          <p className="tooltip-title">{formatDay(activeDay.day, "long")}</p>
          <p>
            <span className="swatch answered" aria-hidden="true" /> Answered <b>{formatCount(activeDay.answered)}</b>
          </p>
          <p>
            <span className="swatch handed-off" aria-hidden="true" /> Handed off <b>{formatCount(activeDay.handedOff)}</b>
          </p>
        </div>
      )}
    </div>
  );
}

function DailyTable({ daily }: { daily: DailyCount[] }) {
  return (
    <div className="table-scroll short">
      <table>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" className="num">Answered</th>
            <th scope="col" className="num">Handed off</th>
            <th scope="col" className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {[...daily].reverse().map((d) => (
            <tr key={d.day}>
              <td>{formatDay(d.day, "long")}</td>
              <td className="num">{formatCount(d.answered)}</td>
              <td className="num">{formatCount(d.handedOff)}</td>
              <td className="num">{formatCount(d.answered + d.handedOff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
