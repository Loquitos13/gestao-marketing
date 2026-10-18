import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/server/auth/session";
import { assertCan, resolveClientAccess, TenantError } from "@/server/auth/tenant";
import { draftReportText } from "@/server/agent/report-writer";
import { LlmBusyError, LlmUnavailableError } from "@/server/agent/llm";
import type { ReportData } from "@/server/reports/build";
import { sectionLabel } from "@/server/reports/sections";
import { audit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ reportId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

/** Rascunho dos comentários do relatório. Não guarda nada: o texto só é usado se o utilizador o guardar. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido" }, { status: 400 });
  const member = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!member) return Response.json({ error: "Sem organização" }, { status: 403 });
  const report = await prisma.report.findUnique({ where: { id: parsed.data.reportId } });
  if (!report?.data) return Response.json({ error: "Não encontrado" }, { status: 404 });
  const tctx = { userId: user.id, organizationId: member.organizationId, role: member.role };
  try {
    assertCan(tctx, "report:write");
    assertCan(tctx, "agent:use");
    await resolveClientAccess(prisma, tctx, report.clientId);
  } catch (e) {
    if (e instanceof TenantError) return Response.json({ error: e.status === 404 ? "Não encontrado" : "Sem permissão" }, { status: e.status });
    throw e;
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          // O browser fechou a ligação.
        }
      };
      const sent = new Map<string, string>();
      try {
        const draft = await draftReportText(report.data as unknown as ReportData, undefined, (partial) => {
          for (const [key, text] of Object.entries(partial)) {
            if (!text || sent.get(key) === text) continue;
            sent.set(key, text);
            send({ type: "section", key, label: sectionLabel(key), text });
          }
        });
        await audit({ organizationId: member.organizationId, clientId: report.clientId, userId: user.id, action: "agent.report.draft", targetType: "Report", targetId: report.id });
        send({ type: "done", comments: draft.comments, unverified: draft.unverified });
      } catch (e) {
        const expected = e instanceof LlmUnavailableError || e instanceof LlmBusyError;
        const message = e instanceof LlmBusyError ? e.message : e instanceof LlmUnavailableError ? `Agente indisponível: ${e.message}` : "Não foi possível gerar o texto.";
        if (!expected) logger.error({ reportId: report.id, error: e instanceof Error ? e.message : String(e) }, "Falha ao escrever o relatório com IA");
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // já fechado
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
