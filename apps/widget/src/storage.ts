// Storage can be blocked (private mode, strict cookie settings), so every access is guarded
// and the widget keeps working without it.

export function load<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(storage: () => Storage, key: string, value: unknown): void {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: persistence is a convenience, not a requirement.
  }
}

/** A stable id per browser so the API's logs can group one visitor's conversation. */
export function sessionId(): string {
  const existing = load<string | null>(() => localStorage, "brewbot:session", null);
  if (existing) return existing;
  const id = crypto.randomUUID();
  save(() => localStorage, "brewbot:session", id);
  return id;
}
