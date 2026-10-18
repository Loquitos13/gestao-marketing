"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { getConfig } from "@/server/config/settings";
import { getQueue, QUEUE_NAMES } from "@/server/sync/queue";
import { withWorkerWarning } from "@/server/sync/worker-presence";
import { checkUrl } from "@/server/competitors/safe-fetch";
import { refreshCompetitors, refreshKeywordIdeas, suggestCompetitors } from "@/server/competitors/refresh";
import { createKeywordsDraft, MATCH_TYPES } from "@/server/ads-write/keywords";
import { failure, formObject, id, type ActionState } from "./util";

const base = z.object({ clientId: id });
const done = (clientId: string, message: string): ActionState => {
  revalidatePath(`/c/${clientId}/competitors`);
  return { ok: true, message };
};

/** Domínio público (sem esquema, caminho nem "www."). Recusa nomes locais e IPs internos. */
const domain = z
  .string()
  .trim()
  .max(253)
  .transform((s) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, ""))
  .refine((s) => s === "" || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s), "domínio inválido (ex.: concorrente.pt)")
  .refine((s) => {
    if (!s) return true;
    try {
      checkUrl(`https://${s}`);
      return true;
    } catch {
      return false;
    }
  }, "domínio não permitido");
const pageIds = z
  .string()
  .max(300)
  .transform((s) => [...new Set(s.split(/[\s,;]+/).filter(Boolean))])
  .refine((a) => a.every((x) => /^\d{5,20}$/.test(x)), "IDs de Página Meta são números")
  .refine((a) => a.length <= 5, "máximo de 5 Páginas por concorrente");

const competitorInput = base.extend({ competitorId: id.optional(), name: z.string().trim().min(2).max(120), domain: domain.optional().default(""), metaPageIds: pageIds.optional().default(""), notes: z.string().trim().max(500).optional() });

export async function saveCompetitorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = competitorInput.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    if (!input.domain && !input.metaPageIds.length) return { ok: false, error: "Indique o domínio ou o ID da Página Meta do concorrente." };
    const data = { name: input.name, domain: input.domain || null, metaPageIds: input.metaPageIds, notes: input.notes || null };
    if (input.competitorId) {
      const r = await prisma.competitor.updateMany({ where: { id: input.competitorId, clientId: client.id }, data });
      if (!r.count) return { ok: false, error: "Concorrente não encontrado." };
    } else {
      if ((await prisma.competitor.count({ where: { clientId: client.id, suggested: false } })) >= 10) return { ok: false, error: "Máximo de 10 concorrentes por cliente." };
      const c = await prisma.competitor.create({ data: { ...data, clientId: client.id } });
      input.competitorId = c.id;
    }
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "competitor.save", targetType: "Competitor", targetId: input.competitorId, metadata: { name: input.name, domain: input.domain } });
    return done(client.id, "Concorrente guardado. Use “Atualizar dados” para recolher páginas, anúncios e velocidade.");
  } catch (e) {
    return failure(e);
  }
}

export async function deleteCompetitorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ competitorId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const r = await prisma.competitor.deleteMany({ where: { id: input.competitorId, clientId: client.id } });
    if (!r.count) return { ok: false, error: "Concorrente não encontrado." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "competitor.delete", targetType: "Competitor", targetId: input.competitorId });
    return done(client.id, "Concorrente removido, com os dados recolhidos.");
  } catch (e) {
    return failure(e);
  }
}

export async function acceptSuggestionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ competitorId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const r = await prisma.competitor.updateMany({ where: { id: input.competitorId, clientId: client.id, suggested: true }, data: { suggested: false } });
    if (!r.count) return { ok: false, error: "Sugestão não encontrada." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "competitor.accept", targetType: "Competitor", targetId: input.competitorId });
    return done(client.id, "Sugestão aceite como concorrente.");
  } catch (e) {
    return failure(e);
  }
}

export async function suggestCompetitorsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.parse(formObject(fd));
    const { client } = await requireClient(input.clientId, "workspace:write");
    const n = await suggestCompetitors(client.id);
    return done(client.id, n ? `${n === 1 ? "1 sugestão" : `${n} sugestões`} a partir da Biblioteca de Anúncios da Meta. Aceite só concorrentes reais.` : "Sem novas sugestões.");
  } catch (e) {
    return failure(e);
  }
}

export async function refreshCompetitorsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ what: z.enum(["research", "keywords"]) }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: `competitor.refresh.${input.what}` });
    const { REDIS_URL } = await getConfig();
    if (REDIS_URL && !client.isDemo) {
      const name = input.what === "research" ? "competitors-refresh-client" : "keyword-ideas-client";
      await getQueue(QUEUE_NAMES.research, REDIS_URL).add(name, { clientId: client.id, force: true }, { deduplication: { id: `${name}-${client.id}` }, removeOnComplete: 50, removeOnFail: 100 });
      return done(client.id, await withWorkerWarning(REDIS_URL, "Recolha enfileirada. Com 1 pedido por segundo por site, pode demorar alguns minutos."));
    }
    if (input.what === "keywords") {
      const s = await refreshKeywordIdeas(client.id, { force: true });
      return s.status === "ok" ? done(client.id, s.message) : { ok: false, error: s.message };
    }
    const s = await refreshCompetitors(client.id, { maxPages: client.isDemo ? 50 : 10 });
    const bad = Object.values(s).filter((x) => x && x.status !== "ok" && x.status !== "skipped");
    revalidatePath(`/c/${client.id}/competitors`);
    return bad.length ? { ok: true, message: `Concluído com avisos: ${bad.map((b) => b!.message).join(" · ")}` } : done(client.id, client.isDemo ? "Dados de demonstração atualizados." : "Recolha concluída (sem Redis: limitada a 10 páginas por site).");
  } catch (e) {
    return failure(e);
  }
}

export async function proposeKeywordsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ adGroupId: id, matchType: z.enum(MATCH_TYPES), keyword: z.array(z.string().trim().min(1).max(80)).min(1, "Escolha pelo menos uma palavra-chave.").max(20) }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    const change = await createKeywordsDraft({ clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, adGroupId: input.adGroupId, keywords: input.keyword.map((text) => ({ text, matchType: input.matchType })), reason: "Lacuna de palavras-chave identificada na pesquisa de concorrência." });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: `Proposta criada: ${(change.after as { summary?: string }).summary}. Confirme em Gestão → Propostas.` };
  } catch (e) {
    return failure(e);
  }
}
