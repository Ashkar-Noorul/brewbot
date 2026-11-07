import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the widget as one self-contained script (React included) that any site can load
// with a single <script> tag. Files in public/ (the demo page) are copied next to it.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // Inline (empty) PostCSS config so Vite doesn't pick up a postcss.config.js from a parent folder.
  css: { postcss: {} },
  build: {
    lib: {
      entry: "src/main.tsx",
      formats: ["iife"],
      name: "BrewBot",
      fileName: () => "brewbot.js",
    },
  },
});
