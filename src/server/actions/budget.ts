"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { failure, formObject, id, isoDate, money, type ActionState } from "./util";

const budget = z
  .object({
    clientId: id,
    platform: z.enum(["GOOGLE_ADS", "META_ADS", ""]).optional(),
    campaignId: id.optional().or(z.literal("")),
    periodStart: isoDate,
    periodEnd: isoDate,
    amount: money.refine((v) => v > 0, "deve ser superior a zero"),
    notes: z.string().max(500).optional(),
  })
  .refine((b) => b.periodEnd >= b.periodStart, { message: "a data final deve ser posterior à inicial", path: ["periodEnd"] });

export async function createBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = budget.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "budget:write");
    let campaignId: string | null = null;
    if (input.campaignId) {
      const c = await prisma.campaign.findFirst({ where: { id: input.campaignId, clientId: client.id } });
      if (!c) return { ok: false, error: "Campanha não encontrada." };
      campaignId = c.id;
    }
    const b = await prisma.budget.create({
      data: {
        clientId: client.id,
        platform: input.platform || null,
        campaignId,
        periodStart: new Date(`${input.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00Z`),
        amount: input.amount,
        currency: client.currency,
        notes: input.notes || null,
      },
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "budget.create", targetType: "Budget", targetId: b.id, metadata: { amount: input.amount } });
    revalidatePath(`/c/${client.id}/budget`);
    return { ok: true, message: "Orçamento criado." };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, budgetId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "budget:write");
    const r = await prisma.budget.deleteMany({ where: { id: input.budgetId, clientId: client.id } });
    if (!r.count) return { ok: false, error: "Orçamento não encontrado." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "budget.delete", targetId: input.budgetId });
    revalidatePath(`/c/${client.id}/budget`);
    return { ok: true, message: "Orçamento removido." };
  } catch (e) {
    return failure(e);
  }
}

const goal = z
  .object({
    clientId: id,
    metric: z.enum(["LEADS", "CONVERSIONS", "REVENUE", "CPA_MAX", "CPL_MAX", "ROAS_MIN", "CTR_MIN", "SESSIONS", "ORGANIC_CLICKS", "AVG_POSITION_MAX"]),
    target: z.coerce.number().finite().positive().max(1e9),
    periodStart: isoDate,
    periodEnd: isoDate,
    notes: z.string().max(500).optional(),
  })
  .refine((b) => b.periodEnd >= b.periodStart, { message: "a data final deve ser posterior à inicial", path: ["periodEnd"] });

export async function createGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = goal.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "budget:write");
    const g = await prisma.goal.create({
      data: { clientId: client.id, metric: input.metric, target: input.target, periodStart: new Date(`${input.periodStart}T00:00:00Z`), periodEnd: new Date(`${input.periodEnd}T00:00:00Z`), notes: input.notes || null },
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "goal.create", targetType: "Goal", targetId: g.id });
    revalidatePath(`/c/${client.id}/settings`);
    revalidatePath(`/c/${client.id}/budget`);
    return { ok: true, message: "Objetivo criado." };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, goalId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "budget:write");
    const r = await prisma.goal.deleteMany({ where: { id: input.goalId, clientId: client.id } });
    if (!r.count) return { ok: false, error: "Objetivo não encontrado." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "goal.delete", targetId: input.goalId });
    revalidatePath(`/c/${client.id}/settings`);
    return { ok: true, message: "Objetivo removido." };
  } catch (e) {
    return failure(e);
  }
}
