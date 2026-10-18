import { addDays, dayCount, endOfMonth, startOfMonth, todayInTz } from "@/lib/dates";
import { formatDay, formatValue } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { loadBudgets, loadCampaignDailyBudgetUsage } from "@/server/queries/budget";
import { createBudget, deleteBudget } from "@/server/actions/budget";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { ActionForm } from "@/components/action-form";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { Badge, Card, CardHeader, EmptyState, Field, inputClass, Notice, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Orçamento" };

const STATUS = {
  OVER: { label: "Acima do orçamento", v: "bad" },
  UNDER: { label: "Abaixo do ritmo", v: "warn" },
  ON_TRACK: { label: "No ritmo", v: "good" },
  NOT_STARTED: { label: "Por iniciar", v: "neutral" },
  ENDED: { label: "Terminado", v: "neutral" },
} as const;

export default async function BudgetPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const { client, tenant, ctx } = await clientContext(clientId);
  const fmt = ctx.fmt;
  const today = todayInTz(client.timezone);
  const [{ asOf, budgets }, usage] = await Promise.all([loadBudgets(ctx), loadCampaignDailyBudgetUsage(ctx, addDays(today, -14), addDays(today, -1))]);
  const active = budgets.filter((b) => b.periodStart <= today && b.periodEnd >= addDays(today, -1)).sort((a, b) => Number(b.scope === "Total") - Number(a.scope === "Total"));
  const past = budgets.filter((b) => !active.includes(b));
  const write = can(tenant.role, "budget:write");

  return (
    <div className="space-y-5">
      <PageHeader title="Orçamento e ritmo de investimento" description={`Projeção com base no ritmo dos últimos 7 dias com dados. Dados considerados até ${formatDay(asOf, fmt, "long")}. Nenhum orçamento é alterado nas plataformas.`} />
      {client.monthlyBudget !== null && (
        <Notice variant="neutral">Orçamento mensal de referência definido no cliente: {formatValue(Number(client.monthlyBudget), "currency", fmt)}.</Notice>
      )}
      {!active.length && (
        <Card>
          <EmptyState title="Sem orçamentos ativos" description="Defina um orçamento total, por plataforma ou por campanha para acompanhar o ritmo de investimento." />
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {active.map((b, i) => {
          const p = b.pacing;
          const st = STATUS[p.status];
          let cum = 0;
          const series = b.daily.map((d) => {
            cum += d.cost;
            return { date: d.date, spent: Math.round(cum * 100) / 100, ideal: Math.round((p.amount / p.totalDays) * dayCount(b.periodStart, d.date) * 100) / 100 };
          });
          return (
            <Card key={b.id} className={i === 0 && active.length % 2 === 1 ? "lg:col-span-2" : undefined}>
              <CardHeader title={b.scope} description={`${formatDay(b.periodStart, fmt, "long")} – ${formatDay(b.periodEnd, fmt, "long")}`} actions={<Badge variant={st.v}>{st.label}</Badge>} />
              <div className="grid grid-cols-2 gap-3 p-4 text-xs md:grid-cols-4">
                <div>
                  <div className="text-muted">Orçamento</div>
                  <div className="tabular text-base font-semibold">{formatValue(p.amount, "currency", fmt)}</div>
                </div>
                <div>
                  <div className="text-muted">Investido</div>
                  <div className="tabular text-base font-semibold">{formatValue(p.spent, "currency", fmt)}</div>
                  <div className="text-[11px] text-muted">
                    {formatValue(p.pctConsumed, "percent", fmt)} · {formatValue(p.pctTimeElapsed, "percent", fmt)} do tempo
                  </div>
                </div>
                <div>
                  <div className="text-muted">Projeção</div>
                  <div className="tabular text-base font-semibold">{formatValue(p.projection, "currency", fmt)}</div>
                  <div className={`text-[11px] ${p.projectedVariance > 0 ? "text-bad" : "text-muted"}`}>
                    {p.projectedVariance >= 0 ? "+" : ""}
                    {formatValue(p.projectedVariance, "currency", fmt)} ({formatValue(p.projectedVariancePct, "percent", fmt)})
                  </div>
                </div>
                <div>
                  <div className="text-muted">Média diária necessária</div>
                  <div className="tabular text-base font-semibold">{formatValue(p.requiredDaily, "currency", fmt)}</div>
                  <div className="text-[11px] text-muted">ritmo atual {formatValue(p.recentDaily, "currency", fmt)}/dia</div>
                </div>
              </div>
              <div className="px-3 pb-3">
                <TimeSeriesChart height={180} data={series} fmt={fmt} series={[{ key: "spent", label: "Investido acumulado", unit: "currency", kind: "area" }, { key: "ideal", label: "Ritmo linear", unit: "currency", color: "var(--muted)" }]} />
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Utilização do orçamento diário por campanha" description="Últimos 14 dias. Utilização alta com bom retorno e parcela perdida por orçamento indica potencial de escala." />
        <DataTable
          fmt={fmt}
          searchable={false}
          rows={usage.map((u) => ({ name: u.name, platform: PLATFORM_LABELS[u.platform], daily: u.dailyBudget, spent: u.spent, utilization: u.utilization, lostIsBudget: u.lostIsBudget, roas: u.roas, cpa: u.cpa }))}
          columns={[
            { key: "name", label: "Campanha" },
            { key: "platform", label: "Plataforma", kind: "platform" },
            { key: "daily", label: "Orç. diário", kind: "metric", unit: "currency" },
            { key: "spent", label: "Investido (14d)", kind: "metric", unit: "currency" },
            { key: "utilization", label: "Utilização", kind: "metric", unit: "percent" },
            { key: "lostIsBudget", label: "Impr. perdidas (orç.)", kind: "metric", unit: "percent" },
            { key: "roas", label: "ROAS", kind: "metric", unit: "multiplier" },
            { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
          ]}
          initialSort={{ key: "utilization" }}
        />
      </Card>
      {past.length > 0 && (
        <Card>
          <CardHeader title="Histórico de orçamentos" />
          <DataTable
            fmt={fmt}
            searchable={false}
            rows={past.map((b) => ({ scope: b.scope, period: `${b.periodStart} – ${b.periodEnd}`, amount: b.pacing.amount, spent: b.pacing.spent, pct: b.pacing.pctConsumed, status: STATUS[b.pacing.status].label }))}
            columns={[
              { key: "scope", label: "Âmbito" },
              { key: "period", label: "Período" },
              { key: "amount", label: "Orçamento", kind: "metric", unit: "currency" },
              { key: "spent", label: "Investido", kind: "metric", unit: "currency" },
              { key: "pct", label: "Consumido", kind: "metric", unit: "percent" },
              { key: "status", label: "Estado", kind: "badge" },
            ]}
          />
        </Card>
      )}
      {write && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Novo orçamento" />
            <div className="p-4">
              <ActionForm action={createBudget} submitLabel="Criar orçamento" resetOnSuccess>
                <input type="hidden" name="clientId" value={client.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Âmbito">
                    <select name="platform" className={inputClass} defaultValue="">
                      <option value="">Total (todas as plataformas)</option>
                      <option value="GOOGLE_ADS">Google Ads</option>
                      <option value="META_ADS">Meta Ads</option>
                    </select>
                  </Field>
                  <Field label={`Montante (${client.currency})`}>
                    <input name="amount" type="number" step="0.01" min="0" required className={inputClass} />
                  </Field>
                  <Field label="Início">
                    <input name="periodStart" type="date" required defaultValue={startOfMonth(today)} className={inputClass} />
                  </Field>
                  <Field label="Fim">
                    <input name="periodEnd" type="date" required defaultValue={endOfMonth(today)} className={inputClass} />
                  </Field>
                </div>
                <Field label="Notas">
                  <input name="notes" maxLength={500} className={inputClass} />
                </Field>
              </ActionForm>
            </div>
          </Card>
          <Card>
            <CardHeader title="Remover orçamento" />
            <ul className="divide-y">
              {budgets.slice(0, 12).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span>
                    {b.scope} · {b.periodStart} – {b.periodEnd} · {formatValue(b.pacing.amount, "currency", fmt)}
                  </span>
                  <ActionForm action={deleteBudget} submitLabel="Remover" variant="ghost" size="sm" inline confirm="Remover este orçamento?">
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="budgetId" value={b.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
