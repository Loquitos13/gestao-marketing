import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fromDate } from "@/lib/dates";
import { createDraft } from "@/server/ads-write/service";
import { AdsWriteError, loadEntity } from "@/server/ads-write/entities";
import { changeTraits, gateSuggestion, loadPreference } from "../learning";
import { defineTool, noteSkip, untrusted } from "./common";

/** Máximo de rascunhos que uma execução do agente pode criar. */
export const MAX_DRAFTS_PER_RUN = 5;

const CATEGORIES = ["BUDGET", "CREATIVE", "BIDDING", "TARGETING", "SEO", "TRACKING", "OTHER"] as const;
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export const proposeRecommendation = defineTool({
  name: "propose_recommendation",
  label: () => "criou uma recomendação",
  description: "Cria uma recomendação pendente de aprovação (não altera nada nas plataformas). Use só com números obtidos das ferramentas.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", enum: [...CATEGORIES] },
      title: { type: "string", description: "Até 120 caracteres" },
      explanation: { type: "string", description: "Porquê, com os números que o justificam" },
      suggestedAction: { type: "string", description: "O que fazer, de forma concreta" },
      priority: { type: "integer", enum: [1, 2, 3], description: "1 alta, 3 baixa" },
      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
      campaignId: { type: "string", description: "id interno da campanha, se aplicável" },
    },
    required: ["category", "title", "explanation", "suggestedAction", "priority", "confidence"],
  },
  schema: z.object({
    category: z.enum(CATEGORIES),
    title: z.string().trim().min(5).max(120),
    explanation: z.string().trim().min(10).max(1500),
    suggestedAction: z.string().trim().min(5).max(500),
    priority: z.coerce.number().int().min(1).max(3),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    campaignId: z.string().max(40).optional(),
  }),
  kind: "draft",
  async run(ctx, a) {
    if (ctx.created.length >= MAX_DRAFTS_PER_RUN) return { recusado: `Limite de ${MAX_DRAFTS_PER_RUN} sugestões por execução atingido.` };
    const camp = a.campaignId ? await prisma.campaign.findFirst({ where: { id: a.campaignId, clientId: ctx.client.id } }) : null;
    if (a.campaignId && !camp) return { erro: "Campanha não encontrada neste cliente." };
    const type = `AI_${a.category}`;
    const gate = gateSuggestion(await loadPreference(ctx.organizationId), { kind: type, platform: camp?.platform ?? null, source: "AI", confidence: a.confidence, priority: a.priority, brand: /\b(marca|brand)\b/i.test(camp?.name ?? "") });
    if (!gate.allowed) {
      noteSkip(ctx, "suppressed");
      return { suprimido: `Não criada: o utilizador ${gate.reason ?? "costuma recusar sugestões semelhantes"}.` };
    }
    const fingerprint = `ai:${a.category}:${camp?.externalId ?? "-"}:${slug(a.title)}:${fromDate(new Date()).slice(0, 7)}`;
    const existing = await prisma.recommendation.findUnique({ where: { clientId_fingerprint: { clientId: ctx.client.id, fingerprint } } });
    if (existing?.status === "DISMISSED") {
      noteSkip(ctx, "refused");
      return { recusado: "Uma recomendação igual foi recusada este mês; não a repita sem dados novos." };
    }
    if (existing) {
      noteSkip(ctx, "duplicate");
      return { ja_existe: existing.id };
    }
    const rec = await prisma.recommendation.create({
      data: {
        clientId: ctx.client.id,
        fingerprint,
        type,
        source: "AI",
        platform: camp?.platform ?? null,
        entityLevel: camp ? "CAMPAIGN" : null,
        entityId: camp?.externalId ?? null,
        entityName: camp?.name ?? null,
        title: untrusted(a.title, 120)!,
        explanation: a.explanation,
        suggestedAction: a.suggestedAction,
        priority: a.priority,
        confidence: a.confidence,
        evidence: { agentRunId: ctx.runId, model: ctx.model ?? null, approvalProbability: gate.probability } as Prisma.InputJsonValue,
        agentRunId: ctx.runId,
      },
    });
    ctx.created.push({ kind: "recommendation", id: rec.id });
    return { criada: rec.id, estado: "NEW", nota: "Fica pendente de aprovação do utilizador em Recomendações." };
  },
});

export const proposeAdChange = defineTool({
  name: "propose_ad_change",
  label: () => "preparou uma proposta de alteração",
  description:
    "Prepara uma proposta de alteração (rascunho) para pausar/ativar ou mudar o orçamento diário de uma campanha, conjunto/grupo ou anúncio. NÃO aplica: o utilizador revê e confirma em Gestão. Os limites de variação do cliente são aplicados.",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["SET_STATUS", "SET_DAILY_BUDGET"] },
      level: { type: "string", enum: ["CAMPAIGN", "AD_GROUP", "AD"] },
      entityId: { type: "string", description: "id interno (de get_campaigns ou get_ads)" },
      status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
      dailyBudget: { type: "number", description: "Novo orçamento diário na moeda da conta de anúncios (DataSource.currency), não na do cliente" },
      reason: { type: "string", description: "Justificação com números" },
    },
    required: ["operation", "level", "entityId", "reason"],
  },
  schema: z.object({
    operation: z.enum(["SET_STATUS", "SET_DAILY_BUDGET"]),
    level: z.enum(["CAMPAIGN", "AD_GROUP", "AD"]),
    entityId: z.string().min(1).max(40),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    dailyBudget: z.coerce.number().positive().max(1_000_000).optional(),
    reason: z.string().trim().min(10).max(800),
  }),
  kind: "draft",
  async run(ctx, a) {
    if (ctx.created.length >= MAX_DRAFTS_PER_RUN) return { recusado: `Limite de ${MAX_DRAFTS_PER_RUN} propostas por execução atingido.` };
    if (a.operation === "SET_STATUS" && !a.status) return { erro: "Indique status (ACTIVE ou PAUSED)." };
    if (a.operation === "SET_DAILY_BUDGET" && !a.dailyBudget) return { erro: "Indique dailyBudget." };
    try {
      const e = await loadEntity(prisma, ctx.client.id, a.level, a.entityId);
      const gate = gateSuggestion(
        await loadPreference(ctx.organizationId),
        changeTraits({ operation: a.operation, platform: e.platform, source: "AGENT", entityName: `${e.campaignName} ${e.name}`, before: { dailyBudget: e.dailyBudget }, after: { dailyBudget: a.dailyBudget, status: a.status } }),
      );
      if (!gate.allowed) {
        noteSkip(ctx, "suppressed");
        return { suprimido: `Não criada: o utilizador ${gate.reason ?? "costuma recusar propostas semelhantes"}.` };
      }
      const change = await createDraft({
        clientId: ctx.client.id,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        level: a.level,
        entityId: a.entityId,
        operation: a.operation,
        desiredStatus: a.status,
        dailyBudget: a.dailyBudget,
        reason: `Agente IA: ${a.reason}`,
        source: "AGENT",
      });
      ctx.created.push({ kind: "change", id: change.id });
      return { proposta: change.id, estado: "DRAFT", antes: change.before, depois: change.after, nota: "Fica pendente de confirmação do utilizador em Gestão → Propostas." };
    } catch (e) {
      if (e instanceof AdsWriteError) return { erro: e.message };
      throw e;
    }
  },
});

export const DRAFT_TOOLS = [proposeRecommendation, proposeAdChange];
