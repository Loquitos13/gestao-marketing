"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { getConfig } from "@/server/config/settings";
import { getQueue, QUEUE_NAMES } from "@/server/sync/queue";
import { trainClientModels } from "@/server/agent/train";
import { trainOrgPreference } from "@/server/agent/learning";
import { analyzeClient } from "@/server/agent/analyze";
import { skipCounts, suggestionOutcome } from "@/server/agent/outcomes";
import { withWorkerWarning } from "@/server/sync/worker-presence";
import { failure, formObject, id, type ActionState } from "./util";

const base = z.object({ clientId: id });
const done = (clientId: string, message: string): ActionState => {
  revalidatePath(`/c/${clientId}/agent`);
  return { ok: true, message };
};

export async function addMemoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ fact: z.string().trim().min(5, "Escreva o facto (mín. 5 caracteres).").max(300) }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "agent:use");
    if ((await prisma.agentMemory.count({ where: { clientId: client.id } })) >= 30) return { ok: false, error: "Máximo de 30 factos por cliente. Remova algum antes de adicionar." };
    const m = await prisma.agentMemory.create({ data: { clientId: client.id, fact: input.fact, createdById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "agent.memory.add", targetType: "AgentMemory", targetId: m.id });
    return done(client.id, "Facto guardado. O agente passa a tê-lo em conta.");
  } catch (e) {
    return failure(e);
  }
}

export async function deleteMemoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ memoryId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "agent:use");
    const r = await prisma.agentMemory.deleteMany({ where: { id: input.memoryId, clientId: client.id } });
    if (!r.count) return { ok: false, error: "Facto não encontrado." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "agent.memory.delete", targetType: "AgentMemory", targetId: input.memoryId });
    return done(client.id, "Facto removido.");
  } catch (e) {
    return failure(e);
  }
}

export async function trainModelsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "agent:use");
    const models = await trainClientModels(client);
    const pref = await trainOrgPreference(ctx.organizationId);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "agent.train", metadata: { models: models.length } });
    const reliable = models.filter((m) => m.reliable).length;
    const prefMsg = pref.trained ? ` Modelo de preferência treinado com ${pref.examples} decisões.` : ` Modelo de preferência: ${pref.examples} decisões (mínimo 10).`;
    return done(client.id, models.length ? `${models.length} modelos treinados, ${reliable} fiáveis.${prefMsg}` : `Dados insuficientes para treinar modelos (mínimo 3 semanas).${prefMsg}`);
  } catch (e) {
    return failure(e);
  }
}

export async function analyzeNowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "agent:use");
    const running = await prisma.agentRun.findFirst({ where: { clientId: client.id, status: "RUNNING", startedAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
    if (running) return { ok: false, error: "Já há uma análise em curso para este cliente." };
    const { REDIS_URL } = await getConfig();
    if (REDIS_URL) {
      await getQueue(QUEUE_NAMES.agent, REDIS_URL).add("agent-analyze", { clientId: client.id, trigger: "MANUAL" }, { deduplication: { id: `agent-manual-${client.id}` }, removeOnComplete: 100, removeOnFail: 200 });
      return done(client.id, await withWorkerWarning(REDIS_URL, "Análise enfileirada. O resultado aparece em Execuções dentro de alguns minutos."));
    }
    const run = await analyzeClient(client.id, "MANUAL", { userId: ctx.userId });
    if (run.status === "UNAVAILABLE") return { ok: false, error: run.error ?? "Agente indisponível." };
    if (run.status === "FAILED") return { ok: false, error: `A análise falhou: ${run.error ?? "erro desconhecido"}` };
    return done(client.id, `Análise concluída: ${suggestionOutcome(run.proposals, skipCounts(run.toolCalls))} Fica pendente da sua aprovação.`);
  } catch (e) {
    return failure(e);
  }
}

export async function deleteConversationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = base.extend({ conversationId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "agent:use");
    const r = await prisma.agentConversation.deleteMany({ where: { id: input.conversationId, clientId: client.id, userId: ctx.userId } });
    if (!r.count) return { ok: false, error: "Conversa não encontrada." };
    return done(client.id, "Conversa apagada.");
  } catch (e) {
    return failure(e);
  }
}
