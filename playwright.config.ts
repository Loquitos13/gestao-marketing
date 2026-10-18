import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure", locale: "pt-PT" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/admin.json" }, dependencies: ["setup"] },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: process.env.CI ? `npx next start -p ${port}` : `npx next dev -p ${port}`, url: `${baseURL}/api/health`, reuseExistingServer: true, timeout: 180_000 },
});
