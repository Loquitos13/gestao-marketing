import Link from "next/link";
import type { Recommendation } from "@prisma/client";
import { formatDelta, formatValue, type FormatContext } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decideRecommendation } from "@/server/actions/intelligence";
import type { Pacing } from "@/server/budget/pacing";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader } from "@/components/ui";

const MONTH = (d: string, locale: string) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export function PacingPanel({ pacing, periodStart, fmt, href }: { pacing: Pacing | null; periodStart: string | null; fmt: FormatContext; href: string }) {
  return (
    <Card>
      <CardHeader
        title="Ritmo do orçamento"
        description={periodStart ? MONTH(periodStart, fmt.locale) : undefined}
        actions={
          <Link href={href} className="text-xs font-medium text-fg-2 hover:text-fg">
            Detalhe
          </Link>
        }
      />
      {pacing ? (
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <span className="tabular text-[19px] font-semibold tracking-tight">{formatValue(pacing.spent, "currency", fmt)}</span>
            <span className="tabular text-xs text-muted">de {formatValue(pacing.amount, "currency", fmt)}</span>
          </div>
          <div className="relative mt-2.5 h-1.5 rounded-full bg-hover" role="img" aria-label={`${formatValue(pacing.pctConsumed, "percent", fmt)} consumido`}>
            <i className="absolute inset-y-0 left-0 rounded-full bg-inverse" style={{ width: `${Math.min(100, (pacing.pctConsumed ?? 0) * 100)}%` }} />
            <i className={cn("absolute -top-[3px] h-3 w-0.5", pacing.status === "OVER" ? "bg-bad" : "bg-fg-2")} style={{ left: `${Math.min(99.5, (pacing.projection / pacing.amount) * 100)}%` }} title="Projeção no fim do período" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-fg-2">
            <span>
              Dia {pacing.elapsedDays} de {pacing.totalDays}
            </span>
            <span className="ml-auto">
              Projeção <b className="tabular font-semibold">{formatValue(pacing.projection, "currency", fmt)}</b>
            </span>
            {pacing.status === "OVER" || pacing.status === "UNDER" ? (
              <Badge variant={pacing.status === "OVER" ? "bad" : "warn"}>
                {formatDelta(pacing.projectedVariancePct, fmt)} {pacing.status === "OVER" ? "acima" : "abaixo"}
              </Badge>
            ) : (
              <Badge variant="good">No ritmo</Badge>
            )}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">Projeção = gasto até ao último dia com dados + média dos últimos 7 dias × dias restantes.</p>
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-muted">
          Sem orçamento total definido para o mês atual.{" "}
          <Link href={href} className="font-medium text-fg underline-offset-2 hover:underline">
            Definir orçamento
          </Link>
        </p>
      )}
    </Card>
  );
}

const CONFIDENCE: Record<string, string> = { HIGH: "Confiança alta", MEDIUM: "Confiança média", LOW: "Confiança baixa" };
const SOURCE: Record<string, string> = { RULE: "Regra", STATISTICAL: "Estatística", AI: "IA" };

export function RecommendationsPanel({ recs, total, clientId, canDecide, href }: { recs: Recommendation[]; total: number; clientId: string; canDecide: boolean; href: string }) {
  return (
    <Card>
      <CardHeader
        title="Recomendações"
        description={total ? `${total} por decidir` : undefined}
        actions={
          <Link href={href} className="text-xs font-medium text-fg-2 hover:text-fg">
            Ver todas
          </Link>
        }
      />
      {recs.length ? (
        <ul>
          {recs.map((r) => (
            <li key={r.id} className="border-b px-4 py-3 last:border-b-0">
              <Link href={`${href}#${r.id}`} className="font-medium hover:underline">
                {r.title}
              </Link>
              <p className="mb-2 mt-0.5 line-clamp-2 text-xs text-fg-2">{r.explanation}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge>{SOURCE[r.source] ?? r.source}</Badge>
                <Badge variant={r.confidence === "HIGH" ? "good" : "neutral"}>{CONFIDENCE[r.confidence] ?? r.confidence}</Badge>
                {canDecide && (
                  <div className="ml-auto flex gap-1.5">
                    <ActionForm action={decideRecommendation} submitLabel="Recusar" variant="ghost" size="sm" inline>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="recommendationId" value={r.id} />
                      <input type="hidden" name="status" value="DISMISSED" />
                    </ActionForm>
                    <ActionForm action={decideRecommendation} submitLabel="Aprovar" variant="secondary" size="sm" inline>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="recommendationId" value={r.id} />
                      <input type="hidden" name="status" value="APPROVED" />
                    </ActionForm>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-muted">Sem recomendações pendentes.</p>
      )}
      <p className="border-t px-4 py-2.5 text-[11.5px] text-muted">Aprovar apenas regista a decisão. Nenhuma alteração é feita nas plataformas.</p>
    </Card>
  );
}
