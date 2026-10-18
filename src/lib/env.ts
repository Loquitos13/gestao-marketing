import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3100"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY é obrigatório"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET deve ter pelo menos 32 caracteres"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_API_VERSION: z.string().default("v26"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v25.0"),
  SEMRUSH_API_KEY: z.string().optional(),
  SEMRUSH_DATABASE: z.string().default("pt"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  OLLAMA_URL: z.string().optional(),
  AGENT_MODEL: z.string().optional(),
  PAGESPEED_API_KEY: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Lê e valida as variáveis de ambiente apenas no servidor. Nunca importar em componentes cliente. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}