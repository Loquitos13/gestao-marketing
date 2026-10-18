import { getConfig } from "@/server/config/settings";
import { isLocalUrl } from "@/server/config/definitions";
import { CONTEXT_TOKENS, RESERVE_TOKENS } from "./context-window";
import { withOllamaLock } from "./ollama-gate";

export { LlmBusyError } from "./ollama-gate";

/** Depois do último pedido o modelo liberta a memória ao fim deste prazo, em vez de ficar carregado para sempre. */
export const OLLAMA_KEEP_ALIVE = "10m";

/** Cliente da API do Ollama (local). Nenhum pedido sai para fora desta máquina ou da rede local. */

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { function: LlmToolCall }[] }
  | { role: "tool"; content: string; tool_name: string };

export interface ChatResult {
  content: string;
  toolCalls: LlmToolCall[];
  evalCount: number | null;
}

export interface ChatOptions {
  tools?: ToolSpec[];
  onToken?: (t: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Quanto esperar se outro pedido já estiver a usar o modelo. */
  lockWaitMs?: number;
  maxTokens?: number;
  temperature?: number;
  /** Força a resposta a ser um objeto JSON. */
  json?: boolean;
}

export interface Llm {
  model: string;
  chat(messages: LlmMessage[], opts?: ChatOptions): Promise<ChatResult>;
}

export class LlmUnavailableError extends Error {}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Dentro de um contentor, 127.0.0.1 é o próprio contentor. O perfil Docker define MIH_IN_DOCKER=1
 * e o compose expõe host.docker.internal, por isso o endereço de loopback passa a apontar para o anfitrião.
 */
export function ollamaReachableUrl(url: string, inDocker = process.env.MIH_IN_DOCKER === "1"): string {
  if (!inDocker) return url;
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(host)) return url;
  u.hostname = "host.docker.internal";
  return u.toString().replace(/\/$/, "");
}

export async function agentConfig() {
  const c = await getConfig();
  const url = ollamaReachableUrl(c.OLLAMA_URL);
  if (!isLocalUrl(url)) throw new LlmUnavailableError("O URL do Ollama tem de ser local (localhost ou rede privada).");
  return { url, model: c.AGENT_MODEL };
}

/** Carrega o modelo se ainda não estiver em memória. Não bloqueia quem chamou e não o deixa preso para sempre. */
export function warmOllama(url: string, model: string, fetchImpl: typeof fetch = fetch) {
  const stop = AbortSignal.timeout(120_000);
  void fetchImpl(`${url}/api/ps`, { signal: AbortSignal.timeout(2_000), cache: "no-store" })
    .then(async (ps) => {
      if (ps.ok) {
        const body = (await ps.json()) as { models?: { name: string }[] };
        const loaded = (body.models ?? []).some((m) => m.name === model || m.name === `${model}:latest`);
        if (loaded) return;
      }
      await fetchImpl(`${url}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: "", keep_alive: OLLAMA_KEEP_ALIVE, stream: false, options: { num_ctx: CONTEXT_TOKENS } }),
        signal: stop,
      });
    })
    .catch(() => undefined);
}

export interface OllamaStatus {
  ok: boolean;
  message: string;
  models: string[];
}

export async function ollamaStatus(fetchImpl: typeof fetch = fetch): Promise<OllamaStatus> {
  let cfg;
  try {
    cfg = await agentConfig();
  } catch (e) {
    return { ok: false, message: (e as Error).message, models: [] };
  }
  try {
    const res = await fetchImpl(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(4_000), cache: "no-store" });
    if (!res.ok) return { ok: false, message: `O Ollama respondeu HTTP ${res.status}.`, models: [] };
    const body = (await res.json()) as { models?: { name: string }[] };
    const models = (body.models ?? []).map((m) => m.name);
    const has = models.some((m) => m === cfg.model || m === `${cfg.model}:latest`);
    if (has) warmOllama(cfg.url, cfg.model, fetchImpl);
    return has
      ? { ok: true, message: `Ollama ativo com o modelo ${cfg.model}.`, models }
      : { ok: false, message: `O Ollama está ativo, mas o modelo ${cfg.model} não está instalado (ollama pull ${cfg.model}).`, models };
  } catch {
    return { ok: false, message: `O Ollama não responde em ${cfg.url}. Inicie-o (ollama serve).`, models: [] };
  }
}

interface OllamaChunk {
  message?: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[] };
  done?: boolean;
  eval_count?: number;
  error?: string;
}

function parseArgs(a: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof a !== "string") return a ?? {};
  try {
    const v = JSON.parse(a);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function ollamaLlm(url: string, model: string, fetchImpl: typeof fetch = fetch): Llm {
  return {
    model,
    async chat(messages, opts = {}) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetchImpl(`${url}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            tools: opts.tools?.length ? opts.tools : undefined,
            stream: true,
            keep_alive: OLLAMA_KEEP_ALIVE,
            format: opts.json ? "json" : undefined,
            options: { temperature: opts.temperature ?? 0.2, repeat_penalty: 1.1, num_predict: Math.min(opts.maxTokens ?? RESERVE_TOKENS, CONTEXT_TOKENS - 256), num_ctx: CONTEXT_TOKENS },
          }),
          signal,
        });
      } catch (e) {
        throw new LlmUnavailableError(`O Ollama não responde em ${url}: ${(e as Error).message}`);
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new LlmUnavailableError(`O Ollama respondeu HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let content = "";
      const toolCalls: LlmToolCall[] = [];
      let evalCount: number | null = null;
      const handle = (line: string) => {
        if (!line.trim()) return;
        const chunk = JSON.parse(line) as OllamaChunk;
        if (chunk.error) throw new LlmUnavailableError(chunk.error);
        const piece = chunk.message?.content ?? "";
        if (piece) {
          content += piece;
          opts.onToken?.(piece);
        }
        for (const tc of chunk.message?.tool_calls ?? []) toolCalls.push({ name: tc.function.name, arguments: parseArgs(tc.function.arguments) });
        if (chunk.done) evalCount = chunk.eval_count ?? null;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handle(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      handle(buf);
      return { content, toolCalls, evalCount };
    },
  };
}

/** LLM configurado. Os pedidos entram um de cada vez. Lança LlmUnavailableError se o Ollama não estiver disponível. */
export async function defaultLlm(lockWaitMs = 20_000): Promise<Llm> {
  const s = await ollamaStatus();
  if (!s.ok) throw new LlmUnavailableError(s.message);
  const cfg = await agentConfig();
  const base = ollamaLlm(cfg.url, cfg.model);
  let redisUrl: string | null = null;
  try {
    redisUrl = (await getConfig()).REDIS_URL ?? null;
  } catch {
    redisUrl = process.env.REDIS_URL || null;
  }
  return {
    model: base.model,
    chat(messages, opts) {
      return withOllamaLock(redisUrl, () => base.chat(messages, opts), opts?.lockWaitMs ?? lockWaitMs);
    },
  };
}
