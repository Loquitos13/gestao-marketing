import { createHmac } from "node:crypto";
import { getConfig } from "@/server/config/settings";
import { IntegrationError, requestJson, type IntegrationErrorKind } from "../http";

export const META_SCOPES = ["ads_read", "read_insights", "pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights", "business_management"];
/** Pedido apenas no botão “Ligar com gestão de anúncios”. Exige App Review (acesso avançado) para contas de terceiros. */
export const META_MANAGE_SCOPES = [...META_SCOPES, "ads_management"];

/** Permissões efetivamente concedidas pelo utilizador (podem diferir das pedidas). */
export async function grantedMetaScopes(token: string): Promise<string[]> {
  const r = await graphGet<{ data?: { permission: string; status: string }[] }>("me/permissions", token).catch(() => ({ data: [] }));
  return (r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
}

export async function graphBase() {
  return `https://graph.facebook.com/${(await getConfig()).META_GRAPH_VERSION}`;
}

/** Códigos de erro da Graph API → categorias internas. */
export function classifyMeta(status: number, body: unknown): IntegrationErrorKind | null {
  const err = (body as { error?: { code?: number; error_subcode?: number } } | null)?.error;
  if (!err || status < 400 && !err.code) return null;
  const code = err.code ?? 0;
  if (code === 190 || code === 102) return "AUTH";
  if ([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014].includes(code)) return "RATE_LIMIT";
  if (code === 10 || (code >= 200 && code < 300)) return "PERMISSION";
  if (code === 1 || code === 2) return "TRANSIENT";
  if (code === 100) return "INVALID_REQUEST";
  return null;
}

/** appsecret_proof recomendado pela Meta para chamadas server-side. */
export function appSecretProof(token: string, secret: string | undefined): string | null {
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
}

export async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}, fetchImpl?: typeof fetch): Promise<T> {
  const url = path.startsWith("http") ? new URL(path) : new URL(`${await graphBase()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  const proof = appSecretProof(token, (await getConfig()).META_APP_SECRET);
  if (proof && !url.searchParams.has("appsecret_proof")) url.searchParams.set("appsecret_proof", proof);
  return requestJson<T>(url.toString(), { classify: classifyMeta, baseDelayMs: 2000, fetchImpl });
}

/** Escrita na Graph API (form-urlencoded). Sem repetições automáticas por omissão: uma escrita nunca é repetida às cegas. */
export async function graphPost<T>(path: string, token: string, form: Record<string, string>, opts: { maxRetries?: number; fetchImpl?: typeof fetch } = {}): Promise<T> {
  const proof = appSecretProof(token, (await getConfig()).META_APP_SECRET);
  return requestJson<T>(`${await graphBase()}/${path.replace(/^\//, "")}`, {
    method: "POST",
    form: { ...form, access_token: token, ...(proof ? { appsecret_proof: proof } : {}) },
    classify: classifyMeta,
    maxRetries: opts.maxRetries ?? 0,
    fetchImpl: opts.fetchImpl,
  });
}

/** Itera todas as páginas de um edge (cursor paging.next). Limite de segurança de páginas. */
export async function graphPaginate<T>(path: string, token: string, params: Record<string, string>, fetchImpl?: typeof fetch, maxPages = 200): Promise<T[]> {
  const out: T[] = [];
  let page = await graphGet<{ data: T[]; paging?: { next?: string } }>(path, token, params, fetchImpl);
  out.push(...(page.data ?? []));
  let n = 1;
  while (page.paging?.next && n < maxPages) {
    page = await graphGet<{ data: T[]; paging?: { next?: string } }>(page.paging.next, token, {}, fetchImpl);
    out.push(...(page.data ?? []));
    n++;
  }
  if (n >= maxPages) throw new IntegrationError("Limite de paginação atingido", "INVALID_REQUEST");
  return out;
}

export async function metaRedirectUri() {
  return `${(await getConfig()).APP_URL}/api/oauth/meta/callback`;
}

export async function metaAuthUrl(state: string, manage = false) {
  const c = await getConfig();
  if (!c.META_APP_ID) throw new IntegrationError("META_APP_ID não configurado", "CONFIG");
  const p = new URLSearchParams({ client_id: c.META_APP_ID, redirect_uri: await metaRedirectUri(), state, scope: (manage ? META_MANAGE_SCOPES : META_SCOPES).join(","), response_type: "code" });
  if (manage) p.set("auth_type", "rerequest");
  return `https://www.facebook.com/${c.META_GRAPH_VERSION}/dialog/oauth?${p}`;
}

export async function exchangeMetaCode(code: string) {
  const c = await getConfig();
  const short = await requestJson<{ access_token: string; expires_in?: number }>(
    `${await graphBase()}/oauth/access_token?${new URLSearchParams({ client_id: c.META_APP_ID ?? "", client_secret: c.META_APP_SECRET ?? "", redirect_uri: await metaRedirectUri(), code })}`,
    { classify: classifyMeta, maxRetries: 1 },
  );
  return exchangeLongLived(short.access_token);
}

/** Token de longa duração (~60 dias). A Meta não fornece refresh token: é necessário reautorizar antes de expirar. */
export async function exchangeLongLived(token: string) {
  const c = await getConfig();
  return requestJson<{ access_token: string; expires_in?: number }>(
    `${await graphBase()}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: c.META_APP_ID ?? "", client_secret: c.META_APP_SECRET ?? "", fb_exchange_token: token })}`,
    { classify: classifyMeta, maxRetries: 1 },
  );
}

export async function revokeMeta(token: string) {
  await requestJson(`${await graphBase()}/me/permissions?access_token=${encodeURIComponent(token)}`, { method: "DELETE", classify: classifyMeta, maxRetries: 1 }).catch(() => undefined);
}
