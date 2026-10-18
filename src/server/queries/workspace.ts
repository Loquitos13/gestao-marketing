import { cache } from "react";
import { prisma } from "@/lib/prisma";

export const workspaceCounts = cache(async (clientId: string) => {
  const [openTasks, reports, openRecs, openAlerts, pendingChanges] = await Promise.all([
    prisma.clientTask.count({ where: { clientId, status: "OPEN" } }),
    prisma.report.count({ where: { clientId } }),
    prisma.recommendation.count({ where: { clientId, status: { in: ["NEW", "IN_REVIEW"] } } }),
    prisma.alert.count({ where: { clientId, status: "OPEN" } }),
    prisma.adChange.count({ where: { clientId, status: "DRAFT" } }),
  ]);
  return { openTasks, reports, openRecs, openAlerts, pendingChanges };
});

export async function loadTasks(clientId: string, opts: { status?: "OPEN" | "DONE"; take?: number } = {}) {
  return prisma.clientTask.findMany({
    where: { clientId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { priority: "asc" }, { createdAt: "desc" }],
    take: opts.take,
    include: { assignee: { select: { id: true, name: true } } },
  });
}

export async function loadNotes(clientId: string, take?: number) {
  return prisma.clientNote.findMany({
    where: { clientId },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take,
    include: { author: { select: { name: true } } },
  });
}

export async function loadFiles(clientId: string) {
  return prisma.clientFile.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, description: true, mimeType: true, size: true, url: true, createdAt: true, uploadedBy: { select: { name: true } } },
  });
}

export type ActivityKind = "sync" | "sync_error" | "alert" | "report" | "recommendation" | "task" | "note" | "file" | "budget" | "source" | "client" | "other";

export interface ActivityItem {
  id: string;
  at: Date;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  actor: string | null;
}

const ACTION_LABELS: Record<string, { kind: ActivityKind; title: string }> = {
  "client.create": { kind: "client", title: "Cliente criado" },
  "client.update": { kind: "client", title: "Dados do cliente atualizados" },
  "client.archive": { kind: "client", title: "Cliente arquivado" },
  "client.restore": { kind: "client", title: "Cliente restaurado" },
  "source.link": { kind: "source", title: "Fonte de dados ligada" },
  "source.sync": { kind: "sync", title: "Sincronização pedida" },
  "sync.retry": { kind: "sync", title: "Sincronização repetida" },
  "report.create": { kind: "report", title: "Relatório gerado" },
  "report.update": { kind: "report", title: "Relatório editado" },
  "report.share": { kind: "report", title: "Link de partilha criado" },
  "report.share_revoke": { kind: "report", title: "Link de partilha revogado" },
  "report.send": { kind: "report", title: "Envio de relatório processado" },
  "report.export": { kind: "report", title: "Relatório exportado" },
  "report.delete": { kind: "report", title: "Relatório eliminado" },
  "report_schedule.create": { kind: "report", title: "Agendamento de relatório criado" },
  "recommendation.decide": { kind: "recommendation", title: "Decisão sobre recomendação" },
  "intelligence.refresh": { kind: "recommendation", title: "Análise de recomendações executada" },
  "alert.status": { kind: "alert", title: "Estado de alerta alterado" },
  "alert_rule.delete": { kind: "alert", title: "Regra de alerta removida" },
  "budget.create": { kind: "budget", title: "Orçamento criado" },
  "budget.delete": { kind: "budget", title: "Orçamento removido" },
  "goal.create": { kind: "budget", title: "Objetivo criado" },
  "goal.delete": { kind: "budget", title: "Objetivo removido" },
  "task.create": { kind: "task", title: "Tarefa criada" },
  "task.complete": { kind: "task", title: "Tarefa concluída" },
  "task.reopen": { kind: "task", title: "Tarefa reaberta" },
  "task.delete": { kind: "task", title: "Tarefa eliminada" },
  "note.create": { kind: "note", title: "Nota adicionada" },
  "note.pin": { kind: "note", title: "Nota fixada" },
  "note.unpin": { kind: "note", title: "Nota desafixada" },
  "note.delete": { kind: "note", title: "Nota eliminada" },
  "file.upload": { kind: "file", title: "Ficheiro carregado" },
  "file.link": { kind: "file", title: "Ligação adicionada" },
  "file.delete": { kind: "file", title: "Ficheiro removido" },
  "gdpr.export": { kind: "client", title: "Exportação RGPD dos dados do cliente" },
};

