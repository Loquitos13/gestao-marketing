import type { OrgRole } from "@prisma/client";

export const PERMISSIONS = [
  "client:read",
  "client:write",
  "client:delete",
  "integration:manage",
  "sync:run",
  "report:read",
  "report:write",
  "report:share",
  "budget:write",
  "recommendation:decide",
  "alert:manage",
  /** Alterar campanhas, orçamentos e anúncios nas plataformas (sempre com confirmação). */
  "ads:write",
  /** Conversar com o agente de IA e pedir análises (só cria sugestões e rascunhos). */
  "agent:use",
  "org:manage",
  "member:manage",
  "audit:read",
  "data:export",
  "workspace:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const ROLE_PERMISSIONS: Record<OrgRole, Set<Permission>> = {
  OWNER: ALL,
  ADMIN: new Set(PERMISSIONS.filter((p) => p !== "org:manage")),
  ANALYST: new Set<Permission>([
    "client:read",
    "sync:run",
    "report:read",
    "report:write",
    "report:share",
    "budget:write",
    "recommendation:decide",
    "alert:manage",
    "data:export",
    "workspace:write",
    "agent:use",
  ]),
  VIEWER: new Set<Permission>(["client:read", "report:read"]),
};

export function can(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** VIEWER só vê clientes atribuídos explicitamente (ClientMember). */
export function requiresExplicitClientAccess(role: OrgRole): boolean {
  return role === "VIEWER";
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  ANALYST: "Analista",
  VIEWER: "Leitor (cliente)",
};
