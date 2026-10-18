"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Calendar, ChevronDown, Loader2 } from "lucide-react";
import { comparePeriod, resolvePeriod, todayInTz, type PeriodPreset } from "@/lib/dates";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRESET_LABELS: Record<PeriodPreset, string> = {
  last7: "Últimos 7 dias",
  last14: "Últimos 14 dias",
  last30: "Últimos 30 dias",
  last90: "Últimos 90 dias",
  thisMonth: "Este mês",
  lastMonth: "Mês anterior",
  lastQuarter: "Trimestre anterior",
  thisYear: "Este ano",
  last365: "Últimos 12 meses",
  custom: "Personalizado",
};

const COMPARE = [
  { v: "previous", l: "Período anterior" },
  { v: "yoy", l: "Ano anterior" },
  { v: "none", l: "Sem comparação" },
] as const;

export interface FilterOptions {
  channels?: boolean;
  campaigns?: { id: string; name: string }[];
  devices?: boolean;
  countries?: string[];
}

function ChipSelect({ label, value, active, onChange, children, className }: { label: string; value: string; active: boolean; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("relative inline-flex h-[26px] items-center rounded-full border bg-surface pl-2.5 pr-6 text-xs font-[450] hover:border-border-strong", active ? "border-fg text-fg" : "text-fg-2", className)}>
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-full max-w-56 cursor-pointer appearance-none truncate bg-transparent outline-none">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted" />
    </label>
  );
}

export function FilterBar({ timezone, locale, options = {} }: { timezone: string; locale: string; options?: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const preset = (sp.get("period") as PeriodPreset) || "last30";
  const today = todayInTz(timezone);
  const period = resolvePeriod(PRESET_LABELS[preset] ? preset : "last30", today, { start: sp.get("start") ?? undefined, end: sp.get("end") ?? undefined });
  const compareMode = (sp.get("compare") as "previous" | "yoy" | "none") || "previous";
  const cmp = comparePeriod(period, compareMode);
  const fmt = { locale, currency: "EUR", timezone };

  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") q.delete(k);
      else q.set(k, v);
    }
    start(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <label className="relative inline-flex h-[30px] items-center gap-1.5 rounded-md border border-border-strong bg-surface pl-2.5 pr-7 text-[12.5px] font-medium hover:bg-surface-2">
        {pending ? <Loader2 className="size-3.5 animate-spin text-muted" /> : <Calendar className="size-3.5 text-muted" />}
        <select
          aria-label="Período"
          value={preset}
          onChange={(e) => set(e.target.value === "custom" ? { period: "custom", start: period.start, end: period.end } : { period: e.target.value, start: null, end: null })}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {Object.entries(PRESET_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="tabular">
          {formatDay(period.start, fmt)} – {formatDay(period.end, fmt)}
        </span>
        {cmp && (
          <span className="tabular font-[450] text-muted">
            vs {formatDay(cmp.start, fmt)} – {formatDay(cmp.end, fmt)}
          </span>
        )}
        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" />
      </label>
      {preset === "custom" && (
        <>
          <input aria-label="Data inicial" type="date" className="h-[30px] rounded-md border border-border-strong px-2 text-xs" value={period.start} max={today} onChange={(e) => e.target.value && set({ start: e.target.value })} />
          <input aria-label="Data final" type="date" className="h-[30px] rounded-md border border-border-strong px-2 text-xs" value={period.end} max={today} onChange={(e) => e.target.value && set({ end: e.target.value })} />
        </>
      )}
      <div role="group" aria-label="Comparação" className="inline-flex gap-0.5 rounded-md border border-border-strong bg-surface p-0.5">
        {COMPARE.map((c) => (
          <button
            key={c.v}
            type="button"
            aria-pressed={compareMode === c.v}
            onClick={() => set({ compare: c.v === "previous" ? null : c.v })}
            className={cn("h-6 rounded px-2 text-xs font-medium", compareMode === c.v ? "bg-hover text-fg" : "text-muted hover:text-fg")}
          >
            {c.l}
          </button>
        ))}
      </div>
      {options.channels && (
        <ChipSelect label="Canal" value={sp.get("channel") ?? "all"} active={!!sp.get("channel")} onChange={(v) => set({ channel: v })}>
          <option value="all">Todos os canais</option>
          <option value="google">Google Ads</option>
          <option value="meta">Meta Ads</option>
          <option value="seo">SEO</option>
        </ChipSelect>
      )}
      {options.campaigns && options.campaigns.length > 0 && (
        <ChipSelect label="Campanha" value={sp.get("campaign") ?? ""} active={!!sp.get("campaign")} onChange={(v) => set({ campaign: v || null })}>
          <option value="">Todas as campanhas</option>
          {options.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </ChipSelect>
      )}
      {options.devices && (
        <ChipSelect label="Dispositivo" value={sp.get("device") ?? ""} active={!!sp.get("device")} onChange={(v) => set({ device: v || null })}>
          <option value="">Dispositivo: todos</option>
          <option value="MOBILE">Telemóvel</option>
          <option value="DESKTOP">Computador</option>
          <option value="TABLET">Tablet</option>
        </ChipSelect>
      )}
      {options.countries && options.countries.length > 0 && (
        <ChipSelect label="País" value={sp.get("country") ?? ""} active={!!sp.get("country")} onChange={(v) => set({ country: v || null })}>
          <option value="">País: todos</option>
          {options.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </ChipSelect>
      )}
    </div>
  );
}
