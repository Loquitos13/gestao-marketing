import type { AdChange, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultDb } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { IntegrationError } from "@/server/integrations/http";
import { graphPost } from "@/server/integrations/meta/graph";
import { AdsWriteError } from "./entities";
import { adWarnings, normalizeRsa, summarizeAd, validateMetaAd, validateRsa, type AdSpec, type MetaLinkAdSpec, type RsaSpec } from "./creative";
import { googleMutate } from "./google";
import type { WriteContext } from "./types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export interface AdDraftInput {
  clientId: string;
  organizationId: string;
  userId: string | null;
  adGroupId: string;
  spec: AdSpec;
  /** Edição: o anúncio original é substituído (proposta de pausa criada após o novo ser aplicado). */
  replaceAdId?: string | null;
  reason?: string | null;
  source?: "MANUAL" | "AGENT";
}

/** Cria a proposta de novo anúncio (sempre criado PAUSADO na plataforma). */
export async function createAdDraft(input: AdDraftInput, db: PrismaClient = defaultDb): Promise<{ change: AdChange; warnings: string[] }> {
  const g = await db.adGroup.findFirst({ where: { id: input.adGroupId, campaign: { clientId: input.clientId, client: { organizationId: input.organizationId } } }, include: { campaign: true } });
  if (!g) throw new AdsWriteError("Grupo/conjunto não encontrado neste cliente.");
  const platform = g.campaign.platform;
  if ((platform === "GOOGLE_ADS") !== (input.spec.kind === "GOOGLE_RSA") || (platform === "META_ADS") !== (input.spec.kind === "META_LINK")) throw new AdsWriteError("O tipo de anúncio não corresponde à plataforma do grupo.");
  if (platform === "GOOGLE_ADS" && g.campaign.campaignType && !/SEARCH/i.test(g.campaign.campaignType)) throw new AdsWriteError("Anúncios responsivos de pesquisa só podem ser criados em campanhas de Pesquisa.");
  const spec = input.spec.kind === "GOOGLE_RSA" ? normalizeRsa(input.spec) : input.spec;
  const errors = spec.kind === "GOOGLE_RSA" ? validateRsa(spec) : validateMetaAd(spec);
  if (errors.length) throw new AdsWriteError(errors.join(" "));
  let replaced: { id: string; name: string } | null = null;
  if (input.replaceAdId) {
    const old = await db.ad.findFirst({ where: { id: input.replaceAdId, adGroupId: g.id } });
    if (!old) throw new AdsWriteError("O anúncio a substituir não pertence a este grupo.");
    replaced = { id: old.id, name: old.name ?? old.externalId };
  }
  const ds = await db.dataSource.findUniqueOrThrow({ where: { id: g.campaign.dataSourceId } });
  const change = await db.adChange.create({
    data: {
      clientId: input.clientId,
      dataSourceId: ds.id,
      platform,
      operation: replaced ? "UPDATE_AD" : "CREATE_AD",
      entityLevel: "AD_GROUP",
      entityId: g.id,
      externalId: g.externalId,
      entityName: `${g.campaign.name} › ${g.name}`,
      before: json({ summary: replaced ? `Anúncio atual: ${replaced.name}` : "—" }),
      after: json({ summary: summarizeAd(spec), spec, replaceAdId: replaced?.id ?? null }),
      reason: input.reason ?? (replaced ? `Nova versão de “${replaced.name}”. O original fica ativo até confirmar a sua pausa.` : null),
      source: input.source ?? "MANUAL",
      simulated: ds.origin === "SIMULATED",
      validation: json({ target: { level: "AD_GROUP", externalId: g.externalId } }),
      createdById: input.userId,
    },
  });
  await audit({ organizationId: input.organizationId, clientId: input.clientId, userId: input.userId, action: "ads.change.draft", targetType: "AdChange", targetId: change.id, metadata: json({ operation: change.operation, entity: change.entityName, summary: summarizeAd(spec) }) });
  return { change, warnings: adWarnings(spec) };
}

const googleCreateOp = (ctx: WriteContext, adGroupExternalId: string, s: RsaSpec) => {
  if (!/^\d+$/.test(adGroupExternalId)) throw new IntegrationError("Grupo de anúncios inválido", "INVALID_REQUEST");
  const cid = ctx.ds.externalId.replace(/-/g, "");
  return {
    create: {
      adGroup: `customers/${cid}/adGroups/${adGroupExternalId}`,
      status: "PAUSED",
      ad: {
        finalUrls: [s.finalUrl],
        responsiveSearchAd: { headlines: s.headlines.map((text) => ({ text })), descriptions: s.descriptions.map((text) => ({ text })), ...(s.path1 ? { path1: s.path1 } : {}), ...(s.path2 ? { path2: s.path2 } : {}) },
      },
    },
  };
};

