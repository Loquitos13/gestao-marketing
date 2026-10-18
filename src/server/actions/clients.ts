"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { requireClient, requirePermission } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { failure, formObject, id, type ActionState } from "./util";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const tz = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Fuso horário inválido");

const clientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || /^https?:\/\/[^\s<>"]+$/i.test(v), "O website deve começar por http:// ou https://"),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || /^https:\/\/[^\s<>"]+$/i.test(v), "O logótipo deve ser um URL https://"),
  industry: optionalText(120),
  contactName: optionalText(120),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => !v || z.string().email().safeParse(v).success, "Email inválido"),
  contactPhone: optionalText(40),
  objectives: optionalText(2000),
  internalNotes: optionalText(5000),
  monthlyBudget: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v.replace(",", ".")) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e10), "Orçamento inválido"),
  grossMargin: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v.replace(",", ".")) / 100 : null))
    .refine((v) => v === null || (v >= 0 && v <= 1), "A margem deve estar entre 0 e 100%"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Moeda ISO 4217 (ex.: EUR)"),
  timezone: tz,
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("pt-PT"),
  contractStatus: z.enum(["PROSPECT", "ACTIVE", "PAUSED", "ENDED"]),
});

async function uniqueSlug(organizationId: string, name: string, exceptId?: string) {
  const base = slugify(name).slice(0, 60) || "cliente";
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const clash = await prisma.client.findFirst({ where: { organizationId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (!clash) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId: string;
  try {
    const ctx = await requirePermission("client:write");
    const data = clientSchema.parse(formObject(fd));
    const client = await prisma.client.create({ data: { ...data, organizationId: ctx.organizationId, slug: await uniqueSlug(ctx.organizationId, data.name) } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "client.create", targetId: client.id });
    newId = client.id;
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/", "layout");
  redirect(`/c/${newId}/sources`);
}

export async function updateClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const clientId = id.parse(fd.get("clientId"));
    const { ctx, client } = await requireClient(clientId, "client:write");
    const data = clientSchema.parse(formObject(fd));
    const slug = data.name !== client.name ? await uniqueSlug(ctx.organizationId, data.name, client.id) : client.slug;
    await prisma.client.update({ where: { id: client.id }, data: { ...data, slug } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "client.update", targetId: client.id, metadata: { fields: Object.keys(data) } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Cliente atualizado." };
  } catch (e) {
    return failure(e);
  }
}

export async function archiveClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const clientId = id.parse(fd.get("clientId"));
    const { ctx, client } = await requireClient(clientId, "client:write");
    await prisma.$transaction([
      prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } }),
      prisma.reportSchedule.updateMany({ where: { clientId: client.id }, data: { enabled: false } }),
    ]);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "client.archive", targetId: client.id });
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/", "layout");
  redirect("/clients");
}

export async function restoreClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const clientId = id.parse(fd.get("clientId"));
    const ctx = await requirePermission("client:write");
    const r = await prisma.client.updateMany({ where: { id: clientId, organizationId: ctx.organizationId, archivedAt: { not: null } }, data: { archivedAt: null } });
    if (!r.count) return { ok: false, error: "Cliente não encontrado." };
    await audit({ organizationId: ctx.organizationId, clientId, userId: ctx.userId, action: "client.restore", targetId: clientId });
    revalidatePath("/", "layout");
    return { ok: true, message: "Cliente reativado." };
  } catch (e) {
    return failure(e);
  }
}

/** Eliminação definitiva (RGPD): remove o cliente e todos os dados em cascata. Exige escrever o nome exato. */
export async function deleteClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, confirmName: z.string() }).parse(formObject(fd));
    const ctx = await requirePermission("client:delete");
    const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: ctx.organizationId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };
    if (input.confirmName.trim() !== client.name) return { ok: false, error: "O nome escrito não corresponde ao nome do cliente." };
    await prisma.client.delete({ where: { id: client.id } });
    // O registo de auditoria mantém-se (clientId fica nulo) mas sem dados pessoais do cliente.
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "client.delete", targetId: client.id, metadata: { gdpr: true } });
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/", "layout");
  redirect("/clients");
}

export async function grantClientAccessAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, userId: id, remove: z.string().optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "member:manage");
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: input.userId } });
    if (!member) return { ok: false, error: "Utilizador não pertence à organização." };
    if (input.remove) await prisma.clientMember.deleteMany({ where: { clientId: client.id, userId: input.userId } });
    else await prisma.clientMember.upsert({ where: { clientId_userId: { clientId: client.id, userId: input.userId } }, create: { clientId: client.id, userId: input.userId }, update: {} });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: input.remove ? "client.access.revoke" : "client.access.grant", targetId: input.userId });
    revalidatePath(`/c/${client.id}/settings`);
    return { ok: true, message: input.remove ? "Acesso removido." : "Acesso concedido." };
  } catch (e) {
    return failure(e);
  }
}
