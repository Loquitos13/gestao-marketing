import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/server/auth/session";
import { assertCan, resolveClientAccess, TenantError } from "@/server/auth/tenant";
import { exportReport, type ExportFormat } from "@/server/reports/export";
import { audit } from "@/server/audit";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const { id, format } = await params;
  if (!["pdf", "csv", "xlsx"].includes(format) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Pedido inválido", { status: 400 });
  const user = await getSessionUser();
  if (!user) return new Response("Não autenticado", { status: 401 });
  const member = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!member) return new Response("Sem organização", { status: 403 });
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report?.data) return new Response("Não encontrado", { status: 404 });
  try {
    const ctx = { userId: user.id, organizationId: member.organizationId, role: member.role };
    assertCan(ctx, "report:read");
    await resolveClientAccess(prisma, ctx, report.clientId);
  } catch (e) {
    if (e instanceof TenantError) return new Response(e.status === 404 ? "Não encontrado" : "Sem permissão", { status: e.status });
    throw e;
  }
  try {
    const res = await exportReport(report, format as ExportFormat, new URL(req.url).searchParams.get("table"));
    await audit({ organizationId: member.organizationId, clientId: report.clientId, userId: user.id, action: "report.export", targetId: report.id, metadata: { format } });
    return res;
  } catch (e) {
    logger.error({ reportId: id, format, error: e instanceof Error ? e.message : String(e) }, "Falha na exportação");
    return new Response("Falha ao gerar o ficheiro", { status: 500 });
  }
}
