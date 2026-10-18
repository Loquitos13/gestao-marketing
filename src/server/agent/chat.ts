import type { Client, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit";
import { loadClientContext } from "@/server/queries/context";
import { defaultLlm, type Llm, type LlmMessage } from "./llm";
import { ALL_TOOLS, runAgent, systemPrompt, type AgentEvent } from "./runner";
import { proposeAdChange } from "./tools/draft";
import { proposeKeywords } from "./tools/competitors";
import type { AgentCtx } from "./tools/common";

export const MAX_MESSAGE_CHARS = 2000;
const HISTORY_MESSAGES = 6;
/** Mensagens que ficam sempre textuais no fim; as anteriores vão para o resumo. */
const SUMMARY_TAIL = 4;
const inFlight = new Set<string>();

export class ChatBusyError extends Error {}

type Stored = { role: string; content: string };

/** Resume-se quando há mais de 8 mensagens por resumir, para o início da conversa não cair fora do contexto. */
export const needsSummary = (total: number, summaryCount: number) => total - summaryCount > 8;

/** Histórico para o modelo: o resumo (se existir) seguido das mensagens ainda não resumidas; sem resumo, só as últimas. */
export function buildHistory(summary: string | null | undefined, tail: Stored[]): LlmMessage[] {
  const msgs: LlmMessage[] = (summary ? tail : tail.slice(-HISTORY_MESSAGES)).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  if (summary) msgs.unshift({ role: "system", content: `Resumo da conversa até aqui: ${summary}` });
  return msgs;
}

/** Uma chamada curta ao modelo que funde o resumo anterior com as mensagens antigas; corre depois da resposta ser enviada. */
async function summarize(llm: Llm, conversationId: string, previous: string | null, summaryCount: number) {
  const rows = await prisma.agentMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, skip: summaryCount, select: { role: true, content: true } });
  const old = rows.slice(0, -SUMMARY_TAIL);
  if (!old.length) return;
  // shortcut: conversas antigas sem resumo podem ter dezenas de mensagens; resumem-se só as últimas 20, clipadas, para caber no contexto.
  const text = old.slice(-20).map((m) => `${m.role === "assistant" ? "Agente" : "Utilizador"}: ${m.content.slice(0, 400)}`).join("\n");
  const prompt = `${previous ? `Resumo anterior:\n${previous}\n\n` : ""}Mensagens:\n${text}\n\nEscreve em português, em até 5 linhas, um resumo da conversa até aqui (pedidos do utilizador, factos e números relevantes, decisões), fundindo o resumo anterior se existir. Só o resumo.`;
  const r = await llm.chat([{ role: "user", content: prompt }], { temperature: 0, maxTokens: 250 });
  // packContext clipa cada mensagem do histórico a 700 caracteres: o resumo tem de caber inteiro.
  const summary = r.content.trim().slice(0, 600);
  if (summary) await prisma.agentConversation.update({ where: { id: conversationId }, data: { summary, summaryCount: summaryCount + old.length } });
}

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
    const previous = await prisma.agentMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "asc" }, skip: conv.summaryCount, select: { role: true, content: true } });
    const history = buildHistory(conv.summary, previous);
    history.push({ role: "user", content: text });
    await prisma.agentMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });

    const ctx: AgentCtx = { client: i.client, cctx: await loadClientContext(i.client), organizationId: i.organizationId, userId: i.userId, runId: null, model: llm.model, created: [] };
    const tools = i.canAds ? ALL_TOOLS : ALL_TOOLS.filter((t) => t !== proposeAdChange && t !== proposeKeywords);
    const startedAt = Date.now();
    const answer = await runAgent({ ctx, llm, system: await systemPrompt(ctx, "chat"), history, tools, onToken: i.onToken, onEvent: i.onEvent, signal: i.signal });
    const content = answer.content || "Não consegui produzir uma resposta. Tente reformular a pergunta.";
    // `usage` chega com a instrumentação do runner; até lá fica só a duração medida aqui.
    const usage = (answer as { usage?: { promptTokens?: number | null; evalTokens?: number | null; durationMs?: number | null } }).usage;
    const msg = await prisma.agentMessage.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content,
        sources: answer.calls.map((c) => ({ name: c.name, label: c.label, ok: c.ok })) as Prisma.InputJsonValue,
        unverified: answer.unverified as Prisma.InputJsonValue,
        proposals: ctx.created as unknown as Prisma.InputJsonValue,
        promptTokens: usage?.promptTokens ?? null,
        evalTokens: usage?.evalTokens ?? null,
        durationMs: usage?.durationMs ?? Date.now() - startedAt,
      },
    });
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    if (needsSummary(conv.summaryCount + previous.length + 2, conv.summaryCount)) {
      const id = conv.id;
      void summarize(llm, id, conv.summary, conv.summaryCount).catch((e) => logger.warn({ conversationId: id, error: (e as Error).message }, "Falha ao resumir a conversa"));
    }
    if (ctx.created.length) await audit({ organizationId: i.organizationId, clientId: i.client.id, userId: i.userId, action: "agent.chat.proposals", targetType: "AgentConversation", targetId: conv.id, metadata: { proposals: ctx.created.length } });
    return { conversationId: conv.id, messageId: msg.id, content, unverified: answer.unverified, proposals: ctx.created, sources: answer.calls };
  } finally {
    inFlight.delete(lockKey);
  }
}
