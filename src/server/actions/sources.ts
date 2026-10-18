"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { integrationStatus } from "@/server/config/settings";
import { limitRequest } from "@/server/security/limit";
import { requireClient, requirePermission } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { linkAccountToClient, linkSemrush, rediscover } from "@/server/integrations/connect";
import { revokeCredential } from "@/server/integrations/tokens";
import { enqueueSync } from "@/server/sync/queue";
import { failure, formObject, id, isoDate, type ActionState } from "./util";

async function sourceFor(clientId: string, dataSourceId: string) {
  const { ctx, client } = await requireClient(clientId, "sync:run");
  const ds = await prisma.dataSource.findFirst({ where: { id: dataSourceId, clientId: client.id } });
  return { ctx, client, ds };
}

function syncMessage(r: Awaited<ReturnType<typeof enqueueSync>>) {
  if (r.mode === "queued") return "Sincronização colocada em fila. O estado é atualizado no histórico.";
  return r.simulated ? `Dados simulados regenerados (${r.rows} linhas).` : `Sincronização concluída (${r.rows} linhas).`;
}

export async function linkAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, accountId: id, historyDays: z.coerce.number().int().min(7).max(1100).default(365) }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "integration:manage");
    const account = await prisma.connectedAccount.findFirst({ where: { id: input.accountId, credential: { organizationId: ctx.organizationId } }, include: { credential: true } });
    if (!account) return { ok: false, error: "Conta não encontrada." };
    if (account.credential.status !== "ACTIVE") return { ok: false, error: "A credencial desta conta não está ativa. Volte a autorizar a ligação." };
    const ds = await linkAccountToClient(client.id, account, { currency: client.currency, timezone: client.timezone });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "source.link", targetType: "DataSource", targetId: ds.id, metadata: { platform: ds.platform, externalId: ds.externalId } });
    const r = await enqueueSync({ dataSourceId: ds.id, kind: "HISTORICAL", historyDays: input.historyDays, requestedBy: ctx.userId });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: `Conta ligada. ${syncMessage(r)}` };
  } catch (e) {
    revalidatePath("/", "layout");
    return failure(e);
  }
}

const syncSchema = z.object({
  clientId: id,
  dataSourceId: id,
  kind: z.enum(["INCREMENTAL", "HISTORICAL"]).default("INCREMENTAL"),
  start: isoDate.optional().or(z.literal("")),
  end: isoDate.optional().or(z.literal("")),
  historyDays: z.coerce.number().int().min(7).max(1100).optional(),
});

export async function syncNowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = syncSchema.parse(formObject(fd));
    const { ctx, client, ds } = await sourceFor(input.clientId, input.dataSourceId);
    if (!ds) return { ok: false, error: "Fonte não encontrada." };
    if (!(await limitRequest(`sync:${ds.id}`, 6, 10 * 60_000)).ok) return { ok: false, error: "Demasiadas sincronizações seguidas para esta fonte. Aguarde alguns minutos." };
    const r = await enqueueSync({ dataSourceId: ds.id, kind: input.kind, start: input.start || undefined, end: input.end || undefined, historyDays: input.historyDays, requestedBy: ctx.userId });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "source.sync", targetId: ds.id, metadata: { kind: input.kind } });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: syncMessage(r) };
  } catch (e) {
    revalidatePath("/", "layout");
    return failure(e);
  }
}

export async function retryJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, jobId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "sync:run");
    const job = await prisma.syncJob.findFirst({ where: { id: input.jobId, dataSource: { clientId: client.id } } });
    if (!job) return { ok: false, error: "Job não encontrado." };
    const r = await enqueueSync({
      dataSourceId: job.dataSourceId,
      kind: job.kind,
      start: job.rangeStart?.toISOString().slice(0, 10),
      end: job.rangeEnd?.toISOString().slice(0, 10),
      requestedBy: ctx.userId,
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "sync.retry", targetId: job.id });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: syncMessage(r) };
  } catch (e) {
    revalidatePath("/", "layout");
    return failure(e);
  }
}

export async function disconnectSourceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, dataSourceId: id, purge: z.string().optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "integration:manage");
    const ds = await prisma.dataSource.findFirst({ where: { id: input.dataSourceId, clientId: client.id } });
    if (!ds) return { ok: false, error: "Fonte não encontrada." };
    if (input.purge) await prisma.dataSource.delete({ where: { id: ds.id } });
    else await prisma.dataSource.update({ where: { id: ds.id }, data: { status: "DISCONNECTED", connectedAccountId: null } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: input.purge ? "source.delete" : "source.disconnect", targetId: ds.id, metadata: { platform: ds.platform } });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: input.purge ? "Fonte e respetivos dados eliminados." : "Fonte desligada (dados históricos mantidos)." };
  } catch (e) {
    return failure(e);
  }
}

export async function linkSemrushAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, domain: z.string().trim().min(3).max(253) }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "integration:manage");
    if (!(await integrationStatus()).semrush) return { ok: false, error: "Semrush não configurado: adicione a API key em Integrações → Configuração." };
    const ds = await linkSemrush(client.id, input.domain, client.currency, client.timezone);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "source.link", targetId: ds.id, metadata: { platform: "SEMRUSH" } });
    const r = await enqueueSync({ dataSourceId: ds.id, kind: "INCREMENTAL", requestedBy: ctx.userId });
    revalidatePath(`/c/${client.id}`, "layout");
    return { ok: true, message: `Semrush ligado. ${syncMessage(r)}` };
  } catch (e) {
    revalidatePath("/", "layout");
    return failure(e);
  }
}

export async function revokeCredentialAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const credentialId = id.parse(fd.get("credentialId"));
    const ctx = await requirePermission("integration:manage");
    const cred = await prisma.oAuthCredential.findFirst({ where: { id: credentialId, organizationId: ctx.organizationId } });
    if (!cred) return { ok: false, error: "Credencial não encontrada." };
    await revokeCredential(cred, prisma);
    await prisma.dataSource.updateMany({ where: { connectedAccount: { credentialId: cred.id } }, data: { status: "DISCONNECTED" } });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "credential.revoke", targetId: cred.id, metadata: { provider: cred.provider } });
    revalidatePath("/integrations");
    return { ok: true, message: "Acesso revogado junto do fornecedor e tokens eliminados." };
  } catch (e) {
    return failure(e);
  }
}

export async function rediscoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const credentialId = id.parse(fd.get("credentialId"));
    const ctx = await requirePermission("integration:manage");
    const cred = await prisma.oAuthCredential.findFirst({ where: { id: credentialId, organizationId: ctx.organizationId } });
    if (!cred) return { ok: false, error: "Credencial não encontrada." };
    const rep = await rediscover(cred.id);
    revalidatePath("/integrations");
    const found = Object.entries(rep.found).map(([p, n]) => `${p}: ${n}`).join(", ") || "nenhuma conta";
    return rep.errors.length ? { ok: false, error: `Encontradas ${found}. Erros: ${rep.errors.map((e) => `${e.platform} — ${e.message}`).join("; ")}` } : { ok: true, message: `Encontradas ${found}.` };
  } catch (e) {
    return failure(e);
  }
}
