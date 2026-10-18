import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/auth/rbac";
import { assertCan, resolveClientAccess, TenantError } from "@/server/auth/tenant";
import { chatTurn, ChatBusyError, MAX_MESSAGE_CHARS } from "@/server/agent/chat";
import { LlmBusyError, LlmUnavailableError } from "@/server/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullish(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

/** Resposta em NDJSON: conversation, tool, token, done ou error (um objeto por linha). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Não autenticado", { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Pedido inválido", { status: 400 });
  const member = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!member) return new Response("Sem organização", { status: 403 });
  const tctx = { userId: user.id, organizationId: member.organizationId, role: member.role };
  let client;
  try {
    assertCan(tctx, "agent:use");
    client = await resolveClientAccess(prisma, tctx, parsed.data.clientId);
  } catch (e) {
    if (e instanceof TenantError) return new Response(e.status === 404 ? "Não encontrado" : "Sem permissão", { status: e.status });
    throw e;
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          // O browser fechou a ligação; a resposta continua a ser guardada na conversa.
        }
      };
      try {
        const r = await chatTurn({
          client,
          organizationId: member.organizationId,
          userId: user.id,
          canAds: can(member.role, "ads:write"),
          conversationId: parsed.data.conversationId,
          message: parsed.data.message,
          onConversation: (id) => send({ type: "conversation", id }),
          onToken: (t) => send({ type: "token", t }),
          onEvent: (e) => send({ type: "tool", label: e.call.label, ok: e.call.ok }),
        });
        send({ type: "done", messageId: r.messageId, content: r.content, unverified: r.unverified, proposals: r.proposals });
      } catch (e) {
        const expected = e instanceof LlmUnavailableError || e instanceof LlmBusyError || e instanceof ChatBusyError;
        const message = e instanceof LlmBusyError || e instanceof ChatBusyError ? e.message : e instanceof LlmUnavailableError ? `Agente indisponível: ${e.message}` : "Ocorreu um erro ao gerar a resposta.";
        if (!expected) logger.error({ clientId: client.id, error: e instanceof Error ? e.message : String(e) }, "Falha no chat do agente");
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
