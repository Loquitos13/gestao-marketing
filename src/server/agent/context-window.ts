import type { LlmMessage, ToolSpec } from "./llm";

/**
 * Janela fixa. O Ollama reserva a cache de contexto para `num_ctx` completo,
 * por isso a janela não cresce quando sobra espaço: o que não é essencial fica de fora.
 */
export const CONTEXT_TOKENS = 4096;
/** Tokens reservados à resposta, dentro da mesma janela. */
export const RESERVE_TOKENS = 768;
/** Estimativa conservadora para português e JSON, para o pedido não ultrapassar a janela. */
const CHARS_PER_TOKEN = 3;

const SHARES = { system: 0.26, tools: 0.25, history: 0.25, results: 0.24 } as const;

const DEFAULT_TOOLS = new Set(["get_kpis", "get_campaigns", "get_alerts_recommendations"]);

/** Palavras da pergunta que justificam levar a ferramenta para a janela. */
const HINTS: Record<string, string[]> = {
  get_kpis: ["kpi", "roas", "cpa", "ctr", "investimento", "convers", "desempenho", "campanha", "resultado"],
  get_campaigns: ["campanha", "orcamento", "anuncio", "grupo"],
  get_ads: ["anuncio", "criativo", "titulo", "descricao"],
  get_budget_pacing: ["orcamento", "ritmo", "pacing", "gasto"],
  get_seo: ["seo", "organico", "search console", "consulta", "posicao"],
  get_forecast: ["previs", "forecast", "tendenc"],
  get_response_curve: ["curva", "what-if", "aumentar o investimento", "reduzir o investimento"],
  get_alerts_recommendations: ["alerta", "recomend"],
  get_notes_tasks: ["nota", "tarefa"],
  get_competitors: ["concorrent"],
  get_keyword_gap: ["palavra-chave", "palavra chave", "keyword", "lacuna"],
  get_competitor_ads: ["biblioteca de anuncios", "anuncios dos concorrentes", "concorrent"],
  get_competitor_pages: ["conteudo dos concorrentes", "paginas dos concorrentes", "concorrent"],
  get_pagespeed: ["velocidade", "pagespeed", "lcp"],
  propose_recommendation: ["sugest", "recomend"],
  propose_ad_change: ["pausar", "orcamento diario", "alterar o orcamento", "lance"],
  propose_keywords: ["adicionar palavra", "palavra-chave", "keyword"],
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function inputCharBudget(reserveTokens = RESERVE_TOKENS): number {
  return Math.max(0, CONTEXT_TOKENS - reserveTokens) * CHARS_PER_TOKEN;
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function shareChars(total: number) {
  return {
    system: Math.floor(total * SHARES.system),
    tools: Math.floor(total * SHARES.tools),
    history: Math.floor(total * SHARES.history),
    results: Math.floor(total * SHARES.results),
  };
}

function shrink(value: unknown, str: number, arr: number, keys: number): unknown {
  if (typeof value === "string") return value.length > str ? value.slice(0, str) : value;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, arr).map((v) => shrink(v, str, arr, keys));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, keys).map(([k, v]) => [k, shrink(v, str, arr, keys)]));
  }
  return null;
}

/** Encolhe JSON longo: números ficam, textos e listas perdem o que não cabe na fatia. */
export function compactJsonText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  try {
    let value = JSON.parse(text) as unknown;
    for (const limits of [
      { str: 160, arr: 6, keys: 16 },
      { str: 80, arr: 3, keys: 10 },
      { str: 40, arr: 1, keys: 6 },
    ]) {
      const next = JSON.stringify(shrink(value, limits.str, limits.arr, limits.keys));
      if (next.length <= maxChars) return next;
      value = JSON.parse(next) as unknown;
    }
  } catch {
    // texto que não é JSON
  }
  return text.slice(0, Math.max(0, maxChars));
}

function clipSystem(text: string, max: number): string {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0 && lines.join("\n").length > max; i--) {
    if (lines[i]?.startsWith("- ")) lines.splice(i, 1);
  }
  const out = lines.join("\n");
  return out.length <= max ? out : out.slice(0, max);
}

