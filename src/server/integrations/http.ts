import { scrubSecrets } from "@/lib/logger";

export type IntegrationErrorKind = "AUTH" | "PERMISSION" | "RATE_LIMIT" | "NOT_FOUND" | "INVALID_REQUEST" | "TRANSIENT" | "CONFIG" | "UNKNOWN";

export class IntegrationError extends Error {
  constructor(
    message: string,
    public kind: IntegrationErrorKind,
    public status?: number,
    public details?: unknown,
  ) {
    super(scrubSecrets(message));
    this.name = "IntegrationError";
  }
  get retryable() {
    return this.kind === "RATE_LIMIT" || this.kind === "TRANSIENT";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  /** Classificador específico do fornecedor (ex.: códigos de erro da Meta no corpo). */
  classify?: (status: number, body: unknown) => IntegrationErrorKind | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function classifyStatus(status: number): IntegrationErrorKind {
  if (status === 401) return "AUTH";
  if (status === 403) return "PERMISSION";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "TRANSIENT";
  if (status >= 400) return "INVALID_REQUEST";
  return "UNKNOWN";
}

/** Backoff exponencial com jitter: base × 2^tentativa (+ até 30% aleatório), máx. 60 s. */
export function backoffDelay(attempt: number, baseMs: number, retryAfterSec?: number | null, rand = Math.random): number {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, 120_000);
  const exp = baseMs * 2 ** attempt;
  return Math.min(60_000, Math.round(exp * (1 + rand() * 0.3)));
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const e = b.error as Record<string, unknown> | string | undefined;
    if (typeof e === "string") return `${e}${b.error_description ? `: ${b.error_description}` : ""}`;
    if (e && typeof e.message === "string") return e.message;
  }
  return fallback;
}

export async function requestJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 4;
  let lastError: IntegrationError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await f(url, {
        method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
        headers: {
          Accept: "application/json",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
          ...(opts.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : opts.form ? new URLSearchParams(opts.form).toString() : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastError = new IntegrationError(`Falha de rede: ${e instanceof Error ? e.message : String(e)}`, "TRANSIENT");
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt, opts.baseDelayMs ?? 1000));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (res.ok) {
      const custom = opts.classify?.(res.status, body);
      if (!custom) return body as T;
    }
    const kind = opts.classify?.(res.status, body) ?? classifyStatus(res.status);
    lastError = new IntegrationError(errorMessage(body, `HTTP ${res.status}`), kind, res.status, body);
    if (lastError.retryable && attempt < maxRetries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(backoffDelay(attempt, opts.baseDelayMs ?? 1000, Number.isFinite(ra) ? ra : null));
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new IntegrationError("Erro desconhecido", "UNKNOWN");
}
