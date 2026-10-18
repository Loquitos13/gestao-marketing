import { defineConfig } from "prisma/config";

// O CLI do Prisma 7 já não lê o .env; os scripts usam `tsx --env-file-if-exists=.env`.
try {
  process.loadEnvFile(".env");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx --env-file-if-exists=.env prisma/seed.ts" },
  // `prisma generate` (postinstall, build Docker) não precisa de BD; sem DATABASE_URL usa-se um
  // valor fictício e migrate/seed falham ao ligar, com a mensagem normal de ligação recusada.
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://indefinido:indefinido@localhost:5432/indefinido" },
});
