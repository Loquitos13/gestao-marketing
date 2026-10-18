import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit";
import { loadClientContext } from "@/server/queries/context";
import { getConfig } from "@/server/config/settings";
import { getQueue, QUEUE_NAMES } from "@/server/sync/queue";
import { defaultLlm, LlmBusyError, LlmUnavailableError, type Llm } from "./llm";
import { z } from "zod";
import { runAgent, systemPrompt, type AgentAnswer } from "./runner";
import type { AgentCtx } from "./tools/common";
import { proposeRecommendation } from "./tools/draft";
import { verifyNumbers } from "./grounding";

export type RunTrigger = "SCHEDULE" | "SYNC" | "MANUAL";

/** Análise autónoma de um cliente. Só cria recomendações (NEW) e propostas (DRAFT); nunca aplica nada. */
export async function analyzeClient(clientId: string, trigger: RunTrigger, opts: { llm?: Llm; userId?: string | null } = {}) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const run = await prisma.agentRun.create({ data: { clientId, trigger } });
  const t0 = Date.now();
  const finish = (data: Prisma.AgentRunUpdateInput) => prisma.agentRun.update({ where: { id: run.id }, data: { ...data, finishedAt: new Date(), durationMs: Date.now() - t0 } });
  let llm: Llm;
  try {
    llm = opts.llm ?? (await defaultLlm(120_000));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return finish({ status: "UNAVAILABLE", error: `Agente indisponível: ${msg}` });
  }
  const ctx: AgentCtx = { client, cctx: await loadClientContext(client), organizationId: client.organizationId, userId: opts.userId ?? null, runId: run.id, model: llm.model, created: [] };
  try {
    const answer = await runAgent({ ctx, llm, system: await systemPrompt(ctx, "analyze"), history: [{ role: "user", content: "Analisa KPIs, campanhas, ritmo do orçamento, previsões, alertas e recomendações. Cria só as sugestões que se justificarem." }] });
    if (!ctx.created.length && answer.content) await extractSuggestions(ctx, llm, answer);
    const done = await finish({
      status: "SUCCESS",
      model: llm.model,
      toolCalls: { calls: answer.calls, unverified: answer.unverified, skipped: ctx.skipped ?? { duplicate: 0, suppressed: 0, refused: 0 } } as unknown as Prisma.InputJsonValue,
      proposals: ctx.created.length,
      summary: answer.content.slice(0, 8000),
    });
    await audit({ organizationId: client.organizationId, clientId, userId: opts.userId ?? null, action: "agent.run", targetType: "AgentRun", targetId: run.id, metadata: { trigger, proposals: ctx.created.length } });
    return done;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ clientId, runId: run.id, error: msg }, "Falha na execução do agente");
    const unavailable = e instanceof LlmUnavailableError || e instanceof LlmBusyError;
    return finish({ status: unavailable ? "UNAVAILABLE" : "FAILED", model: llm.model, proposals: ctx.created.length, error: msg.slice(0, 500) });
  }
}

const extracted = z.object({
  sugestoes: z
    .array(
      z.object({
        category: z.string(),
        title: z.string(),
        explanation: z.string(),
        suggestedAction: z.string(),
        priority: z.coerce.number().optional(),
        confidence: z.string().optional(),
        campaignName: z.string().nullish(),
      }),
    )
    .max(5),
});

/**
 * Modelos pequenos escrevem muitas vezes as sugestões em texto em vez de chamarem a ferramenta.
 * Converte-as em JSON e cria-as pela mesma ferramenta (mesma validação, deduplicação e filtro de preferência).
 */
async function extractSuggestions(ctx: AgentCtx, llm: Llm, answer: AgentAnswer) {
  const r = await llm.chat(
    [
      {
        role: "system",
        content:
          'Converte as sugestões do texto num objeto JSON {"sugestoes":[{"category":"BUDGET|CREATIVE|BIDDING|TARGETING|SEO|TRACKING|OTHER","title":"...","explanation":"porquê, com os números do texto","suggestedAction":"...","priority":1|2|3,"confidence":"HIGH|MEDIUM|LOW","campaignName":"nome exato ou null"}]}. Inclui só sugestões que estejam no texto (máximo 3). Não acrescentes números novos.',
      },
      { role: "user", content: answer.content.slice(0, 8000) },
    ],
    { json: true, maxTokens: 1200, temperature: 0 },
  );
  let data: z.infer<typeof extracted>;
  try {
    data = extracted.parse(JSON.parse(r.content));
  } catch (e) {
    logger.warn({ runId: ctx.runId, error: (e as Error).message.slice(0, 300) }, "Extração de sugestões do agente inválida");
    return;
  }
  const campaigns = await prisma.campaign.findMany({ where: { clientId: ctx.client.id }, select: { id: true, name: true } });
  for (const s of data.sugestoes.slice(0, 3)) {
    const unverified = verifyNumbers(`${s.explanation} ${s.suggestedAction}`, answer.results).unverified;
    const camp = s.campaignName ? campaigns.find((c) => c.name.toLowerCase() === s.campaignName!.toLowerCase()) : undefined;
    const pick = (v: string | undefined, allowed: string[], fallback: string) => (v ?? "").toUpperCase().split(/[|,/\s]+/).find((x) => allowed.includes(x)) ?? fallback;
    const args = proposeRecommendation.schema.safeParse({
      category: pick(s.category, ["BUDGET", "CREATIVE", "BIDDING", "TARGETING", "SEO", "TRACKING", "OTHER"], "OTHER"),
      title: s.title.slice(0, 120),
      explanation: unverified.length ? `${s.explanation}\n\nNúmeros não verificados nos dados: ${unverified.join(", ")}.` : s.explanation,
      suggestedAction: s.suggestedAction,
      priority: [1, 2, 3].includes(s.priority ?? 0) ? s.priority : 2,
      confidence: unverified.length ? "LOW" : pick(s.confidence, ["HIGH", "MEDIUM", "LOW"], "MEDIUM"),
      campaignId: camp?.id,
    });
    if (!args.success) {
      logger.warn({ runId: ctx.runId, issues: args.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, "Sugestão do agente rejeitada na validação");
      continue;
    }
    const res = (await proposeRecommendation.run(ctx, args.data)) as Record<string, unknown>;
    if (!res.criada) logger.info({ runId: ctx.runId, result: res }, "Sugestão do agente não criada");
  }
}

/** Execução diária para todos os clientes ativos (em série: um só modelo local). */
export async function analyzeAllClients() {
  const clients = await prisma.client.findMany({ where: { archivedAt: null, contractStatus: { in: ["ACTIVE", "PROSPECT"] } }, select: { id: true } });
  const out = [];
  for (const c of clients) {
    const r = await analyzeClient(c.id, "SCHEDULE");
    out.push({ clientId: c.id, status: r.status, proposals: r.proposals });
    if (r.status === "UNAVAILABLE") break;
  }
  return out;
}

export const AGENT_QUEUE = QUEUE_NAMES.agent;

/** Pede uma análise depois de uma sincronização, com espera e deduplicação por cliente (debounce). */
export async function requestAnalysisAfterSync(clientId: string) {
  const { REDIS_URL } = await getConfig();
  if (!REDIS_URL) return null;
  const id = `agent-sync-${clientId}`;
  return getQueue(QUEUE_NAMES.agent, REDIS_URL).add("agent-analyze", { clientId, trigger: "SYNC" }, { delay: 10 * 60_000, deduplication: { id, ttl: 6 * 3_600_000 }, removeOnComplete: 100, removeOnFail: 200 });
}
