import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { retryJobAction } from "@/server/actions/sources";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Histórico" };

const JOB_VARIANT = { QUEUED: "neutral", RUNNING: "accent", SUCCEEDED: "good", PARTIAL: "warn", FAILED: "bad" } as const;
const JOB_LABEL = { QUEUED: "Em fila", RUNNING: "A correr", SUCCEEDED: "Concluído", PARTIAL: "Parcial", FAILED: "Falhou" } as const;

const ACTION_LABELS: Record<string, string> = {
  "source.link": "Fonte associada",
  "source.sync": "Sincronização pedida",
  "source.disconnect": "Fonte desligada",
  "source.delete": "Fonte eliminada",
  "sync.retry": "Job reprocessado",
  "report.create": "Relatório gerado",
  "report.export": "Relatório exportado",
  "report.share": "Link de partilha criado",
  "report.send": "Envio de relatório",
  "recommendation.decide": "Decisão sobre recomendação",
  "client.update": "Cliente atualizado",
  "budget.create": "Orçamento criado",
};

export default async function HistoryPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<{ job?: string }> }) {
  const { clientId } = await props.params;
  const { job: openJob } = await props.searchParams;
  const { client, tenant, ctx } = await clientContext(clientId);
  const fmt = ctx.fmt;
  const retry = can(tenant.role, "sync:run");
  const [jobs, audits] = await Promise.all([
    prisma.syncJob.findMany({
      where: { dataSource: { clientId: client.id } },
      orderBy: { queuedAt: "desc" },
      take: 60,
      include: { dataSource: { select: { platform: true, name: true, origin: true } }, logs: { orderBy: { createdAt: "asc" }, take: 50 } },
    }),
    can(tenant.role, "audit:read")
      ? prisma.auditLog.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 80, include: { user: { select: { name: true, email: true } } } })
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Histórico" description="Jobs de sincronização, erros e registo de auditoria deste cliente. Datas no fuso do cliente." />
      <Card>
        <CardHeader title="Sincronizações" description="Até 5 tentativas automáticas com espera exponencial. Erros de autorização não são repetidos." />
        {!jobs.length ? (
          <EmptyState title="Sem sincronizações" />
        ) : (
          <ul className="divide-y">
            {jobs.map((j) => (
              <li key={j.id} className="px-4 py-2.5 text-xs">
                <details open={openJob === j.id || undefined}>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <Badge variant={JOB_VARIANT[j.status]}>{JOB_LABEL[j.status]}</Badge>
                    <span className="font-medium">{PLATFORM_LABELS[j.dataSource.platform]}</span>
                    <span className="text-muted">{j.dataSource.name}</span>
                    {j.dataSource.origin === "SIMULATED" && <Badge variant="warn">Simulado</Badge>}
                    <span className="text-muted">
                      {j.kind === "HISTORICAL" ? "Histórico" : j.kind === "ENTITIES" ? "Entidades" : "Incremental"}
                      {j.rangeStart && j.rangeEnd && ` · ${j.rangeStart.toISOString().slice(0, 10)} → ${j.rangeEnd.toISOString().slice(0, 10)}`}
                    </span>
                    <span className="ml-auto tabular text-muted">
                      {j.rowsUpserted} linhas · {j.attempts} tent. · {formatTimestamp(j.queuedAt, fmt)}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2 pl-2">
                    {j.error && <p className="rounded-md bg-bad/10 px-3 py-2 text-bad">{j.error}</p>}
                    {j.logs.length ? (
                      <ol className="space-y-0.5 font-mono text-[11px]">
                        {j.logs.map((l) => (
                          <li key={l.id} className={l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : "text-muted"}>
                            {formatTimestamp(l.createdAt, fmt)} [{l.level}] {l.message}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-muted">Sem registos.</p>
                    )}
                    {retry && (j.status === "FAILED" || j.status === "PARTIAL") && (
                      <ActionForm action={retryJobAction} submitLabel="Reprocessar este período" size="sm" variant="secondary" inline>
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="jobId" value={j.id} />
                      </ActionForm>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {audits && (
        <Card>
          <CardHeader title="Auditoria" description="Ações realizadas por utilizadores e processos sobre este cliente." />
          {!audits.length ? (
            <EmptyState title="Sem registos" />
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Quando</th>
                  <th className="px-4 py-2 font-medium">Quem</th>
                  <th className="px-4 py-2 font-medium">Ação</th>
                  <th className="px-4 py-2 font-medium">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {audits.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-2 tabular">{formatTimestamp(a.createdAt, fmt)}</td>
                    <td className="px-4 py-2">{a.user?.name ?? "Sistema"}</td>
                    <td className="px-4 py-2">{ACTION_LABELS[a.action] ?? a.action}</td>
                    <td className="max-w-md truncate px-4 py-2 font-mono text-[11px] text-muted" title={a.metadata ? JSON.stringify(a.metadata) : undefined}>
                      {a.metadata ? JSON.stringify(a.metadata) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
