import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { SETTING_FIELDS, SETTING_KEYS, type SettingKey } from "./definitions";

/** Configuração efetiva das integrações: valores guardados na interface sobrepõem-se às variáveis de ambiente. */
export interface Config {
  APP_URL: string;
  REDIS_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_API_VERSION: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION: string;
  SEMRUSH_API_KEY?: string;
  SEMRUSH_DATABASE: string;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  OLLAMA_URL: string;
  AGENT_MODEL: string;
  PAGESPEED_API_KEY?: string;
}

export type SettingSource = "db" | "env" | "default" | "missing";

const DEFAULTS: Partial<Record<SettingKey, string>> = {
  APP_URL: "http://localhost:3100",
  GOOGLE_ADS_API_VERSION: "v26",
  META_GRAPH_VERSION: "v25.0",
  SEMRUSH_DATABASE: "pt",
  SMTP_PORT: "587",
  OLLAMA_URL: "http://127.0.0.1:11434",
  AGENT_MODEL: "qwen2.5:7b-instruct",
};

const TTL_MS = 15_000;
let cache: { at: number; values: Partial<Record<SettingKey, string>> } | null = null;

/** SETTINGS_ENV_ONLY=1 ignora a configuração guardada e bloqueia a edição na interface. */
export function settingsLocked() {
  return process.env.SETTINGS_ENV_ONLY === "1";
}

export function invalidateConfig() {
  cache = null;
}

async function storedValues(): Promise<Partial<Record<SettingKey, string>>> {
  if (settingsLocked()) return {};
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values: Partial<Record<SettingKey, string>> = {};
  try {
    const rows = await prisma.appSetting.findMany();
    for (const r of rows) {
      if (!SETTING_KEYS.has(r.key)) continue;
      try {
        values[r.key as SettingKey] = decrypt(r.valueEnc);
      } catch {
        logger.error({ key: r.key }, "Configuração guardada não pode ser desencriptada (ENCRYPTION_KEY alterada?)");
      }
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "Não foi possível ler a configuração da base de dados; a usar variáveis de ambiente");
    return values;
  }
  cache = { at: Date.now(), values };
  return values;
}

function envValue(key: SettingKey): string | undefined {
  const v = (env() as unknown as Record<string, unknown>)[key];
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v);
  return DEFAULTS[key] === s && !process.env[key] ? undefined : s;
}

function resolve(key: SettingKey, stored: Partial<Record<SettingKey, string>>): { value?: string; source: SettingSource } {
  if (stored[key]) return { value: stored[key], source: "db" };
  const e = envValue(key);
  if (e) return { value: e, source: "env" };
  if (DEFAULTS[key]) return { value: DEFAULTS[key], source: "default" };
  return { source: "missing" };
}

export async function getConfig(): Promise<Config> {
  const stored = await storedValues();
  const out: Record<string, string | number | undefined> = {};
  for (const f of SETTING_FIELDS) out[f.key] = resolve(f.key, stored).value;
  out.SMTP_PORT = Number(out.SMTP_PORT) || 587;
  return out as unknown as Config;
}

export async function integrationStatus() {
  const c = await getConfig();
  return {
    google: Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET),
    googleAds: Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_ADS_DEVELOPER_TOKEN),
    meta: Boolean(c.META_APP_ID && c.META_APP_SECRET),
    semrush: Boolean(c.SEMRUSH_API_KEY),
    smtp: Boolean(c.SMTP_HOST && c.SMTP_FROM),
    redis: Boolean(c.REDIS_URL),
    pagespeed: Boolean(c.PAGESPEED_API_KEY),
  };
}

export type IntegrationStatus = Awaited<ReturnType<typeof integrationStatus>>;

export interface FieldState {
  key: SettingKey;
  source: SettingSource;
  /** Valor visível apenas para campos não secretos. */
  value?: string;
  /** Últimos 4 caracteres de um segredo, para identificação. */
  hint?: string;
}

export async function settingsOverview(): Promise<Record<SettingKey, FieldState>> {
  cache = null;
  const stored = await storedValues();
  const out = {} as Record<SettingKey, FieldState>;
  for (const f of SETTING_FIELDS) {
    const r = resolve(f.key, stored);
    out[f.key] = f.secret
      ? { key: f.key, source: r.source, hint: r.value && r.source !== "default" ? `…${r.value.slice(-4)}` : undefined }
      : { key: f.key, source: r.source, value: r.value };
  }
  return out;
}

export async function writeSettings(changes: { set: Partial<Record<SettingKey, string>>; clear: SettingKey[] }, userId: string) {
  await prisma.$transaction([
    ...changes.clear.map((key) => prisma.appSetting.deleteMany({ where: { key } })),
    ...Object.entries(changes.set).map(([key, value]) =>
      prisma.appSetting.upsert({
        where: { key },
        create: { key, valueEnc: encrypt(value as string), updatedById: userId },
        update: { valueEnc: encrypt(value as string), updatedById: userId },
      }),
    ),
  ]);
  invalidateConfig();
}
