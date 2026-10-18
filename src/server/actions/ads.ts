"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { AdsWriteError, cancelChange, confirmAndApply, createDraft, previewChange, revertChange } from "@/server/ads-write/service";
import { clampStep } from "@/server/ads-write/guards";
import { loadAllocation } from "@/server/ads-write/allocation-data";
import { createAdDraft } from "@/server/ads-write/create";
import { META_CTAS, type AdSpec } from "@/server/ads-write/creative";
import { loadClientContext } from "@/server/queries/context";
import { randomUUID } from "node:crypto";
import { checkbox, failure, formObject, id, type ActionState } from "./util";

const level = z.enum(["CAMPAIGN", "AD_GROUP", "AD"]);
const base = z.object({ clientId: id });

const done = (clientId: string, message: string, data?: Record<string, unknown>): ActionState => {
  revalidatePath(`/c/${clientId}`, "layout");
  return { ok: true, message, data };
};

export async function draftStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ level, entityId: id, desired: z.enum(["ACTIVE", "PAUSED"]), reason: z.string().max(500).optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    await createDraft({ clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, level: input.level, entityId: input.entityId, operation: "SET_STATUS", desiredStatus: input.desired, reason: input.reason || null });
    return done(client.id, "Proposta criada. Reveja e confirme em Gestão de anúncios.");
  } catch (e) {
    return failure(e);
  }
}

export async function draftBudgetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ level, entityId: id, dailyBudget: z.coerce.number().finite().positive().max(1e7), reason: z.string().max(500).optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    await createDraft({ clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, level: input.level, entityId: input.entityId, operation: "SET_DAILY_BUDGET", dailyBudget: input.dailyBudget, reason: input.reason || null });
    return done(client.id, "Proposta de orçamento criada. Reveja e confirme abaixo.");
  } catch (e) {
    return failure(e);
  }
}

/** Recomendações acionáveis → proposta (pausar anúncio, aumentar orçamento dentro do passo máximo). */
export async function draftFromRecommendationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ recommendationId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    const rec = await prisma.recommendation.findFirst({ where: { id: input.recommendationId, clientId: client.id } });
    if (!rec?.entityId || !rec.platform) throw new AdsWriteError("Esta recomendação não tem uma alteração direta associada.");
    const common = { clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, source: "RULE" as const, recommendationId: rec.id, reason: rec.title };
    if (rec.type === "LOW_CTR_AD" || rec.type === "CREATIVE_FATIGUE") {
      const ad = await prisma.ad.findFirst({ where: { externalId: rec.entityId, adGroup: { campaign: { clientId: client.id, platform: rec.platform } } } });
      if (!ad) throw new AdsWriteError("Anúncio não encontrado (sincronize a fonte).");
      await createDraft({ ...common, level: "AD", entityId: ad.id, operation: "SET_STATUS", desiredStatus: "PAUSED" });
    } else if (rec.type === "SCALE_BUDGET") {
      const camp = await prisma.campaign.findFirst({ where: { externalId: rec.entityId, clientId: client.id, platform: rec.platform } });
      if (!camp?.dailyBudget) throw new AdsWriteError("Campanha sem orçamento diário próprio.");
      const current = Number(camp.dailyBudget);
      await createDraft({ ...common, level: "CAMPAIGN", entityId: camp.id, operation: "SET_DAILY_BUDGET", dailyBudget: clampStep(current, current * 1.15, Number(client.maxBudgetStepPct)) });
    } else {
      throw new AdsWriteError("Esta recomendação exige análise: use o separador Distribuição ou edite manualmente.");
    }
    await prisma.recommendation.update({ where: { id: rec.id }, data: { status: "IN_REVIEW" } });
    return done(client.id, "Proposta criada a partir da recomendação.");
  } catch (e) {
    return failure(e);
  }
}

const changeRef = base.extend({ changeId: id });

export async function previewChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = changeRef.parse(formObject(fd));
    const { client } = await requireClient(input.clientId, "ads:write");
    const r = await previewChange(input.changeId, client.id);
    revalidatePath(`/c/${client.id}/manage`);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: `Validação recusada: ${r.message}` };
  } catch (e) {
    return failure(e);
  }
}

export async function confirmChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  let authorized: { clientId: string; changeId: string } | null = null;
  try {
    const input = changeRef.extend({ acknowledged: checkbox }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    authorized = { clientId: client.id, changeId: input.changeId };
    const c = await confirmAndApply({ changeId: input.changeId, clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, acknowledged: input.acknowledged });
    revalidatePath(`/c/${client.id}`, "layout");
    target = `/c/${client.id}/manage?view=historico&done=${c.id}`;
  } catch (e) {
    // Falhas depois da transição para APPLYING ficam no histórico: mostrar lá o resultado.
    const row = authorized ? await prisma.adChange.findFirst({ where: { id: authorized.changeId, clientId: authorized.clientId }, select: { status: true } }) : null;
    if (!authorized || row?.status !== "FAILED") return failure(e);
    revalidatePath(`/c/${authorized.clientId}`, "layout");
    target = `/c/${authorized.clientId}/manage?view=historico&done=${authorized.changeId}`;
  }
  redirect(target);
}

