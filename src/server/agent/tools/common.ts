import type { Client } from "@prisma/client";
import type { z } from "zod";
import type { ClientContext } from "@/server/queries/context";

/** Contexto de execução: o cliente vem sempre do servidor, nunca dos argumentos do modelo. */
export interface AgentCtx {
  client: Client;
  cctx: ClientContext;
  organizationId: string;
  userId: string | null;
  runId: string | null;
  /** Modelo de linguagem em uso (registado nas sugestões criadas). */
  model?: string;
  /** IDs de Recommendation/AdChange criados nesta execução. */
  created: { kind: "recommendation" | "change"; id: string }[];
  /** Sugestões que o agente tentou criar e que não foram gravadas. */
  skipped?: { duplicate: number; suppressed: number; refused: number };
}

export function noteSkip(ctx: AgentCtx, kind: keyof NonNullable<AgentCtx["skipped"]>) {
  ctx.skipped ??= { duplicate: 0, suppressed: 0, refused: 0 };
  ctx.skipped[kind] += 1;
}

export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Rótulo visível nas fontes ("consultou: …"). */
  label: (args: z.infer<S>) => string;
  description: string;
  parameters: Record<string, unknown>;
  schema: S;
  kind: "read" | "draft";
  run: (ctx: AgentCtx, args: z.infer<S>) => Promise<unknown>;
}

/** Os argumentos são sempre validados com `schema` antes de `run`, por isso o tipo pode ser apagado no registo. */
export const defineTool = <S extends z.ZodTypeAny>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;

/**
 * Texto vindo das plataformas ou de terceiros (nomes, anúncios, publicações, páginas de concorrentes):
 * sem caracteres de controlo nem marcadores de papel, truncado. É tratado como dado, nunca como instrução.
 */
export function untrusted(s: string | null | undefined, max = 160): string | null {
  if (!s) return null;
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/<\|[^|]*\|>|\[\/?(INST|SYS)\]|<\/?(system|assistant|user|tool)>/gi, "")
    .trim()
    .slice(0, max);
}

const r2 = (x: number) => Math.round(x * 100) / 100;
export const n = (x: number | null | undefined, digits = 2) => (x === null || x === undefined || !Number.isFinite(x) ? null : digits === 2 ? r2(x) : Number(x.toFixed(digits)));
export const pct = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev === 0 ? null : r2(((cur - prev) / Math.abs(prev)) * 100));

export const DAYS = [7, 14, 30, 90] as const;
export const daysParam = { type: "integer", description: "Janela em dias até ao último dia com dados; ajustada a 7, 14, 30 ou 90. Por omissão 30." };
