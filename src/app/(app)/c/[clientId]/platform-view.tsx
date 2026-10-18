import type { Platform } from "@prisma/client";
import { kpi } from "@/server/queries/dashboard";
import { filtersToQuery } from "@/server/queries/filters";
import { loadPlatformAnalytics, loadSearchTerms } from "@/server/queries/ads";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { delta } from "@/server/metrics/calc";
import { resolveMetricGroups } from "@/server/metrics/platform-groups";
import { KpiStrip } from "@/components/kpi-card";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import type { pageContext } from "./page-context";

type Ctx = Awaited<ReturnType<typeof pageContext>>;

const DEVICE_LABELS: Record<string, string> = { MOBILE: "Telemóvel", DESKTOP: "Computador", TABLET: "Tablet", CONNECTED_TV: "TV", OTHER: "Outro" };

/** 5 ou 6 colunas, a que deixar menos células vazias no fim de cada grupo (empate: 6). */
function stripCols(sizes: number[]): 5 | 6 {
  const empty = (c: number) => sizes.reduce((s, n) => s + ((c - (n % c)) % c), 0);
  return empty(5) < empty(6) ? 5 : 6;
}

export async function PlatformView({ page, platform }: { page: Ctx; platform: "GOOGLE_ADS" | "META_ADS" }) {
  const { client, ctx, filters, fmt, compareLabel } = page;
  const label = PLATFORM_LABELS[platform];
  if (!ctx.has[platform]) {
    return (
      <>
        <PageHeader title={label} />
        <Card>
          <EmptyState title={`${label} não está ligado a este cliente`} description="Ligue uma conta através de OAuth para sincronizar campanhas, anúncios e métricas." action={<LinkButton href={`/c/${client.id}/sources`} variant="primary">Ligar conta</LinkButton>} />
        </Card>
      </>
    );
  }
  const isGoogle = platform === "GOOGLE_ADS";
  const platforms: Platform[] = [platform];
  const [a, keywords, terms] = await Promise.all([
    loadPlatformAnalytics(ctx, filters, platforms),
    isGoogle ? loadSearchTerms(client.id, "KEYWORD", filters.period.start, filters.period.end, filters.campaign) : [],
    isGoogle ? loadSearchTerms(client.id, "SEARCH_TERM", filters.period.start, filters.period.end, filters.campaign) : [],
  ]);
  const origin = ctx.originOf(platforms);
  const t = a.totals.totals;
  const d = a.totals.derived;
  const pt = a.previous?.totals ?? null;
  const pd = a.previous?.derived ?? null;
  const s = (key: keyof (typeof a.series)[number]) => a.series.map((r) => ({ date: r.date, value: r[key] as number | null }));

  const resolved = resolveMetricGroups(platform, a.totals, a.previous);
  const approx = (key: string) =>
    key === "reach" ? { quality: t.reach === null ? ("UNAVAILABLE" as const) : t.reachIsApproximate ? ("APPROX" as const) : ("OK" as const), note: t.reachIsApproximate ? "Soma de alcances diários (limite superior do alcance único)." : undefined }
    : key === "frequency" ? { quality: d.frequency === null ? ("UNAVAILABLE" as const) : t.reachIsApproximate ? ("APPROX" as const) : ("OK" as const) }
    : {};
  const groups = resolved.groups.map((g) => ({ label: g.label, kpis: g.metrics.map((m) => kpi(m.key, m.current, m.previous, m.series ? s(m.series) : [], origin, approx(m.key))) }));
  const campaignTotals = {
    name: "Total",
    cost: t.cost,
    impressions: t.impressions,
    clicks: t.clicks,
    ctr: d.ctr,
    cpc: d.cpc,
    conversions: t.conversions,
    convD: pt ? delta(t.conversions, pt.conversions).pct : null,
    costD: pt ? delta(t.cost, pt.cost).pct : null,
    cpa: d.cpa,
    cpaD: pd ? delta(d.cpa, pd.cpa).pct : null,
    roas: d.roas,
    is: t.searchImpressionShare,
    lostB: t.searchLostIsBudget,
    frequency: d.frequency,
  };

  const base = `/c/${client.id}`;
  const campaignCols: Col[] = [
    { key: "name", label: "Campanha", subKey: "sub", hrefKey: "href" },
    { key: "status", label: "Estado", kind: "status" },
    { key: "cost", label: "Invest.", kind: "metric", unit: "currency" },
    { key: "costD", label: "Var. invest.", kind: "delta" },
    { key: "impressions", label: "Impr.", kind: "metric" },
    { key: "clicks", label: "Cliques", kind: "metric" },
    { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
    { key: "cpc", label: "CPC", kind: "metric", unit: "currency" },
    { key: "conversions", label: "Conv.", kind: "metric" },
    { key: "convD", label: "Var. conv.", kind: "delta", higherIsBetter: true },
    { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
    { key: "cpaD", label: "Var. CPA", kind: "delta", higherIsBetter: false },
    { key: "roas", label: "ROAS", kind: "metric", unit: "multiplier" },
    isGoogle
      ? { key: "is", label: "Parcela impr.", kind: "metric", unit: "percent", hint: "Parcela de impressões de pesquisa (só campanhas de pesquisa)" }
      : { key: "frequency", label: "Freq.", kind: "metric", unit: "ratio" },
    ...(isGoogle ? [{ key: "lostB", label: "Perdida (orç.)", kind: "metric" as const, unit: "percent" as const }] : []),
  ];
  const campaignRows = a.campaigns.map((c) => ({
    name: c.name,
    sub: [c.type, c.objective].filter(Boolean).join(" · "),
    href: `${base}/campaigns?${filtersToQuery({ ...filters, campaign: c.id })}`,
    status: c.status,
    cost: c.cost,
    costD: c.costDeltaPct,
    impressions: c.impressions,
    clicks: c.clicks,
    ctr: c.ctr,
    cpc: c.cpc,
    conversions: c.conversions,
    convD: c.conversionsDeltaPct,
    cpa: c.cpa,
    cpaD: c.cpaDeltaPct,
    roas: c.roas,
    is: c.searchImpressionShare,
    lostB: c.searchLostIsBudget,
    frequency: c.frequency,
  }));

  const adRows = a.ads.map((ad) => {
    const info = a.adInfo[ad.id];
    return {
      name: ad.name,
      sub: `${ad.campaignName ?? ""}${ad.adGroupName ? ` › ${ad.adGroupName}` : ""}`,
      format: info?.creative?.format ?? ad.type ?? null,
      text: info?.creative?.primaryText ?? info?.headlines?.slice(0, 2).join(" | ") ?? null,
      cost: ad.cost,
      impressions: ad.impressions,
      clicks: ad.clicks,
      ctr: ad.ctr,
      conversions: ad.conversions,
      cpa: ad.cpa,
      roas: ad.roas,
      frequency: ad.frequency,
      convD: ad.conversionsDeltaPct,
    };
  });

  const breakdownCols = (dimLabel: string): Col[] => [
    { key: "value", label: dimLabel },
    { key: "cost", label: "Invest.", kind: "metric", unit: "currency" },
    { key: "impressions", label: "Impr.", kind: "metric" },
    { key: "clicks", label: "Cliques", kind: "metric" },
    { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
    { key: "conversions", label: "Conv.", kind: "metric" },
    { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
    { key: "roas", label: "ROAS", kind: "metric", unit: "multiplier" },
  ];
  const termCols: Col[] = [
    { key: "text", label: "Termo", subKey: "matchType" },
    { key: "impressions", label: "Impr.", kind: "metric" },
    { key: "clicks", label: "Cliques", kind: "metric" },
    { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
    { key: "cost", label: "Custo", kind: "metric", unit: "currency" },
    { key: "cpc", label: "CPC", kind: "metric", unit: "currency" },
    { key: "conversions", label: "Conv.", kind: "metric" },
    { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={label}
        description={isGoogle ? "Campanhas, grupos de anúncios, anúncios, palavras-chave e termos de pesquisa. Conversões segundo o modelo de atribuição da conta Google Ads." : "Campanhas, conjuntos e anúncios. Conversões = resultado do objetivo da campanha, com a janela de atribuição configurada no Meta."}
        actions={<FilterBar timezone={client.timezone} locale={client.locale} options={{ campaigns: a.campaignOptions, devices: true, countries: a.countries.map((c) => c.value) }} />}
      />
      {a.completeness && <Notice>Dados incompletos no fim do período — {a.completeness}</Notice>}
      {a.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      <KpiStrip groups={groups} fmt={fmt} compareLabel={compareLabel} cols={stripCols(groups.map((g) => g.kpis.length))} />
      {resolved.unavailable.length > 0 && <p className="-mt-3 text-[11.5px] text-muted">Não disponível nesta conta: {resolved.unavailable.join(", ")} (a plataforma não reportou estas métricas no período).</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Investimento e conversões" />
          <div className="px-4 pb-3 pt-3">
            <TimeSeriesChart data={a.series} fmt={fmt} granularity={a.granularity} series={[{ key: "cost", label: "Investimento", unit: "currency", kind: "bar", color: isGoogle ? "var(--google)" : "var(--meta)" }, { key: "conversions", label: "Conversões (eixo dir.)", unit: "number", axis: "right", color: "var(--fg)" }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title={isGoogle ? "CTR e custo por conversão" : "CTR e frequência"} description={isGoogle ? undefined : "Frequência a subir com CTR a descer pode indicar fadiga criativa."} />
          <div className="px-4 pb-3 pt-3">
            <TimeSeriesChart
              data={a.series}
              fmt={fmt}
              granularity={a.granularity}
              series={isGoogle ? [{ key: "ctr", label: "CTR", unit: "percent", color: "var(--fg)" }, { key: "cpa", label: "CPA (eixo dir.)", unit: "currency", axis: "right", color: "var(--google)", dashed: true }] : [{ key: "ctr", label: "CTR", unit: "percent", color: "var(--fg)" }, { key: "frequency", label: "Frequência (eixo dir.)", unit: "ratio", axis: "right", color: "var(--meta)", dashed: true }]}
            />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Campanhas"
          description={`${a.campaigns.length} campanhas com atividade no período`}
          actions={
            <LinkButton href={`${base}/manage?view=campanhas`} size="sm">
              Pausar, ativar ou alterar orçamentos
            </LinkButton>
          }
        />
        <DataTable fmt={fmt} rows={campaignRows} columns={campaignCols} totals={campaignRows.length > 1 ? campaignTotals : undefined} exportName={`${client.slug}-${platform.toLowerCase()}-campanhas`} initialSort={{ key: "cost" }} />
      </Card>
      <Card>
        <CardHeader title="Anúncios" description={isGoogle ? "Campanhas Performance Max não têm dados ao nível do anúncio." : undefined} />
        <DataTable
          fmt={fmt}
          rows={adRows}
          exportName={`${client.slug}-${platform.toLowerCase()}-anuncios`}
          initialSort={{ key: "cost" }}
          columns={[
            { key: "name", label: "Anúncio", subKey: "sub" },
            { key: "format", label: "Formato", kind: "badge" },
            { key: "text", label: "Texto / títulos" },
            { key: "cost", label: "Invest.", kind: "metric", unit: "currency" },
            { key: "impressions", label: "Impr.", kind: "metric" },
            { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
            { key: "conversions", label: "Conv.", kind: "metric" },
            { key: "convD", label: "Var. conv.", kind: "delta", higherIsBetter: true },
            { key: "cpa", label: "CPA", kind: "metric", unit: "currency" },
            ...(isGoogle ? [{ key: "roas", label: "ROAS", kind: "metric" as const, unit: "multiplier" as const }] : [{ key: "frequency", label: "Freq.", kind: "metric" as const, unit: "ratio" as const }]),
          ]}
        />
      </Card>
      {isGoogle && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Palavras-chave" />
            <DataTable fmt={fmt} rows={keywords.map((k) => ({ ...k, matchType: k.matchType ?? "" }))} columns={termCols} pageSize={10} exportName={`${client.slug}-palavras-chave`} initialSort={{ key: "cost" }} />
          </Card>
          <Card>
            <CardHeader title="Termos de pesquisa" description="Termos de baixo volume podem ser omitidos pela Google por privacidade." />
            <DataTable fmt={fmt} rows={terms.map((k) => ({ ...k, matchType: "" }))} columns={termCols} pageSize={10} exportName={`${client.slug}-termos-pesquisa`} initialSort={{ key: "cost" }} />
          </Card>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Por dispositivo" />
          <DataTable fmt={fmt} searchable={false} rows={a.devices.map((r) => ({ ...r, value: DEVICE_LABELS[r.value] ?? r.value }))} columns={breakdownCols("Dispositivo")} />
        </Card>
        <Card>
          <CardHeader title="Por país" />
          <DataTable fmt={fmt} searchable={false} pageSize={10} rows={a.countries} columns={breakdownCols("País")} />
        </Card>
      </div>
    </div>
  );
}
