import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/auth/session";
import { assertCan, resolveClientAccess, TenantError } from "@/server/auth/tenant";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Pedido inválido", { status: 400 });
  const user = await getSessionUser();
  if (!user) return new Response("Não autenticado", { status: 401 });
  const member = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!member) return new Response("Sem organização", { status: 403 });
  const file = await prisma.clientFile.findUnique({ where: { id }, select: { clientId: true, name: true, mimeType: true, data: true, url: true } });
  if (!file) return new Response("Não encontrado", { status: 404 });
  try {
    const ctx = { userId: user.id, organizationId: member.organizationId, role: member.role };
    assertCan(ctx, "client:read");
    await resolveClientAccess(prisma, ctx, file.clientId);
  } catch (e) {
    if (e instanceof TenantError) return new Response(e.status === 404 ? "Não encontrado" : "Sem permissão", { status: e.status });
    throw e;
  }
  if (!file.data) return file.url ? Response.redirect(file.url, 302) : new Response("Não encontrado", { status: 404 });
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
