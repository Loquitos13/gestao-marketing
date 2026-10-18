import { defineConfig, env } from "prisma/config";

// O CLI do Prisma 7 já não lê o .env; os scripts usam `tsx --env-file-if-exists=.env`.
try {
  process.loadEnvFile(".env");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx --env-file-if-exists=.env prisma/seed.ts" },
  datasource: { url: env("DATABASE_URL") },
});
