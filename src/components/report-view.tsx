import { Fragment } from "react";
import { formatDay, formatDelta, formatRange, formatValue, type Unit } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReportData } from "@/server/reports/build";
import { metricChange, metricTone, type PlatformMetrics } from "@/server/reports/platform-metrics";
import { sectionLabel } from "@/server/reports/sections";
import { TimeSeriesChart } from "./charts";
import { Badge, Dot, Initials } from "./ui";

type Rec = ReportData["recommendations"][number];
type Ent = ReportData["topCampaigns"][number];
type Kpi = ReportData["kpis"]["paid"][number];
type Cell = React.ReactNode;

const TONE = { good: "text-good", bad: "text-bad", neutral: "text-muted" } as const;
const PRIORITY: Record<number, string> = { 1: "Prioridade alta", 2: "Prioridade média", 3: "Prioridade baixa" };
const CONF: Record<string, string> = { HIGH: "Confiança alta", MEDIUM: "Confiança média", LOW: "Confiança baixa" };

/** Tabela do relatório: cabeçalho com filete escuro, linhas de grupo opcionais. */
function T({ headers, rows, align, groups, foot }: { headers: string[]; rows: Cell[][]; align?: ("l" | "r")[]; groups?: { at: number; label: string }[]; foot?: Cell[] }) {
  const al = (i: number) => ((align?.[i] ?? (i ? "r" : "l")) === "r" ? "whitespace-nowrap text-right tabular" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={cn("whitespace-nowrap border-b border-fg px-2.5 py-1.5 text-[11.5px] font-medium text-fg-2 first:pl-0 last:pr-0", al(i))}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <Fragment key={ri}>
              {groups?.filter((g) => g.at === ri).map((g) => (
                <tr key={g.label}>
                  <td colSpan={headers.length} className="border-b pb-1.5 pt-3 text-[11px] font-semibold text-muted">
                    {g.label}
                  </td>
                </tr>
              ))}
              <tr className="break-inside-avoid">
                {r.map((c, i) => (
                  <td key={i} className={cn("border-b px-2.5 py-1.5 first:pl-0 last:pr-0", al(i))}>
                    {c}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={headers.length} className="py-4 text-center text-muted">
                Sem dados no período.
              </td>
            </tr>
          )}
        </tbody>
        {foot && (
          <tfoot>
            <tr>
              {foot.map((c, i) => (
                <td key={i} className={cn("border-t border-border-strong px-2.5 py-1.5 font-semibold first:pl-0 last:pr-0", al(i))}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function KpiRow({ kpis, fmt, cols = 4 }: { kpis: Kpi[]; fmt: ReportData["fmt"]; cols?: number }) {
  if (!kpis.length) return null;
  return (
    <div className="grid overflow-hidden rounded-md border" style={{ gridTemplateColumns: `repeat(${Math.min(cols, kpis.length)}, minmax(0, 1fr))` }}>
      {kpis.map((k) => {
        const tone = metricTone({ higherIsBetter: k.higherIsBetter, current: k.delta.current, previous: k.delta.previous, abs: k.delta.abs });
        return (
          <div key={k.key} className="border-l px-3 py-2.5 first:border-l-0 [&:nth-child(n+5)]:border-t">
            <div className="text-[11px] text-muted">
              {k.label}
              {k.quality === "APPROX" && " (aprox.)"}
            </div>
            <div className="tabular mt-0.5 text-[17px] font-semibold tracking-tight">{formatValue(k.delta.current, k.unit, fmt)}</div>
            {k.delta.previous !== null && (
              <div className="tabular text-[11px] text-muted">
                <span className={cn("font-medium", TONE[tone])}>{metricChange({ unit: k.unit, current: k.delta.current, previous: k.delta.previous, pct: k.delta.pct }, fmt)}</span>
                {` vs ${formatValue(k.delta.previous, k.unit, fmt)}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetricTable({ p, fmt, compared }: { p: PlatformMetrics; fmt: ReportData["fmt"]; compared: boolean }) {
  const rows: Cell[][] = [];
  const groups: { at: number; label: string }[] = [];
  for (const g of p.groups) {
    groups.push({ at: rows.length, label: g.label });
    for (const r of g.rows) {
      const label = (
        <span key="l">
          {r.label}
          {r.note && <span className="block text-[10.5px] text-muted">{r.note}</span>}
        </span>
      );
      const current = <b key="c" className="font-semibold">{formatValue(r.current, r.unit, fmt)}</b>;
      const source = <span key="s" className="block max-w-[220px] text-[10.5px] text-faint">{r.source}</span>;
      rows.push(
        compared
          ? [label, current, formatValue(r.previous, r.unit, fmt), <span key="d" className={cn("font-medium", TONE[metricTone(r)])}>{r.previous === null ? "—" : metricChange(r, fmt)}</span>, source]
          : [label, current, source],
      );
    }
  }
  return <T headers={compared ? ["Métrica", "Atual", "Último relatório", "Variação", "Fonte / fórmula"] : ["Métrica", "Atual", "Fonte / fórmula"]} align={compared ? ["l", "r", "r", "r", "l"] : ["l", "r", "l"]} rows={rows} groups={groups} />;
}

const POST_PLATFORM: Record<string, string> = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", BLOG: "Blog" };

function Rank({ n }: { n: number }) {
  return <span className={cn("tabular inline-grid size-5 place-items-center rounded text-[11px] font-semibold", n <= 3 ? "bg-inverse text-inverse-fg" : "bg-hover text-fg-2")}>{n}</span>;
}

function TopContentBlock({ t, v }: { t: NonNullable<ReportData["topContent"]>; v: (x: number | null, u: Unit) => string }) {
  const sub = (main: React.ReactNode, detail: string | null) => (
    <span className="block min-w-0">
      <span className="block font-medium">{main}</span>
      {detail && <span className="block max-w-[340px] truncate text-[11px] text-muted">{detail}</span>}
    </span>
  );
  return (
    <>
      <h3 className="text-xs font-semibold">Anúncios</h3>
      <T
        headers={["#", "Anúncio", "Impr.", "Cliques", "CTR", "Conv.", "CPA", "ROAS"]}
        align={["l", "l"]}
        rows={t.ads.map((a) => [
          <Rank key="r" n={a.rank} />,
          sub(
            <span className="inline-flex items-center gap-1.5">
              <Dot tone={a.platform === "GOOGLE_ADS" ? "google" : "meta"} />
              {a.name}
            </span>,
            [a.headline, a.campaign].filter(Boolean).join(" · ") || null,
          ),
          v(a.impressions, "number"),
          v(a.clicks, "number"),
          v(a.ctr, "percent"),
          <b key="c" className="font-semibold">{v(a.conversions, "number")}</b>,
          v(a.cpa, "currency"),
          v(a.roas, "multiplier"),
        ])}
      />
      <p className="text-[11px] text-muted">{t.criteria.ads}</p>
      <h3 className="pt-3 text-xs font-semibold">Publicações orgânicas</h3>
      <T
        headers={["#", "Publicação", "Impr.", "Alcance", "Interações", "Taxa"]}
        align={["l", "l"]}
        rows={t.posts.map((p) => [
          <Rank key="r" n={p.rank} />,
          sub(p.title, [POST_PLATFORM[p.platform] ?? p.platform, p.type, p.publishedAt].filter(Boolean).join(" · ")),
          v(p.impressions, "number"),
          v(p.reach, "number"),
          <b key="e" className="font-semibold">{v(p.engagements, "number")}</b>,
          v(p.engagementRate, "percent"),
        ])}
      />
      <p className="text-[11px] text-muted">{t.criteria.posts}</p>
      <h3 className="pt-3 text-xs font-semibold">Páginas do website</h3>
      <T
        headers={["#", "Página", "Cliques", "Impressões", "CTR", "Posição"]}
        align={["l", "l"]}
        rows={t.pages.map((p) => [<Rank key="r" n={p.rank} />, <span key="u" className="block max-w-[380px] truncate">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</span>, <b key="c" className="font-semibold">{v(p.clicks, "number")}</b>, v(p.impressions, "number"), v(p.ctr, "percent"), v(p.position, "position")])}
      />
      <p className="text-[11px] text-muted">{t.criteria.pages}</p>
    </>
  );
}

export function ReportView({ d, title }: { d: ReportData; title: string }) {
  const f = d.fmt;
  const has = (k: string) => d.sections.includes(k as never);
  const v = (x: number | null, u: Unit) => formatValue(x, u, f);
  const sim = d.origin === "SIMULATED" || d.origin === "MIXED";
  const all = [...d.kpis.paid, ...d.kpis.seo, ...d.kpis.web];
  const pick = (keys: string[]) => keys.map((k) => all.find((x) => x.key === k)).filter((x): x is Kpi => Boolean(x));
  const compared = Boolean(d.compare);
  const pm = d.platformMetrics ?? [];
  const Section = ({ k, eyebrow, children }: { k: string; eyebrow?: React.ReactNode; children: React.ReactNode }) =>
    has(k) ? (
      <section className="mt-9 first:mt-0">
        {eyebrow && <div className="mb-1 flex items-center gap-2 text-xs text-muted">{eyebrow}</div>}
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{sectionLabel(k)}</h2>
        <div className="space-y-3">{children}</div>
        {d.comments[k] && (
          <p className="mt-3 border-l-2 border-fg pl-3 text-[12.5px] text-fg-2">
            <span className="font-medium text-fg">Comentário do gestor: </span>
            {d.comments[k]}
          </p>
        )}
      </section>
    ) : null;
  const ent = (rows: Ent[]) => (
    <T
      headers={["Nome", "Canal", "Investimento", "Cliques", "CTR", "Conversões", "CPA", "ROAS"]}
      rows={rows.map((r) => [
        <span key="n" className="inline-flex items-center gap-2">
          <Dot tone={r.platform === "GOOGLE_ADS" ? "google" : "meta"} />
          {r.name}
        </span>,
        r.platform === "GOOGLE_ADS" ? "Google" : "Meta",
        v(r.cost, "currency"),
        v(r.clicks, "number"),
        v(r.ctr, "percent"),
        v(r.conversions, "number"),
        v(r.cpa, "currency"),
        v(r.roas, "multiplier"),
      ])}
    />
  );
  const recs = (items: Rec[]) =>
    items.length ? (
      <ul className="divide-y border-y">
        {items.map((r, i) => (
          <li key={i} className="break-inside-avoid py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{r.title}</span>
              <Badge variant={r.priority === 1 ? "bad" : r.priority === 2 ? "warn" : "neutral"}>{PRIORITY[r.priority] ?? r.priority}</Badge>
              <Badge>{CONF[r.confidence] ?? r.confidence}</Badge>
            </div>
            <p className="mt-1 text-[12.5px] text-fg-2">{r.explanation}</p>
            <p className="mt-0.5 text-[12.5px]">
              <span className="font-medium">Ação sugerida:</span> {r.action}
            </p>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-xs text-muted">Nada a assinalar no período.</p>
    );
  const chTotal = d.channels.filter((c) => c.cost !== null);
  const sum = (k: "cost" | "conversions" | "value") => (chTotal.some((c) => c[k] !== null) ? chTotal.reduce((s, c) => s + (c[k] ?? 0), 0) : null);
  const [tCost, tConv, tValue] = [sum("cost"), sum("conversions"), sum("value")];
  const stacked = d.spendSeries.length > 0 && "costGoogle" in d.spendSeries[0]! && pm.length > 1;

  return (
    <article className="mx-auto max-w-[860px] rounded-md border bg-surface px-12 pb-10 pt-11 text-[13px] print:max-w-none print:border-0 print:p-0">
      {has("cover") && (
        <header className="mb-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Initials name={d.client.name} size="sm" inverse />
              <div>
                <b>{d.client.name}</b>
                <div className="text-[11px] text-muted">Preparado por {d.agency.name}</div>
              </div>
            </div>
            {sim && <Badge variant="warn">Contém dados simulados</Badge>}
          </div>
          <p className="mt-9 text-muted">{title.replace(formatRange(d.period.start, d.period.end, f), "").replace(/[\s·–-]+$/, "") || "Relatório"}</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">{formatRange(d.period.start, d.period.end, f)}</h1>
          <p className="mt-1 text-muted">
            {d.compare ? `Evolução face ao último relatório (${formatRange(d.compare.start, d.compare.end, f)})` : "Primeiro relatório: sem comparação"} · valores em {f.currency} · gerado em {formatDay(d.generatedAt.slice(0, 10), f, "long")}
          </p>
          {d.client.objectives && <p className="mt-3 text-[12.5px] text-fg-2">Objetivos: {d.client.objectives}</p>}
        </header>
      )}
      {!has("cover") && sim && <p className="mb-6 text-xs font-medium text-warn">Contém dados simulados — gerado em modo de demonstração; não representa resultados reais.</p>}

      <Section k="summary">
        <div className="space-y-1.5 leading-relaxed text-fg-2">
          {d.executiveSummary.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      </Section>
      <Section k="highlights">
        <KpiRow kpis={pick(["cost", "conversionValue", "roas", "conversions", "cpa", "leads", "organicClicks", "sessions"])} fmt={f} />
      </Section>
      {d.compare && (
        <Section k="comparison">
          <T
            headers={["Métrica", "Atual", "Último relatório", "Variação"]}
            rows={all.filter((k) => k.delta.current !== null).map((k) => [k.label + (k.quality === "APPROX" ? " (aprox.)" : ""), v(k.delta.current, k.unit), v(k.delta.previous, k.unit), <span key="d" className={TONE[metricTone({ higherIsBetter: k.higherIsBetter, current: k.delta.current, previous: k.delta.previous, abs: k.delta.abs })]}>{metricChange({ unit: k.unit, current: k.delta.current, previous: k.delta.previous, pct: k.delta.pct }, f)}</span>])}
          />
        </Section>
      )}
      <Section k="goals">
        {d.goals.length ? (
          <T headers={["Objetivo", "Meta", "Resultado", "Estado"]} rows={d.goals.map((g) => [g.label, `${g.lowerIsBetter ? "≤" : "≥"} ${v(g.target, g.unit as Unit)}`, v(g.actual, g.unit as Unit), g.achieved === null ? <span key="s" className="text-muted">Sem dados</span> : <Badge key="s" variant={g.achieved ? "good" : "bad"}>{g.achieved ? "Cumprido" : "Não cumprido"}</Badge>])} />
        ) : (
          <p className="text-xs text-muted">Sem objetivos definidos para o período.</p>
        )}
      </Section>
      <Section k="overview">
        <T
          headers={["Canal", "Investimento", "Cliques", "Conversões", "Custo/conv.", "Receita", "ROAS", ...(compared ? ["Var. conv."] : [])]}
          rows={d.channels.map((c) => [
            <span key="c" className="inline-flex items-center gap-2">
              <Dot tone={c.key === "google" ? "google" : c.key === "meta" ? "meta" : "seo"} />
              {c.label}
            </span>,
            v(c.cost, "currency"),
            v(c.clicks, "number"),
            v(c.conversions, "number"),
            v(c.cpa, "currency"),
            v(c.value, "currency"),
            <b key="r" className="font-semibold">{v(c.roas, "multiplier")}</b>,
            ...(compared ? [formatDelta(c.conversionsDeltaPct, f)] : []),
          ])}
          foot={chTotal.length > 1 ? ["Total reportado (pago)", v(tCost, "currency"), "", v(tConv, "number"), v(tCost !== null && tConv ? tCost / tConv : null, "currency"), v(tValue, "currency"), v(tCost && tValue !== null ? tValue / tCost : null, "multiplier"), ...(compared ? [""] : [])] : undefined}
        />
        <p className="text-[11px] text-muted">Conversões e receitas são as reportadas por cada plataforma, com a respetiva atribuição; podem existir conversões contadas por ambas. {d.channels.map((c) => `${c.label}: ${c.note}.`).join(" ")}</p>
      </Section>
      <Section k="trends">
        <TimeSeriesChart
          data={d.spendSeries}
          fmt={f}
          granularity={d.spendSeries.length > 62 ? "week" : "day"}
          height={200}
          series={[
            ...(stacked
              ? [
                  { key: "costGoogle", label: "Google Ads", unit: "currency" as const, kind: "bar" as const, color: "var(--google)", stack: "c" },
                  { key: "costMeta", label: "Meta Ads", unit: "currency" as const, kind: "bar" as const, color: "var(--meta)", stack: "c" },
                ]
              : [{ key: "cost", label: "Investimento", unit: "currency" as const, kind: "bar" as const, color: "var(--fg-2)" }]),
            { key: "conversions", label: "Conversões (eixo dir.)", unit: "number", axis: "right", color: "var(--fg)" },
          ]}
        />
      </Section>
      <Section k="google" eyebrow={<><Dot tone="google" />Google Ads</>}>{ent([...d.topCampaigns, ...d.bottomCampaigns].filter((r, i, a) => r.platform === "GOOGLE_ADS" && a.findIndex((x) => x.id === r.id) === i))}</Section>
      {(["googleMetrics", "metaMetrics"] as const).map((k) => {
        const p = pm.find((x) => x.platform === (k === "googleMetrics" ? "GOOGLE_ADS" : "META_ADS"));
        if (!has(k)) return null;
        return (
          <Section key={k} k={k} eyebrow={<><Dot tone={k === "googleMetrics" ? "google" : "meta"} />{k === "googleMetrics" ? "Google Ads" : "Meta Ads"}</>}>
            {p ? (
              <>
                <p className="text-fg-2">{p.attribution}</p>
                <MetricTable p={p} fmt={f} compared={compared} />
                {p.unavailable.length > 0 && <p className="text-[11px] text-muted">Não disponível nesta conta: {p.unavailable.join(", ")}.</p>}
                <h3 className="pt-3 text-xs font-semibold">Campanhas</h3>
                <T
                  headers={["Campanha", "Investimento", "Impr.", "CTR", "Conv.", "CPA", "ROAS", p.platform === "GOOGLE_ADS" ? "Parcela impr." : "Freq.", ...(compared ? ["Δ CPA"] : [])]}
                  rows={p.campaigns.map((c) => [c.name, v(c.cost, "currency"), v(c.impressions, "number"), v(c.ctr, "percent"), v(c.conversions, "number"), v(c.cpa, "currency"), v(c.roas, "multiplier"), p.platform === "GOOGLE_ADS" ? v(c.searchImpressionShare, "percent") : v(c.frequency, "ratio"), ...(compared ? [<span key="d" className={c.cpaDeltaPct === null ? "text-muted" : c.cpaDeltaPct > 0.0005 ? "text-bad" : c.cpaDeltaPct < -0.0005 ? "text-good" : "text-muted"}>{formatDelta(c.cpaDeltaPct, f)}</span>] : [])])}
                />
              </>
            ) : (
              <p className="text-xs text-muted">{d.platformMetrics ? "Plataforma não ligada a este cliente — Não disponível." : "Relatório gerado antes desta secção existir. Recalcule para incluir todas as métricas."}</p>
            )}
          </Section>
        );
      })}
      <Section k="meta" eyebrow={<><Dot tone="meta" />Meta Ads</>}>{ent([...d.topCampaigns, ...d.bottomCampaigns].filter((r, i, a) => r.platform === "META_ADS" && a.findIndex((x) => x.id === r.id) === i))}</Section>
      {d.seo && (
        <Section k="seo" eyebrow={<><Dot tone="seo" />Google Search Console</>}>
          <KpiRow kpis={pick(["organicClicks", "organicImpressions", "organicCtr", "position"])} fmt={f} />
          <T headers={["Consulta", "Cliques", "Impressões", "CTR", "Posição", ...(compared ? ["Var. cliques"] : [])]} rows={d.seo.topQueries.map((q) => [q.key, v(q.clicks, "number"), v(q.impressions, "number"), v(q.ctr, "percent"), v(q.position, "position"), ...(compared ? [formatDelta(q.clicksDeltaPct, f)] : [])])} />
          {d.seo.declining.length > 0 && <p className="text-xs text-muted">Em queda: {d.seo.declining.map((q) => `«${q.key}» (${formatDelta(q.clicksDeltaPct, f)})`).join(", ")}</p>}
        </Section>
      )}
      <Section k="ads">{ent(d.topAds)}</Section>
      <Section k="topContent">
        {!d.topContent ? (
          <p className="text-xs text-muted">Relatório gerado antes desta secção existir. Recalcule para incluir o top 10.</p>
        ) : (
          <TopContentBlock t={d.topContent} v={v} />
        )}
      </Section>
      <Section k="creatives">
        <div className="grid gap-x-6 md:grid-cols-2">
          {d.topAds.filter((a) => a.creative).map((a) => (
            <div key={a.id} className="break-inside-avoid border-b py-2.5 text-xs">
              <p className="font-medium">{a.name}</p>
              {a.creative?.title && <p>{a.creative.title}</p>}
              {a.creative?.primaryText && <p className="line-clamp-3 text-fg-2">{a.creative.primaryText}</p>}
              <p className="tabular mt-1 text-[11px] text-muted">
                CTR {v(a.ctr, "percent")} · {v(a.conversions, "number")} conversões · CPA {v(a.cpa, "currency")}
              </p>
            </div>
          ))}
        </div>
        {d.organicContent.length > 0 && <T headers={["Conteúdo orgânico", "Plataforma", "Impressões", "Interações", "Taxa"]} rows={d.organicContent.map((o) => [o.title ?? "—", o.platform, v(o.impressions, "number"), v(o.engagements, "number"), v(o.engagementRate, "percent")])} />}
      </Section>
      <Section k="topCampaigns">{ent(d.topCampaigns)}</Section>
      <Section k="bottomCampaigns">{ent(d.bottomCampaigns)}</Section>
      <Section k="investment">
        <KpiRow kpis={pick(["cost", "cpc", "cpm", "roi"])} fmt={f} />
        {d.budgets.length > 0 && <T headers={["Orçamento", "Definido", "Investido", "Projeção", "Consumido", "Estado"]} rows={d.budgets.map((b) => [b.scope, v(b.amount, "currency"), v(b.spent, "currency"), v(b.projection, "currency"), v(b.pctConsumed, "percent"), b.status])} />}
      </Section>
      <Section k="conversions">
        <KpiRow kpis={pick(["conversions", "conversionRate", "leads", "cpl", "conversionValue", "roas"])} fmt={f} cols={3} />
      </Section>
      <Section k="opportunities">{recs(d.opportunities)}</Section>
      <Section k="problems">{recs(d.problems)}</Section>
      <Section k="recommendations">{recs(d.recommendations)}</Section>
      <Section k="actionPlan">
        <ol className="list-decimal space-y-1 pl-5">
          {d.actionPlan.map((r, i) => (
            <li key={i}>
              {r.action} <span className="text-muted">({r.status})</span>
            </li>
          ))}
          {!d.actionPlan.length && <li className="list-none text-muted">Sem ações prioritárias.</li>}
        </ol>
      </Section>
      <Section k="methodology">
        <T headers={["Métrica", "Fórmula", "Fonte", "Limitações"]} align={["l", "l", "l", "l"]} rows={d.methodology.map((m) => [m.label, m.formula ?? "Fornecido pela plataforma", <span key="s" className="text-[11px] text-muted">{m.source}</span>, <span key="l" className="text-[11px] text-muted">{m.limitation ?? "—"}</span>])} />
      </Section>
      <Section k="limitations">
        <ul className="list-disc space-y-1 pl-5 text-fg-2">
          {d.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Section>
      <footer className="mt-10 flex flex-wrap justify-between gap-2 border-t pt-3 text-[10.5px] text-muted">
        <span>
          {d.client.name} · {title}
          {sim && " · DADOS SIMULADOS"}
        </span>
        <span>
          Fontes: {d.channels.map((c) => c.label).join(", ") || "—"} · {d.generatedAt.slice(0, 16).replace("T", " ")} UTC
        </span>
      </footer>
    </article>
  );
}
