import type { Platform, PrismaClient } from "@prisma/client";
import type { BudgetEntity } from "./guards";
import type { EntityLevel, RemoteState, Target } from "./types";

export interface LoadedEntity {
  level: EntityLevel;
  id: string;
  name: string;
  platform: Platform;
  dataSourceId: string;
  campaignName: string;
  status: string;
  dailyBudget: number | null;
  target: Target;
  budget: BudgetEntity;
}

type Raw = Record<string, unknown> | null;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class AdsWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdsWriteError";
  }
}

/** Carrega a entidade garantindo que pertence ao cliente (isolamento entre clientes). */
export async function loadEntity(db: PrismaClient, clientId: string, level: EntityLevel, id: string): Promise<LoadedEntity> {
  if (level === "CAMPAIGN") {
    const c = await db.campaign.findFirst({ where: { id, clientId } });
    if (!c) throw new AdsWriteError("Campanha não encontrada neste cliente.");
    const raw = c.raw as Raw;
    return {
      level,
      id: c.id,
      name: c.name,
      platform: c.platform,
      dataSourceId: c.dataSourceId,
      campaignName: c.name,
      status: c.status,
      dailyBudget: num(c.dailyBudget),
      target: { level, externalId: c.externalId, budgetResourceName: (raw?.budgetResourceName as string | undefined) ?? null },
      budget: { platform: c.platform, level, dailyBudget: num(c.dailyBudget), shared: Boolean(raw?.budgetShared), metaBudgetLevel: (raw?.budgetLevel as string | undefined) ?? null, lifetime: raw?.budgetLevel === "CAMPAIGN_LIFETIME" },
    };
  }
  if (level === "AD_GROUP") {
    const g = await db.adGroup.findFirst({ where: { id, campaign: { clientId } }, include: { campaign: true } });
    if (!g) throw new AdsWriteError("Grupo/conjunto não encontrado neste cliente.");
    const raw = g.raw as Raw;
    return {
      level,
      id: g.id,
      name: g.name,
      platform: g.campaign.platform,
      dataSourceId: g.campaign.dataSourceId,
      campaignName: g.campaign.name,
      status: g.status,
      dailyBudget: num(g.dailyBudget),
      target: { level, externalId: g.externalId },
      budget: { platform: g.campaign.platform, level, dailyBudget: num(g.dailyBudget), lifetime: Boolean(raw?.lifetimeBudget) },
    };
  }
  const a = await db.ad.findFirst({ where: { id, adGroup: { campaign: { clientId } } }, include: { adGroup: { include: { campaign: true } } } });
  if (!a) throw new AdsWriteError("Anúncio não encontrado neste cliente.");
  return {
    level,
    id: a.id,
    name: a.name ?? a.externalId,
    platform: a.adGroup.campaign.platform,
    dataSourceId: a.adGroup.campaign.dataSourceId,
    campaignName: a.adGroup.campaign.name,
    status: a.status,
    dailyBudget: null,
    target: { level, externalId: a.externalId, adGroupExternalId: a.adGroup.externalId },
    budget: { platform: a.adGroup.campaign.platform, level, dailyBudget: null },
  };
}

export const localState = (e: LoadedEntity): RemoteState => ({ status: e.status, dailyBudget: e.dailyBudget });

/** Reflete na base local uma alteração aplicada (evita esperar pela próxima sincronização). */
export async function updateLocal(db: PrismaClient, level: EntityLevel, id: string, after: RemoteState) {
  const data = { ...(after.status ? { status: after.status } : {}), ...(after.dailyBudget !== undefined && after.dailyBudget !== null ? { dailyBudget: after.dailyBudget } : {}) };
  if (level === "CAMPAIGN") await db.campaign.update({ where: { id }, data });
  else if (level === "AD_GROUP") await db.adGroup.update({ where: { id }, data });
  else if (after.status) await db.ad.update({ where: { id }, data: { status: after.status } });
}
