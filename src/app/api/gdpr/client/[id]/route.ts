import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { getSessionUser } from "@/server/auth/session";
import { assertCan, resolveClientAccess, TenantError } from "@/server/auth/tenant";
import { audit } from "@/server/audit";
import { exportClientData, jsonDownload } from "@/server/gdpr";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("Não autenticado", { status: 401 });
  const m = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!m) return new Response("Sem organização", { status: 403 });
  const ctx = { userId: user.id, organizationId: m.organizationId, role: m.role };
  try {
    assertCan(ctx, "data:export");
    const client = await resolveClientAccess(prisma, ctx, id);
    const data = await exportClientData(client.id);
    await audit({ organizationId: m.organizationId, clientId: client.id, userId: user.id, action: "gdpr.export", targetId: client.id });
    return jsonDownload(data, `${slugify(client.name)}-export-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (e) {
    if (e instanceof TenantError) return new Response(e.status === 404 ? "Não encontrado" : "Sem permissão", { status: e.status });
    throw e;
  }
}
