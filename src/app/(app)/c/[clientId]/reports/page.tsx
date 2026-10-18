import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { integrationStatus } from "@/server/config/settings";
import { formatRange, formatTimestamp } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { REPORT_KINDS } from "@/server/reports/sections";
import { createScheduleAction, toggleScheduleAction } from "@/server/actions/reports";
import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, CardHeader, EmptyState, Field, inputClass, LinkButton, Notice, PageHeader } from "@/components/ui";
import { Tbl, Td } from "@/components/simple-table";
import { clientContext } from "../page-context";

export const metadata = { title: "Relatórios" };
const FREQ = { WEEKLY: "Semanal", MONTHLY: "Mensal", QUARTERLY: "Trimestral" } as Record<string, string>;
const DOW = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

export default async function ReportsPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const { client, tenant, ctx } = await clientContext(clientId, "report:read");
  const [reports, schedules, templates] = await Promise.all([
    prisma.report.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 100, include: { deliveries: { select: { status: true } } } }),
    prisma.reportSchedule.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" }, include: { template: { select: { name: true } } } }),
    prisma.reportTemplate.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: "asc" } }),
  ]);
  const write = can(tenant.role, "report:write");
  const smtp = (await integrationStatus()).smtp;
  const base = `/c/${client.id}/reports`;

  return (
    <div className="space-y-5">
      <PageHeader title="Relatórios" description="Cada relatório guarda um retrato fixo dos dados no momento da geração. Exportação em PDF, CSV e Excel; partilha por link com expiração." actions={write && <LinkButton href={`${base}/new`} variant="primary">Novo relatório</LinkButton>} />
      <Card>
        {reports.length ? (
          <Tbl head={[{ label: "Relatório" }, { label: "Tipo" }, { label: "Período" }, { label: "Gerado" }, { label: "Envios" }, { label: "Exportar", className: "text-right" }]}>
            {reports.map((r) => {
              const sent = r.deliveries.filter((d) => d.status === "SENT").length;
              const range = formatRange(r.periodStart.toISOString().slice(0, 10), r.periodEnd.toISOString().slice(0, 10), ctx.fmt);
              const title = r.title.endsWith(` · ${range}`) ? r.title.slice(0, -range.length - 3) : r.title;
              return (
                <tr key={r.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link href={`${base}/${r.id}`} className="font-medium hover:underline">
                        {title}
                      </Link>
                      {r.containsSimulated && <Badge variant="warn">Simulado</Badge>}
                      {r.scheduleId && <Badge variant="accent">Agendado</Badge>}
                    </div>
                  </Td>
                  <Td className="text-fg-2">{REPORT_KINDS[r.kind as keyof typeof REPORT_KINDS] ?? r.kind}</Td>
                  <Td className="text-fg-2">{range}</Td>
                  <Td className="text-muted">{formatTimestamp(r.generatedAt, ctx.fmt)}</Td>
                  <Td className="text-muted">{r.deliveries.length ? `${sent} de ${r.deliveries.length} enviados` : "—"}</Td>
                  <Td className="text-right">
                    <div className="inline-flex gap-1">
                      {(["pdf", "xlsx", "csv"] as const).map((f) => (
                        <a key={f} className={buttonClass("secondary", "sm")} href={`/api/reports/${r.id}/${f}`}>
                          {f === "xlsx" ? "Excel" : f.toUpperCase()}
                        </a>
                      ))}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Tbl>
        ) : (
          <EmptyState title="Ainda não há relatórios" action={write && <LinkButton href={`${base}/new`} variant="primary">Criar o primeiro relatório</LinkButton>} />
        )}
      </Card>

      <Card>
        <CardHeader title="Relatórios recorrentes" description="O worker gera o relatório do período anterior completo à hora indicada (fuso do cliente) e envia-o por email, se o SMTP estiver configurado." />
        {!smtp && (
          <div className="px-4 pt-3">
            <Notice variant="neutral">SMTP não configurado: os relatórios agendados são gerados mas não enviados. Cada tentativa fica registada como “não enviado (SMTP não configurado)”.</Notice>
          </div>
        )}
        <ul className="divide-y">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
              <div>
                <span className="font-medium">{s.name}</span>
                <span className="text-muted">
                  {" "}
                  · {FREQ[s.frequency]}
                  {s.frequency === "WEEKLY" && ` (${DOW[s.dayOfWeek ?? 1]})`} às {s.hour}h · {s.template?.name ?? "Todas as secções"} · {s.recipients.length} destinatário(s) · próxima {formatTimestamp(s.nextRunAt, ctx.fmt)}
                </span>
              </div>
              {write && (
                <div className="flex gap-1.5">
                  <ActionForm action={toggleScheduleAction} submitLabel={s.enabled ? "Pausar" : "Ativar"} variant="secondary" size="sm" inline>
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="scheduleId" value={s.id} />
                  </ActionForm>
                  <ActionForm action={toggleScheduleAction} submitLabel="Remover" variant="ghost" size="sm" inline confirm="Remover este agendamento?">
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="scheduleId" value={s.id} />
                    <input type="hidden" name="remove" value="1" />
                  </ActionForm>
                </div>
              )}
            </li>
          ))}
          {!schedules.length && <li className="px-4 py-6 text-center text-xs text-muted">Sem agendamentos.</li>}
        </ul>
        {write && (
          <div className="border-t p-4">
            <ActionForm action={createScheduleAction} submitLabel="Criar agendamento" resetOnSuccess>
              <input type="hidden" name="clientId" value={client.id} />
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                <Field label="Nome">
                  <input name="name" required defaultValue="Relatório mensal" className={inputClass} />
                </Field>
                <Field label="Frequência">
                  <select name="frequency" className={inputClass} defaultValue="MONTHLY">
                    <option value="WEEKLY">Semanal</option>
                    <option value="MONTHLY">Mensal (dia 1)</option>
                    <option value="QUARTERLY">Trimestral</option>
                  </select>
                </Field>
                <Field label="Dia (semanal)">
                  <select name="dayOfWeek" className={inputClass} defaultValue="1">
                    {DOW.slice(1).map((d, i) => (
                      <option key={d} value={i + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hora">
                  <input name="hour" type="number" min="0" max="23" defaultValue="8" className={inputClass} />
                </Field>
                <Field label="Modelo">
                  <select name="templateId" className={inputClass} defaultValue={templates.find((t) => t.isDefault)?.id ?? ""}>
                    <option value="">Todas as secções</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Destinatários">
                  <input name="recipients" placeholder="a@cliente.pt, b@cliente.pt" className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>
    </div>
  );
}
