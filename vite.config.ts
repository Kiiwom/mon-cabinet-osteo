import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri attend un port fixe et ne doit pas masquer ses erreurs Rust.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", sourcemap: false },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
