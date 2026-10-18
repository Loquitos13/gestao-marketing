import React from "react";
import { Document, Page, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDay, formatRange, formatValue, formatDelta } from "@/lib/format";
import type { ReportData } from "./build";
import { sectionLabel } from "./sections";
import { metricChange } from "./platform-metrics";
import { BarLineChart, C, HBar, KpiCard, s, T, Table } from "./pdf-parts";

const PRIORITY = { 1: "Alta", 2: "Média", 3: "Baixa" } as Record<number, string>;
const CONF = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" } as Record<string, string>;
const h3 = { fontFamily: "Helvetica-Bold", fontSize: 9, marginTop: 8, marginBottom: 4 };
const SRC = { RULE: "Regra determinística", STATISTICAL: "Projeção estatística", AI: "Modelo de IA" } as Record<string, string>;

function ReportPdf({ d, title }: { d: ReportData; title: string }) {
  const f = d.fmt;
  const brand = d.agency.brandColor || "#4f46e5";
  const has = (k: string) => d.sections.includes(k as never);
  const simulated = d.origin === "SIMULATED" || d.origin === "MIXED";
  const money = (v: number | null) => formatValue(v, "currency", f);
  const nmb = (v: number | null) => formatValue(v, "number", f);
  const pct = (v: number | null) => formatValue(v, "percent", f);
  const Comment = ({ k }: { k: string }) => (d.comments[k] ? <T style={s.comment}>{`Comentário do gestor: ${d.comments[k]}`}</T> : null);
  const H2 = ({ k }: { k: string }) => (
    <View minPresenceAhead={60}>
      <T style={s.h2}>{sectionLabel(k)}</T>
    </View>
  );
  const kpi = (key: string, list = [...d.kpis.paid, ...d.kpis.seo, ...d.kpis.web]) => list.find((x) => x.key === key);
  const Kpis = ({ keys }: { keys: string[] }) => (
    <View style={[s.row, { flexWrap: "wrap" }]}>
      {keys
        .map((k) => kpi(k))
        .filter(Boolean)
        .map((k) => (
          <KpiCard key={k!.key} label={k!.label} value={k!.delta.current} unit={k!.unit} prev={k!.delta.previous} pct={k!.delta.pct} higherIsBetter={k!.higherIsBetter} fmt={f} />
        ))}
    </View>
  );
  const entityRows = (rows: ReportData["topCampaigns"]) =>
    rows.map((r) => [r.name, r.platform === "GOOGLE_ADS" ? "Google" : "Meta", money(r.cost), nmb(r.clicks), pct(r.ctr), formatValue(r.conversions, "number", f), money(r.cpa), formatValue(r.roas, "multiplier", f)]);
  const entHead = ["Nome", "Canal", "Invest.", "Cliques", "CTR", "Conv.", "CPA", "ROAS"];
  const entW = [34, 8, 11, 9, 8, 9, 11, 10];
  const Recs = ({ items }: { items: ReportData["recommendations"] }) =>
    items.length ? (
      <View>
        {items.map((r, i) => (
          <View key={i} style={[s.card, { marginRight: 0 }]} wrap={false}>
            <T style={{ fontFamily: "Helvetica-Bold", fontSize: 9 }}>{r.title}</T>
            <T style={[s.p, { marginTop: 2 }]}>{r.explanation}</T>
            <T style={{ fontSize: 8.5 }}>{`Ação sugerida: ${r.action}`}</T>
            <T style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>{`Prioridade ${PRIORITY[r.priority] ?? r.priority} · Confiança ${CONF[r.confidence] ?? r.confidence} · ${SRC[r.source] ?? r.source} · Estado: ${r.status}`}</T>
          </View>
        ))}
      </View>
    ) : (
      <T style={s.muted}>Nada a assinalar no período.</T>
    );

  return (
    <Document title={title} author={d.agency.name} creator="Marketing Intelligence Hub">
      {has("cover") && (
        <Page size="A4" style={{ padding: 0, fontFamily: "Helvetica" }}>
          <View style={{ height: 260, padding: 48, justifyContent: "flex-end", borderBottomWidth: 1, borderBottomColor: "#e7e7ea" }}>
            <View style={{ width: 28, height: 3, backgroundColor: brand, marginBottom: 16 }} />
            <T style={{ color: C.muted, fontSize: 10 }}>{`${d.agency.name} · ${title}`}</T>
            <T style={{ color: "#17171a", fontSize: 26, fontFamily: "Helvetica-Bold", marginTop: 8 }}>{d.client.name}</T>
            <T style={{ color: "#4d4d55", fontSize: 12, marginTop: 6 }}>{formatRange(d.period.start, d.period.end, f)}</T>
          </View>
          <View style={{ padding: 48 }}>
            <T style={{ fontSize: 11 }}>{`Período analisado: ${formatRange(d.period.start, d.period.end, f)}`}</T>
            <T style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{d.compare ? `Evolução face ao último relatório: ${formatRange(d.compare.start, d.compare.end, f)}` : "Primeiro relatório: sem comparação."}</T>
            <T style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{`Gerado em ${formatDay(d.generatedAt.slice(0, 10), f, "long")}`}</T>
            {d.client.objectives && <T style={{ marginTop: 24, fontSize: 10 }}>{`Objetivos: ${d.client.objectives}`}</T>}
            {simulated && <T style={[s.note, { marginTop: 24, fontSize: 10 }]}>{"DADOS SIMULADOS — este relatório foi gerado em modo de demonstração e não representa resultados reais."}</T>}
          </View>
        </Page>
      )}
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <T>{`${d.client.name} · ${title}`}</T>
          <T>{simulated ? "DADOS SIMULADOS" : d.agency.name}</T>
        </View>
        <View style={s.footer} fixed>
          <T>{`Fontes: ${d.channels.map((c) => c.label).join(", ") || "—"} · Gerado em ${d.generatedAt.slice(0, 10)}`}</T>
        </View>

        {has("summary") && (
          <View>
            <T style={s.h1}>{sectionLabel("summary")}</T>
            {d.executiveSummary.map((l, i) => (
              <T key={i} style={s.p}>{`• ${l}`}</T>
            ))}
            <Comment k="summary" />
          </View>
        )}
        {has("highlights") && (
          <View>
            <H2 k="highlights" />
            <Kpis keys={["cost", "conversions", "cpa", "roas", "leads", "cpl", "organicClicks", "sessions"]} />
            <Comment k="highlights" />
          </View>
        )}
        {has("comparison") && d.compare && (
          <View>
            <H2 k="comparison" />
            <Table
              headers={["Métrica", "Atual", "Último relatório", "Variação"]}
              widths={[40, 20, 20, 20]}
              rows={[...d.kpis.paid, ...d.kpis.seo, ...d.kpis.web]
                .filter((k) => k.delta.current !== null)
                .map((k) => [k.label + (k.quality === "APPROX" ? " (aprox.)" : ""), formatValue(k.delta.current, k.unit, f), formatValue(k.delta.previous, k.unit, f), formatDelta(k.delta.pct, f)])}
            />
            <Comment k="comparison" />
          </View>
        )}
        {has("goals") && (
          <View>
            <H2 k="goals" />
            {d.goals.length ? (
              <Table
                headers={["Objetivo", "Meta", "Resultado", "Estado"]}
                widths={[40, 20, 20, 20]}
                rows={d.goals.map((g) => [g.label, formatValue(g.target, g.unit as never, f), formatValue(g.actual, g.unit as never, f), g.achieved === null ? "Sem dados" : g.achieved ? "Cumprido" : "Não cumprido"])}
              />
            ) : (
              <T style={s.muted}>Não foram definidos objetivos para este período.</T>
            )}
            <Comment k="goals" />
          </View>
        )}
        {has("overview") && (
          <View>
            <H2 k="overview" />
            <Table
              headers={d.compare ? ["Canal", "Investimento", "Cliques", "Conversões", "CPA", "ROAS", "Var. conv."] : ["Canal", "Investimento", "Cliques", "Conversões", "CPA", "ROAS"]}
              widths={d.compare ? [24, 14, 12, 12, 12, 12, 14] : [28, 16, 14, 14, 14, 14]}
              rows={d.channels.map((c) => [c.label, money(c.cost), nmb(c.clicks), formatValue(c.conversions, "number", f), money(c.cpa), formatValue(c.roas, "multiplier", f), ...(d.compare ? [formatDelta(c.conversionsDeltaPct, f)] : [])])}
            />
            <T style={[s.muted, { fontSize: 7.5, marginTop: 4 }]}>{d.channels.map((c) => `${c.label}: ${c.note}`).join(" · ")}</T>
            <Comment k="overview" />
          </View>
        )}
        {has("trends") && (
          <View>
            <H2 k="trends" />
            <BarLineChart data={d.spendSeries.map((x) => ({ label: formatDay(x.date, f), bar: x.cost, line: x.conversions }))} color={brand} fmt={f} />
            <Comment k="trends" />
          </View>
        )}
        {(["google", "meta"] as const).map((ch) =>
          has(ch) && d.channels.find((c) => c.key === ch) ? (
            <View key={ch}>
              <H2 k={ch} />
              <Table headers={entHead} widths={entW} rows={entityRows([...d.topCampaigns, ...d.bottomCampaigns].filter((r, i, a) => r.platform === (ch === "google" ? "GOOGLE_ADS" : "META_ADS") && a.findIndex((x) => x.id === r.id) === i))} />
              <Comment k={ch} />
            </View>
          ) : null,
        )}
        {(["googleMetrics", "metaMetrics"] as const).map((k) => {
          const p = (d.platformMetrics ?? []).find((x) => x.platform === (k === "googleMetrics" ? "GOOGLE_ADS" : "META_ADS"));
          if (!has(k) || !p) return null;
          return (
            <View key={k} break>
              <H2 k={k} />
              <T style={[s.muted, { marginBottom: 6 }]}>{p.attribution}</T>
              {p.groups.map((g) => (
                <View key={g.label} style={{ marginBottom: 6 }}>
                  <View minPresenceAhead={50}>
                    <T style={{ fontFamily: "Helvetica-Bold", fontSize: 8, color: C.muted, marginBottom: 2 }}>{g.label}</T>
                  </View>
                  <Table
                    headers={d.compare ? ["Métrica", "Atual", "Último relatório", "Variação", "Fonte / fórmula"] : ["Métrica", "Atual", "Fonte / fórmula"]}
                    widths={d.compare ? [30, 14, 14, 12, 30] : [40, 20, 40]}
                    align={d.compare ? ["left", "right", "right", "right", "left"] : ["left", "right", "left"]}
                    rows={g.rows.map((r) => [r.label + (r.note ? " *" : ""), formatValue(r.current, r.unit, f), ...(d.compare ? [formatValue(r.previous, r.unit, f), r.previous === null ? "—" : metricChange(r, f)] : []), r.source])}
                  />
                </View>
              ))}
              {p.groups.some((g) => g.rows.some((r) => r.note)) && (
                <T style={[s.muted, { fontSize: 7 }]}>{`* ${[...new Set(p.groups.flatMap((g) => g.rows.map((r) => r.note).filter(Boolean)))].join(" ")}`}</T>
              )}
              {p.unavailable.length > 0 && <T style={[s.muted, { fontSize: 7.5 }]}>{`Não disponível nesta conta: ${p.unavailable.join(", ")}.`}</T>}
              <T style={{ fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 }}>Campanhas</T>
              <Table
                headers={["Campanha", "Invest.", "Impr.", "CTR", "Conv.", "CPA", "ROAS", p.platform === "GOOGLE_ADS" ? "Parc. impr." : "Freq."]}
                widths={[30, 11, 11, 8, 9, 10, 9, 12]}
                rows={p.campaigns.map((c) => [c.name, money(c.cost), nmb(c.impressions), pct(c.ctr), formatValue(c.conversions, "number", f), money(c.cpa), formatValue(c.roas, "multiplier", f), p.platform === "GOOGLE_ADS" ? pct(c.searchImpressionShare) : formatValue(c.frequency, "ratio", f)])}
              />
              <Comment k={k} />
            </View>
          );
        })}
        {has("seo") && d.seo && (
          <View>
            <H2 k="seo" />
            <Kpis keys={["organicClicks", "organicImpressions", "organicCtr", "position"]} />
            <T style={{ fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 2 }}>Consultas com mais cliques</T>
            <Table
              headers={d.compare ? ["Consulta", "Cliques", "Impressões", "CTR", "Posição", "Var. cliques"] : ["Consulta", "Cliques", "Impressões", "CTR", "Posição"]}
              widths={d.compare ? [40, 12, 14, 10, 10, 14] : [46, 14, 16, 12, 12]}
              rows={d.seo.topQueries.map((q) => [q.key, nmb(q.clicks), nmb(q.impressions), pct(q.ctr), formatValue(q.position, "position", f), ...(d.compare ? [formatDelta(q.clicksDeltaPct, f)] : [])])}
            />
            {d.seo.declining.length > 0 && (
              <View>
                <T style={{ fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 }}>Consultas em queda</T>
                <HBar items={d.seo.declining.map((q) => ({ label: q.key, value: q.clicks }))} color={C.bad} fmt={f} unit="number" />
              </View>
            )}
            <Comment k="seo" />
          </View>
        )}
        {has("ads") && (
          <View>
            <H2 k="ads" />
            <Table headers={entHead} widths={entW} rows={entityRows(d.topAds)} />
            {d.bottomAds.length > 0 && (
              <View>
                <T style={{ fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 }}>Anúncios com custo elevado e baixo retorno</T>
                <Table headers={entHead} widths={entW} rows={entityRows(d.bottomAds)} />
              </View>
            )}
            <Comment k="ads" />
          </View>
        )}
        {has("topContent") && (
          <View>
            <H2 k="topContent" />
            {!d.topContent ? (
              <T style={s.muted}>Relatório gerado antes desta secção existir. Recalcule para incluir o top 10.</T>
            ) : (
              <>
                <T style={h3}>Anúncios</T>
                <Table
                  headers={["#", "Anúncio", "Canal", "Impr.", "Cliques", "CTR", "Conv.", "CPA"]}
                  widths={[5, 37, 8, 10, 10, 9, 9, 12]}
                  rows={d.topContent.ads.map((a) => [String(a.rank), a.headline ? `${a.name} — ${a.headline}` : a.name, a.platform === "GOOGLE_ADS" ? "Google" : "Meta", nmb(a.impressions), nmb(a.clicks), pct(a.ctr), nmb(a.conversions), money(a.cpa)])}
                />
                <T style={s.muted}>{d.topContent.criteria.ads}</T>
                <T style={h3}>Publicações orgânicas</T>
                <Table
                  headers={["#", "Publicação", "Plataforma", "Impr.", "Interações", "Taxa"]}
                  widths={[5, 47, 12, 12, 12, 12]}
                  rows={d.topContent.posts.map((p) => [String(p.rank), p.title, p.platform, nmb(p.impressions), nmb(p.engagements), pct(p.engagementRate)])}
                />
                <T style={s.muted}>{d.topContent.criteria.posts}</T>
                <T style={h3}>Páginas do website</T>
                <Table
                  headers={["#", "Página", "Cliques", "Impr.", "CTR", "Posição"]}
                  widths={[5, 51, 11, 12, 10, 11]}
                  rows={d.topContent.pages.map((p) => [String(p.rank), p.url.replace(/^https?:\/\/(www\.)?/, ""), nmb(p.clicks), nmb(p.impressions), pct(p.ctr), formatValue(p.position, "position", f)])}
                />
                <T style={s.muted}>{d.topContent.criteria.pages}</T>
              </>
            )}
            <Comment k="topContent" />
          </View>
        )}
        {has("creatives") && (
          <View>
            <H2 k="creatives" />
            {d.topAds.filter((a) => a.creative).map((a) => (
              <View key={a.id} style={[s.card, { marginRight: 0 }]} wrap={false}>
                <T style={{ fontFamily: "Helvetica-Bold" }}>{`${a.name} · ${a.creative?.format ?? ""}`}</T>
                {a.creative?.title && <T>{`Título: ${a.creative.title}`}</T>}
                {a.creative?.primaryText && <T style={s.muted}>{a.creative.primaryText}</T>}
                <T style={{ fontSize: 7.5, marginTop: 2 }}>{`Investimento ${money(a.cost)} · CTR ${pct(a.ctr)} · Conversões ${formatValue(a.conversions, "number", f)} · CPA ${money(a.cpa)}`}</T>
              </View>
            ))}
            {d.organicContent.length > 0 && (
              <Table
                headers={["Conteúdo orgânico", "Plataforma", "Impressões", "Interações", "Taxa engagement"]}
                widths={[40, 15, 15, 15, 15]}
                rows={d.organicContent.map((o) => [o.title ?? "—", o.platform, formatValue(o.impressions, "number", f), nmb(o.engagements), pct(o.engagementRate)])}
              />
            )}
            <Comment k="creatives" />
          </View>
        )}
        {has("topCampaigns") && (
          <View>
            <H2 k="topCampaigns" />
            <Table headers={entHead} widths={entW} rows={entityRows(d.topCampaigns)} />
            <Comment k="topCampaigns" />
          </View>
        )}
        {has("bottomCampaigns") && (
          <View>
            <H2 k="bottomCampaigns" />
            <Table headers={entHead} widths={entW} rows={entityRows(d.bottomCampaigns)} />
            <Comment k="bottomCampaigns" />
          </View>
        )}
        {has("investment") && (
          <View>
            <H2 k="investment" />
            <Kpis keys={["cost", "costGoogle", "costMeta", "cpc", "cpm", "roi"]} />
            {d.budgets.length > 0 && (
              <Table
                headers={["Orçamento", "Definido", "Investido", "Projeção", "Consumido", "Estado"]}
                widths={[26, 15, 15, 15, 14, 15]}
                rows={d.budgets.map((b) => [b.scope, money(b.amount), money(b.spent), money(b.projection), pct(b.pctConsumed), b.status])}
              />
            )}
            <Comment k="investment" />
          </View>
        )}
        {has("conversions") && (
          <View>
            <H2 k="conversions" />
            <Kpis keys={["conversions", "conversionRate", "leads", "cpl", "conversionValue", "roas"]} />
            <Comment k="conversions" />
          </View>
        )}
        {has("opportunities") && (
          <View>
            <H2 k="opportunities" />
            <Recs items={d.opportunities} />
            <Comment k="opportunities" />
          </View>
        )}
        {has("problems") && (
          <View>
            <H2 k="problems" />
            <Recs items={d.problems} />
            <Comment k="problems" />
          </View>
        )}
        {has("recommendations") && (
          <View>
            <H2 k="recommendations" />
            <Recs items={d.recommendations} />
            <Comment k="recommendations" />
          </View>
        )}
        {has("actionPlan") && (
          <View>
            <H2 k="actionPlan" />
            {d.actionPlan.length ? (
              <Table headers={["#", "Ação", "Prioridade", "Estado"]} widths={[6, 64, 15, 15]} align={["left", "left", "right", "right"]} rows={d.actionPlan.map((r, i) => [i + 1, r.action, PRIORITY[r.priority] ?? "", r.status])} />
            ) : (
              <T style={s.muted}>Sem ações prioritárias registadas.</T>
            )}
            <Comment k="actionPlan" />
          </View>
        )}
        {has("methodology") && (
          <View>
            <H2 k="methodology" />
            <Table headers={["Métrica", "Fórmula", "Fonte"]} widths={[22, 38, 40]} align={["left", "left", "left"]} rows={d.methodology.map((m) => [m.label, m.formula ?? "Fornecido pela plataforma", m.source])} />
          </View>
        )}
        {has("limitations") && (
          <View>
            <H2 k="limitations" />
            {d.limitations.map((l, i) => (
              <T key={i} style={s.p}>{`• ${l}`}</T>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderReportPdf(d: ReportData, title: string): Promise<Buffer> {
  return renderToBuffer(<ReportPdf d={d} title={title} />);
}
