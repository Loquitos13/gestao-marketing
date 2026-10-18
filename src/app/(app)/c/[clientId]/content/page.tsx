import { prisma } from "@/lib/prisma";
import { engagementRate } from "@/server/metrics/calc";
import { formatValue } from "@/lib/format";
import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { pageContext } from "../page-context";

export const metadata = { title: "Conteúdo" };

const LABEL: Record<string, string> = { impressions: "impressões", reach: "alcance", clicks: "cliques", saves: "guardados", shares: "partilhas", videoViews: "visualizações de vídeo", linkClicks: "cliques em links", watchTimeSec: "tempo de visualização" };

export default async function ContentPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { client, ctx, filters, fmt } = await pageContext(props.params, props.searchParams);
  if (!ctx.has.META_ORGANIC) {
    return (
      <>
        <PageHeader title="Conteúdo" />
        <Card>
          <EmptyState title="Nenhuma página Facebook/Instagram ligada" description="Ligue uma página através da Meta para analisar publicações orgânicas. Algumas métricas dependem de permissões e da idade da publicação." action={<LinkButton href={`/c/${client.id}/sources`} variant="primary">Ligar página</LinkButton>} />
        </Card>
      </>
    );
  }
  const posts = await prisma.organicContent.findMany({
    where: { clientId: client.id, publishedAt: { gte: new Date(`${filters.period.start}T00:00:00Z`), lte: new Date(`${filters.period.end}T23:59:59Z`) } },
    orderBy: { publishedAt: "desc" },
    take: 500,
  });
  const rows = posts.map((p) => {
    const eng = (p.reactions ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0) + (p.linkClicks ?? 0);
    return {
      title: p.title ?? p.text?.slice(0, 80) ?? "(sem texto)",
      sub: `${p.platform === "INSTAGRAM" ? "Instagram" : "Facebook"} · ${p.contentType ?? ""} · ${p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : ""}`,
      platform: p.platform,
      impressions: p.impressions,
      reach: p.reach,
      reactions: p.reactions,
      comments: p.comments,
      shares: p.shares,
      saves: p.saves,
      engagements: eng,
      engagementRate: engagementRate(eng, p.impressions),
      unavailable: p.unavailable.map((u) => LABEL[u] ?? u).join(", "),
    };
  });
  const byPlatform = ["FACEBOOK", "INSTAGRAM"].map((pl) => {
    const list = rows.filter((r) => r.platform === pl);
    const impr = list.reduce((a, r) => a + (r.impressions ?? 0), 0);
    const eng = list.reduce((a, r) => a + r.engagements, 0);
    return { pl, n: list.length, impr, eng, rate: impr ? eng / impr : null };
  });
  const unavailable = [...new Set(posts.flatMap((p) => p.unavailable))];

  return (
    <div className="space-y-5">
      <PageHeader title="Conteúdo orgânico" description="Publicações do Facebook e Instagram no período. Taxa de envolvimento = (reações + comentários + partilhas + guardados + cliques) ÷ impressões." actions={<FilterBar timezone={client.timezone} locale={client.locale} />} />
      {unavailable.length > 0 && <Notice variant="neutral">Métricas não disponibilizadas pela API para parte das publicações: {unavailable.map((u) => LABEL[u] ?? u).join(", ")}. São apresentadas como “Não disponível”, nunca como zero.</Notice>}
      <div className="grid gap-3 md:grid-cols-2">
        {byPlatform.map((b) => (
          <Card key={b.pl} className="p-4">
            <div className="text-xs text-muted">{b.pl === "INSTAGRAM" ? "Instagram" : "Facebook"}</div>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <div>
                <div className="tabular text-lg font-semibold">{b.n}</div>
                <div className="text-[11px] text-muted">publicações</div>
              </div>
              <div>
                <div className="tabular text-lg font-semibold">{formatValue(b.impr || null, "number", fmt, { compact: true })}</div>
                <div className="text-[11px] text-muted">impressões</div>
              </div>
              <div>
                <div className="tabular text-lg font-semibold">{formatValue(b.rate, "percent", fmt)}</div>
                <div className="text-[11px] text-muted">envolvimento</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Publicações" />
        <DataTable
          fmt={fmt}
          rows={rows}
          exportName={`${client.slug}-conteudo`}
          initialSort={{ key: "engagementRate" }}
          columns={[
            { key: "title", label: "Publicação", subKey: "sub" },
            { key: "impressions", label: "Impressões", kind: "metric" },
            { key: "reach", label: "Alcance", kind: "metric" },
            { key: "reactions", label: "Reações", kind: "metric" },
            { key: "comments", label: "Coment.", kind: "metric" },
            { key: "shares", label: "Partilhas", kind: "metric" },
            { key: "saves", label: "Guardados", kind: "metric" },
            { key: "engagementRate", label: "Envolvimento", kind: "metric", unit: "percent" },
            { key: "unavailable", label: "Não disponível" },
          ]}
        />
      </Card>
    </div>
  );
}
