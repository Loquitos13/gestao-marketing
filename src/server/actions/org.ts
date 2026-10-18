"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrg, requirePermission } from "@/server/auth/guard";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";
import { destroyOtherSessions } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { failure, formObject, id, type ActionState } from "./util";

const orgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor em formato #RRGGBB"),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || /^https:\/\/[^\s<>"]+$/i.test(v), "O logótipo deve ser um URL https://"),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  defaultTimezone: z.string().min(1).max(64),
  dataRetentionDays: z.coerce.number().int().min(90, "Mínimo 90 dias").max(3650, "Máximo 10 anos"),
});

export async function updateOrgAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("org:manage");
    const data = orgSchema.parse(formObject(fd));
    await prisma.organization.update({ where: { id: ctx.organizationId }, data });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "org.update", metadata: { fields: Object.keys(data) } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Organização atualizada." };
  } catch (e) {
    return failure(e);
  }
}

const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "ANALYST", "VIEWER"]),
  password: z.string().min(1).max(200),
});

/** Cria (ou associa) um utilizador. A password inicial deve ser comunicada por canal seguro e alterada no primeiro acesso. */
export async function addMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("member:manage");
    const input = memberSchema.parse(formObject(fd));
    let user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      const policy = passwordPolicyError(input.password);
      if (policy) return { ok: false, error: policy };
      user = await prisma.user.create({ data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) } });
    }
    const exists = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: user.id } } });
    if (exists) return { ok: false, error: "Este utilizador já é membro." };
    await prisma.organizationMember.create({ data: { organizationId: ctx.organizationId, userId: user.id, role: input.role } });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "member.add", targetId: user.id, metadata: { role: input.role } });
    revalidatePath("/settings");
    return { ok: true, message: input.role === "VIEWER" ? "Membro adicionado. Atribua-lhe clientes nas definições de cada cliente." : "Membro adicionado." };
  } catch (e) {
    return failure(e);
  }
}

async function ownersLeft(organizationId: string, excludingUserId: string) {
  return prisma.organizationMember.count({ where: { organizationId, role: "OWNER", NOT: { userId: excludingUserId } } });
}

export async function changeRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("member:manage");
    const input = z.object({ userId: id, role: z.enum(["OWNER", "ADMIN", "ANALYST", "VIEWER"]) }).parse(formObject(fd));
    if (input.role === "OWNER" && ctx.role !== "OWNER") return { ok: false, error: "Só um proprietário pode promover a proprietário." };
    const m = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: input.userId } } });
    if (!m) return { ok: false, error: "Membro não encontrado." };
    if (m.role === "OWNER" && ctx.role !== "OWNER") return { ok: false, error: "Só um proprietário pode alterar outro proprietário." };
    if (m.role === "OWNER" && input.role !== "OWNER" && !(await ownersLeft(ctx.organizationId, m.userId))) return { ok: false, error: "A organização tem de manter pelo menos um proprietário." };
    await prisma.organizationMember.update({ where: { id: m.id }, data: { role: input.role } });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "member.role", targetId: m.userId, metadata: { from: m.role, to: input.role } });
    revalidatePath("/settings");
    return { ok: true, message: "Papel atualizado." };
  } catch (e) {
    return failure(e);
  }
}

export async function removeMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("member:manage");
    const userId = id.parse(fd.get("userId"));
    if (userId === ctx.userId) return { ok: false, error: "Não pode remover-se a si próprio." };
    const m = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId } } });
    if (!m) return { ok: false, error: "Membro não encontrado." };
    if (m.role === "OWNER" && ctx.role !== "OWNER") return { ok: false, error: "Só um proprietário pode remover outro proprietário." };
    await prisma.$transaction([
      prisma.clientMember.deleteMany({ where: { userId, client: { organizationId: ctx.organizationId } } }),
      prisma.organizationMember.delete({ where: { id: m.id } }),
      prisma.session.deleteMany({ where: { userId } }),
    ]);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "member.remove", targetId: userId });
    revalidatePath("/settings");
    return { ok: true, message: "Membro removido e sessões terminadas." };
  } catch (e) {
    return failure(e);
  }
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOrg();
    const input = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200), confirm: z.string() }).parse(formObject(fd));
    if (input.next !== input.confirm) return { ok: false, error: "A confirmação não coincide." };
    const policy = passwordPolicyError(input.next);
    if (policy) return { ok: false, error: policy };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!(await verifyPassword(input.current, user.passwordHash))) return { ok: false, error: "Password atual incorreta." };
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.next) } });
    const ended = await destroyOtherSessions(user.id);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "user.password" });
    return { ok: true, message: ended ? `Password alterada. ${ended} outra(s) sessão(ões) terminada(s).` : "Password alterada." };
  } catch (e) {
    return failure(e);
  }
}

/** Termina todas as outras sessões do utilizador. */
export async function revokeSessionsAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOrg();
    const count = await destroyOtherSessions(ctx.userId);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "user.sessions.revoke", metadata: { count } });
    revalidatePath("/settings");
    return { ok: true, message: `${count} sessão(ões) terminada(s).` };
  } catch (e) {
    return failure(e);
  }
}
