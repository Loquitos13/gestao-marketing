import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig usa jsx "preserve" (exigido pelo Next); o Vite 8 (Oxc) precisa de compilar o JSX dos .tsx importados pelos testes.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/server-only-stub.ts") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
