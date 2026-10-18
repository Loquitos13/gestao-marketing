import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can } from "@/server/auth/rbac";
import { decideRecommendation, refreshIntelligence } from "@/server/actions/intelligence";
import { draftFromRecommendationAction } from "@/server/actions/ads";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Dot, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Recomendações" };

const STATUS = {
  NEW: { label: "Nova", v: "accent" },
  IN_REVIEW: { label: "Em análise", v: "warn" },
  APPROVED: { label: "Aprovada", v: "good" },
  DONE: { label: "Concluída", v: "neutral" },
  DISMISSED: { label: "Ignorada", v: "neutral" },
} as const;
const DECIDE = { IN_REVIEW: "Em análise", APPROVED: "Aprovar", DONE: "Concluída", DISMISSED: "Ignorar" } as const;
const SOURCE = { RULE: "Regra determinística", STATISTICAL: "Projeção estatística", AI: "Modelo de IA" } as const;
const CONF: Record<string, string> = { HIGH: "alta", MEDIUM: "média", LOW: "baixa" };
const PRIO: Record<number, [string, "err" | "warn" | "off"]> = { 1: ["Alta", "err"], 2: ["Média", "warn"], 3: ["Baixa", "off"] };
const LEVEL: Record<string, string> = { CAMPAIGN: "Campanha", AD_GROUP: "Grupo de anúncios", AD_SET: "Conjunto de anúncios", ADSET: "Conjunto de anúncios", AD: "Anúncio", PAGE: "Página", QUERY: "Consulta", BUDGET: "Orçamento", ACCOUNT: "Conta" };

/** Tipos com uma alteração direta (pausar anúncio, aumentar orçamento dentro do passo máximo). */
const ACTIONABLE = new Set(["LOW_CTR_AD", "CREATIVE_FATIGUE", "SCALE_BUDGET"]);

const platformTone = (p: string) => (p === "GOOGLE_ADS" ? "google" : p === "META_ADS" ? "meta" : "seo");

function evidenceValue(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("pt-PT", { maximumFractionDigits: 4 });
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "—";
  return JSON.stringify(v);
}