const metaCreativeForm = (s: MetaLinkAdSpec) => ({
  name: `${s.name} (criativo)`,
  object_story_spec: JSON.stringify({
    page_id: s.pageId,
    link_data: { link: s.link, message: s.message, name: s.headline, ...(s.description ? { description: s.description } : {}), picture: s.imageUrl, call_to_action: { type: s.callToAction, value: { link: s.link } } },
  }),
});

const account = (ctx: WriteContext) => {
  if (!/^act_\d+$/.test(ctx.ds.externalId)) throw new IntegrationError("Conta Meta inválida", "INVALID_REQUEST");
  return ctx.ds.externalId;
};

/** Pré-validação sem efeitos. */
export async function validateAdOnPlatform(ctx: WriteContext, adGroupExternalId: string, spec: AdSpec) {
  if (spec.kind === "GOOGLE_RSA") await googleMutate(ctx, "adGroupAds", [googleCreateOp(ctx, adGroupExternalId, spec)], true);
  else await graphPost(`${account(ctx)}/adcreatives`, ctx.token, { ...metaCreativeForm(spec), execution_options: JSON.stringify(["validate_only"]) }, { fetchImpl: ctx.fetchImpl });
}

/** Cria o anúncio PAUSADO. Sem repetições automáticas: uma criação nunca é repetida às cegas. Devolve o ID externo. */
export async function createAdOnPlatform(ctx: WriteContext, adGroupExternalId: string, spec: AdSpec): Promise<string> {
  if (spec.kind === "GOOGLE_RSA") {
    const r = await googleMutate(ctx, "adGroupAds", [googleCreateOp(ctx, adGroupExternalId, spec)], false);
    const rn = r.results?.[0]?.resourceName ?? "";
    const id = rn.split("~")[1];
    if (!id) throw new IntegrationError("Resposta sem identificador do anúncio criado", "UNKNOWN");
    return id;
  }
  if (!/^\d+$/.test(adGroupExternalId)) throw new IntegrationError("Conjunto de anúncios inválido", "INVALID_REQUEST");
  const creative = await graphPost<{ id: string }>(`${account(ctx)}/adcreatives`, ctx.token, metaCreativeForm(spec), { fetchImpl: ctx.fetchImpl });
  const ad = await graphPost<{ id: string }>(`${account(ctx)}/ads`, ctx.token, { name: spec.name, adset_id: adGroupExternalId, creative: JSON.stringify({ creative_id: creative.id }), status: "PAUSED" }, { fetchImpl: ctx.fetchImpl });
  return ad.id;
}

/** Regista localmente o anúncio criado (aparece já na gestão, antes da próxima sincronização). */
export async function persistCreatedAd(db: PrismaClient, change: AdChange, externalId: string, spec: AdSpec) {
  const g = await db.adGroup.findUniqueOrThrow({ where: { id: change.entityId! }, include: { campaign: true } });
  let creativeId: string | null = null;
  if (spec.kind === "META_LINK") {
    const cr = await db.creative.create({ data: { dataSourceId: g.campaign.dataSourceId, externalId: `cr_${externalId}`, format: "IMAGE", primaryText: spec.message, title: spec.headline, description: spec.description ?? null, callToAction: spec.callToAction, imageUrl: spec.imageUrl } });
    creativeId = cr.id;
  }
  return db.ad.create({
    data: {
      adGroupId: g.id,
      externalId,
      name: spec.kind === "META_LINK" ? spec.name : spec.headlines[0],
      status: "PAUSED",
      adType: spec.kind === "GOOGLE_RSA" ? "RESPONSIVE_SEARCH_AD" : "LINK",
      finalUrl: spec.kind === "GOOGLE_RSA" ? spec.finalUrl : spec.link,
      headlines: spec.kind === "GOOGLE_RSA" ? spec.headlines : [spec.headline],
      descriptions: spec.kind === "GOOGLE_RSA" ? spec.descriptions : spec.description ? [spec.description] : [],
      createdTime: new Date(),
      creativeId,
    },
  });
}