function fitHistory(messages: LlmMessage[], budget: number): LlmMessage[] {
  const clipped = messages.map((m) => ({ ...m, content: m.content.slice(-700) }));
  while (clipped.length > 1 && estimateTokens(clipped.map((m) => m.content).join("")) * CHARS_PER_TOKEN > budget) clipped.shift();
  if (clipped.length === 1 && clipped[0]!.content.length > budget) clipped[0] = { ...clipped[0]!, content: clipped[0]!.content.slice(-budget) };
  return clipped;
}

function fitParts(parts: string[], budget: number): string[] {
  const out = parts.slice();
  let pending = out.map((_, i) => i);
  for (let guard = parts.length + 1; pending.length && guard > 0; guard--) {
    const cap = Math.max(0, Math.floor(budget / pending.length));
    const still: number[] = [];
    for (const i of pending) {
      if (out[i]!.length <= cap) budget -= out[i]!.length;
      else still.push(i);
    }
    if (still.length === pending.length) {
      for (const i of still) out[i] = compactJsonText(out[i]!, cap);
      break;
    }
    pending = still;
  }
  return out;
}

/** Ferramentas cuja descrição a pergunta pede, mais um núcleo curto. O resto não entra na janela. */
export function selectTools(tools: ToolSpec[], focus: string, pinned: string[], budgetChars: number): ToolSpec[] {
  const f = fold(focus);
  const scored = tools.map((t, i) => ({ t, i, score: (HINTS[t.function.name] ?? []).some((h) => f.includes(h)) ? 1 : 0 }));
  const matched = scored.filter((s) => s.score > 0);
  const defaults = scored.filter((s) => DEFAULT_TOOLS.has(s.t.function.name) && !matched.some((m) => m.t.function.name === s.t.function.name));
  const pin = scored.filter((s) => pinned.includes(s.t.function.name));
  const pool = pin.concat(matched, defaults);
  const ordered = (pool.length ? pool : scored).filter((s, idx, arr) => arr.findIndex((x) => x.t.function.name === s.t.function.name) === idx);
  ordered.sort((a, b) => Number(pinned.includes(b.t.function.name)) - Number(pinned.includes(a.t.function.name)) || b.score - a.score || a.i - b.i);
  const chosen: ToolSpec[] = [];
  let used = 2;
  for (const s of ordered) {
    const size = JSON.stringify(s.t).length + 1;
    if (chosen.length && used + size > budgetChars) continue;
    chosen.push(s.t);
    used += size;
  }
  return chosen;
}

export interface PackedContext {
  messages: LlmMessage[];
  tools?: ToolSpec[];
}

/**
 * Reparte a janela entre sistema, ferramentas, histórico recente e resultados.
 * O orçamento que uma parte não usa não é enchido com texto a mais.
 */
export function packContext(messages: LlmMessage[], tools?: ToolSpec[], pinned: string[] = []): PackedContext {
  const budget = shareChars(inputCharBudget());
  const system = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m !== system);
  const history: LlmMessage[] = [];
  const groups: LlmMessage[][] = [];
  for (const m of rest) {
    if (m.role === "assistant" && m.tool_calls?.length) groups.push([m]);
    else if (m.role === "tool" && groups.length) groups.at(-1)!.push(m);
    else history.push(m);
  }
  const focus = history.filter((m) => m.role === "user").map((m) => m.content).join("\n").slice(-1500);
  const keptTools = tools?.length ? selectTools(tools, focus, pinned, budget.tools) : undefined;
  const keptHistory = fitHistory(history, budget.history);
  const toolMsgs = groups.flatMap((g) => g.filter((m) => m.role === "tool"));
  const fitted = fitParts(toolMsgs.map((m) => m.content), budget.results);
  toolMsgs.forEach((m, i) => (m.content = fitted[i] ?? ""));
  const out: LlmMessage[] = [];
  if (system) out.push({ ...system, content: clipSystem(system.content, budget.system) });
  out.push(...keptHistory, ...groups.flat());
  return { messages: out, tools: keptTools };
}
