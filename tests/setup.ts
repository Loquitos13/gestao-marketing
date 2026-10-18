import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

// Valores apenas para testes quando não definidos ou vazios (nunca usados em produção).
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.SESSION_SECRET ||= "test-session-secret-with-more-than-32-characters";
process.env.DATABASE_URL ||= "postgresql://invalid:invalid@localhost:1/invalid";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN ||= "test-dev-token";
process.env.LOG_LEVEL = "silent";
process.env.SETTINGS_ENV_ONLY = "1";
