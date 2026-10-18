import Link from "next/link";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDelta, formatRelative, formatTimestamp, formatValue, type FormatContext, type Unit } from "@/lib/format";
import { requireOrg } from "@/server/auth/guard";
import { accessibleClientsWhere } from "@/server/auth/tenant";
import { can } from "@/server/auth/rbac";
import { loadPortfolio, totalsByCurrency, type PortfolioRow } from "@/server/queries/portfolio";
import type { Delta } from "@/server/metrics/calc";
import { Badge, Card, CardHeader, DeltaText, EmptyState, LinkButton, Notice, OriginBadge, PageHeader } from "@/components/ui";
import { InfoTip } from "@/components/tooltip";

export const metadata = { title: "Painel global" };

function Metric({ d, unit, fmt, higherIsBetter }: { d: Delta; unit: Unit; fmt: FormatContext; higherIsBetter: boolean }) {
  return (
    <div className="text-right">
      <div className="tabular">{formatValue(d.current, unit, fmt)}</div>
      {d.current !== null && <DeltaText pct={d.pct} higherIsBetter={higherIsBetter} text={formatDelta(d.pct, fmt)} />}
    </div>
  );
}

const PACING = { OVER: ["Acima", "bad"], UNDER: ["Abaixo", "warn"], ON_TRACK: ["No ritmo", "good"], NOT_STARTED: ["Por iniciar", "neutral"], ENDED: ["Terminado", "neutral"] } as const;

