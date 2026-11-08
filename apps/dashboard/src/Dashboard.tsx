import { useState } from "react";
import { api } from "./api.ts";
import { DailyChart } from "./DailyChart.tsx";
import { StatTiles } from "./StatTiles.tsx";
import { Tickets } from "./Tickets.tsx";
import { TopicsChart } from "./TopicsChart.tsx";
import { useResource } from "./useResource.ts";
import { WeakQuestions } from "./WeakQuestions.tsx";

const RANGES = [7, 30, 90] as const;
const RANGE_KEY = "brewbot:admin-range";

function initialRange(): number {
  try {
    const saved = Number(localStorage.getItem(RANGE_KEY));
    return (RANGES as readonly number[]).includes(saved) ? saved : 30;
  } catch {
    return 30;
  }
}

interface Props {
  token: string;
  onSignOut: (reason?: string) => void;
}

export function Dashboard({ token, onSignOut }: Props) {
  const [days, setDays] = useState(initialRange);
  const expired = () => onSignOut("Your admin token is no longer valid. Sign in again.");

  const stats = useResource(() => api.stats(token, days), `stats-${days}`, expired);
  const weak = useResource(() => api.weakQuestions(token, days), `weak-${days}`, expired);
  const tickets = useResource(() => api.tickets(token), "tickets", expired);

  function chooseRange(value: number) {
    setDays(value);
    try {
      localStorage.setItem(RANGE_KEY, String(value));
    } catch {
      // Remembering the range is a convenience only.
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>BrewBot Analytics</h1>
          <p className="muted">How the support bot is doing, and where it needs help.</p>
        </div>
        <div className="filters">
          <div className="segmented" role="radiogroup" aria-label="Date range">
            {RANGES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={days === value}
                className={days === value ? "active" : ""}
                onClick={() => chooseRange(value)}
              >
                {value} days
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={() => onSignOut()}>
            Sign out
          </button>
        </div>
      </header>

      <Section error={stats.error} onRetry={stats.reload} loading={stats.loading} hasData={!!stats.data}>
        {stats.data && <StatTiles stats={stats.data} />}
      </Section>

      <div className="grid-2">
        <Panel title="Questions per day" subtitle={`Last ${days} days, by UTC date`}>
          <Section error={stats.error} onRetry={stats.reload} loading={stats.loading} hasData={!!stats.data}>
            {stats.data && <DailyChart daily={stats.data.daily} />}
          </Section>
        </Panel>
        <Panel title="What customers ask about" subtitle="Questions by the document that best matched">
          <Section error={stats.error} onRetry={stats.reload} loading={stats.loading} hasData={!!stats.data}>
            {stats.data && <TopicsChart topics={stats.data.topics} total={stats.data.current.questions} />}
          </Section>
        </Panel>
      </div>

      <Panel
        title="Questions the bot couldn't answer well"
        subtitle="No strong match in the docs, or handed to a person. Add or improve the docs for the top ones."
      >
        <Section error={weak.error} onRetry={weak.reload} loading={weak.loading} hasData={!!weak.data}>
          {weak.data && <WeakQuestions rows={weak.data} />}
        </Section>
      </Panel>

      <Panel title="Support tickets" subtitle="Created when a customer asks for a person. Open tickets first.">
        <Section error={tickets.error} onRetry={tickets.reload} loading={tickets.loading} hasData={!!tickets.data}>
          {tickets.data && <Tickets tickets={tickets.data} token={token} onChanged={tickets.reload} onUnauthorized={expired} />}
        </Section>
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="muted subtitle">{subtitle}</p>
      {children}
    </section>
  );
}

/** Loading, error and refetch states for one block. A refetch dims the previous result instead of blanking it. */
function Section(props: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (props.error && !props.hasData) {
    return (
      <div className="state error" role="alert">
        <p>Couldn't load this: {props.error}</p>
        <button type="button" className="ghost" onClick={props.onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (!props.hasData) return <div className="state skeleton" aria-busy="true" aria-label="Loading" />;
  return (
    <div className={props.loading ? "refreshing" : undefined} aria-busy={props.loading}>
      {props.children}
    </div>
  );
}
