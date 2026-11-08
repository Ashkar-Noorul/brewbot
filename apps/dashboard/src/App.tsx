import { useState, type FormEvent } from "react";
import { api, getToken, setToken, UnauthorizedError } from "./api.ts";
import { Dashboard } from "./Dashboard.tsx";

export function App() {
  const [token, setCurrentToken] = useState(getToken);
  const [notice, setNotice] = useState<string | null>(null);

  function signIn(newToken: string) {
    setToken(newToken);
    setCurrentToken(newToken);
    setNotice(null);
  }

  function signOut(reason?: string) {
    setToken(null);
    setCurrentToken(null);
    setNotice(reason ?? null);
  }

  return token ? (
    <Dashboard token={token} onSignOut={signOut} />
  ) : (
    <SignIn onSignIn={signIn} notice={notice} />
  );
}

function SignIn({ onSignIn, notice }: { onSignIn: (token: string) => void; notice: string | null }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!token) return;
    setChecking(true);
    setError(null);
    try {
      await api.stats(token, 1); // Cheapest call that proves the token works.
      onSignIn(token);
    } catch (err) {
      setError(err instanceof UnauthorizedError ? "That admin token isn't valid." : (err as Error).message);
      setChecking(false);
    }
  }

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <h1>BrewBot Analytics</h1>
        <p className="muted">Enter the admin token from the server's <code>ADMIN_TOKEN</code> setting.</p>
        <label htmlFor="token">Admin token</label>
        <input
          id="token"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "token-error" : undefined}
          autoFocus
        />
        {error && (
          <p id="token-error" className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={checking || !value.trim()}>
          {checking ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
