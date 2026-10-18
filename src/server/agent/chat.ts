import type { Client, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { loadClientContext } from "@/server/queries/context";
import { defaultLlm, type Llm, type LlmMessage } from "./llm";
import { ALL_TOOLS, runAgent, systemPrompt, type AgentEvent } from "./runner";
import { proposeAdChange } from "./tools/draft";
import { proposeKeywords } from "./tools/competitors";
import type { AgentCtx } from "./tools/common";

export const MAX_MESSAGE_CHARS = 2000;
const HISTORY_MESSAGES = 6;
const inFlight = new Set<string>();

export class ChatBusyError extends Error {}

export interface ChatTurnInput {
  client: Client;
  organizationId: string;
  userId: string;
  canAds: boolean;
  conversationId?: string | null;
  message: string;
  llm?: Llm;
  onConversation?: (id: string) => void;
  onToken?: (t: string) => void;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

/** Uma pergunta e a resposta do agente, guardadas na conversa (sempre do próprio utilizador e cliente). */
export async function chatTurn(i: ChatTurnInput) {
  const lockKey = `${i.userId}:${i.client.id}`;
  if (inFlight.has(lockKey)) throw new ChatBusyError("Já há uma resposta em curso para este cliente. Aguarde que termine.");
  inFlight.add(lockKey);
  try {
    const llm = i.llm ?? (await defaultLlm());
    const text = i.message.trim().slice(0, MAX_MESSAGE_CHARS);
    let conv = i.conversationId ? await prisma.agentConversation.findFirst({ where: { id: i.conversationId, clientId: i.client.id, userId: i.userId } }) : null;
    conv ??= await prisma.agentConversation.create({ data: { clientId: i.client.id, userId: i.userId, title: text.slice(0, 80) } });
    i.onConversation?.(conv.id);
    const previous = await prisma.agentMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGES });
    const history: LlmMessage[] = previous.reverse().map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    history.push({ role: "user", content: text });
    await prisma.agentMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });

    const ctx: AgentCtx = { client: i.client, cctx: await loadClientContext(i.client), organizationId: i.organizationId, userId: i.userId, runId: null, model: llm.model, created: [] };
    const tools = i.canAds ? ALL_TOOLS : ALL_TOOLS.filter((t) => t !== proposeAdChange && t !== proposeKeywords);
    const answer = await runAgent({ ctx, llm, system: await systemPrompt(ctx, "chat"), history, tools, onToken: i.onToken, onEvent: i.onEvent, signal: i.signal });
    const content = answer.content || "Não consegui produzir uma resposta. Tente reformular a pergunta.";
    const msg = await prisma.agentMessage.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content,
        sources: answer.calls.map((c) => ({ name: c.name, label: c.label, ok: c.ok })) as Prisma.InputJsonValue,
        unverified: answer.unverified as Prisma.InputJsonValue,
        proposals: ctx.created as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    if (ctx.created.length) await audit({ organizationId: i.organizationId, clientId: i.client.id, userId: i.userId, action: "agent.chat.proposals", targetType: "AgentConversation", targetId: conv.id, metadata: { proposals: ctx.created.length } });
    return { conversationId: conv.id, messageId: msg.id, content, unverified: answer.unverified, proposals: ctx.created, sources: answer.calls };
  } finally {
    inFlight.delete(lockKey);
  }
}
