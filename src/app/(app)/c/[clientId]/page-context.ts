import { cache } from "react";
import type { Permission } from "@/server/auth/rbac";
import { requireClient } from "@/server/auth/guard";
import { loadClientContext } from "@/server/queries/context";
import { parseFilters, type SearchParams } from "@/server/queries/filters";

export const clientContext = cache(async (clientId: string, permission: Permission = "client:read") => {
  const { ctx: tenant, client } = await requireClient(clientId, permission);
  const ctx = await loadClientContext(client);
  return { tenant, client, ctx };
});

export async function pageContext(params: Promise<{ clientId: string }>, searchParams: Promise<SearchParams>, permission: Permission = "client:read") {
  const { clientId } = await params;
  const sp = await searchParams;
  const base = await clientContext(clientId, permission);
  const filters = parseFilters(sp, base.client.timezone);
  const compareLabel = filters.compareMode === "yoy" ? "Ano ant." : filters.compareMode === "none" ? "Sem comp." : "Ant.";
  return { ...base, filters, sp, compareLabel, fmt: base.ctx.fmt };
}
