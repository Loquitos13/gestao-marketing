import pino from "pino";

/** Logs estruturados em JSON. Campos sensíveis são removidos automaticamente. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "mih" },
  redact: {
    paths: [
      "*.access_token",
      "*.refresh_token",
      "*.accessToken",
      "*.refreshToken",
      "*.password",
      "*.passwordHash",
      "*.client_secret",
      "*.authorization",
      "*.Authorization",
      "headers.authorization",
      "token",
      "password",
    ],
    censor: "[REDACTED]",
  },
});

/** Remove tokens de URLs/mensagens de erro antes de as persistir ou registar. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(access_token|refresh_token|client_secret|key|fb_exchange_token)=([^&\s"]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]");
}
