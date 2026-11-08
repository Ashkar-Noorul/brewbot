import type { StatsResponse, Ticket, WeakQuestion } from "@brewbot/shared";

const TOKEN_KEY = "brewbot:admin-token";

export class UnauthorizedError extends Error {}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Without storage the visitor just signs in again on reload.
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 401) throw new UnauthorizedError("That admin token isn't valid.");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  stats: (token: string, days: number) => request<StatsResponse>(`/stats?days=${days}`, token),
  weakQuestions: (token: string, days: number) => request<WeakQuestion[]>(`/weak-questions?days=${days}`, token),
  tickets: (token: string) => request<Ticket[]>("/tickets", token),
  setTicketStatus: (token: string, id: number, status: Ticket["status"]) =>
    request<void>(`/tickets/${id}`, token, { method: "PATCH", body: JSON.stringify({ status }) }),
};
