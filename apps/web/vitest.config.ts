import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // Playwright smoke 在 e2e/ 下（.spec.ts 会被 vitest 默认 include 误捡）
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
