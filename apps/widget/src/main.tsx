import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { readConfig } from "./config.ts";
import styles from "./styles.css?inline";

// Read the <script> tag's settings now: document.currentScript is only set while this file first runs.
const config = readConfig();

function mount() {
  if (document.getElementById("brewbot-widget")) return;
  const host = document.createElement("div");
  host.id = "brewbot-widget";
  document.body.appendChild(host);

  // A shadow root keeps the host site's CSS out of the widget, and the widget's CSS out of the site.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const container = document.createElement("div");
  shadow.append(style, container);

  createRoot(container).render(<App config={config} />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
