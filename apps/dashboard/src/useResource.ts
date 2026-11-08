import { useEffect, useRef, useState } from "react";
import { UnauthorizedError } from "./api.ts";

export interface Resource<T> {
  data: T | undefined;
  error: string | null;
  /** True while a (re)fetch is in flight. Previous data stays available so the UI doesn't blank out. */
  loading: boolean;
  reload: () => void;
}

/** Loads data when `key` changes, keeping the last result on screen while the next one loads. */
export function useResource<T>(load: () => Promise<T>, key: string, onUnauthorized: () => void): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Read the latest callbacks without refetching whenever the parent re-renders.
  const latest = useRef({ load, onUnauthorized });
  latest.current = { load, onUnauthorized };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    latest.current.load().then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          latest.current.onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}
