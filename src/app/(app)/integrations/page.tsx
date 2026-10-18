import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/format";
import { requireOrg } from "@/server/auth/guard";
import { can } from "@/server/auth/rbac";
import { SETTING_GROUPS, type SettingGroupKey } from "@/server/config/definitions";
import { getConfig, integrationStatus, settingsLocked, settingsOverview } from "@/server/config/settings";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { GOOGLE_SCOPES } from "@/server/integrations/google/oauth";
import { META_SCOPES } from "@/server/integrations/meta/graph";
import { ollamaStatus } from "@/server/agent/llm";
import { rediscoverAction, revokeCredentialAction } from "@/server/actions/sources";
import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, CardHeader, EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { SettingsPanel } from "./settings-panel";

export const metadata = { title: "Integrações" };

type Status = "missing" | "configured" | "connected" | "verified";
const STATUS: Record<Status, { label: string; v: "neutral" | "warn" | "accent" | "good"; hint: string }> = {
  missing: { label: "Não configurado", v: "neutral", hint: "Preencha a configuração desta integração mais abaixo." },
  configured: { label: "Configurado · não verificado", v: "warn", hint: "As credenciais da app existem, mas ainda não foi feita nenhuma ligação." },
  connected: { label: "Conta ligada · sem sync real", v: "accent", hint: "OAuth concluído, mas ainda nenhuma sincronização real terminou com sucesso." },
  verified: { label: "Verificado", v: "good", hint: "Pelo menos uma sincronização real terminou com sucesso." },
};

function Redirect({ uri, scopes }: { uri: string; scopes: string[] }) {
  return (
    <dl className="grid gap-1.5 rounded-md bg-hover px-3 py-2 text-[11px] sm:grid-cols-[150px_1fr]">
      <dt className="text-muted">URI de redirecionamento</dt>
      <dd className="break-all font-mono">{uri}</dd>
      <dt className="text-muted">Permissões pedidas</dt>
      <dd className="break-all font-mono text-fg-2">{scopes.map((s) => s.replace("https://www.googleapis.com/auth/", "")).join(", ")}</dd>
    </dl>
  );
}

