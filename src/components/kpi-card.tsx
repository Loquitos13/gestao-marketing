import { formatDelta, formatPp, formatValue, NOT_AVAILABLE, type FormatContext } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Kpi } from "@/server/queries/dashboard";
import { InfoTip } from "./tooltip";
import { DeltaText, QualityBadge } from "./ui";

export function SparkLine({ data, className, color = "var(--fg-2)" }: { data: (number | null)[]; className?: string; color?: string }) {
  const pts = data.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <div className={cn("h-[26px]", className)} />;
  const vals = pts.map((p) => p[1]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 100;
  const h = 26;
  const n = data.length - 1 || 1;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${((i / n) * w).toFixed(2)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(2)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("block h-[26px] w-full", className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function KpiInfo({ kpi }: { kpi: Kpi }) {
  return (
    <InfoTip
      content={
        <div className="space-y-1.5">
          <p>{kpi.description}</p>
          {kpi.formula && (
            <p>
              <span className="text-muted">Fórmula: </span>
              {kpi.formula}
            </p>
          )}
          <p>
            <span className="text-muted">Fonte: </span>
            {kpi.source || "—"}
          </p>
          {kpi.note && <p className="text-warn">{kpi.note}</p>}
          {kpi.origin === "SIMULATED" && <p className="text-warn">Dados simulados (demonstração).</p>}
        </div>
      }
    />
  );
}

export function KpiTile({ kpi, fmt, compareLabel, spark = true }: { kpi: Kpi; fmt: FormatContext; compareLabel: string; spark?: boolean }) {
  const d = kpi.delta;
  const na = d.current === null;
  const isRate = kpi.unit === "percent";
  const deltaText = d.status === "unavailable" ? "—" : d.status === "new" ? "Novo" : isRate ? formatPp(d.current, d.previous, fmt) : formatDelta(d.pct, fmt);
  const pctForColor = isRate && d.current !== null && d.previous !== null ? d.current - d.previous : d.pct;
  return (
    <div className="min-w-0 border-b border-r px-4 pb-3 pt-3.5" data-kpi={kpi.key}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
        <span className="truncate">{kpi.label}</span>
        <KpiInfo kpi={kpi} />
      </div>
      {na ? (
        <div className="py-1 text-[15px] font-medium text-faint">{NOT_AVAILABLE}</div>
      ) : (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="tabular text-[22px] font-semibold leading-tight tracking-[-0.02em]">{formatValue(d.current, kpi.unit, fmt, { compact: true })}</span>
          <QualityBadge quality={kpi.quality} />
        </div>
      )}
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {!na && <DeltaText pct={pctForColor} higherIsBetter={kpi.higherIsBetter} text={deltaText} />}
        <span className="truncate">
          {compareLabel} {formatValue(d.previous, kpi.unit, fmt, { compact: true })}
        </span>
      </div>
      {spark && kpi.series.length > 1 && <SparkLine className="mt-2" data={kpi.series.map((s) => s.value)} />}
    </div>
  );
}

const COLS = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" } as const;

/** Faixa de KPIs: uma superfície dividida, com grupos opcionais. */
export function KpiStrip({ kpis, groups, fmt, compareLabel, cols = 6, spark = true }: { kpis?: Kpi[]; groups?: { label: string; kpis: Kpi[] }[]; fmt: FormatContext; compareLabel: string; cols?: keyof typeof COLS; spark?: boolean }) {
  const list = groups ?? [{ label: "", kpis: kpis ?? [] }];
  return (
    <div className="overflow-hidden rounded-lg border bg-surface">
      {list
        .filter((g) => g.kpis.length)
        .map((g, i) => (
          <div key={g.label || i} className={cn(i > 0 && "border-t")}>
            {g.label && <div className="border-b bg-surface-2 px-4 py-2 text-[11px] font-medium text-muted">{g.label}</div>}
            <div className={cn("-mb-px -mr-px grid grid-cols-2 md:grid-cols-3", COLS[cols])}>
              {g.kpis.map((k) => (
                <KpiTile key={k.key} kpi={k} fmt={fmt} compareLabel={compareLabel} spark={spark} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

/** Compatibilidade: grelha de KPIs como faixa. */
export function KpiGrid({ kpis, fmt, compareLabel, cols = 4 }: { kpis: Kpi[]; fmt: FormatContext; compareLabel: string; cols?: 3 | 4 | 5 | 6 }) {
  return <KpiStrip kpis={kpis} fmt={fmt} compareLabel={compareLabel} cols={cols} />;
}
