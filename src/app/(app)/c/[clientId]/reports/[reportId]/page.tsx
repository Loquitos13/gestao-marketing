import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { integrationStatus } from "@/server/config/settings";
import { formatTimestamp } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import type { ReportData } from "@/server/reports/build";
import { sectionLabel } from "@/server/reports/sections";
import { deleteReportAction, retryDeliveryAction, revokeShareAction, saveReportComments, sendReportAction } from "@/server/actions/reports";
import { ActionForm } from "@/components/action-form";
import { ReportView } from "@/components/report-view";
import { cn } from "@/lib/utils";
import { Badge, buttonClass, Card, CardHeader, Field, inputClass, Notice } from "@/components/ui";
import { clientContext } from "../../page-context";
import { ShareForm } from "./share-form";
import { PrintButton } from "./print-button";
import { AiWriter } from "./ai-writer";

export const metadata = { title: "Relatório" };

const DELIVERY = { SENT: { l: "Enviado", v: "good" }, FAILED: { l: "Falhou", v: "bad" }, PENDING: { l: "Pendente", v: "neutral" }, SKIPPED_NOT_CONFIGURED: { l: "Não enviado (SMTP não configurado)", v: "warn" } } as const;

export default async function ReportPage(props: { params: Promise<{ clientId: string; reportId: string }> }) {
  const { clientId, reportId } = await props.params;
  const { client, tenant, ctx } = await clientContext(clientId, "report:read");
  const report = await prisma.report.findFirst({ where: { id: reportId, clientId: client.id }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!report || !report.data) notFound();
  const d = report.data as unknown as ReportData;
  const write = can(tenant.role, "report:write");
  const share = can(tenant.role, "report:share");
  const shareActive = report.shareTokenHash && report.shareExpiresAt && report.shareExpiresAt > new Date();

  return (
    <div className="-mx-6 -mt-5 grid min-h-[calc(100vh-160px)] xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 bg-hover px-6 py-6 print:bg-transparent print:p-0">
        <ReportView d={d} title={report.title} />
      </div>
      <aside className="no-print space-y-4 border-l bg-bg p-4">
        <Card>
          <CardHeader title="Exportar" />
          <div className="p-4">
            <div className="grid grid-cols-3 gap-1.5">
              <a href={`/api/reports/${report.id}/pdf`} className={buttonClass("primary", "sm")}>PDF</a>
              <a href={`/api/reports/${report.id}/xlsx`} className={buttonClass("secondary", "sm")}>Excel</a>
              <a href={`/api/reports/${report.id}/csv`} className={buttonClass("secondary", "sm")}>CSV</a>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">Excel e CSV incluem uma folha por tabela, com todas as métricas Google Ads e Meta Ads.</p>
            <div className="mt-2">
              <PrintButton />
            </div>
          </div>
        </Card>
        {share && (
          <Card>
            <CardHeader title="Partilhar" description="Link de leitura com expiração. Apenas o hash do token é guardado." />
            <div className="space-y-3 p-4">
              {shareActive && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>Link ativo até {formatTimestamp(report.shareExpiresAt, ctx.fmt)}</span>
                  <ActionForm action={revokeShareAction} submitLabel="Revogar" variant="danger" size="sm" inline>
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="reportId" value={report.id} />
                  </ActionForm>
                </div>
              )}
              <ShareForm clientId={client.id} reportId={report.id} />
            </div>
          </Card>
        )}
        {share && (
          <Card>
            <CardHeader title="Enviar por email" />
            <div className="space-y-3 p-4">
              {!(await integrationStatus()).smtp && <Notice variant="neutral">SMTP não configurado — o envio fica registado como não realizado.</Notice>}
              <ActionForm action={sendReportAction} submitLabel="Enviar PDF">
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="reportId" value={report.id} />
                <Field label="Destinatários">
                  <input name="recipients" defaultValue={client.contactEmail ?? ""} className={inputClass} />
                </Field>
              </ActionForm>
              {report.deliveries.length > 0 && (
                <ul className="space-y-1.5 border-t pt-3 text-[11px]">
                  {report.deliveries.map((x) => {
                    const st = DELIVERY[x.status as keyof typeof DELIVERY] ?? DELIVERY.PENDING;
                    return (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-1">
                        <span className="truncate">{x.recipient}</span>
                        <span className="flex items-center gap-1">
                          <Badge variant={st.v}>{st.l}</Badge>
                          {x.status !== "SENT" && (
                            <ActionForm action={retryDeliveryAction} submitLabel="Reenviar" variant="ghost" size="sm" inline>
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="reportId" value={report.id} />
                              <input type="hidden" name="deliveryId" value={x.id} />
                            </ActionForm>
                          )}
                        </span>
                        <span className="w-full text-muted">
                          {formatTimestamp(x.createdAt, ctx.fmt)} · {x.attempts} tentativa(s){x.error ? ` · ${x.error}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        )}
        {write && (
          <Card>
            <CardHeader title="Comentários do gestor" description="Guardar recalcula os dados do relatório. O rascunho da IA só é usado se o guardar." />
            <div className="p-4">
              <ActionForm action={saveReportComments} submitLabel="Guardar e recalcular">
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="reportId" value={report.id} />
                {can(tenant.role, "agent:use") && <AiWriter reportId={report.id} />}
                <Field label="Título">
                  <input name="title" defaultValue={report.title} className={inputClass} />
                </Field>
                {d.sections
                  .filter((k) => !["cover", "methodology", "limitations"].includes(k))
                  .map((k) => (
                    <Field key={k} label={sectionLabel(k)}>
                      <textarea name={`comment_${k}`} defaultValue={d.comments[k] ?? ""} rows={2} maxLength={2000} className={cn(inputClass, "h-auto py-1.5")} />
                    </Field>
                  ))}
              </ActionForm>
            </div>
          </Card>
        )}
        {write && (
          <ActionForm action={deleteReportAction} submitLabel="Eliminar relatório" variant="danger" size="sm" confirm="Eliminar este relatório e o histórico de envios?">
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="reportId" value={report.id} />
          </ActionForm>
        )}
      </aside>
    </div>
  );
}
