export type Unit = "currency" | "number" | "percent" | "ratio" | "position" | "multiplier" | "duration";

export interface FormatContext {
  locale: string;
  currency: string;
  timezone: string;
}

export const DEFAULT_FORMAT: FormatContext = { locale: "pt-PT", currency: "EUR", timezone: "Europe/Lisbon" };

export const NOT_AVAILABLE = "Não disponível";

/** pt-PT só agrupa a partir de 5 dígitos por omissão; "always" alinha 1 004 com 10 004 nas tabelas. */
const GROUP = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;
/** Evita "-0,0" quando um valor negativo arredonda para zero. */
const SIGN = { signDisplay: "negative" } as unknown as Intl.NumberFormatOptions;
const COMPACT_FROM = 1_000_000;

export function formatValue(value: number | null | undefined, unit: Unit, ctx: FormatContext = DEFAULT_FORMAT, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  const { locale, currency } = ctx;
  const compact = opts.compact && Math.abs(value) >= COMPACT_FROM;
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat(locale, {
        ...GROUP,
        ...SIGN,
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
    case "percent":
    {
      const digits = Math.abs(value) < 0.1 ? 2 : 1;
      return new Intl.NumberFormat(locale, { ...SIGN, style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
    }
    case "ratio":
      return new Intl.NumberFormat(locale, { ...GROUP, ...SIGN, maximumFractionDigits: 2 }).format(value);
    case "multiplier":
      return `${new Intl.NumberFormat(locale, { ...SIGN, maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)}×`;
    case "position":
      return new Intl.NumberFormat(locale, { ...SIGN, maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
    case "duration": {
      const m = Math.floor(value / 60);
      const s = Math.round(value % 60);
      return `${m}m ${s}s`;
    }
    default:
      return new Intl.NumberFormat(locale, {
        ...GROUP,
        ...SIGN,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : Math.abs(value) < 100 && !Number.isInteger(value) ? 1 : 0,
      }).format(value);
  }
}

export function formatDelta(pct: number | null, ctx: FormatContext = DEFAULT_FORMAT): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const nf = new Intl.NumberFormat(ctx.locale, { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (Math.abs(pct) < 0.0005) return nf.format(0);
  return `${pct > 0 ? "+" : "−"}${nf.format(Math.abs(pct))}`;
}

/** Variação em pontos percentuais entre duas taxas (0..1). */
export function formatPp(cur: number | null, prev: number | null, ctx: FormatContext = DEFAULT_FORMAT): string {
  if (cur === null || prev === null) return "—";
  const d = (cur - prev) * 100;
  const nf = new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (Math.abs(d) < 0.05) return `${nf.format(0)} p.p.`;
  return `${d > 0 ? "+" : "−"}${nf.format(Math.abs(d))} p.p.`;
}

/** Datas de calendário (YYYY-MM-DD) — sem conversão de fuso. */
export function formatDay(d: string, ctx: FormatContext = DEFAULT_FORMAT, style: "short" | "long" | "month" = "short"): string {
  const dt = new Date(`${d}T12:00:00Z`);
  const o: Intl.DateTimeFormatOptions =
    style === "long"
      ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : style === "month"
        ? { month: "short", year: "numeric", timeZone: "UTC" }
        : { day: "2-digit", month: "short", timeZone: "UTC" };
  return new Intl.DateTimeFormat(ctx.locale, o).format(dt);
}

export function formatRange(start: string, end: string, ctx: FormatContext = DEFAULT_FORMAT): string {
  return `${formatDay(start, ctx, "long")} – ${formatDay(end, ctx, "long")}`;
}

/** Timestamps UTC apresentados no fuso do cliente. */
export function formatTimestamp(d: Date | string | null | undefined, ctx: FormatContext = DEFAULT_FORMAT): string {
  if (!d) return "Nunca";
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: ctx.timezone }).format(dt);
}

export function formatRelative(d: Date | string | null | undefined, ctx: FormatContext = DEFAULT_FORMAT, now = new Date()): string {
  if (!d) return "Nunca";
  const dt = typeof d === "string" ? new Date(d) : d;
  const diffMin = Math.round((dt.getTime() - now.getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(ctx.locale, { numeric: "auto" });
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 48) return rtf.format(diffH, "hour");
  return rtf.format(Math.round(diffH / 24), "day");
}
