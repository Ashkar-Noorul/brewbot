// Response shapes of the /api/admin endpoints, used by the API and the dashboard.

export interface PeriodStats {
  questions: number;
  conversations: number;
  /** Share of questions where the contact form was offered (0 to 1). */
  handoffRate: number;
  /** Share of questions where retrieval found no strong match in the docs (0 to 1). */
  lowConfidenceRate: number;
  avgLatencyMs: number;
  orderLookups: number;
}

export interface DailyCount {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  answered: number;
  handedOff: number;
}

export interface TopicCount {
  topic: string;
  questions: number;
}

export interface StatsResponse {
  days: number;
  current: PeriodStats;
  /** The same-length period just before, for deltas. */
  previous: PeriodStats;
  openTickets: number;
  daily: DailyCount[];
  topics: TopicCount[];
}

export interface WeakQuestion {
  id: number;
  createdAt: string;
  question: string;
  answer: string;
  topSimilarity: number | null;
  lowConfidence: boolean;
  handoffOffered: boolean;
  topSource: string | null;
}

export interface TicketTurn {
  question: string;
  answer: string;
  created_at: string;
}

export interface Ticket {
  id: number;
  createdAt: string;
  name: string;
  email: string;
  message: string;
  status: "open" | "closed";
  transcript: TicketTurn[];
}