export async function cancelChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = changeRef.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    await cancelChange(input.changeId, client.id, ctx.organizationId, ctx.userId);
    return done(client.id, "Proposta cancelada.");
  } catch (e) {
    return failure(e);
  }
}

export async function revertChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = changeRef.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    await revertChange(input.changeId, client.id, ctx.organizationId, ctx.userId);
    return done(client.id, "Proposta de reversão criada. Confirme-a para aplicar.");
  } catch (e) {
    return failure(e);
  }
}

const adBase = base.extend({ adGroupId: id, replaceAdId: id.optional().or(z.literal("")), kind: z.enum(["GOOGLE_RSA", "META_LINK"]) });
const line = (max: number) => z.string().max(max * 3).transform((s) => s.trim());

export async function draftAdAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const raw = formObject(fd);
    const input = adBase.parse(raw);
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    const spec: AdSpec =
      input.kind === "GOOGLE_RSA"
        ? z
            .object({ h: z.array(line(30)).max(15).default([]), d: z.array(line(90)).max(4).default([]), finalUrl: z.string().trim().max(2000), path1: z.string().trim().max(15).optional(), path2: z.string().trim().max(15).optional() })
            .transform((v) => ({ kind: "GOOGLE_RSA" as const, headlines: v.h.filter(Boolean), descriptions: v.d.filter(Boolean), finalUrl: v.finalUrl, path1: v.path1 || null, path2: v.path2 || null }))
            .parse(raw)
        : z
            .object({ name: z.string().trim().min(1).max(200), pageId: z.string().trim().max(30), link: z.string().trim().max(2000), message: z.string().max(2200), headline: z.string().trim().max(255), description: z.string().trim().max(255).optional(), imageUrl: z.string().trim().max(2000), cta: z.enum(META_CTAS) })
            .transform((v) => ({ kind: "META_LINK" as const, name: v.name, pageId: v.pageId, link: v.link, message: v.message.trim(), headline: v.headline, description: v.description || null, imageUrl: v.imageUrl, callToAction: v.cta }))
            .parse(raw);
    const { warnings } = await createAdDraft({ clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, adGroupId: input.adGroupId, spec, replaceAdId: input.replaceAdId || null });
    return done(client.id, `Proposta de anúncio criada (será criado em pausa). Confirme-a em Propostas.${warnings.length ? ` Atenção: ${warnings.join(" ")}` : ""}`);
  } catch (e) {
    return failure(e);
  }
}

/** Converte a distribuição recalculada no servidor em propostas individuais (uma por linha, mesmo planId). */
export async function draftAllocationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ keys: z.array(z.string().max(80)).max(200).optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    const view = await loadAllocation(client, await loadClientContext(client));
    if (!view.ok) throw new AdsWriteError(view.reason);
    const chosen = new Set(input.keys ?? []);
    const lines = view.result.lines.filter((l) => l.change !== 0 && l.entity.adjustable && (!chosen.size || chosen.has(l.entity.key)));
    if (!lines.length) throw new AdsWriteError("Nenhuma alteração a propor com os dados atuais.");
    const planId = randomUUID();
    const errors: string[] = [];
    for (const l of lines) {
      try {
        await createDraft({ clientId: client.id, organizationId: ctx.organizationId, userId: ctx.userId, level: l.entity.level, entityId: l.entity.entityId, operation: "SET_DAILY_BUDGET", dailyBudget: l.proposed, source: "ALLOCATION", planId, reason: l.reason });
      } catch (e) {
        errors.push(`${l.entity.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const created = lines.length - errors.length;
    if (!created) throw new AdsWriteError(`Nenhuma proposta criada. ${errors.join(" · ")}`);
    return done(client.id, `${created} propostas criadas — confirme cada uma em Propostas.${errors.length ? ` Ignoradas: ${errors.join(" · ")}` : ""}`);
  } catch (e) {
    return failure(e);
  }
}

export async function saveAdsSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ enabled: checkbox, maxStepPct: z.coerce.number().min(1).max(50) }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "ads:write");
    await prisma.client.update({ where: { id: client.id }, data: { adsManagementEnabled: input.enabled, maxBudgetStepPct: input.maxStepPct / 100 } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "ads.settings", metadata: { enabled: input.enabled, maxStepPct: input.maxStepPct } });
    return done(client.id, input.enabled ? "Gestão de anúncios ativada. Cada alteração continua a exigir confirmação." : "Gestão de anúncios desativada.");
  } catch (e) {
    return failure(e);
  }
}