const STATUS_LABELS: Record<string, string> = { APPROVED: "aprovada", DISMISSED: "recusada", DONE: "concluída", IN_REVIEW: "em análise", NEW: "nova", ACKNOWLEDGED: "reconhecido", RESOLVED: "resolvido", OPEN: "aberto" };

function auditDetail(action: string, meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  if (action === "recommendation.decide" && typeof meta.to === "string") return `${typeof meta.title === "string" ? `«${meta.title}» ` : ""}${STATUS_LABELS[meta.to] ?? meta.to}`;
  if (action === "alert.status" && typeof meta.to === "string") return `Marcado como ${STATUS_LABELS[meta.to] ?? meta.to}`;
  if (action === "report.export" && typeof meta.format === "string") return meta.format.toUpperCase();
  if (typeof meta.title === "string") return meta.title;
  if (typeof meta.name === "string") return meta.name;
  if (typeof meta.platform === "string") return meta.platform.replace("_", " ");
  return null;
}

/** Atividade do workspace: auditoria (só com `audit:read`) + sincronizações + alertas, por ordem cronológica inversa. */
export async function loadActivity(clientId: string, take = 30, includeAudit = false): Promise<ActivityItem[]> {
  const [logs, jobs, alerts] = await Promise.all([
    includeAudit ? prisma.auditLog.findMany({ where: { clientId, action: { not: { startsWith: "auth." } } }, orderBy: { createdAt: "desc" }, take, include: { user: { select: { name: true } } } }) : [],
    prisma.syncJob.findMany({
      where: { dataSource: { clientId }, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      take,
      select: { id: true, status: true, kind: true, rowsUpserted: true, finishedAt: true, error: true, dataSource: { select: { name: true } } },
    }),
    prisma.alert.findMany({ where: { clientId }, orderBy: { firstSeenAt: "desc" }, take: Math.ceil(take / 2), select: { id: true, title: true, severity: true, firstSeenAt: true, message: true } }),
  ]);
  const items: ActivityItem[] = [
    ...logs.map((l) => {
      const m = ACTION_LABELS[l.action] ?? { kind: "other" as const, title: l.action };
      return { id: `a-${l.id}`, at: l.createdAt, kind: m.kind, title: m.title, detail: auditDetail(l.action, l.metadata as Record<string, unknown> | null), actor: l.user?.name ?? null };
    }),
    ...jobs.map((j) => {
      const failed = j.status === "FAILED";
      return {
        id: `s-${j.id}`,
        at: j.finishedAt!,
        kind: (failed ? "sync_error" : "sync") as ActivityKind,
        title: `${j.dataSource.name} ${failed ? "falhou a sincronização" : j.status === "PARTIAL" ? "sincronizado parcialmente" : "sincronizado"}`,
        detail: failed ? (j.error?.slice(0, 120) ?? null) : `${j.rowsUpserted.toLocaleString("pt-PT")} linhas · ${j.kind === "HISTORICAL" ? "histórico" : j.kind === "ENTITIES" ? "entidades" : "incremental"}`,
        actor: null,
      };
    }),
    ...alerts.map((a) => ({ id: `al-${a.id}`, at: a.firstSeenAt, kind: "alert" as const, title: `Alerta: ${a.title}`, detail: a.message.slice(0, 140), actor: null })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}
