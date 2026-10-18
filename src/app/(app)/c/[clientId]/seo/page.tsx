import { autoGranularity } from "@/lib/dates";
import { delta } from "@/server/metrics/calc";
import { kpi } from "@/server/queries/dashboard";
import { searchByKey, searchSeries, searchTotals, seoProviderSnapshots, type SearchKeyRow } from "@/server/queries/seo";
import { webByKey } from "@/server/queries/web";
import { KpiGrid } from "@/components/kpi-card";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { pageContext } from "../page-context";

export const metadata = { title: "SEO" };

const DEVICE: Record<string, string> = { MOBILE: "Telemóvel", DESKTOP: "Computador", TABLET: "Tablet" };

function rows(list: SearchKeyRow[], label = (k: string) => k) {
  return list.map((r) => ({
    key: label(r.key),
    clicks: r.current.clicks,
    clicksD: delta(r.current.clicks, r.previous.clicks).pct,
    impressions: r.current.impressions,
    impressionsD: delta(r.current.impressions, r.previous.impressions).pct,
    ctr: r.current.ctr,
    position: r.current.position,
    positionChange: r.current.position !== null && r.previous.position !== null ? r.previous.position - r.current.position : null,
  }));
}

const cols = (label: string): Col[] => [
  { key: "key", label },
  { key: "clicks", label: "Cliques", kind: "metric" },
  { key: "clicksD", label: "Var. cliques", kind: "delta", higherIsBetter: true },
  { key: "impressions", label: "Impressões", kind: "metric" },
  { key: "impressionsD", label: "Var. impr.", kind: "delta", higherIsBetter: true },
  { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
  { key: "position", label: "Posição", kind: "metric", unit: "position" },
  { key: "positionChange", label: "Var. posição", kind: "metric", unit: "position", hint: "Positivo = subiu no ranking (melhorou)" },
];

const MOVER_KEYS = ["key", "clicks", "clicksD", "position", "positionChange"];
const moverCols = cols("Consulta").filter((c) => MOVER_KEYS.includes(c.key));

export default async function SeoPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { client, ctx, filters, fmt, compareLabel } = await pageContext(props.params, props.searchParams);
  if (!ctx.has.SEARCH_CONSOLE) {
    return (
      <>
        <PageHeader title="SEO" />
        <Card>
          <EmptyState title="Search Console não está ligado" description="Os dados orgânicos (cliques, impressões, CTR, posição, consultas e páginas) vêm exclusivamente da API oficial do Google Search Console." action={<LinkButton href={`/c/${client.id}/sources`} variant="primary">Ligar Search Console</LinkButton>} />
        </Card>
      </>
    );
  }
  const cur = filters.period;
  const prev = filters.compare;
  const g = autoGranularity(cur.start, cur.end);
  const [tCur, tPrev, series, queries, pages, devices, countries, landing, snapshots] = await Promise.all([
    searchTotals(client.id, cur.start, cur.end),
    prev ? searchTotals(client.id, prev.start, prev.end) : null,
    searchSeries(client.id, cur.start, cur.end, g),
    searchByKey(client.id, "QUERY", cur, prev, 1000),
    searchByKey(client.id, "PAGE", cur, prev, 500),
    searchByKey(client.id, "DEVICE", cur, prev, 10),
    searchByKey(client.id, "COUNTRY", cur, prev, 50),
    ctx.has.GA4 ? webByKey(client.id, "LANDING_PAGE", cur.start, cur.end, 100) : [],
    ctx.has.SEMRUSH ? seoProviderSnapshots(client.id) : [],
  ]);
  const origin = ctx.originOf(["SEARCH_CONSOLE"]);
  const ss = (fn: (r: (typeof series)[number]) => number | null) => series.map((r) => ({ date: r.date, value: fn(r) }));
  const kpis = [
    kpi("organicClicks", tCur.clicks, tPrev?.clicks ?? null, ss((r) => r.clicks), origin),
    kpi("organicImpressions", tCur.impressions, tPrev?.impressions ?? null, ss((r) => r.impressions), origin),
    kpi("organicCtr", tCur.ctr, tPrev?.ctr ?? null, ss((r) => r.ctr), origin),
    kpi("position", tCur.position, tPrev?.position ?? null, ss((r) => r.position), origin),
  ];
  const withPrev = queries.filter((q) => q.previous.clicks >= 5);
  const rising = [...withPrev].sort((a, b) => b.current.clicks - b.previous.clicks - (a.current.clicks - a.previous.clicks)).filter((q) => q.current.clicks > q.previous.clicks).slice(0, 10);
  const falling = [...withPrev].sort((a, b) => a.current.clicks - a.previous.clicks - (b.current.clicks - b.previous.clicks)).filter((q) => q.current.clicks < q.previous.clicks).slice(0, 10);
  const visibleClicks = queries.reduce((a, q) => a + q.current.clicks, 0);
  const base = new URL(client.website ?? "https://x.invalid").origin;

  return (
    <div className="space-y-5">
      <PageHeader title="SEO" description="Dados oficiais do Google Search Console. A posição média é ponderada pelas impressões. Os dados têm habitualmente 2–3 dias de atraso." actions={<FilterBar timezone={client.timezone} locale={client.locale} />} />
      {ctx.completenessWarning(["SEARCH_CONSOLE"], cur.end) && <Notice>Período inclui dias ainda não disponíveis — {ctx.completenessWarning(["SEARCH_CONSOLE"], cur.end)}</Notice>}
      <KpiGrid kpis={kpis} fmt={fmt} compareLabel={compareLabel} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cliques e impressões" />
          <div className="p-3">
            <TimeSeriesChart data={series} fmt={fmt} granularity={g} series={[{ key: "clicks", label: "Cliques", unit: "number", kind: "area" }, { key: "impressions", label: "Impressões", unit: "number", axis: "right", color: "var(--chart-2)" }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Posição média e CTR" description="Eixo da posição invertido: mais acima = melhor posição." />
          <div className="p-3">
            <TimeSeriesChart data={series} fmt={fmt} granularity={g} reversedRight series={[{ key: "ctr", label: "CTR", unit: "percent" }, { key: "position", label: "Posição", unit: "position", axis: "right", color: "var(--chart-4)" }]} />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Consultas"
          description={`As consultas visíveis somam ${visibleClicks.toLocaleString(fmt.locale)} de ${tCur.clicks.toLocaleString(fmt.locale)} cliques; a diferença corresponde a consultas anonimizadas pela Google.`}
        />
        <DataTable fmt={fmt} rows={rows(queries)} columns={cols("Consulta")} exportName={`${client.slug}-seo-consultas`} initialSort={{ key: "clicks" }} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Consultas em crescimento" />
          <DataTable fmt={fmt} searchable={false} pageSize={10} rows={rows(rising)} columns={moverCols} empty="Sem consultas com crescimento significativo." />
        </Card>
        <Card>
          <CardHeader title="Consultas em queda" />
          <DataTable fmt={fmt} searchable={false} pageSize={10} rows={rows(falling)} columns={moverCols} empty="Sem consultas em queda significativa." />
        </Card>
      </div>
      <Card>
        <CardHeader title="Páginas" />
        <DataTable fmt={fmt} rows={rows(pages, (k) => (k.startsWith(base) ? k.slice(base.length) || "/" : k))} columns={cols("Página")} exportName={`${client.slug}-seo-paginas`} initialSort={{ key: "clicks" }} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Por dispositivo" />
          <DataTable fmt={fmt} searchable={false} rows={rows(devices, (k) => DEVICE[k] ?? k)} columns={cols("Dispositivo").slice(0, 7)} />
        </Card>
        <Card>
          <CardHeader title="Por país" />
          <DataTable fmt={fmt} searchable={false} pageSize={10} rows={rows(countries)} columns={cols("País").slice(0, 7)} />
        </Card>
      </div>
      {landing.length > 0 && (
        <Card>
          <CardHeader title="Páginas de destino (GA4)" description="Todas as origens de tráfego. Eventos-chave conforme configurados na propriedade GA4." />
          <DataTable
            fmt={fmt}
            rows={landing.map((l) => ({ key: l.key, sessions: l.sessions, engagementRate: l.engagementRate, keyEvents: l.keyEvents, keyEventRate: l.keyEventRate, revenue: l.revenue }))}
            columns={[
              { key: "key", label: "Página" },
              { key: "sessions", label: "Sessões", kind: "metric" },
              { key: "engagementRate", label: "Taxa de envolvimento", kind: "metric", unit: "percent" },
              { key: "keyEvents", label: "Eventos-chave", kind: "metric" },
              { key: "keyEventRate", label: "Taxa ev.-chave", kind: "metric", unit: "percent" },
              { key: "revenue", label: "Receita", kind: "metric", unit: "currency" },
            ]}
            initialSort={{ key: "sessions" }}
          />
        </Card>
      )}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2">Semrush <Badge variant="accent">Estimativa</Badge></span>} description="Valores estimados por ferramenta de terceiros; não são dados oficiais da Google." />
          <DataTable
            fmt={fmt}
            rows={snapshots.map((s) => ({ key: s.keyword ?? s.metricKey ?? "—", position: s.position, volume: s.searchVolume, traffic: s.estTraffic, value: s.metricValue, date: s.snapshotDate.toISOString().slice(0, 10) }))}
            columns={[
              { key: "key", label: "Palavra-chave / métrica" },
              { key: "position", label: "Posição", kind: "metric", unit: "position" },
              { key: "volume", label: "Volume", kind: "metric" },
              { key: "traffic", label: "Tráfego est.", kind: "metric" },
              { key: "value", label: "Valor", kind: "metric" },
              { key: "date", label: "Data" },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
