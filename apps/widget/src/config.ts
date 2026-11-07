export interface WidgetConfig {
  apiUrl: string;
  title: string;
  greeting: string;
  color: string;
}

/**
 * Reads settings from the embedding <script> tag's data-* attributes, e.g.
 * <script src="https://api.example.com/brewbot.js" data-title="Help" data-color="#7a4b2a"></script>
 * The API defaults to wherever the script was loaded from.
 */
export function readConfig(): WidgetConfig {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="brewbot.js"]');
  const data = script?.dataset ?? {};
  const scriptOrigin = script?.src ? new URL(script.src).origin : window.location.origin;

  return {
    apiUrl: (data.apiUrl ?? scriptOrigin).replace(/\/$/, ""),
    title: data.title ?? "BrewBot",
    greeting: data.greeting ?? "Hi! I can help with orders, shipping, returns and our machines. What can I do for you?",
    color: data.color ?? "#7a4b2a",
  };
}
