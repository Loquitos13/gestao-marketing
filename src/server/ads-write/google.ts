import { IntegrationError, requestJson } from "@/server/integrations/http";
import { base, classifyGoogleAds, gaqlSearch, headers } from "@/server/integrations/google/ads";
import type { AdsExecutor, ChangeSpec, RemoteState, Target, WriteContext } from "./types";

const numeric = (id: string | null | undefined, what: string) => {
  if (!id || !/^\d+$/.test(id)) throw new IntegrationError(`Identificador inválido (${what})`, "INVALID_REQUEST");
  return id;
};
const customerId = (ctx: WriteContext) => numeric(ctx.ds.externalId.replace(/-/g, ""), "conta");

type Service = "campaigns" | "adGroups" | "adGroupAds" | "campaignBudgets" | "adGroupCriteria";

export async function googleMutate(ctx: WriteContext, service: Service, operations: unknown[], validateOnly: boolean) {
  return requestJson<{ results?: { resourceName: string }[] }>(`${await base()}/customers/${customerId(ctx)}/${service}:mutate`, {
    headers: await headers(ctx.token, ctx.loginCustomerId),
    body: { operations, validateOnly, partialFailure: false },
    classify: classifyGoogleAds,
    maxRetries: 0,
    fetchImpl: ctx.fetchImpl,
  });
}

export function resourceName(ctx: WriteContext, t: Target): { service: Service; name: string } {
  const cid = customerId(ctx);
  if (t.level === "CAMPAIGN") return { service: "campaigns", name: `customers/${cid}/campaigns/${numeric(t.externalId, "campanha")}` };
  if (t.level === "AD_GROUP") return { service: "adGroups", name: `customers/${cid}/adGroups/${numeric(t.externalId, "grupo")}` };
  return { service: "adGroupAds", name: `customers/${cid}/adGroupAds/${numeric(t.adGroupExternalId, "grupo")}~${numeric(t.externalId, "anúncio")}` };
}

/** Constrói a operação de mutação. O orçamento Google vive no recurso campaignBudgets (montante em micros, múltiplo de 10 000). */
export function buildOperation(ctx: WriteContext, spec: ChangeSpec): { service: Service; op: unknown } {
  if (spec.operation === "SET_DAILY_BUDGET") {
    if (spec.target.level !== "CAMPAIGN" || !spec.target.budgetResourceName) throw new IntegrationError("No Google Ads o orçamento diário é definido na campanha", "INVALID_REQUEST");
    if (!spec.target.budgetResourceName.startsWith(`customers/${customerId(ctx)}/campaignBudgets/`)) throw new IntegrationError("Recurso de orçamento não pertence a esta conta", "INVALID_REQUEST");
    const micros = Math.round((spec.after.dailyBudget ?? 0) * 100) * 10_000;
    return { service: "campaignBudgets", op: { update: { resourceName: spec.target.budgetResourceName, amountMicros: String(micros) }, updateMask: "amountMicros" } };
  }
  const status = spec.after.status;
  if (status !== "ENABLED" && status !== "PAUSED") throw new IntegrationError(`Estado não suportado: ${status}`, "INVALID_REQUEST");
  const { service, name } = resourceName(ctx, spec.target);
  return { service, op: { update: { resourceName: name, status }, updateMask: "status" } };
}

const micros = (v: unknown) => (v === undefined || v === null ? null : Number(v) / 1_000_000);

export const googleExecutor: AdsExecutor = {
  async read(ctx, t): Promise<RemoteState> {
    const cid = customerId(ctx);
    const q = (query: string) => gaqlSearch(cid, query, ctx.token, ctx.loginCustomerId, ctx.fetchImpl);
    if (t.level === "CAMPAIGN") {
      const [r] = await q(`SELECT campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${numeric(t.externalId, "campanha")}`);
      if (!r) throw new IntegrationError("Campanha não encontrada na conta Google Ads", "NOT_FOUND");
      return { status: String(r.campaign?.status ?? ""), dailyBudget: micros(r.campaignBudget?.amountMicros) };
    }
    if (t.level === "AD_GROUP") {
      const [r] = await q(`SELECT ad_group.status FROM ad_group WHERE ad_group.id = ${numeric(t.externalId, "grupo")}`);
      if (!r) throw new IntegrationError("Grupo de anúncios não encontrado", "NOT_FOUND");
      return { status: String(r.adGroup?.status ?? "") };
    }
    const [r] = await q(`SELECT ad_group_ad.status FROM ad_group_ad WHERE ad_group.id = ${numeric(t.adGroupExternalId, "grupo")} AND ad_group_ad.ad.id = ${numeric(t.externalId, "anúncio")}`);
    if (!r) throw new IntegrationError("Anúncio não encontrado", "NOT_FOUND");
    return { status: String(r.adGroupAd?.status ?? "") };
  },
  async validate(ctx, spec) {
    const { service, op } = buildOperation(ctx, spec);
    await googleMutate(ctx, service, [op], true);
  },
  async apply(ctx, spec) {
    const { service, op } = buildOperation(ctx, spec);
    await googleMutate(ctx, service, [op], false);
  },
};
