import { IntegrationError } from "@/server/integrations/http";
import { graphGet, graphPost } from "@/server/integrations/meta/graph";
import { metaCurrencyOffset } from "@/server/integrations/meta/ads";
import type { AdsExecutor, ChangeSpec, RemoteState, WriteContext } from "./types";

const objectId = (id: string) => {
  if (!/^\d+$/.test(id)) throw new IntegrationError("Identificador Meta inválido", "INVALID_REQUEST");
  return id;
};

/** Campos a enviar. Orçamentos em unidades mínimas da moeda (fator da conta). */
export function buildFields(ctx: WriteContext, spec: ChangeSpec): Record<string, string> {
  if (spec.operation === "SET_DAILY_BUDGET") {
    if (spec.target.level === "AD") throw new IntegrationError("Anúncios Meta não têm orçamento próprio", "INVALID_REQUEST");
    return { daily_budget: String(Math.round((spec.after.dailyBudget ?? 0) * metaCurrencyOffset(ctx.ds.currency))) };
  }
  const status = spec.after.status;
  if (status !== "ACTIVE" && status !== "PAUSED") throw new IntegrationError(`Estado não suportado: ${status}`, "INVALID_REQUEST");
  return { status };
}

export const metaExecutor: AdsExecutor = {
  async read(ctx, t): Promise<RemoteState> {
    const fields = t.level === "AD" ? "status" : "status,daily_budget";
    const r = await graphGet<{ status?: string; daily_budget?: string }>(objectId(t.externalId), ctx.token, { fields }, ctx.fetchImpl);
    const budget = r.daily_budget && Number(r.daily_budget) > 0 ? Number(r.daily_budget) / metaCurrencyOffset(ctx.ds.currency) : null;
    return { status: r.status ?? null, ...(t.level === "AD" ? {} : { dailyBudget: budget }) };
  },
  async validate(ctx, spec) {
    await graphPost(objectId(spec.target.externalId), ctx.token, { ...buildFields(ctx, spec), execution_options: JSON.stringify(["validate_only"]) }, { fetchImpl: ctx.fetchImpl });
  },
  async apply(ctx, spec) {
    // Atualizar estado/orçamento é idempotente: uma repetição em caso de falha de rede é segura.
    await graphPost(objectId(spec.target.externalId), ctx.token, buildFields(ctx, spec), { maxRetries: 1, fetchImpl: ctx.fetchImpl });
  },
};
