import React from "react";
import { Polyline, Rect, StyleSheet, Svg, Text, View, Line } from "@react-pdf/renderer";
import { formatDelta, formatValue, type FormatContext, type Unit } from "@/lib/format";

/** As fontes PDF padrão (WinAnsi) não suportam todos os caracteres Unicode. */
export function pdfSafe(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\u202F\u2009\u2007]/g, " ")
    .replace(/→/g, "->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/Δ/g, "Var. ")
    .replace(/\u2212/g, "-")
    .replace(/Σ/g, "soma ")
    .replace(/≠/g, "diferente de")
    .replace(/[^\u0000-\u00FF€“”‘’–—…•]/gu, "");
}

export const C = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  soft: "#f8fafc",
  good: "#047857",
  bad: "#b91c1c",
  warn: "#b45309",
};

export const s = StyleSheet.create({
  page: { paddingTop: 56, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9, color: C.ink, fontFamily: "Helvetica", lineHeight: 1.4 },
  header: { position: "absolute", top: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.muted, borderBottomWidth: 0.5, borderBottomColor: C.line, paddingBottom: 6 },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 6 },
  p: { marginBottom: 4 },
  muted: { color: C.muted },
  row: { flexDirection: "row" },
  card: { borderWidth: 0.5, borderColor: C.line, borderRadius: 4, padding: 8, marginRight: 6, marginBottom: 6, backgroundColor: "#ffffff" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: C.muted, paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 0.75, borderBottomColor: C.line },
  td: { fontSize: 8, paddingVertical: 3.5, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: C.line },
  note: { backgroundColor: "#fffbeb", borderLeftWidth: 2, borderLeftColor: C.warn, padding: 6, marginVertical: 6, fontSize: 8 },
  comment: { backgroundColor: "#eef2ff", borderLeftWidth: 2, borderLeftColor: "#4f46e5", padding: 6, marginVertical: 6, fontSize: 8.5 },
});

type PdfStyle = Extract<React.ComponentProps<typeof Text>, { render?: unknown }>["style"];

export function T({ children, style }: { children: React.ReactNode; style?: PdfStyle }) {
  const text = typeof children === "string" ? pdfSafe(children) : Array.isArray(children) ? children.map((c) => (typeof c === "string" ? pdfSafe(c) : c)) : children;
  return <Text style={style}>{text}</Text>;
}

export function KpiCard({ label, value, unit, prev, pct, higherIsBetter, fmt, width = "23%" }: { label: string; value: number | null; unit: Unit; prev: number | null; pct: number | null; higherIsBetter: boolean | null; fmt: FormatContext; width?: string }) {
  const good = pct === null || higherIsBetter === null ? null : (pct > 0) === higherIsBetter;
  return (
    <View style={[s.card, { width }]} wrap={false}>
      <T style={{ fontSize: 7.5, color: C.muted }}>{label}</T>
      <T style={{ fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 }}>{formatValue(value, unit, fmt, { compact: true })}</T>
      {prev !== null && (
        <View style={[s.row, { marginTop: 2 }]}>
          <T style={{ fontSize: 7.5, color: good === null ? C.muted : good ? C.good : C.bad }}>{formatDelta(pct, fmt)}</T>
          <T style={{ fontSize: 7, color: C.muted, marginLeft: 4 }}>{`último: ${formatValue(prev, unit, fmt, { compact: true })}`}</T>
        </View>
      )}
    </View>
  );
}

export function Table({ headers, rows, widths, align }: { headers: string[]; rows: (string | number)[][]; widths: number[]; align?: ("left" | "right")[] }) {
  return (
    <View>
      <View style={s.row} fixed={false}>
        {headers.map((h, i) => (
          <T key={i} style={[s.th, { width: `${widths[i]}%`, textAlign: align?.[i] ?? (i === 0 ? "left" : "right") }]}>
            {h}
          </T>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.row, ri % 2 ? { backgroundColor: C.soft } : {}]} wrap={false}>
          {r.map((c, i) => (
            <T key={i} style={[s.td, { width: `${widths[i]}%`, textAlign: align?.[i] ?? (i === 0 ? "left" : "right") }]}>
              {String(c)}
            </T>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Gráfico de barras + linha (investimento vs conversões) em SVG vetorial. */
export function BarLineChart({ data, color, fmt, height = 120 }: { data: { label: string; bar: number; line: number }[]; color: string; fmt: FormatContext; height?: number }) {
  const W = 515;
  const H = height;
  const pad = { l: 30, r: 30, t: 8, b: 16 };
  if (!data.length) return <T style={s.muted}>Sem dados no período.</T>;
  const maxBar = Math.max(...data.map((d) => d.bar), 1);
  const maxLine = Math.max(...data.map((d) => d.line), 1);
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number, m: number) => pad.t + (H - pad.t - pad.b) * (1 - v / m);
  const points = data.map((d, i) => `${pad.l + bw * i + bw / 2},${y(d.line, maxLine)}`).join(" ");
  const step = Math.ceil(data.length / 8);
  return (
    <View wrap={false}>
      <Svg width={W} height={H}>
        <Line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke={C.line} strokeWidth={0.75} />
        {data.map((d, i) => (
          <Rect key={i} x={pad.l + bw * i + bw * 0.15} y={y(d.bar, maxBar)} width={bw * 0.7} height={H - pad.b - y(d.bar, maxBar)} fill={color} opacity={0.35} />
        ))}
        <Polyline points={points} stroke={color} strokeWidth={1.5} fill="none" />
        {data.map((d, i) =>
          i % step === 0 ? (
            <Text key={`l${i}`} x={pad.l + bw * i + bw / 2} y={H - 4} style={{ fontSize: 6, fill: C.muted }} textAnchor="middle">
              {d.label}
            </Text>
          ) : null,
        )}
        <Text x={2} y={pad.t + 6} style={{ fontSize: 6, fill: C.muted }}>
          {pdfSafe(formatValue(maxBar, "currency", fmt, { compact: true }))}
        </Text>
        <Text x={W - 28} y={pad.t + 6} style={{ fontSize: 6, fill: C.muted }}>
          {pdfSafe(formatValue(maxLine, "number", fmt, { compact: true }))}
        </Text>
      </Svg>
      <View style={[s.row, { marginTop: 2 }]}>
        <T style={{ fontSize: 7, color: C.muted }}>{"Barras: investimento  ·  Linha: conversões"}</T>
      </View>
    </View>
  );
}

export function HBar({ items, color, fmt, unit }: { items: { label: string; value: number }[]; color: string; fmt: FormatContext; unit: Unit }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={[s.row, { alignItems: "center", marginBottom: 3 }]} wrap={false}>
          <T style={{ width: "34%", fontSize: 7.5 }}>{it.label}</T>
          <View style={{ width: "50%", height: 7, backgroundColor: C.soft }}>
            <View style={{ width: `${(it.value / max) * 100}%`, height: 7, backgroundColor: color }} />
          </View>
          <T style={{ width: "16%", fontSize: 7.5, textAlign: "right" }}>{formatValue(it.value, unit, fmt, { compact: true })}</T>
        </View>
      ))}
    </View>
  );
}