export default async function IntegrationsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await props.searchParams;
  const ctx = await requireOrg();
  const manage = can(ctx.role, "integration:manage");
  const configure = can(ctx.role, "org:manage");
  const [cfg, conf, fields, creds, verified, llm] = await Promise.all([
    integrationStatus(),
    getConfig(),
    settingsOverview(),
    prisma.oAuthCredential.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, provider: true, externalUserName: true, status: true, scopes: true, accessTokenExpiresAt: true, lastRefreshedAt: true, lastError: true, createdAt: true, connectedAccounts: { select: { platform: true, name: true, externalId: true, _count: { select: { dataSources: true } } } } },
    }),
    prisma.dataSource.groupBy({ by: ["platform"], where: { client: { organizationId: ctx.organizationId }, origin: "REAL", lastSuccessfulSyncAt: { not: null } }, _count: true }),
    ollamaStatus(),
  ]);
  const ok = new Set(verified.map((v) => v.platform));
  const activeProv = (p: "GOOGLE" | "META") => creds.some((c) => c.provider === p && c.status === "ACTIVE");
  const st = (configured: boolean, provider: "GOOGLE" | "META" | null, platforms: Platform[]): Status =>
    !configured ? "missing" : platforms.some((p) => ok.has(p)) ? "verified" : provider && activeProv(provider) ? "connected" : "configured";

  const rows: { name: string; status: Status; group: SettingGroupKey; note: string }[] = [
    { name: "Google Ads API", status: st(cfg.googleAds, "GOOGLE", ["GOOGLE_ADS"]), group: "google", note: `Versão ${conf.GOOGLE_ADS_API_VERSION}. Exige developer token aprovado (acesso básico ou standard).` },
    { name: "Google Search Console", status: st(cfg.google, "GOOGLE", ["SEARCH_CONSOLE"]), group: "google", note: "Dados com ~2–3 dias de atraso; consultas raras são anonimizadas pela Google." },
    { name: "Google Analytics 4", status: st(cfg.google, "GOOGLE", ["GA4"]), group: "google", note: "Data API v1 com quotas por propriedade." },
    { name: "Meta Marketing API", status: st(cfg.meta, "META", ["META_ADS", "META_ORGANIC"]), group: "meta", note: `Graph ${conf.META_GRAPH_VERSION}. Token de longa duração (~60 dias), sem refresh: reautorize antes de expirar.` },
    { name: "Semrush (opcional)", status: cfg.semrush ? (ok.has("SEMRUSH") ? "verified" : "configured") : "missing", group: "semrush", note: "Consome unidades da API por pedido." },
    { name: "Email (SMTP)", status: cfg.smtp ? "configured" : "missing", group: "smtp", note: "Sem SMTP, os envios ficam registados como “não enviado — serviço não configurado”." },
    { name: "Fila (Redis/BullMQ)", status: cfg.redis ? "configured" : "missing", group: "redis", note: "Sem Redis, as sincronizações correm no pedido e não há agendamento automático." },
    { name: "Agente IA (Ollama local)", status: llm.ok ? "verified" : "configured", group: "agent", note: llm.message },
    { name: "PageSpeed Insights (opcional)", status: cfg.pagespeed ? "configured" : "missing", group: "pagespeed", note: "Velocidade das páginas na pesquisa de concorrência. Gratuita, com quota diária." },
  ];
  const locked = settingsLocked();
  const extra: Partial<Record<SettingGroupKey, React.ReactNode>> = {
    google: <Redirect uri={`${conf.APP_URL}/api/oauth/google/callback`} scopes={GOOGLE_SCOPES} />,
    meta: <Redirect uri={`${conf.APP_URL}/api/oauth/meta/callback`} scopes={META_SCOPES} />,
  };

  return (
    <div className="w-full max-w-[1480px] space-y-5 px-6 pb-6 pt-5">
      <PageHeader title="Integrações" description="Apenas APIs oficiais. A escrita nas contas de anúncios só acontece após confirmação explícita em Gestão de anúncios. Tokens e segredos encriptados (AES-256-GCM) no servidor; nunca expostos ao browser nem incluídos em relatórios." />
      {sp.error && <Notice variant="bad">{sp.error}</Notice>}
      {sp.connected && (
        <Notice variant="accent">
          Autorização {sp.connected === "google" ? "Google" : "Meta"} concluída. Contas encontradas: {sp.found || "nenhuma"}. Associe-as aos clientes na página “Fontes” de cada cliente.
          {sp.warn && <span className="mt-1 block text-warn">Avisos: {sp.warn}</span>}
        </Notice>
      )}

      <Card>
        <CardHeader title="Estado das integrações" description="“Verificado” só aparece depois de uma sincronização real bem-sucedida." />
        <table className="w-full text-xs">
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-3 py-2.5">
                  <Badge variant={STATUS[r.status].v} title={STATUS[r.status].hint}>
                    {STATUS[r.status].label}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-muted">{r.note}</td>
                <td className="px-4 py-2.5 text-right">
                  {configure && (
                    <a href={`#cfg-${r.group}`} className="text-accent hover:underline">
                      Configurar
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {manage && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Google" description="Uma autorização dá acesso a Google Ads, Search Console e GA4. Search Console e GA4 só leitura; Google Ads só escreve após confirmação em Gestão." />
            <div className="space-y-2 p-4 text-xs">
              {cfg.google ? (
                <a href="/api/oauth/google/start" className={buttonClass("primary")}>
                  Ligar conta Google
                </a>
              ) : (
                <p className="text-muted">Preencha o Client ID e o Client secret em Configuração → Google para ativar.</p>
              )}
              {cfg.google && !cfg.googleAds && <p className="text-warn">Sem developer token, as contas Google Ads não são listadas.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Meta" description="Contas de anúncios, Páginas e Instagram Business (permissões de leitura)." />
            <div className="space-y-2 p-4 text-xs">
              {cfg.meta ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <a href="/api/oauth/meta/start" className={buttonClass("primary")}>
                      Ligar conta Meta
                    </a>
                    <a href="/api/oauth/meta/start?mode=manage" className={buttonClass("secondary")}>
                      Ligar com gestão de anúncios
                    </a>
                  </div>
                  <p className="text-muted">A gestão de anúncios pede também <span className="font-mono">ads_management</span>. Para contas de clientes, a app Meta precisa de App Review com acesso avançado e Business Verification.</p>
                </>
              ) : (
                <p className="text-muted">Preencha o App ID e o App secret em Configuração → Meta para ativar.</p>
              )}
            </div>
          </Card>
        </div>
      )}

      <section id="configuracao" className="scroll-mt-4">
        <SectionTitle title="Configuração" description="Tudo o que o hub precisa para funcionar. Valores guardados aqui sobrepõem-se às variáveis de ambiente." />
        {!configure ? (
          <Notice variant="neutral">Só o proprietário da organização pode alterar a configuração das integrações.</Notice>
        ) : (
          <div className="space-y-4">
            {locked && <Notice variant="warn">Configuração bloqueada no servidor (SETTINGS_ENV_ONLY=1): os valores vêm apenas das variáveis de ambiente.</Notice>}
            <div className="grid gap-4 xl:grid-cols-2">
              {SETTING_GROUPS.map((g) => (
                <SettingsPanel key={g.key} group={g} state={fields} locked={locked} extra={extra[g.key]} />
              ))}
            </div>
            <p className="text-[11px] text-muted">
              Segredos nunca são mostrados depois de guardados (apenas os últimos 4 caracteres). <span className="font-mono">DATABASE_URL</span>, <span className="font-mono">ENCRYPTION_KEY</span> e{" "}
              <span className="font-mono">SESSION_SECRET</span> continuam obrigatoriamente em variáveis de ambiente: são necessários para ler e desencriptar esta configuração.
            </p>
          </div>
        )}
      </section>

      <Card>
        <CardHeader title="Credenciais OAuth" />
        {!creds.length ? (
          <EmptyState title="Nenhuma conta ligada" description="Os clientes de demonstração usam apenas dados simulados e não precisam de credenciais." />
        ) : (
          <ul className="divide-y">
            {creds.map((c) => (
              <li key={c.id} className="space-y-2 px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.provider === "GOOGLE" ? "Google" : c.provider === "META" ? "Meta" : c.provider}</span>
                  <span className="text-muted">{c.externalUserName ?? "—"}</span>
                  <Badge variant={c.status === "ACTIVE" ? "good" : c.status === "REVOKED" ? "neutral" : "bad"}>{c.status}</Badge>
                  {c.provider === "META" && (c.scopes.includes("ads_management") ? <Badge variant="accent">Gestão de anúncios</Badge> : <Badge variant="neutral">Só leitura</Badge>)}
                  {c.provider === "GOOGLE" && c.scopes.some((s) => s.endsWith("/adwords")) && <Badge variant="accent">Google Ads: leitura e escrita</Badge>}
                  <span className="text-muted">
                    Token válido até {c.accessTokenExpiresAt ? formatTimestamp(c.accessTokenExpiresAt) : "—"} · renovado {c.lastRefreshedAt ? formatTimestamp(c.lastRefreshedAt) : "—"}
                  </span>
                  {manage && c.status !== "REVOKED" && (
                    <span className="ml-auto flex gap-2">
                      <ActionForm action={rediscoverAction} submitLabel="Listar contas" size="sm" variant="secondary" inline>
                        <input type="hidden" name="credentialId" value={c.id} />
                      </ActionForm>
                      <ActionForm action={revokeCredentialAction} submitLabel="Revogar" size="sm" variant="danger" inline confirm="Revogar o acesso? As fontes que usam esta credencial deixam de sincronizar.">
                        <input type="hidden" name="credentialId" value={c.id} />
                      </ActionForm>
                    </span>
                  )}
                </div>
                {c.lastError && <p className="text-bad">{c.lastError}</p>}
                {c.connectedAccounts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.connectedAccounts.map((a) => (
                      <Badge key={`${a.platform}-${a.externalId}`} variant={a._count.dataSources ? "accent" : "neutral"} title={a._count.dataSources ? "Associada a cliente(s)" : "Não associada"}>
                        {PLATFORM_LABELS[a.platform]} · {a.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