export default async function RecommendationsPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { clientId } = await props.params;
  const sp = await props.searchParams;
  const { client, tenant, ctx } = await clientContext(clientId);
  const filter = sp.status && sp.status in STATUS ? (sp.status as keyof typeof STATUS) : null;
  const recs = await prisma.recommendation.findMany({
    where: { clientId: client.id, ...(filter ? { status: filter } : { status: { in: ["NEW", "IN_REVIEW", "APPROVED"] } }) },
    orderBy: [{ priority: "asc" }, { detectedAt: "desc" }],
    take: 200,
  });
  const counts = await prisma.recommendation.groupBy({ by: ["status"], where: { clientId: client.id }, _count: true });
  const count = (k: string) => counts.find((c) => c.status === k)?._count ?? 0;
  const canDecide = can(tenant.role, "recommendation:decide");
  const canAds = can(tenant.role, "ads:write");
  const tabs: { key: string | null; label: string; n: number }[] = [
    { key: null, label: "Ativas", n: count("NEW") + count("IN_REVIEW") + count("APPROVED") },
    ...Object.entries(STATUS).map(([k, s]) => ({ key: k, label: s.label, n: count(k) })),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recomendações"
        description="Propostas geradas a partir dos dados, para decisão humana. Aprovar regista apenas a decisão. “Preparar alteração” cria uma proposta em Gestão, que só é aplicada depois de confirmada."
        actions={
          canDecide && (
            <ActionForm action={refreshIntelligence} submitLabel="Reavaliar agora" variant="secondary" size="sm" inline>
              <input type="hidden" name="clientId" value={client.id} />
            </ActionForm>
          )
        }
      />
      {ctx.origin !== "REAL" && ctx.origin !== "NONE" && <Notice>Recomendações calculadas sobre dados simulados — servem apenas para demonstrar o motor de análise.</Notice>}
      <nav aria-label="Estado" className="inline-flex gap-0.5 rounded-md border border-border-strong bg-surface p-0.5">
        {tabs.map((t) => {
          const active = filter === t.key;
          return (
            <Link key={t.key ?? "active"} href={t.key ? `?status=${t.key}` : "?"} aria-current={active ? "page" : undefined} className={cn("inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-xs font-medium", active ? "bg-hover text-fg" : "text-muted hover:text-fg")}>
              {t.label}
              <span className="tabular text-[11px] text-faint">{t.n}</span>
            </Link>
          );
        })}
      </nav>
      <Card>
        {!recs.length ? (
          <EmptyState title="Sem recomendações neste estado" description="O motor avalia regras sobre os últimos 14 dias (pago) e 28 dias (SEO) com amostra mínima." />
        ) : (
          <ul className="divide-y">
            {recs.map((r) => {
              const st = STATUS[r.status];
              const [prio, tone] = PRIO[r.priority] ?? PRIO[3]!;
              const evidence = (r.evidence ?? {}) as Record<string, unknown>;
              const ev = r.source === "AI" ? [] : Object.entries(evidence);
              const pApprove = typeof evidence.approvalProbability === "number" ? evidence.approvalProbability : null;
              return (
                <li key={r.id} id={r.id} className="grid gap-x-4 gap-y-3 px-4 py-3.5 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
                      <span className="inline-flex items-center gap-1.5 font-medium text-fg-2">
                        <Dot tone={tone} />
                        Prioridade {prio.toLowerCase()}
                      </span>
                      <span aria-hidden>·</span>
                      {r.platform && (
                        <>
                          <span className="inline-flex items-center gap-1.5">
                            <Dot tone={platformTone(r.platform)} />
                            {PLATFORM_LABELS[r.platform]}
                          </span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      {r.source === "AI" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge variant="accent">IA</Badge>
                          {typeof evidence.model === "string" ? `${evidence.model} (local)` : "Agente local"}
                          {r.agentRunId && (
                            <Link href={`/c/${client.id}/agent`} className="underline-offset-2 hover:underline">
                              execução {r.agentRunId.slice(-6)}
                            </Link>
                          )}
                        </span>
                      ) : (
                        <span>{SOURCE[r.source]}</span>
                      )}
                      <span aria-hidden>·</span>
                      <span title="Baseada no tamanho da amostra e na consistência do sinal">Confiança {CONF[r.confidence] ?? r.confidence}</span>
                      {r.status !== "NEW" && <Badge variant={st.v}>{st.label}</Badge>}
                    </div>
                    <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug">{r.title}</h3>
                    {r.entityName && (
                      <p className="mt-0.5 truncate text-xs text-muted" title={r.entityName}>
                        {LEVEL[r.entityLevel ?? ""] ?? "Entidade"} · {r.entityName}
                      </p>
                    )}
                    <p className="mt-2 max-w-[880px] text-[12.5px] leading-relaxed text-fg-2">{r.explanation}</p>
                    <div className="mt-2 max-w-[880px] rounded-md border bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                      <span className="font-medium">Ação sugerida — </span>
                      {r.suggestedAction}
                      {r.impactEstimate && <div className="mt-1 text-xs text-muted">Impacto estimado: {r.impactEstimate}</div>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span>Detetada {formatTimestamp(r.detectedAt, ctx.fmt)}</span>
                      {r.decidedAt && <span>Decisão {formatTimestamp(r.decidedAt, ctx.fmt)}</span>}
                      {r.decisionNote && <span>Nota: {r.decisionNote}</span>}
                      {pApprove !== null && <span title="Estimativa do modelo de preferência, treinado com as suas decisões anteriores">Probabilidade de aprovação estimada: {Math.round(pApprove * 100)}%</span>}
                      {ev.length > 0 && (
                        <details className="w-full">
                          <summary className="cursor-pointer select-none hover:text-fg">Métricas e comparação utilizadas ({ev.length})</summary>
                          <dl className="mt-2 grid max-w-[880px] grid-cols-[minmax(140px,max-content)_1fr] gap-x-4 gap-y-1 rounded-md border px-3 py-2 font-mono text-[11px]">
                            {ev.map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="text-muted">{k}</dt>
                                <dd className="break-all text-fg-2">{evidenceValue(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </div>
                  </div>
                  {canDecide && (
                    <div className="flex flex-wrap items-start gap-1.5 lg:justify-end">
                      {canAds && ACTIONABLE.has(r.type) && r.status !== "DONE" && r.status !== "DISMISSED" && (
                        <ActionForm action={draftFromRecommendationAction} submitLabel="Preparar alteração" size="sm" inline>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="recommendationId" value={r.id} />
                        </ActionForm>
                      )}
                      {canAds && r.type === "BUDGET_REALLOCATION" && <LinkButton href={`/c/${client.id}/manage?view=distribuicao`} size="sm">Abrir distribuição</LinkButton>}
                      {(["APPROVED", "IN_REVIEW", "DONE", "DISMISSED"] as const)
                        .filter((s) => s !== r.status)
                        .map((s) => (
                          <ActionForm key={s} action={decideRecommendation} submitLabel={DECIDE[s]} variant={s === "APPROVED" ? "primary" : s === "DISMISSED" ? "ghost" : "secondary"} size="sm" inline>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="recommendationId" value={r.id} />
                            <input type="hidden" name="status" value={s} />
                          </ActionForm>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
