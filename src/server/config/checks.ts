import { Redis, type RedisOptions } from "ioredis";
import { smtpTransport } from "@/server/notify/email";
import { redisConnection } from "@/server/sync/queue";
import { ollamaStatus } from "@/server/agent/llm";
import type { SettingGroupKey } from "./definitions";
import { getConfig, type Config } from "./settings";

export type CheckResult = { ok: boolean; message: string };

const TIMEOUT_MS = 10_000;

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null; text: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

/** Troca um código inválido: "invalid_grant" prova que o Client ID/secret são aceites, sem criar nenhuma autorização. */
async function checkGoogle(c: Config): Promise<CheckResult> {
  if (!c.GOOGLE_CLIENT_ID || !c.GOOGLE_CLIENT_SECRET) return { ok: false, message: "Faltam Client ID e/ou Client secret." };
  const r = await getJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: "mih-config-check", client_id: c.GOOGLE_CLIENT_ID, client_secret: c.GOOGLE_CLIENT_SECRET, redirect_uri: `${c.APP_URL}/api/oauth/google/callback`, grant_type: "authorization_code" }),
  });
  const err = String(r.body?.error ?? "");
  if (err === "invalid_client" || err === "unauthorized_client") return { ok: false, message: "A Google rejeitou o Client ID ou o Client secret." };
  if (err === "redirect_uri_mismatch") return { ok: false, message: `Credenciais aceites, mas o URI de redirecionamento não está registado no projeto Google Cloud: ${c.APP_URL}/api/oauth/google/callback` };
  if (err === "invalid_grant") {
    const ads = c.GOOGLE_ADS_DEVELOPER_TOKEN ? " O developer token só é validado na primeira listagem de contas Google Ads." : " Sem developer token, as contas Google Ads não são listadas.";
    return { ok: true, message: `Client ID e secret aceites pela Google.${ads}` };
  }
  return { ok: false, message: `Resposta inesperada da Google (HTTP ${r.status}${err ? `, ${err}` : ""}).` };
}

async function checkMeta(c: Config): Promise<CheckResult> {
  if (!c.META_APP_ID || !c.META_APP_SECRET) return { ok: false, message: "Faltam App ID e/ou App secret." };
  const qs = new URLSearchParams({ client_id: c.META_APP_ID, client_secret: c.META_APP_SECRET, grant_type: "client_credentials" });
  const r = await getJson(`https://graph.facebook.com/${c.META_GRAPH_VERSION}/oauth/access_token?${qs}`);
  if (r.body?.access_token) return { ok: true, message: `App ID e secret aceites pela Meta (Graph ${c.META_GRAPH_VERSION}).` };
  const msg = (r.body?.error as { message?: string } | undefined)?.message;
  return { ok: false, message: `A Meta rejeitou as credenciais${msg ? `: ${msg}` : ` (HTTP ${r.status})`}.` };
}

async function checkSemrush(c: Config): Promise<CheckResult> {
  if (!c.SEMRUSH_API_KEY) return { ok: false, message: "Falta a API key." };
  const r = await getJson(`https://www.semrush.com/users/countapiunits.html?${new URLSearchParams({ key: c.SEMRUSH_API_KEY })}`);
  const units = Number(r.text.trim());
  if (r.status === 200 && Number.isFinite(units)) return { ok: true, message: `API key válida. Unidades disponíveis: ${units.toLocaleString("pt-PT")}.` };
  return { ok: false, message: `A Semrush rejeitou a API key (${r.text.trim().slice(0, 120) || `HTTP ${r.status}`}).` };
}

async function checkSmtp(c: Config): Promise<CheckResult> {
  if (!c.SMTP_HOST || !c.SMTP_FROM) return { ok: false, message: "Faltam o servidor e/ou o remetente." };
  const t = smtpTransport(c);
  try {
    await t.verify();
    return { ok: true, message: `Ligação e autenticação aceites por ${c.SMTP_HOST}:${c.SMTP_PORT}. Nenhum email foi enviado.` };
  } finally {
    t.close();
  }
}

async function checkRedis(c: Config): Promise<CheckResult> {
  if (!c.REDIS_URL) return { ok: false, message: "Falta o URL do Redis." };
  const client = new Redis({ ...(redisConnection(c.REDIS_URL) as RedisOptions), maxRetriesPerRequest: 0, connectTimeout: 5_000, lazyConnect: true, retryStrategy: () => null });
  client.on("error", () => undefined);
  try {
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === "PONG", message: pong === "PONG" ? "Redis respondeu (PING → PONG)." : `Resposta inesperada: ${pong}` };
  } finally {
    client.disconnect();
  }
}

async function checkAgent(): Promise<CheckResult> {
  const s = await ollamaStatus();
  return { ok: s.ok, message: s.ok ? `${s.message} Nenhum dado sai deste servidor.` : s.message };
}

async function checkPagespeed(c: Config): Promise<CheckResult> {
  if (!c.PAGESPEED_API_KEY) return { ok: false, message: "Falta a API key." };
  const qs = new URLSearchParams({ url: c.APP_URL.startsWith("https://") ? c.APP_URL : "https://www.google.com/", strategy: "mobile", category: "performance", key: c.PAGESPEED_API_KEY });
  const r = await getJson(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
  if (r.status === 200) return { ok: true, message: "API key aceite pela PageSpeed Insights API." };
  const msg = (r.body?.error as { message?: string } | undefined)?.message;
  return { ok: false, message: `A Google rejeitou o pedido${msg ? `: ${msg.slice(0, 160)}` : ` (HTTP ${r.status})`}.` };
}

const CHECKS: Partial<Record<SettingGroupKey, (c: Config) => Promise<CheckResult>>> = { google: checkGoogle, meta: checkMeta, semrush: checkSemrush, smtp: checkSmtp, redis: checkRedis, agent: checkAgent, pagespeed: checkPagespeed };

export async function checkGroup(group: SettingGroupKey): Promise<CheckResult> {
  const fn = CHECKS[group];
  if (!fn) return { ok: false, message: "Este grupo não tem teste de ligação." };
  try {
    return await fn(await getConfig());
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Falha na ligação: ${m.slice(0, 200)}` };
  }
}
