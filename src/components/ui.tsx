import Link from "next/link";
import { cn } from "@/lib/utils";

export function Card({ className, children, id }: { className?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("rounded-lg border bg-surface", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 border-b px-4 py-2.5", className)}>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {description && <span className="min-w-0 text-xs text-muted">{description}</span>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 flex items-baseline gap-2.5 first:mt-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <span className="text-xs text-muted">{description}</span>}
      {actions && <div className="ml-auto">{actions}</div>}
    </div>
  );
}

const BADGE = {
  neutral: "bg-hover text-fg-2",
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
} as const;
export type BadgeVariant = keyof typeof BADGE;

export function Badge({ variant = "neutral", children, className, title }: { variant?: BadgeVariant; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium", BADGE[variant], className)}>
      {children}
    </span>
  );
}

const ORIGIN: Record<string, { label: string; variant: BadgeVariant; title: string }> = {
  REAL: { label: "Dados reais", variant: "good", title: "Dados obtidos das APIs oficiais das plataformas." },
  SIMULATED: { label: "Dados simulados", variant: "warn", title: "Dados fictícios gerados para demonstração. Não representam resultados reais." },
  MIXED: { label: "Real + simulado", variant: "warn", title: "Combina fontes reais e simuladas." },
  NONE: { label: "Sem fonte", variant: "neutral", title: "Nenhuma fonte de dados ligada." },
};

export function OriginBadge({ origin }: { origin: string }) {
  const o = ORIGIN[origin] ?? ORIGIN.NONE;
  return (
    <Badge variant={o.variant} title={o.title}>
      {o.label}
    </Badge>
  );
}

export function QualityBadge({ quality }: { quality: "OK" | "APPROX" | "UNAVAILABLE" | "ESTIMATE" | "INCOMPLETE" }) {
  if (quality === "OK") return null;
  const map = {
    APPROX: { label: "Aproximado", variant: "neutral" as const, title: "Valor calculado por aproximação (ver nota)." },
    UNAVAILABLE: { label: "Não disponível", variant: "neutral" as const, title: "A fonte não disponibiliza esta métrica para o filtro atual." },
    ESTIMATE: { label: "Estimativa", variant: "accent" as const, title: "Estimativa de ferramenta de terceiros; não é dado oficial." },
    INCOMPLETE: { label: "Incompleto", variant: "warn" as const, title: "O período inclui dias ainda não disponíveis na fonte." },
  };
  const m = map[quality];
  return (
    <Badge variant={m.variant} title={m.title}>
      {m.label}
    </Badge>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ variant = "warn", children }: { variant?: "warn" | "bad" | "accent" | "neutral"; children: React.ReactNode }) {
  const c = { warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", accent: "bg-accent-soft text-accent", neutral: "bg-hover text-fg-2" }[variant];
  return <div className={cn("rounded-md px-3 py-2 text-xs", c)}>{children}</div>;
}

export const buttonClass = (variant: "primary" | "secondary" | "ghost" | "danger" = "secondary", size: "sm" | "md" = "md") =>
  cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    size === "sm" ? "h-[26px] px-2 text-xs" : "h-[30px] px-2.5 text-[12.5px]",
    variant === "primary" && "border-inverse bg-inverse text-inverse-fg hover:opacity-90",
    variant === "secondary" && "border-border-strong bg-surface hover:bg-surface-2",
    variant === "ghost" && "border-transparent text-fg-2 hover:bg-hover hover:text-fg",
    variant === "danger" && "border-bad/30 bg-bad-soft text-bad hover:border-bad/50",
  );

export function LinkButton({ href, children, variant, size, prefetch }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; prefetch?: boolean }) {
  return (
    <Link href={href} className={buttonClass(variant, size)} prefetch={prefetch}>
      {children}
    </Link>
  );
}

export const inputClass = "h-[30px] w-full rounded-md border border-border-strong bg-surface px-2.5 text-[12.5px] outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20";
export const labelClass = "mb-1 block text-xs font-medium text-fg-2";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function DeltaText({ pct, higherIsBetter, text }: { pct: number | null; higherIsBetter: boolean | null; text: string }) {
  const good = pct === null || Math.abs(pct) < 0.0005 || higherIsBetter === null ? null : pct > 0 === higherIsBetter;
  return <span className={cn("tabular text-xs font-medium", good === null ? "text-muted" : good ? "text-good" : "text-bad")}>{text}</span>;
}

export function Dot({ tone, className }: { tone: "google" | "meta" | "seo" | "on" | "off" | "err" | "warn"; className?: string }) {
  const c = { google: "bg-google", meta: "bg-meta", seo: "bg-seo", on: "bg-good", off: "bg-faint", err: "bg-bad", warn: "bg-warn" }[tone];
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-full", c, className)} />;
}

export function Initials({ name, size = "sm", inverse }: { name: string; size?: "xs" | "sm" | "lg"; inverse?: boolean }) {
  const ini = name
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const s = { xs: "size-[18px] rounded text-[9.5px]", sm: "size-[22px] rounded-[5px] text-[10px]", lg: "size-[34px] rounded-[7px] text-[13px]" }[size];
  return <span className={cn("grid shrink-0 place-items-center font-semibold", s, inverse ? "bg-inverse text-inverse-fg" : "border bg-surface text-fg-2")}>{ini || name.slice(0, 1)}</span>;
}
