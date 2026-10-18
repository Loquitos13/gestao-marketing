"use client";

import { Bar, CartesianGrid, Cell, ComposedChart, Line, Area, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart } from "recharts";
import { formatDay, formatValue, type FormatContext, type Unit } from "@/lib/format";

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const TICK = { fontSize: 10.5, fill: "var(--muted)" };
const TOOLTIP_STYLE = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, padding: "6px 10px", boxShadow: "none" };

export function Sparkline({ data, color = "var(--fg-2)" }: { data: (number | null)[]; color?: string }) {
  const points = data.map((i, k) => ({ i: k, v: i }));
  if (points.filter((p) => p.v !== null).length < 2) return <div className="h-7" />;
  return (
    <div className="h-7 w-full" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface SeriesDef {
  key: string;
  label: string;
  unit: Unit;
  kind?: "bar" | "line" | "area";
  axis?: "left" | "right";
  color?: string;
  /** Barras com o mesmo stack são empilhadas. */
  stack?: string;
  dashed?: boolean;
}

function tickLabel(v: string, granularity: string, fmt: FormatContext) {
  if (granularity === "month") return formatDay(`${v.slice(0, 7)}-01`, fmt, "month");
  return formatDay(v, fmt);
}

export function ChartLegend({ series }: { series: Pick<SeriesDef, "label" | "kind" | "color" | "dashed">[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5 text-xs text-fg-2">
      {series.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          {s.kind === "bar" ? (
            <span className="size-2 rounded-[2px]" style={{ background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
          ) : (
            <span className="h-[2px] w-2.5 rounded" style={{ background: s.dashed ? "transparent" : (s.color ?? CHART_COLORS[i % CHART_COLORS.length]), borderTop: s.dashed ? `2px dashed ${s.color ?? "var(--faint)"}` : undefined }} />
          )}
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function TimeSeriesChart({
  data,
  series,
  fmt,
  granularity = "day",
  height = 240,
  reversedRight = false,
  legend = true,
}: {
  data: Record<string, string | number | null>[];
  series: SeriesDef[];
  fmt: FormatContext;
  granularity?: string;
  height?: number;
  reversedRight?: boolean;
  legend?: boolean;
}) {
  if (!data.length) return <div className="grid place-items-center text-xs text-muted" style={{ height }}>Sem dados no período selecionado.</div>;
  const left = series.find((s) => (s.axis ?? "left") === "left");
  const right = series.find((s) => s.axis === "right");
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }));
  return (
    <div className="w-full">
      {legend && series.length > 1 && (
        <div className="mb-2 flex justify-end">
          <ChartLegend series={colored} />
        </div>
      )}
      <div style={{ height }} className="w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 6, right: right ? 0 : 8, bottom: 0, left: 0 }} barCategoryGap="35%">
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(v) => tickLabel(String(v), granularity, fmt)} tick={TICK} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} minTickGap={28} />
            <YAxis yAxisId="left" tick={TICK} axisLine={false} tickLine={false} width={58} tickFormatter={(v) => (left ? formatValue(Number(v), left.unit, fmt, { compact: true }) : String(v))} />
            {right && (
              <YAxis yAxisId="right" orientation="right" reversed={reversedRight} tick={TICK} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => formatValue(Number(v), right.unit, fmt, { compact: true })} />
            )}
            <Tooltip
              cursor={{ fill: "var(--hover)" }}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "var(--muted)", marginBottom: 2 }}
              labelFormatter={(v) => tickLabel(String(v), granularity, fmt)}
              formatter={(value, name) => {
                const s = series.find((x) => x.label === name);
                return [formatValue(value === null || value === undefined ? null : Number(value), s?.unit ?? "number", fmt), name];
              }}
            />
            {colored.map((s) => {
              const common = { dataKey: s.key, name: s.label, yAxisId: s.axis ?? "left", isAnimationActive: false };
              if (s.kind === "bar") return <Bar key={s.key} {...common} fill={s.color} stackId={s.stack} radius={s.stack ? 0 : [2, 2, 0, 0]} maxBarSize={18} />;
              if (s.kind === "area") return <Area key={s.key} {...common} type="monotone" stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={1.5} connectNulls />;
              return <Line key={s.key} {...common} type="monotone" stroke={s.color} strokeWidth={1.5} strokeDasharray={s.dashed ? "3 3" : undefined} dot={false} connectNulls />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DonutChart({ data, unit, fmt, height = 160 }: { data: { label: string; value: number; color?: string }[]; unit: Unit; fmt: FormatContext; height?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <div className="grid place-items-center text-xs text-muted" style={{ height }}>Sem dados.</div>;
  const color = (i: number) => data[i]?.color ?? CHART_COLORS[i % CHART_COLORS.length];
  return (
    <div className="flex items-center gap-5">
      <div style={{ height, width: height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={color(i)} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatValue(Number(v), unit, fmt)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="size-2 rounded-[2px]" style={{ background: color(i) }} />
            <span className="text-fg-2">{d.label}</span>
            <span className="tabular font-medium">{formatValue(d.value, unit, fmt)}</span>
            <span className="tabular text-muted">{formatValue(d.value / total, "percent", fmt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
