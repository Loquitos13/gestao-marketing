import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/** Avaliação do agente com Ollama e BD reais (npm run agent:eval). Fora do `npm test`: lenta e depende de serviços locais. */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["tests/eval/**/*.test.ts"], testTimeout: 30 * 60_000, hookTimeout: 60_000 },
});
