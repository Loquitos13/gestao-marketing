import type { Client, Organization, OrgRole, PrismaClient } from "@prisma/client";
import { can, requiresExplicitClientAccess, type Permission } from "./rbac";

export interface TenantContext {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organization: Organization;
  role: OrgRole;
}

export class TenantError extends Error {
  constructor(
    message: string,
    public status: 403 | 404,
  ) {
    super(message);
  }
}

export function assertCan(ctx: Pick<TenantContext, "role">, permission: Permission) {
  if (!can(ctx.role, permission)) throw new TenantError(`Sem permissão: ${permission}`, 403);
}

/**
 * Isolamento multi-tenant: o cliente é procurado SEMPRE filtrado pela organização do utilizador.
 * Um id de outra organização devolve 404 (não revela a existência).
 */
export async function resolveClientAccess(
  db: Pick<PrismaClient, "client" | "clientMember">,
  ctx: Pick<TenantContext, "organizationId" | "role" | "userId">,
  clientId: string,
): Promise<Client> {
  const client = await db.client.findFirst({ where: { id: clientId, organizationId: ctx.organizationId, archivedAt: null } });
  if (!client) throw new TenantError("Cliente não encontrado", 404);
  if (requiresExplicitClientAccess(ctx.role)) {
    const access = await db.clientMember.findUnique({ where: { clientId_userId: { clientId, userId: ctx.userId } } });
    if (!access) throw new TenantError("Cliente não encontrado", 404);
  }
  return client;
}

/** Filtro Prisma para listar apenas clientes acessíveis. */
export function accessibleClientsWhere(ctx: Pick<TenantContext, "organizationId" | "role" | "userId">) {
  return {
    organizationId: ctx.organizationId,
    archivedAt: null,
    ...(requiresExplicitClientAccess(ctx.role) ? { members: { some: { userId: ctx.userId } } } : {}),
  };
}
