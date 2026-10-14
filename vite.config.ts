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
    // Le thème est lu tel quel par le test des contrastes ; les autres feuilles restent ignorées.
    css: { include: [/theme\.css/] },
  },
});
