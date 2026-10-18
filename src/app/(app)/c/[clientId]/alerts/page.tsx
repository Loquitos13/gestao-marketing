import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { integrationStatus } from "@/server/config/settings";
import { ALERT_TYPES } from "@/server/alerts/evaluate";
import { deleteAlertRule, saveAlertRule, setAlertStatus } from "@/server/actions/intelligence";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, inputClass, Notice, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Alertas" };

function RuleFields({ clientId, rule }: { clientId: string; rule?: { id: string; type: string; name: string; platform: string | null; threshold: number; windowDays: number; cooldownHours: number; recipients: string[]; enabled: boolean } }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <input type="hidden" name="clientId" value={clientId} />
      {rule && <input type="hidden" name="ruleId" value={rule.id} />}
      <Field label="Tipo">
        <select name="type" defaultValue={rule?.type ?? "CPA_INCREASE"} className={inputClass}>
          {Object.entries(ALERT_TYPES).map(([k, t]) => (
            <option key={k} value={k}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nome">
        <input name="name" required defaultValue={rule?.name} className={inputClass} />
      </Field>
      <Field label="Plataforma">
        <select name="platform" defaultValue={rule?.platform ?? ""} className={inputClass}>
          <option value="">Todas</option>
          <option value="GOOGLE_ADS">Google Ads</option>
          <option value="META_ADS">Meta Ads</option>
          <option value="SEARCH_CONSOLE">Search Console</option>
          <option value="GA4">GA4</option>
        </select>
      </Field>
      <Field label="Limiar" hint="% para variações; posições ou dias conforme o tipo">
        <input name="threshold" type="number" step="0.1" min="0" required defaultValue={rule?.threshold ?? 30} className={inputClass} />
      </Field>
      <Field label="Janela (dias)">
        <input name="windowDays" type="number" min="1" max="90" defaultValue={rule?.windowDays ?? 7} className={inputClass} />
      </Field>
      <Field label="Período de silêncio (horas)" hint="Intervalo mínimo entre notificações do mesmo alerta">
        <input name="cooldownHours" type="number" min="1" defaultValue={rule?.cooldownHours ?? 24} className={inputClass} />
      </Field>
      <Field label="Destinatários (email)" hint="Separados por vírgula">
        <input name="recipients" defaultValue={rule?.recipients.join(", ")} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 pt-5 text-xs">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} /> Ativa
      </label>
    </div>
  );
}

export default async function AlertsPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const { client, tenant, ctx } = await clientContext(clientId);
  const [alerts, rules] = await Promise.all([
    prisma.alert.findMany({ where: { clientId: client.id }, orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }], take: 200 }),
    prisma.alertRule.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const manage = can(tenant.role, "alert:manage");
  const smtp = (await integrationStatus()).smtp;

  return (
    <div className="space-y-5">
      <PageHeader title="Alertas" description="Avaliados de hora a hora pelo worker (ou ao reavaliar). Alertas iguais são agrupados (contador de ocorrências) e resolvidos automaticamente quando a condição deixa de se verificar." />
      {!smtp && <Notice variant="neutral">Serviço de email (SMTP) não configurado: os alertas são registados na aplicação mas não são enviados por email.</Notice>}
      <Card>
        <CardHeader title="Alertas" />
        {alerts.length ? (
          <ul className="divide-y">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant={a.severity === "CRITICAL" ? "bad" : a.severity === "WARNING" ? "warn" : "neutral"}>{a.severity === "CRITICAL" ? "Crítico" : a.severity === "WARNING" ? "Aviso" : "Info"}</Badge>
                    <Badge variant={a.status === "OPEN" ? "accent" : "neutral"}>{a.status === "OPEN" ? "Aberto" : a.status === "ACKNOWLEDGED" ? "Visto" : "Resolvido"}</Badge>
                    <span className="text-[11px] text-muted">{ALERT_TYPES[a.type as keyof typeof ALERT_TYPES]?.label ?? a.type}</span>
                  </div>
                  <p className="mt-1 font-medium">{a.title}</p>
                  <p className="text-xs text-muted">{a.message}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {a.occurrences} ocorrência(s) · primeira {formatTimestamp(a.firstSeenAt, ctx.fmt)} · última {formatTimestamp(a.lastSeenAt, ctx.fmt)}
                    {a.lastNotifiedAt ? ` · notificado ${formatTimestamp(a.lastNotifiedAt, ctx.fmt)}` : " · não notificado por email"}
                  </p>
                </div>
                {manage && a.status !== "RESOLVED" && (
                  <div className="flex gap-1.5">
                    {a.status === "OPEN" && (
                      <ActionForm action={setAlertStatus} submitLabel="Marcar como visto" variant="secondary" size="sm" inline>
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="status" value="ACKNOWLEDGED" />
                      </ActionForm>
                    )}
                    <ActionForm action={setAlertStatus} submitLabel="Resolver" variant="secondary" size="sm" inline>
                      <input type="hidden" name="clientId" value={client.id} />
                      <input type="hidden" name="alertId" value={a.id} />
                      <input type="hidden" name="status" value="RESOLVED" />
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Sem alertas" description="Nenhuma regra foi acionada." />
        )}
      </Card>
      <Card>
        <CardHeader title="Regras" description="Limiares, janelas de comparação, destinatários e frequência de notificação." />
        <div className="divide-y">
          {rules.map((r) => (
            <details key={r.id} className="px-4 py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-xs">
                <Badge variant={r.enabled ? "good" : "neutral"}>{r.enabled ? "Ativa" : "Inativa"}</Badge>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted">
                  {ALERT_TYPES[r.type as keyof typeof ALERT_TYPES]?.label} · limiar {r.threshold} {ALERT_TYPES[r.type as keyof typeof ALERT_TYPES]?.unit} · {r.windowDays} dias · {r.recipients.length} destinatário(s)
                </span>
              </summary>
              {manage && (
                <div className="mt-3 space-y-2">
                  <ActionForm action={saveAlertRule} submitLabel="Guardar">
                    <RuleFields clientId={client.id} rule={r} />
                  </ActionForm>
                  <ActionForm action={deleteAlertRule} submitLabel="Remover regra" variant="danger" size="sm" confirm="Remover esta regra?">
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="ruleId" value={r.id} />
                  </ActionForm>
                </div>
              )}
            </details>
          ))}
        </div>
        {manage && (
          <div className="border-t p-4">
            <p className="mb-3 text-xs font-medium">Nova regra</p>
            <ActionForm action={saveAlertRule} submitLabel="Criar regra" resetOnSuccess>
              <RuleFields clientId={client.id} />
            </ActionForm>
          </div>
        )}
      </Card>
    </div>
  );
}
