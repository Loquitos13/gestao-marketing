"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { refreshRecommendations } from "@/server/intelligence/engine";
import { evaluateAlerts } from "@/server/alerts/engine";
import { ALERT_TYPES } from "@/server/alerts/evaluate";
import { checkbox, emails, failure, formObject, id, type ActionState } from "./util";

const decision = z.object({
  clientId: id,
  recommendationId: id,
  status: z.enum(["IN_REVIEW", "APPROVED", "DONE", "DISMISSED", "NEW"]),
  note: z.string().max(1000).optional(),
});

/**
 * Regista a decisão humana sobre uma recomendação. Nunca executa alterações nas plataformas:
 * "Aprovada" significa apenas aprovada para execução manual pelo gestor.
 */
export async function decideRecommendation(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = decision.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "recommendation:decide");
    const rec = await prisma.recommendation.findFirst({ where: { id: input.recommendationId, clientId: client.id } });
    if (!rec) return { ok: false, error: "Recomendação não encontrada." };
    await prisma.recommendation.update({
      where: { id: rec.id },
      data: { status: input.status, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: input.note || rec.decisionNote },
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "recommendation.decide", targetType: "Recommendation", targetId: rec.id, metadata: { from: rec.status, to: input.status, title: rec.title } });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: "Decisão registada." };
  } catch (e) {
    return failure(e);
  }
}

export async function refreshIntelligence(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const clientId = id.parse(fd.get("clientId"));
    const { ctx, client } = await requireClient(clientId, "recommendation:decide");
    const r = await refreshRecommendations(client);
    const a = await evaluateAlerts(client);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "intelligence.refresh" });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: `${r.evaluated} recomendações avaliadas (${r.created} novas) · ${a.opened} alertas abertos.` };
  } catch (e) {
    return failure(e);
  }
}

const alertStatus = z.object({ clientId: id, alertId: id, status: z.enum(["ACKNOWLEDGED", "RESOLVED", "OPEN"]) });

export async function setAlertStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = alertStatus.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "alert:manage");
    const alert = await prisma.alert.findFirst({ where: { id: input.alertId, clientId: client.id } });
    if (!alert) return { ok: false, error: "Alerta não encontrado." };
    await prisma.alert.update({ where: { id: alert.id }, data: { status: input.status, resolvedAt: input.status === "RESOLVED" ? new Date() : null } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "alert.status", targetType: "Alert", targetId: alert.id, metadata: { to: input.status } });
    revalidatePath(`/c/${client.id}/alerts`);
    revalidatePath("/alerts");
    revalidatePath("/");
    return { ok: true, message: "Estado atualizado." };
  } catch (e) {
    return failure(e);
  }
}

const rule = z.object({
  clientId: id,
  ruleId: id.optional().or(z.literal("")),
  type: z.enum(Object.keys(ALERT_TYPES) as [keyof typeof ALERT_TYPES, ...(keyof typeof ALERT_TYPES)[]]),
  name: z.string().trim().min(2).max(120),
  platform: z.enum(["GOOGLE_ADS", "META_ADS", "SEARCH_CONSOLE", "GA4", ""]).optional(),
  threshold: z.coerce.number().finite().min(0).max(10000),
  windowDays: z.coerce.number().int().min(1).max(90),
  cooldownHours: z.coerce.number().int().min(1).max(24 * 30),
  recipients: emails.optional(),
  enabled: checkbox,
});

export async function saveAlertRule(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = rule.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "alert:manage");
    const data = {
      type: input.type,
      name: input.name,
      platform: input.platform ? input.platform : null,
      threshold: input.threshold,
      windowDays: input.windowDays,
      cooldownHours: input.cooldownHours,
      recipients: input.recipients ?? [],
      enabled: input.enabled,
    };
    if (input.ruleId) {
      const existing = await prisma.alertRule.findFirst({ where: { id: input.ruleId, clientId: client.id } });
      if (!existing) return { ok: false, error: "Regra não encontrada." };
      await prisma.alertRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.alertRule.create({ data: { ...data, clientId: client.id } });
    }
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: input.ruleId ? "alert_rule.update" : "alert_rule.create", metadata: { type: input.type } });
    revalidatePath(`/c/${client.id}/alerts`);
    return { ok: true, message: "Regra guardada." };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteAlertRule(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, ruleId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "alert:manage");
    const r = await prisma.alertRule.deleteMany({ where: { id: input.ruleId, clientId: client.id } });
    if (!r.count) return { ok: false, error: "Regra não encontrada." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "alert_rule.delete", targetId: input.ruleId });
    revalidatePath(`/c/${client.id}/alerts`);
    return { ok: true, message: "Regra removida." };
  } catch (e) {
    return failure(e);
  }
}
