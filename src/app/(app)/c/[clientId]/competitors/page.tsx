import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/auth/rbac";
import { formatTimestamp } from "@/lib/format";
import { loadCompetitorData } from "@/server/queries/competitors";
import { refreshCompetitorsAction } from "@/server/actions/competitors";
import type { SourceKey } from "@/server/competitors/refresh";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Notice, PageHeader, type BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/utils";
import { clientContext } from "../page-context";
import { CompetitorsTab, KeywordsTab } from "./tabs";
import { AdsTab, PagesTab, SpeedTab } from "./tabs-research";

export const metadata = { title: "Concorrência" };

const TABS = [
  { key: "concorrentes", label: "Concorrentes" },
  { key: "palavras", label: "Palavras-chave" },
  { key: "anuncios", label: "Anúncios dos concorrentes" },
  { key: "paginas", label: "Páginas" },
  { key: "velocidade", label: "Velocidade" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const SOURCES: { key: SourceKey; label: string; what: string }[] = [
  { key: "crawl", label: "Páginas públicas", what: "Rastreio próprio (robots.txt, 1 pedido/s)" },
  { key: "adLibrary", label: "Biblioteca de Anúncios da Meta", what: "Anúncios ativos em Portugal" },
  { key: "keywordPlanner", label: "Google Keyword Planner", what: "Volumes e CPC estimados" },
  { key: "pagespeed", label: "PageSpeed Insights", what: "Velocidade em telemóvel" },
];
const STATUS: Record<string, { label: string; v: BadgeVariant }> = { ok: { label: "OK", v: "good" }, credentials: { label: "Depende de credenciais", v: "warn" }, error: { label: "Erro", v: "bad" }, skipped: { label: "Sem dados", v: "neutral" } };

export default async function CompetitorsPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ tab?: string; all?: string }> }) {
  const { clientId } = await params;
  const sp = await searchParams;
  const { client, ctx, tenant } = await clientContext(clientId);
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "concorrentes";
  const canWrite = can(tenant.role, "workspace:write");
  const canAds = can(tenant.role, "ads:write");
  const [d, groups] = await Promise.all([
    loadCompetitorData(client.id),
    tab === "palavras" ? prisma.adGroup.findMany({ where: { campaign: { clientId: client.id, platform: "GOOGLE_ADS", status: { not: "REMOVED" }, OR: [{ campaignType: null }, { campaignType: { contains: "SEARCH" } }] }, status: { not: "REMOVED" } }, include: { campaign: { select: { name: true } } }, orderBy: [{ campaign: { name: "asc" } }, { name: "asc" }] }) : [],
  ]);
  const base = `/c/${client.id}/competitors`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Concorrência"
        description="Pesquisa com fontes gratuitas e oficiais: Keyword Planner, Biblioteca de Anúncios da Meta, páginas públicas e PageSpeed Insights. Os resultados inspiram recomendações e propostas; nada é aplicado sem a sua confirmação."
      />
      {d.simulated && <Notice>Este cliente usa dados de demonstração: os concorrentes, páginas, anúncios e volumes são fictícios (domínios .example, nunca contactados).</Notice>}

      <Card>
        <CardHeader
          title="Fontes"
          description="Auction Insights e o Centro de Transparência de Anúncios da Google não têm API pública: não estão disponíveis. Não é feito scraping dos resultados da Google."
          actions={
            canWrite ? (
              <div className="flex gap-2">
                <ActionForm action={refreshCompetitorsAction} submitLabel="Atualizar páginas, anúncios e velocidade" size="sm" variant="secondary" inline>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="what" value="research" />
                </ActionForm>
                <ActionForm action={refreshCompetitorsAction} submitLabel="Atualizar palavras-chave" size="sm" variant="secondary" inline>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="what" value="keywords" />
                </ActionForm>
              </div>
            ) : undefined
          }
        />
        <ul className="grid divide-y md:grid-cols-4 md:divide-x md:divide-y-0">
          {SOURCES.map((s) => {
            const v = d.status[s.key];
            const b = v ? STATUS[v.status] : null;
            return (
              <li key={s.key} className="space-y-1 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{s.label}</span>
                  {b ? <Badge variant={b.v}>{b.label}</Badge> : <Badge>Nunca atualizado</Badge>}
                </div>
                <p className="text-[11px] text-muted">{s.what}</p>
                {v && <p className="text-xs text-fg-2">{v.message}</p>}
                {v && <p className="text-[11px] text-muted">{formatTimestamp(v.at, ctx.fmt)}</p>}
              </li>
            );
          })}
        </ul>
      </Card>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Separadores da concorrência">
        {TABS.map((t) => (
          <Link key={t.key} href={`${base}?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-xs font-medium", t.key === tab ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}>
            {t.label}
            {t.key === "concorrentes" && d.suggested.length > 0 && <span className="tabular ml-1.5 rounded-full bg-accent-soft px-1.5 text-[10.5px] text-accent">{d.suggested.length}</span>}
            {t.key === "palavras" && d.gaps.gaps > 0 && <span className="tabular ml-1.5 rounded-full bg-warn-soft px-1.5 text-[10.5px] text-warn">{d.gaps.gaps}</span>}
          </Link>
        ))}
      </nav>

      {tab === "concorrentes" && <CompetitorsTab d={d} clientId={client.id} canWrite={canWrite} fmt={ctx.fmt} />}
      {tab === "palavras" && <KeywordsTab d={d} clientId={client.id} canAds={canAds} showAll={sp.all === "1"} groups={groups.map((g) => ({ id: g.id, label: `${g.campaign.name} › ${g.name}` }))} fmt={ctx.fmt} base={base} />}
      {tab === "anuncios" && <AdsTab d={d} clientId={client.id} canAds={canAds} fmt={ctx.fmt} />}
      {tab === "paginas" && <PagesTab d={d} fmt={ctx.fmt} />}
      {tab === "velocidade" && <SpeedTab d={d} fmt={ctx.fmt} />}
    </div>
  );
}
