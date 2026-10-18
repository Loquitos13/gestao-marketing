import type { Platform } from "@prisma/client";
import { formatValue } from "@/lib/format";
import { kpi, paidPlatforms } from "@/server/queries/dashboard";
import { filtersToQuery } from "@/server/queries/filters";
import { loadPlatformAnalytics } from "@/server/queries/ads";
import { webByKey, webTotals } from "@/server/queries/web";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { KpiGrid } from "@/components/kpi-card";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { pageContext } from "../page-context";

export const metadata = { title: "Campanhas" };

export default async function CampaignsPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string>> }) {
  const page = await pageContext(props.params, props.searchParams);
  const { client, ctx, filters, fmt, compareLabel } = page;
  const platforms = paidPlatforms({ ...filters, channel: filters.channel === "seo" ? "all" : filters.channel }, ctx);
  if (!platforms.length) {
    return (
      <>
        <PageHeader title="Campanhas" />
        <Card>
          <EmptyState title="Sem plataformas de publicidade ligadas" action={<LinkButton href={`/c/${client.id}/sources`} variant="primary">Ligar Google Ads ou Meta Ads</LinkButton>} />
        </Card>
      </>
    );
  }
  const [a, channels, web] = await Promise.all([
    loadPlatformAnalytics(ctx, filters, platforms),
    ctx.has.GA4 ? webByKey(client.id, "CHANNEL", filters.period.start, filters.period.end, 20) : [],
    ctx.has.GA4 ? webTotals(client.id, filters.period.start, filters.period.end) : null,
  ]);
  const selected = filters.campaign ? a.campaigns.find((c) => c.id === filters.campaign) : null;
  const origin = ctx.originOf(platforms);
  const t = a.totals.totals;
  const d = a.totals.derived;
  const pt = a.previous?.totals ?? null;
  const pd = a.previous?.derived ?? null;

  const campaignRows = a.campaigns.map((c) => ({
    name: c.name,
    platform: PLATFORM_LABELS[c.platform as Platform],
    sub: [c.type, c.objective].filter(Boolean).join(" · "),
    href: `?${filtersToQuery({ ...filters, campaign: c.id })}`,
    status: c.status,
    cost: c.cost,
    clicks: c.clicks,
    ctr: c.ctr,
    conversions: c.conversions,
    convD: c.conversionsDeltaPct,
    cpa: c.cpa,
    cpaD: c.cpaDeltaPct,
    roas: c.roas,
    share: t.cost ? c.cost / t.cost : null,
  }));

  const funnel = [
    { label: "Impressões (anúncios)", value: t.impressions, src: "Plataformas de anúncios" },
    { label: "Cliques (anúncios)", value: t.clicks, src: "Plataformas de anúncios" },
    ...(web ? [{ label: "Sessões no site (todas as origens)", value: web.sessions, src: "GA4" }] : []),
    { label: "Conversões (anúncios)", value: t.conversions, src: "Atribuição de cada plataforma" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={selected ? selected.name : "Campanhas"}
        description={selected ? `${PLATFORM_LABELS[selected.platform as Platform]} · ${[selected.type, selected.objective].filter(Boolean).join(" · ")}` : "Comparação de campanhas entre plataformas com métricas equivalentes. As conversões seguem a atribuição de cada plataforma e não são diretamente comparáveis."}
        actions={
          <>
            {selected && <LinkButton href={`/c/${client.id}/campaigns?${filtersToQuery({ ...filters, campaign: null })}`} size="sm">Todas as campanhas</LinkButton>}
            <FilterBar timezone={client.timezone} locale={client.locale} options={{ channels: true, campaigns: a.campaignOptions, devices: true }} />
          </>
        }
      />
      {a.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      <KpiGrid
        fmt={fmt}
        compareLabel={compareLabel}
        cols={6}
        kpis={[
          kpi("cost", t.cost, pt?.cost ?? null, a.series.map((s) => ({ date: s.date, value: s.cost })), origin),
          kpi("clicks", t.clicks, pt?.clicks ?? null, a.series.map((s) => ({ date: s.date, value: s.clicks })), origin),
          kpi("ctr", d.ctr, pd?.ctr ?? null, [], origin),
          kpi("conversions", t.conversions, pt?.conversions ?? null, a.series.map((s) => ({ date: s.date, value: s.conversions })), origin),
          kpi("cpa", d.cpa, pd?.cpa ?? null, [], origin),
          kpi("roas", d.roas, pd?.roas ?? null, [], origin),
        ]}
      />
      {selected ? (
        <>
          <Card>
            <CardHeader title="Evolução" />
            <div className="p-3">
              <TimeSeriesChart data={a.series} fmt={fmt} granularity={a.granularity} series={[{ key: "cost", label: "Investimento", unit: "currency", kind: "bar" }, { key: "conversions", label: "Conversões", unit: "number", axis: "right", color: "var(--chart-3)" }]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Anúncios da campanha" />
            <DataTable
              fmt={fmt}
              rows={a.ads.map((x) => ({ name: x.name, sub: x.adGroupName ?? "", cost: x.cost, impressions: x.impressions, clicks: x.clicks, ctr: x.ctr, conversions: x.conversions, cpa: x.cpa, frequency: x.frequency }))}
              columns={[
                { key: "name", label: "Anúncio", subKey: "sub" },
                { key: "cost", label: "Invest.", kind: "metric", unit: "currency" },
                { key: "impressions", label: "Impr.", kind: "metric" },
                { key: "clicks", label: "Cliques", kind: "metric" },
                { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
                { key: "conversions", label: "Conv.", kind: "metric" },
                { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
                { key: "frequency", label: "Freq.", kind: "metric", unit: "ratio" },
              ]}
              empty="Sem dados ao nível do anúncio (ex.: Performance Max)."
              initialSort={{ key: "cost" }}
            />
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="Todas as campanhas" description="Clique numa campanha para ver o detalhe." />
          <DataTable
            fmt={fmt}
            rows={campaignRows}
            exportName={`${client.slug}-campanhas`}
            initialSort={{ key: "cost" }}
            columns={[
              { key: "name", label: "Campanha", subKey: "sub", hrefKey: "href" },
              { key: "platform", label: "Plataforma", kind: "platform" },
              { key: "status", label: "Estado", kind: "status" },
              { key: "cost", label: "Invest.", kind: "metric", unit: "currency" },
              { key: "share", label: "% invest.", kind: "metric", unit: "percent" },
              { key: "clicks", label: "Cliques", kind: "metric" },
              { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
              { key: "conversions", label: "Conv.", kind: "metric" },
              { key: "convD", label: "Var. conv.", kind: "delta", higherIsBetter: true },
              { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
              { key: "cpaD", label: "Var. CPA", kind: "delta", higherIsBetter: false },
              { key: "roas", label: "ROAS", kind: "metric", unit: "multiplier" },
            ]}
          />
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Funil (indicativo)" description="Cada etapa vem de uma fonte diferente; não representa um percurso único do utilizador." />
          <ul className="space-y-2 p-4">
            {funnel.map((f, i) => {
              const max = funnel[0].value || 1;
              return (
                <li key={f.label}>
                  <div className="flex justify-between text-xs">
                    <span>{f.label}</span>
                    <span className="tabular font-medium">{formatValue(f.value, "number", fmt)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-hover">
                    <div className="h-1.5 rounded-full bg-fg-2" style={{ width: `${Math.max(1.5, Math.sqrt((f.value ?? 0) / max) * 100)}%`, opacity: 1 - i * 0.15 }} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">{f.src}</div>
                </li>
              );
            })}
          </ul>
          <p className="px-4 pb-4 text-[11px] text-muted">Barras em escala de raiz quadrada para legibilidade.</p>
        </Card>
        <Card>
          <CardHeader title="Canais de tráfego (GA4)" description="Agrupamento de canais predefinido do GA4, atribuição baseada em sessões." />
          {channels.length ? (
            <DataTable
              fmt={fmt}
              searchable={false}
              rows={channels.map((c) => ({ key: c.key, sessions: c.sessions, engagementRate: c.engagementRate, keyEvents: c.keyEvents, revenue: c.revenue }))}
              columns={[
                { key: "key", label: "Canal" },
                { key: "sessions", label: "Sessões", kind: "metric" },
                { key: "engagementRate", label: "Envolvimento", kind: "metric", unit: "percent" },
                { key: "keyEvents", label: "Eventos-chave", kind: "metric" },
                { key: "revenue", label: "Receita", kind: "metric", unit: "currency" },
              ]}
            />
          ) : (
            <EmptyState title="GA4 não ligado" description="Ligue uma propriedade GA4 para comparar canais." />
          )}
        </Card>
      </div>
    </div>
  );
}
