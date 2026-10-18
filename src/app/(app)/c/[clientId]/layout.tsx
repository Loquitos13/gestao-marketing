import Link from "next/link";
import { ChevronRight, FileText, RefreshCw } from "lucide-react";
import { formatRelative, formatTimestamp } from "@/lib/format";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { workspaceCounts } from "@/server/queries/workspace";
import { can } from "@/server/auth/rbac";
import { Badge, Initials, LinkButton, OriginBadge } from "@/components/ui";
import { ClientTabs } from "@/components/client-tabs";
import { Tip } from "@/components/tooltip";
import { clientContext } from "./page-context";

const STATUS_DOT: Record<string, string> = { ACTIVE: "bg-good", ERROR: "bg-bad", PAUSED: "bg-faint" };

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { client, ctx, tenant } = await clientContext(clientId);
  const counts = await workspaceCounts(client.id);
  const errors = ctx.sources.filter((s) => s.status === "ERROR");
  const base = `/c/${client.id}`;
  const meta = [client.industry, client.currency, client.timezone].filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b bg-bg/90 backdrop-blur max-md:top-11">
        <div className="flex items-center gap-1.5 px-6 pt-2.5 text-xs text-muted">
          <Link href="/clients" className="hover:text-fg">
            Clientes
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-fg-2">{client.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3.5 px-6 pt-2">
          <Initials name={client.name} size="lg" inverse />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-[-0.01em]">{client.name}</h1>
            <div className="mt-px flex flex-wrap items-center gap-2.5 text-xs text-muted">
              {meta.map((m, i) => (
                <span key={i} className="flex items-center gap-2.5">
                  {i > 0 && <span aria-hidden className="size-[3px] rounded-full bg-faint" />}
                  {m}
                </span>
              ))}
              <OriginBadge origin={ctx.origin} />
              {errors.length > 0 && (
                <Link href={`${base}/sources`}>
                  <Badge variant="bad">{errors.length} fonte(s) com erro</Badge>
                </Link>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Tip
              side="bottom"
              content={
                <ul className="space-y-1">
                  {ctx.sources.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.name}</span>
                      <br />
                      <span className="text-muted">
                        Última sincronização: {formatTimestamp(s.lastSuccessfulSyncAt, ctx.fmt)} · dados até {s.dataAvailableUntil ?? "—"}
                      </span>
                    </li>
                  ))}
                  {!ctx.sources.length && <li>Nenhuma fonte ligada.</li>}
                </ul>
              }
            >
              <Link href={`${base}/sources`} className="inline-flex h-[30px] items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-hover">
                <RefreshCw className="size-3.5" />
                Atualizado {formatRelative(ctx.lastSync, ctx.fmt)}
              </Link>
            </Tip>
            {can(tenant.role, "report:write") && (
              <LinkButton href={`${base}/reports/new`} variant="primary">
                <FileText /> Gerar relatório
              </LinkButton>
            )}
          </div>
        </div>
        <ClientTabs
          clientId={client.id}
          primary={[
            { seg: "overview", label: "Visão geral" },
            { seg: "google-ads", label: "Google Ads", dot: "google" },
            { seg: "meta-ads", label: "Meta Ads", dot: "meta" },
            { seg: "seo", label: "SEO" },
            { seg: "competitors", label: "Concorrência" },
            { seg: "content", label: "Conteúdo" },
            { seg: "campaigns", label: "Campanhas" },
            { seg: "budget", label: "Orçamento" },
            { seg: "manage", label: "Gestão", count: counts.pendingChanges },
            { seg: "agent", label: "Agente IA" },
          ]}
          workspace={[
            { seg: "reports", label: "Relatórios", count: counts.reports },
            { seg: "tasks", label: "Tarefas", count: counts.openTasks },
            { seg: "notes", label: "Notas" },
            { seg: "files", label: "Ficheiros" },
            { seg: "activity", label: "Atividade" },
          ]}
          more={[
            { seg: "recommendations", label: "Recomendações", count: counts.openRecs },
            { seg: "alerts", label: "Alertas", count: counts.openAlerts, alert: true },
            { seg: "history", label: "Histórico" },
            { seg: "sources", label: "Fontes de dados" },
            { seg: "settings", label: "Definições do cliente" },
          ]}
        />
      </header>

      <div className="w-full max-w-[1480px] flex-1 px-6 pb-6 pt-5">{children}</div>

      <footer className="no-print mx-6 flex flex-wrap items-center gap-x-[18px] gap-y-1.5 border-t py-3.5 text-xs text-muted">
        {ctx.sources.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5" title={s.lastError ?? undefined}>
            <span aria-hidden className={`size-[7px] rounded-full ${STATUS_DOT[s.status] ?? "bg-faint"}`} />
            {PLATFORM_LABELS[s.platform] ?? s.name} · {s.status === "ERROR" ? "erro na sincronização" : `${formatRelative(s.lastSuccessfulSyncAt, ctx.fmt)}${s.dataAvailableUntil ? ` · dados até ${s.dataAvailableUntil}` : ""}`}
          </span>
        ))}
        {!ctx.sources.length && <span>Sem fontes de dados ligadas.</span>}
        {(ctx.origin === "SIMULATED" || ctx.origin === "MIXED") && <span className="ml-auto text-warn">{ctx.origin === "MIXED" ? "Parte dos dados é simulada" : "Dados fictícios de demonstração"}</span>}
      </footer>
    </div>
  );
}
