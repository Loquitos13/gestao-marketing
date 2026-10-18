import "server-only";
import { redirect, notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "./session";
import { assertCan, resolveClientAccess, TenantError, type TenantContext } from "./tenant";
import type { Permission } from "./rbac";

export const requireUser = cache(async () => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
});

/** Organização ativa do utilizador (primeira membership; o modelo suporta várias). */
export const requireOrg = cache(async (): Promise<TenantContext> => {
  const user = await requireUser();
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { organization: true },
  });
  if (!membership) redirect("/login?error=no-org");
  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    organizationId: membership.organizationId,
    organization: membership.organization,
    role: membership.role,
  };
});

export async function requirePermission(permission: Permission): Promise<TenantContext> {
  const ctx = await requireOrg();
  assertCan(ctx, permission);
  return ctx;
}

/** Garante que o cliente pertence à organização e que o utilizador lhe tem acesso. 404 caso contrário. */
export const requireClient = cache(async (clientId: string, permission: Permission = "client:read") => {
  const ctx = await requireOrg();
  try {
    assertCan(ctx, permission);
    const client = await resolveClientAccess(prisma, ctx, clientId);
    return { ctx, client };
  } catch (e) {
    if (e instanceof TenantError && e.status === 404) notFound();
    throw e;
  }
});
