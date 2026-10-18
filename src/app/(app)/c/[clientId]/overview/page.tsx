import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { todayInTz } from "@/lib/dates";
import { formatDelta, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can } from "@/server/auth/rbac";
import { delta } from "@/server/metrics/calc";
import { loadDashboard, type Kpi } from "@/server/queries/dashboard";
import { loadEntities } from "@/server/queries/entities";
import { loadBudgets } from "@/server/queries/budget";
import { loadActivity, loadNotes, loadTasks } from "@/server/queries/workspace";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { KpiStrip } from "@/components/kpi-card";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { ShareBar, Tbl, Td } from "@/components/simple-table";
import { ActivityList, NoteList, TaskList } from "@/components/workspace-lists";
import { Badge, Card, CardHeader, Dot, EmptyState, LinkButton, Notice, SectionTitle } from "@/components/ui";
import { pageContext } from "../page-context";
import { PacingPanel, RecommendationsPanel } from "./side-panels";

export const metadata = { title: "Visão geral" };

const HEADLINE = ["cost", "conversionValue", "roas", "conversions", "cpa"];
const DOT = { GOOGLE_ADS: "google", META_ADS: "meta" } as const;

export default async function OverviewPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { client, ctx, tenant, filters, fmt, compareLabel } = await pageContext(props.params, props.searchParams);
  const base = `/c/${client.id}`;
  if (!ctx.sources.length) {
    return (
      <Card>
        <EmptyState
          title="Ainda não há fontes de dados ligadas a este cliente"
          description="Ligue Google Ads, Meta Ads, Search Console ou GA4 para começar a ver métricas. Nenhum valor é apresentado sem fonte."
          action={<LinkButton href={`${base}/sources`} variant="primary">Ligar fontes de dados</LinkButton>}
        />
      </Card>
    );
  }
  const today = todayInTz(client.timezone);
  const [dash, entities, recs, recTotal, tasks, notes, activity, budgets] = await Promise.all([
    loadDashboard(ctx, filters),
    loadEntities(client.id),
    prisma.recommendation.findMany({ where: { clientId: client.id, status: { in: ["NEW", "IN_REVIEW"] } }, orderBy: [{ priority: "asc" }, { detectedAt: "desc" }], take: 2 }),
    prisma.recommendation.count({ where: { clientId: client.id, status: { in: ["NEW", "IN_REVIEW"] } } }),
    loadTasks(client.id, { take: 12 }),
    loadNotes(client.id, 2),
    loadActivity(client.id, 5, can(tenant.role, "audit:read")),
    loadBudgets(ctx),
  ]);
  const byKey = (k: string) => dash.paidKpis.find((x) => x.key === k) ?? dash.seoKpis.find((x) => x.key === k);
  const headline = [...HEADLINE.map(byKey), byKey("organicClicks") ?? byKey("ctr")].filter((k): k is Kpi => Boolean(k)).map((k) => (k.key === "cost" ? { ...k, label: "Investimento" } : k));
  const morePaid = dash.paidKpis.filter((k) => !headline.some((h) => h.key === k.key));
  const openTasks = tasks.filter((t) => t.status === "OPEN");
  const shownTasks = [...openTasks.slice(0, 4), ...tasks.filter((t) => t.status === "DONE").slice(0, 1)];
  const monthBudget = budgets.budgets.find((b) => !b.platform && !b.campaignId && b.periodStart <= today && b.periodEnd >= today) ?? null;
  const canWrite = can(tenant.role, "workspace:write");
  const ch = dash.channels;
  const tot = dash.paidKpis.length ? { cost: byKey("cost")!.delta, conv: byKey("conversions")!.delta, value: byKey("conversionValue")!.delta, roas: byKey("roas")!.delta, cpa: byKey("cpa")!.delta } : null;
  const hasBoth = ch.length > 1;

  const signal = (c: (typeof dash.campaignMovers)[number]) => {
    if (c.lostIsBudget !== null && c.lostIsBudget >= 0.15) return { text: "Limitada pelo orçamento", v: "good" as const };
    if (c.lostIsRank !== null && c.lostIsRank >= 0.3) return { text: `Perdida por classificação ${formatValue(c.lostIsRank, "percent", fmt)}`, v: "neutral" as const };
    if (c.frequency !== null && c.frequency >= 3.5) return { text: `Frequência ${formatValue(c.frequency, "ratio", fmt)}`, v: "bad" as const };
    return null;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterBar timezone={client.timezone} locale={client.locale} options={{ channels: true, devices: true }} />
        <span className="ml-auto text-xs text-muted">Valores em {client.currency} · fuso {client.timezone}</span>
      </div>
      <div className="mb-4 space-y-2 empty:hidden">
        {dash.completeness && <Notice>Período inclui dias ainda sem dados em algumas fontes — {dash.completeness}</Notice>}
        {dash.warnings.map((w) => (
          <Notice key={w}>{w}</Notice>
        ))}
        {dash.excludedPlatforms.length > 0 && (
          <Notice>
            {dash.excludedPlatforms.map((p) => PLATFORM_LABELS[p]).join(", ")} ausente dos gráficos, da repartição por canal e dos totais de investimento.{" "}
            <Link href="/settings" className="font-medium underline-offset-2 hover:underline">
              Registe a taxa de câmbio em Definições
            </Link>
            .
          </Notice>
        )}
      </div>

      {headline.length > 0 && <KpiStrip kpis={headline} fmt={fmt} compareLabel={compareLabel} cols={6} />}
      {morePaid.length > 0 && (
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded px-1 text-xs font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Mostrar todas as métricas pagas ({morePaid.length})</span>
            <span className="hidden group-open:inline">Ocultar métricas</span>
          </summary>
          <div className="mt-2">
            <KpiStrip kpis={morePaid} fmt={fmt} compareLabel={compareLabel} cols={6} spark={false} />
          </div>
        </details>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {dash.paidKpis.length > 0 && (
            <Card>
              <CardHeader title="Investimento e receita por dia" />
              <div className="px-4 pb-3 pt-3">
                <TimeSeriesChart
                  data={dash.spendSeries}
                  fmt={fmt}
                  granularity={dash.granularity}
                  height={230}
                  series={[
                    ...(hasBoth
                      ? [
                          { key: "costGoogle", label: "Google Ads", unit: "currency" as const, kind: "bar" as const, color: "var(--google)", stack: "cost" },
                          { key: "costMeta", label: "Meta Ads", unit: "currency" as const, kind: "bar" as const, color: "var(--meta)", stack: "cost" },
                        ]
                      : [{ key: "cost", label: "Investimento", unit: "currency" as const, kind: "bar" as const, color: ch[0]?.platform === "META_ADS" ? "var(--meta)" : "var(--google)" }]),
                    { key: "value", label: "Receita atribuída (eixo dir.)", unit: "currency", kind: "line", axis: "right", color: "var(--fg)" },
                  ]}
                />
                <p className="mt-2 text-[11.5px] text-muted">Investimento diário (barras) e receita atribuída pelas plataformas (linha). A receita é a reportada por cada plataforma com a sua atribuição.</p>
              </div>
            </Card>
          )}

          {ch.length > 0 && (
            <Card>
              <CardHeader title="Desempenho por canal" description="Cada plataforma usa a sua própria atribuição; o total é a soma do reportado." />
              <Tbl
                head={[{ label: "Canal" }, { label: "Investimento", num: true }, { label: "Peso", num: true }, { label: "Conversões", num: true }, { label: "Custo/conv.", num: true }, { label: "Receita", num: true }, { label: "ROAS", num: true }, { label: `Δ ROAS`, num: true }]}
                foot={
                  tot && hasBoth ? (
                    <tr>
                      <Td>Total reportado</Td>
                      <Td num>{formatValue(tot.cost.current, "currency", fmt)}</Td>
                      <Td num>100%</Td>
                      <Td num>{formatValue(tot.conv.current, "number", fmt)}</Td>
                      <Td num>{formatValue(tot.cpa.current, "currency", fmt)}</Td>
                      <Td num>{formatValue(tot.value.current, "currency", fmt)}</Td>
                      <Td num>{formatValue(tot.roas.current, "multiplier", fmt)}</Td>
                      <Td num>
                        <DeltaCell pct={tot.roas.pct} />
                      </Td>
                    </tr>
                  ) : undefined
                }
              >
                {ch.map((c) => (
                  <tr key={c.platform}>
                    <Td>
                      <Link href={`${base}/${c.platform === "GOOGLE_ADS" ? "google-ads" : "meta-ads"}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                        <Dot tone={DOT[c.platform as keyof typeof DOT] ?? "seo"} />
                        {PLATFORM_LABELS[c.platform]}
                      </Link>
                    </Td>
                    <Td num>{formatValue(c.cost, "currency", fmt)}</Td>
                    <Td num>
                      <span className="inline-flex items-center gap-2">
                        {formatValue(c.share, "percent", fmt)}
                        <ShareBar value={c.share} />
                      </span>
                    </Td>
                    <Td num>{c.conversions === null ? "—" : formatValue(c.conversions, "number", fmt)}</Td>
                    <Td num>{c.cpa === null ? "—" : formatValue(c.cpa, "currency", fmt)}</Td>
                    <Td num>{c.value === null ? "—" : formatValue(c.value, "currency", fmt)}</Td>
                    <Td num>{c.roas === null ? "—" : formatValue(c.roas, "multiplier", fmt)}</Td>
                    <Td num>
                      <DeltaCell pct={c.roasDelta} />
                    </Td>
                  </tr>
                ))}
                {dash.excludedPlatforms.map((p) => (
                  <tr key={p}>
                    <Td>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Dot tone={DOT[p as keyof typeof DOT] ?? "seo"} />
                        {PLATFORM_LABELS[p]}
                      </span>
                    </Td>
                    <Td className="text-faint" colSpan={7}>
                      Não disponível — sem taxa de câmbio
                    </Td>
                  </tr>
                ))}
              </Tbl>
            </Card>
          )}

          {dash.campaignMovers.length > 0 && (
            <Card>
              <CardHeader
                title="Maiores variações em campanhas"
                description="Ordenado pelo impacto absoluto no custo por conversão"
                actions={<LinkButton href={`${base}/campaigns`} size="sm" variant="ghost">Ver todas</LinkButton>}
              />
              <Tbl head={[{ label: "Campanha" }, { label: "Investimento", num: true }, { label: "Conversões", num: true }, { label: "Custo/conv.", num: true }, { label: "Δ custo/conv.", num: true }, { label: "ROAS", num: true }, { label: "Sinal" }]}>
                {dash.campaignMovers.map((c) => {
                  const s = signal(c);
                  return (
                    <tr key={c.id}>
                      <Td className="max-w-[260px]">
                        <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                          <Dot tone={DOT[c.platform as keyof typeof DOT] ?? "seo"} />
                          <span className="truncate">{entities.campaigns.get(c.id)?.name ?? c.id}</span>
                        </span>
                      </Td>
                      <Td num>{formatValue(c.cost, "currency", fmt)}</Td>
                      <Td num>{c.conversions === null ? "—" : formatValue(c.conversions, "number", fmt)}</Td>
                      <Td num>{c.cpa === null ? "—" : formatValue(c.cpa, "currency", fmt)}</Td>
                      <Td num>
                        <DeltaCell pct={c.cpaDelta} invert />
                      </Td>
                      <Td num>{c.roas === null ? "—" : formatValue(c.roas, "multiplier", fmt)}</Td>
                      <Td>{s ? <Badge variant={s.v}>{s.text}</Badge> : <span className="text-faint">—</span>}</Td>
                    </tr>
                  );
                })}
              </Tbl>
            </Card>
          )}

          {dash.seoKpis.length > 0 && (
            <>
              <SectionTitle title="Pesquisa orgânica" description="Google Search Console" actions={<LinkButton href={`${base}/seo`} size="sm" variant="ghost">Ver SEO</LinkButton>} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Cliques e impressões orgânicas" />
                  <div className="px-4 pb-3 pt-3">
                    <TimeSeriesChart
                      data={dash.organicSeries}
                      fmt={fmt}
                      granularity={dash.granularity}
                      height={200}
                      series={[
                        { key: "clicks", label: "Cliques", unit: "number", kind: "line", color: "var(--fg)" },
                        { key: "impressions", label: "Impressões (eixo dir.)", unit: "number", kind: "line", axis: "right", color: "var(--faint)", dashed: true },
                      ]}
                    />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Consultas com mais cliques" />
                  <DataTable
                    fmt={fmt}
                    searchable={false}
                    pageSize={6}
                    rows={dash.topQueries.map((q) => ({ q: q.key, clicks: q.current.clicks, ctr: q.current.ctr, position: q.current.position, d: delta(q.current.clicks, q.previous.clicks).pct }))}
                    columns={[
                      { key: "q", label: "Consulta" },
                      { key: "clicks", label: "Cliques", kind: "metric" },
                      { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
                      { key: "position", label: "Posição", kind: "metric", unit: "position" },
                      { key: "d", label: "Var.", kind: "delta", higherIsBetter: true },
                    ]}
                  />
                </Card>
              </div>
            </>
          )}

          {dash.webKpis.length > 0 && (
            <>
              <SectionTitle title="Website" description="Google Analytics 4" />
              <KpiStrip kpis={dash.webKpis} fmt={fmt} compareLabel={compareLabel} cols={4} />
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              title="Tarefas"
              description={`${openTasks.length} abertas`}
              actions={
                <Link href={`${base}/tasks`} className="text-xs font-medium text-fg-2 hover:text-fg">
                  {canWrite ? "Gerir" : "Ver"}
                </Link>
              }
            />
            <TaskList tasks={shownTasks} clientId={client.id} canWrite={canWrite} today={today} fmt={fmt} empty="Sem tarefas abertas." />
          </Card>
          <PacingPanel pacing={monthBudget?.pacing ?? null} periodStart={monthBudget?.periodStart ?? null} fmt={fmt} href={`${base}/budget`} />
          <RecommendationsPanel recs={recs} total={recTotal} clientId={client.id} canDecide={can(tenant.role, "recommendation:decide")} href={`${base}/recommendations`} />
          <Card>
            <CardHeader
              title="Notas"
              actions={
                <Link href={`${base}/notes`} className="text-xs font-medium text-fg-2 hover:text-fg">
                  {canWrite ? "Nova nota" : "Ver"}
                </Link>
              }
            />
            <NoteList notes={notes} clientId={client.id} canWrite={canWrite} fmt={fmt} clamp />
          </Card>
          <Card>
            <CardHeader
              title="Atividade"
              actions={
                <Link href={`${base}/activity`} className="text-xs font-medium text-fg-2 hover:text-fg">
                  Ver tudo
                </Link>
              }
            />
            <ActivityList items={activity} fmt={fmt} />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function DeltaCell({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return <span className="text-faint">—</span>;
  const flat = Math.abs(pct) < 0.0005;
  const good = pct > 0 !== invert;
  return <span className={cn("tabular font-medium", flat ? "text-muted" : good ? "text-good" : "text-bad")}>{formatDelta(pct)}</span>;
}
