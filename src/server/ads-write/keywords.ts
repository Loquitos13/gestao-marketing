import type { AdChange, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultDb } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { IntegrationError } from "@/server/integrations/http";
import { AdsWriteError } from "./entities";
import { googleMutate } from "./google";
import type { WriteContext } from "./types";

export const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
export const MATCH_LABELS: Record<MatchType, string> = { EXACT: "Exata", PHRASE: "Frase", BROAD: "Ampla" };
export const MAX_KEYWORDS_PER_CHANGE = 20;

export interface KeywordSpec {
  text: string;
  matchType: MatchType;
}

/** Regras da Google Ads: até 80 caracteres, 10 palavras e sem caracteres especiais proibidos. */
export function validateKeywords(list: KeywordSpec[]): string[] {
  const errors: string[] = [];
  if (!list.length) errors.push("Indique pelo menos uma palavra-chave.");
  if (list.length > MAX_KEYWORDS_PER_CHANGE) errors.push(`Máximo de ${MAX_KEYWORDS_PER_CHANGE} palavras-chave por proposta.`);
  for (const k of list) {
    if (!k.text) errors.push("Palavra-chave vazia.");
    else if (k.text.length > 80) errors.push(`“${k.text.slice(0, 30)}…” tem mais de 80 caracteres.`);
    else if (k.text.split(/\s+/).length > 10) errors.push(`“${k.text}” tem mais de 10 palavras.`);
    else if (/[!@%^*()={};~`<>?\\|]/.test(k.text)) errors.push(`“${k.text}” tem caracteres não permitidos.`);
    if (!MATCH_TYPES.includes(k.matchType)) errors.push(`Tipo de correspondência inválido: ${k.matchType}.`);
  }
  return errors;
}

export const normalizeKeywords = (list: KeywordSpec[]) => {
  const seen = new Set<string>();
  return list
    .map((k) => ({ text: k.text.trim().toLowerCase().replace(/\s+/g, " "), matchType: k.matchType }))
    .filter((k) => k.text && !seen.has(`${k.matchType}|${k.text}`) && seen.add(`${k.matchType}|${k.text}`));
};

const fmtKw = (k: KeywordSpec) => (k.matchType === "EXACT" ? `[${k.text}]` : k.matchType === "PHRASE" ? `"${k.text}"` : k.text);

/** Proposta de adicionar palavras-chave a um grupo de anúncios de Pesquisa (Google). Criadas sempre em PAUSA. */
export async function createKeywordsDraft(
  input: { clientId: string; organizationId: string; userId: string | null; adGroupId: string; keywords: KeywordSpec[]; reason?: string | null; source?: "MANUAL" | "AGENT" },
  db: PrismaClient = defaultDb,
): Promise<AdChange> {
  const g = await db.adGroup.findFirst({ where: { id: input.adGroupId, campaign: { clientId: input.clientId, client: { organizationId: input.organizationId } } }, include: { campaign: true } });
  if (!g) throw new AdsWriteError("Grupo de anúncios não encontrado neste cliente.");
  if (g.campaign.platform !== "GOOGLE_ADS") throw new AdsWriteError("Palavras-chave só podem ser adicionadas em grupos da Google Ads.");
  if (g.campaign.campaignType && !/SEARCH/i.test(g.campaign.campaignType)) throw new AdsWriteError("Palavras-chave só podem ser adicionadas em campanhas de Pesquisa.");
  let keywords = normalizeKeywords(input.keywords);
  const errors = validateKeywords(keywords);
  if (errors.length) throw new AdsWriteError(errors.join(" "));
  const existing = await db.adsTermDaily.findMany({ where: { clientId: input.clientId, kind: "KEYWORD", adGroupExternalId: g.externalId }, distinct: ["text", "matchType"], select: { text: true, matchType: true } });
  const have = new Set(existing.map((e) => `${e.matchType}|${e.text.toLowerCase()}`));
  const dropped = keywords.filter((k) => have.has(`${k.matchType}|${k.text}`));
  keywords = keywords.filter((k) => !have.has(`${k.matchType}|${k.text}`));
  if (!keywords.length) throw new AdsWriteError("Todas estas palavras-chave já existem neste grupo.");
  const ds = await db.dataSource.findUniqueOrThrow({ where: { id: g.campaign.dataSourceId } });
  const summary = `${keywords.length} palavra(s)-chave em pausa: ${keywords.slice(0, 6).map(fmtKw).join(", ")}${keywords.length > 6 ? "…" : ""}`;
  const change = await db.adChange.create({
    data: {
      clientId: input.clientId,
      dataSourceId: ds.id,
      platform: "GOOGLE_ADS",
      operation: "ADD_KEYWORDS",
      entityLevel: "AD_GROUP",
      entityId: g.id,
      externalId: g.externalId,
      entityName: `${g.campaign.name} › ${g.name}`,
      before: { summary: "—" } as Prisma.InputJsonValue,
      after: { summary, keywords } as unknown as Prisma.InputJsonValue,
      reason: [input.reason, dropped.length ? `${dropped.length} já existiam no grupo e foram retiradas.` : null].filter(Boolean).join(" ") || null,
      source: input.source ?? "MANUAL",
      simulated: ds.origin === "SIMULATED",
      validation: { target: { level: "AD_GROUP", externalId: g.externalId } } as Prisma.InputJsonValue,
      createdById: input.userId,
    },
  });
  await audit({ organizationId: input.organizationId, clientId: input.clientId, userId: input.userId, action: "ads.change.draft", targetType: "AdChange", targetId: change.id, metadata: { operation: "ADD_KEYWORDS", entity: change.entityName, keywords: keywords.length } });
  return change;
}

export function keywordOperations(ctx: WriteContext, adGroupExternalId: string, keywords: KeywordSpec[]) {
  if (!/^\d+$/.test(adGroupExternalId)) throw new IntegrationError("Grupo de anúncios inválido", "INVALID_REQUEST");
  const errors = validateKeywords(keywords);
  if (errors.length) throw new IntegrationError(errors.join(" "), "INVALID_REQUEST");
  const cid = ctx.ds.externalId.replace(/-/g, "");
  return keywords.map((k) => ({ create: { adGroup: `customers/${cid}/adGroups/${adGroupExternalId}`, status: "PAUSED", keyword: { text: k.text, matchType: k.matchType } } }));
}

export const validateKeywordsOnPlatform = (ctx: WriteContext, adGroupExternalId: string, keywords: KeywordSpec[]) => googleMutate(ctx, "adGroupCriteria", keywordOperations(ctx, adGroupExternalId, keywords), true);

/** Sem repetições automáticas: uma criação nunca é repetida às cegas. */
export async function addKeywordsOnPlatform(ctx: WriteContext, adGroupExternalId: string, keywords: KeywordSpec[]): Promise<number> {
  const r = await googleMutate(ctx, "adGroupCriteria", keywordOperations(ctx, adGroupExternalId, keywords), false);
  return r.results?.length ?? 0;
}
