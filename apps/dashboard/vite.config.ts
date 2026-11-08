import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served by the API at /admin, alongside the admin endpoints it calls (same origin, no CORS).
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  // Inline (empty) PostCSS config so Vite doesn't pick up a postcss.config.js from a parent folder.
  css: { postcss: {} },
});
