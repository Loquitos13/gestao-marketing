import { formatTimestamp, formatValue, type FormatContext } from "@/lib/format";
import type { CompetitorData } from "@/server/queries/competitors";
import { vitalRating } from "@/server/competitors/pagespeed";
import { Badge, Card, CardHeader, EmptyState, LinkButton, type BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted";
const td = "px-3 py-2 align-top";
const PLATFORM: Record<string, string> = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", MESSENGER: "Messenger", AUDIENCE_NETWORK: "Audience Network", THREADS: "Threads" };
const latestDate = (xs: { fetchedAt?: Date; lastSeenAt?: Date }[]) => xs.reduce<Date | null>((m, x) => {
  const d = x.fetchedAt ?? x.lastSeenAt ?? null;
  return d && (!m || d > m) ? d : m;
}, null);

export function AdsTab({ d, clientId, canAds, fmt }: { d: CompetitorData; clientId: string; canAds: boolean; fmt: FormatContext }) {
  const m = d.messaging;
  const seen = latestDate(d.ads);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Ângulos das mensagens" description={`${m.total} anúncios ativos em Portugal${seen ? ` · Biblioteca de Anúncios da Meta${d.simulated ? " (simulado)" : ""}, ${formatTimestamp(seen, fmt)}` : ""}. Contagem por anúncio; um anúncio pode usar vários ângulos.`} />
        {m.total ? (
          <div className="grid gap-5 px-4 py-4 md:grid-cols-[2fr_1fr]">
            <ul className="space-y-2">
              {m.angles.map((a) => (
                <li key={a.key} className="grid grid-cols-[160px_1fr_auto] items-center gap-3 text-[13px]">
                  <span>{a.label}</span>
                  <span className="h-2 rounded-full bg-surface-2">
                    <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.round(a.share * 100)}%` }} />
                  </span>
                  <span className="tabular w-24 text-right text-xs text-muted">
                    {a.count} · {formatValue(a.share, "percent", fmt)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-3 text-[13px]">
              <div>
                <p className="mb-1 text-xs font-medium text-fg-2">Chamadas para a ação</p>
                <p className="text-muted">{m.ctas.length ? m.ctas.map((c) => `${c.text} (${c.count})`).join(" · ") : "—"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-2">Descontos mencionados</p>
                <p className="text-muted">{m.offers.length ? m.offers.map((c) => `${c.text} (${c.count})`).join(" · ") : "—"}</p>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Sem anúncios recolhidos" description="Indique os IDs de Página Meta dos concorrentes e use “Atualizar”. A Biblioteca de Anúncios exige que o utilizador da ligação Meta tenha confirmado a identidade (facebook.com/ID)." />
        )}
      </Card>
      {d.ads.length > 0 && (
        <Card>
          <CardHeader title="Anúncios ativos" description="Texto tal como publicado pelo concorrente. Use-os como inspiração de ângulos, nunca para copiar." />
          <ul className="divide-y">
            {d.ads.map((a) => (
              <li key={a.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-fg">{a.competitorName}</span>
                  <span className="text-muted">ativo desde {a.startDate ? formatTimestamp(a.startDate, fmt).split(",")[0] : "—"}</span>
                  {a.platforms.map((p) => (
                    <Badge key={p} variant="neutral">
                      {PLATFORM[p] ?? p}
                    </Badge>
                  ))}
                  {a.simulated && <Badge variant="warn">Simulado</Badge>}
                  <span className="ml-auto flex gap-2">
                    {a.snapshotUrl && !a.simulated && (
                      <a href={a.snapshotUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                        Ver na Biblioteca
                      </a>
                    )}
                    {canAds && (
                      <LinkButton href={`/c/${clientId}/manage?view=anuncios&ref=${a.id}`} size="sm">
                        Criar rascunho a partir disto
                      </LinkButton>
                    )}
                  </span>
                </div>
                {a.titles[0] && <p className="text-[13px] font-medium">{a.titles[0]}</p>}
                {a.bodies.slice(0, 2).map((b, i) => (
                  <p key={i} className="whitespace-pre-line text-[13px] text-fg-2">
                    {b}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function PagesTab({ d, fmt }: { d: CompetitorData; fmt: FormatContext }) {
  const sites = [
    { name: `${d.client.name} (cliente)`, pages: d.clientPages },
    ...d.active.map((c) => ({ name: c.name, pages: d.compPages.filter((p) => p.competitorId === c.id) })),
  ];
  const pct = (n: number, t: number) => (t ? formatValue(n / t, "percent", fmt) : "—");
  const fetched = latestDate(d.pages);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Lacunas de conteúdo" description="Temas nos títulos e cabeçalhos dos concorrentes que não aparecem em nenhuma página lida do site do cliente. Bom ponto de partida para briefs de conteúdo." />
        {d.content.length ? (
          <ul className="divide-y">
            {d.content.map((g) => (
              <li key={g.topic} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.topic}</span>
                  <span className="text-xs text-muted">{g.competitors.join(", ")}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {g.examples.map((e) => (
                    <li key={e.url} className="truncate text-xs text-muted">
                      “{e.heading}” — {e.url}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Sem lacunas de conteúdo" description={d.pages.length ? "Os temas dos concorrentes já existem no site do cliente." : "Ainda não foram lidas páginas. Indique o site do cliente nas definições e os domínios dos concorrentes."} />
        )}
      </Card>
      <Card>
        <CardHeader title="Comparação de sites" description={fetched ? `Páginas públicas lidas${d.simulated ? " (simulado)" : ""} em ${formatTimestamp(fetched, fmt)}, respeitando o robots.txt.` : "Sem páginas lidas."} />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b bg-surface-2">
              <tr>
                <th className={th}>Site</th>
                <th className={cn(th, "text-right")}>Páginas</th>
                <th className={cn(th, "text-right")}>Palavras (média)</th>
                <th className={cn(th, "text-right")}>Com meta descrição</th>
                <th className={cn(th, "text-right")}>Com um só H1</th>
                <th className={cn(th, "text-right")}>Dados estruturados</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sites.map((s) => {
                const n = s.pages.length;
                return (
                  <tr key={s.name}>
                    <td className={cn(td, "font-medium")}>{s.name}</td>
                    <td className={cn(td, "tabular text-right")}>{n}</td>
                    <td className={cn(td, "tabular text-right")}>{n ? formatValue(s.pages.reduce((a, p) => a + p.wordCount, 0) / n, "number", fmt) : "—"}</td>
                    <td className={cn(td, "tabular text-right")}>{pct(s.pages.filter((p) => p.metaDescription).length, n)}</td>
                    <td className={cn(td, "tabular text-right")}>{pct(s.pages.filter((p) => p.h1.length === 1).length, n)}</td>
                    <td className={cn(td, "tabular text-right")}>{pct(s.pages.filter((p) => p.structuredData.length).length, n)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="divide-y border-t">
          {sites.filter((s) => s.pages.length).map((s) => (
            <details key={s.name} className="px-4 py-2.5">
              <summary className="cursor-pointer text-xs font-medium text-fg-2">
                {s.name}: {s.pages.length} páginas
              </summary>
              <ul className="mt-2 space-y-1">
                {s.pages.map((p) => (
                  <li key={p.id} className="text-xs">
                    <span className="font-medium">{p.title ?? "(sem título)"}</span> <span className="text-muted">· {p.wordCount} palavras · {p.url}</span>
                    {p.structuredData.length > 0 && <span className="text-muted"> · {p.structuredData.join(", ")}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}

const RATING: Record<string, BadgeVariant> = { good: "good", "needs-improvement": "warn", poor: "bad" };

function Vital({ metric, v, fmt }: { metric: "lcpMs" | "inpMs" | "cls"; v: number | null; fmt: FormatContext }) {
  const r = vitalRating(metric, v);
  if (v === null) return <span className="text-muted">—</span>;
  const text = metric === "cls" ? formatValue(v, "ratio", fmt) : `${formatValue(v / 1000, "ratio", fmt)} s`;
  return <Badge variant={r ? RATING[r] : "neutral"}>{metric === "inpMs" ? `${formatValue(v, "number", fmt)} ms` : text}</Badge>;
}

export function SpeedTab({ d, fmt }: { d: CompetitorData; fmt: FormatContext }) {
  const s = d.speed;
  const fetched = latestDate(d.speedRows);
  const lines = [{ name: `${d.client.name} (cliente)`, ...s.client }, ...s.competitors];
  const verdict: Record<string, string> = { melhor: "melhor que os concorrentes", pior: "pior que os concorrentes", igual: "ao nível dos concorrentes" };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Velocidade em telemóvel"
          description={`PageSpeed Insights${d.simulated ? " (simulado)" : ""}${fetched ? `, ${formatTimestamp(fetched, fmt)}` : ""}. Medianas por site. Bom: LCP até 2,5 s, INP até 200 ms, CLS até 0,1. O INP só existe com dados reais de utilizadores (CrUX).`}
        />
        {d.speedRows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b bg-surface-2">
                  <tr>
                    <th className={th}>Site</th>
                    <th className={cn(th, "text-right")}>Páginas</th>
                    <th className={cn(th, "text-right")}>Pontuação</th>
                    <th className={th}>LCP</th>
                    <th className={th}>INP</th>
                    <th className={th}>CLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.name}>
                      <td className={cn(td, "font-medium")}>{l.name}</td>
                      <td className={cn(td, "tabular text-right")}>{l.pages}</td>
                      <td className={cn(td, "tabular text-right")}>{l.score === null ? "—" : Math.round(l.score)}</td>
                      <td className={td}>
                        <Vital metric="lcpMs" v={l.lcpMs} fmt={fmt} />
                      </td>
                      <td className={td}>
                        <Vital metric="inpMs" v={l.inpMs} fmt={fmt} />
                      </td>
                      <td className={td}>
                        <Vital metric="cls" v={l.cls} fmt={fmt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t px-4 py-2.5 text-xs text-fg-2">
              {(["score", "lcpMs", "inpMs", "cls"] as const)
                .filter((k) => s.verdicts[k])
                .map((k) => `${{ score: "Pontuação", lcpMs: "LCP", inpMs: "INP", cls: "CLS" }[k]}: ${verdict[s.verdicts[k]!]}`)
                .join(" · ") || "Sem dados suficientes para comparar."}
            </p>
          </>
        ) : (
          <EmptyState title="Sem medições" description="Use “Atualizar” para medir. Sem API key da PageSpeed (Integrações) só as páginas iniciais são medidas." />
        )}
      </Card>
      {s.slowClientPages.length > 0 && (
        <Card>
          <CardHeader title="Páginas do cliente a melhorar" description="LCP acima de 2,5 s, CLS acima de 0,1 ou pontuação abaixo de 50." />
          <ul className="divide-y">
            {s.slowClientPages.map((p) => (
              <li key={p.url} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{p.url}</span>
                <span className="tabular text-xs text-muted">pontuação {p.score ?? "—"}</span>
                <Vital metric="lcpMs" v={p.lcpMs} fmt={fmt} />
                <Vital metric="cls" v={p.cls} fmt={fmt} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
