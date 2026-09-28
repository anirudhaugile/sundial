import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only guards Next bundles; tests run server code directly
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  // integration tests talk to local Supabase and run the real scheduler; 5s is too tight under parallel load
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});