export default async function GlobalDashboard() {
  const ctx = await requireOrg();
  const clients = await prisma.client.findMany({ where: accessibleClientsWhere(ctx), orderBy: [{ isDemo: "asc" }, { name: "asc" }] });
  const rows: PortfolioRow[] = clients.length ? await loadPortfolio(clients) : [];
  const orgFmt: FormatContext = { locale: "pt-PT", currency: ctx.organization.defaultCurrency, timezone: ctx.organization.defaultTimezone };
  const totals = totalsByCurrency(rows);
  const [openAlerts, recs] = await Promise.all([
    prisma.alert.findMany({ where: { status: "OPEN", client: accessibleClientsWhere(ctx) }, orderBy: { lastSeenAt: "desc" }, take: 50, include: { client: { select: { id: true, name: true } } } }),
    prisma.recommendation.findMany({ where: { status: "NEW", client: accessibleClientsWhere(ctx) }, orderBy: [{ priority: "asc" }, { detectedAt: "desc" }], take: 8, include: { client: { select: { id: true, name: true } } } }),
  ]);
  const SEV: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  const alerts = openAlerts.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3)).slice(0, 8);
  const anySimulated = rows.some((r) => r.origin === "SIMULATED" || r.origin === "MIXED");

  return (
    <div className="w-full max-w-[1480px] space-y-5 px-6 pb-6 pt-5">
      <PageHeader
        title="Painel global"
        description="Últimos 30 dias completos de cada cliente (até ontem, no respetivo fuso) comparados com os 30 dias anteriores."
        actions={can(ctx.role, "client:write") ? <LinkButton href="/clients/new" variant="primary">Novo cliente</LinkButton> : undefined}
      />
      {anySimulated && <Notice variant="warn">Alguns clientes usam dados <strong>simulados</strong> (modo demonstração). Os totais abaixo incluem esses valores fictícios e estão assinalados.</Notice>}

      {!clients.length ? (
        <Card>
          <EmptyState title="Ainda não há clientes" description="Crie o primeiro cliente e ligue as respetivas contas de publicidade, Search Console e GA4." action={<LinkButton href="/clients/new" variant="primary">Criar cliente</LinkButton>} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {totals.map((t) => {
              const f = { ...orgFmt, currency: t.currency };
              const roas = t.cost > 0 ? t.value / t.cost : null;
              const roasPrev = t.costPrev > 0 ? t.valuePrev / t.costPrev : null;
              return [
                { label: `Investimento (${t.currency})`, cur: t.cost, prev: t.costPrev, unit: "currency" as Unit, hib: false, f },
                { label: `Valor de conversão (${t.currency})`, cur: t.value, prev: t.valuePrev, unit: "currency" as Unit, hib: true, f },
                { label: "Conversões (plataformas)", cur: t.conversions, prev: t.conversionsPrev, unit: "number" as Unit, hib: true, f },
                { label: "ROAS agregado", cur: roas, prev: roasPrev, unit: "multiplier" as Unit, hib: true, f },
              ].map((k) => {
                const pct = k.cur !== null && k.prev ? (k.cur - k.prev) / k.prev : null;
                return (
                  <Card key={`${t.currency}-${k.label}`} className="p-4">
                    <div className="flex items-center gap-1 text-xs text-muted">
                      {k.label}
                      <InfoTip
                        content={`Soma de ${t.clients} cliente(s) com moeda ${t.currency}. Conversões somadas com a atribuição de cada plataforma (pode haver sobreposição entre Google e Meta). Clientes noutras moedas aparecem num grupo separado.`}
                      />
                    </div>
                    <div className="mt-1 tabular text-xl font-semibold">{formatValue(k.cur, k.unit, k.f)}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs">
                      <DeltaText pct={pct} higherIsBetter={k.hib} text={formatDelta(pct, k.f)} />
                      <span className="text-muted">vs {formatValue(k.prev, k.unit, k.f)}</span>
                    </div>
                  </Card>
                );
              });
            })}
          </div>

          <Card>
            <CardHeader title="Clientes" description="Valores na moeda de cada cliente." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="text-muted">
                  <tr className="border-b text-left">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 text-right font-medium">Investimento</th>
                    <th className="px-3 py-2 text-right font-medium">Conversões</th>
                    <th className="px-3 py-2 text-right font-medium">CPA</th>
                    <th className="px-3 py-2 text-right font-medium">ROAS</th>
                    <th className="px-3 py-2 text-right font-medium">Cliques orgânicos</th>
                    <th className="px-3 py-2 text-right font-medium">Sessões</th>
                    <th className="px-3 py-2 font-medium">Orçamento do mês</th>
                    <th className="px-3 py-2 font-medium">Atenção</th>
                    <th className="px-3 py-2 font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const fmt: FormatContext = { locale: r.client.locale, currency: r.client.currency, timezone: r.client.timezone };
                    return (
                      <tr key={r.client.id} className="hover:bg-surface-2/50">
                        <td className="px-4 py-2">
                          <Link href={`/c/${r.client.id}/overview`} className="font-medium hover:underline">
                            {r.client.name}
                          </Link>
                          <div className="mt-0.5">
                            <OriginBadge origin={r.origin} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Metric d={r.cost} unit="currency" fmt={fmt} higherIsBetter={false} />
                        </td>
                        <td className="px-3 py-2">
                          <Metric d={r.conversions} unit="number" fmt={fmt} higherIsBetter />
                        </td>
                        <td className="px-3 py-2">
                          <Metric d={r.cpa} unit="currency" fmt={fmt} higherIsBetter={false} />
                        </td>
                        <td className="px-3 py-2">
                          <Metric d={r.roas} unit="multiplier" fmt={fmt} higherIsBetter />
                        </td>
                        <td className="px-3 py-2">
                          <Metric d={r.organicClicks} unit="number" fmt={fmt} higherIsBetter />
                        </td>
                        <td className="px-3 py-2">
                          <Metric d={r.sessions} unit="number" fmt={fmt} higherIsBetter />
                        </td>
                        <td className="px-3 py-2">
                          {r.budget ? (
                            <div>
                              <Badge variant={PACING[r.budget.status as keyof typeof PACING]?.[1] ?? "neutral"}>{PACING[r.budget.status as keyof typeof PACING]?.[0] ?? r.budget.status}</Badge>
                              <div className="mt-0.5 tabular text-muted">
                                {formatValue(r.budget.spent, "currency", fmt)} / {formatValue(r.budget.amount, "currency", fmt)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted">Sem orçamento</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {r.criticalAlerts > 0 && <Badge variant="bad">{r.criticalAlerts} crítico(s)</Badge>}
                            {r.openAlerts - r.criticalAlerts > 0 && <Badge variant="warn">{r.openAlerts - r.criticalAlerts} alerta(s)</Badge>}
                            {r.newRecommendations > 0 && <Badge variant="accent">{r.newRecommendations} recomend.</Badge>}
                            {r.sourceErrors > 0 && <Badge variant="bad">Erro de sync</Badge>}
                            {!r.openAlerts && !r.newRecommendations && !r.sourceErrors && <span className="text-muted">—</span>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted" title={formatTimestamp(r.lastSync, fmt)}>
                          {r.lastSync ? formatRelative(r.lastSync, fmt) : "Nunca"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Alertas abertos" actions={<LinkButton href="/alerts" size="sm" variant="ghost">Ver todos</LinkButton>} />
              {!alerts.length ? (
                <EmptyState title="Sem alertas abertos" />
              ) : (
                <ul className="divide-y">
                  {alerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 px-4 py-2 text-xs">
                      <AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${a.severity === "CRITICAL" ? "text-bad" : "text-warn"}`} />
                      <div className="min-w-0">
                        <Link href={`/c/${a.client.id}/alerts`} className="font-medium hover:underline">
                          {a.client.name} · {a.title}
                        </Link>
                        <p className="truncate text-muted">{a.message}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Recomendações por rever" description="Propostas apenas; nada é alterado nas plataformas sem a sua aprovação e execução manual." />
              {!recs.length ? (
                <EmptyState title="Sem recomendações novas" />
              ) : (
                <ul className="divide-y">
                  {recs.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 px-4 py-2 text-xs">
                      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      <div className="min-w-0">
                        <Link href={`/c/${r.client.id}/recommendations`} className="font-medium hover:underline">
                          {r.client.name} · {r.title}
                        </Link>
                        {r.entityName && <p className="truncate text-[11px]">{r.entityName}</p>}
                        <p className="truncate text-muted">{r.suggestedAction}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
