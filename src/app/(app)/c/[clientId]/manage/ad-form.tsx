import { prisma } from "@/lib/prisma";
import { draftAdAction } from "@/server/actions/ads";
import { CTA_LABELS, META_CTAS, META_LIMITS, RSA_LIMITS } from "@/server/ads-write/creative";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, EmptyState, Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { cn } from "@/lib/utils";

const textarea = cn(inputClass, "h-auto min-h-[64px] py-1.5");

/** Seleção do grupo/conjunto e formulário do anúncio (novo ou nova versão de um existente). */
export async function AdComposer({ clientId, groupId, fromAdId, refAdId, canWrite }: { clientId: string; groupId?: string; fromAdId?: string; refAdId?: string; canWrite: boolean }) {
  const ref = refAdId ? await prisma.competitorAd.findFirst({ where: { id: refAdId, clientId }, include: { competitor: { select: { name: true } } } }) : null;
  const groups = await prisma.adGroup.findMany({
    where: { campaign: { clientId, platform: { in: ["GOOGLE_ADS", "META_ADS"] }, status: { not: "REMOVED" } }, status: { not: "REMOVED" } },
    include: { campaign: { select: { name: true, platform: true, campaignType: true } } },
    orderBy: [{ campaign: { platform: "asc" } }, { campaign: { name: "asc" } }, { name: "asc" }],
  });
  const eligible = groups.filter((g) => g.campaign.platform === "META_ADS" || !g.campaign.campaignType || /SEARCH/i.test(g.campaign.campaignType));
  const group = eligible.find((g) => g.id === groupId);
  const from = group && fromAdId ? await prisma.ad.findFirst({ where: { id: fromAdId, adGroupId: group.id }, include: { creative: true } }) : null;
  const page = group?.campaign.platform === "META_ADS" ? await prisma.dataSource.findFirst({ where: { clientId, platform: "META_ORGANIC" }, select: { externalId: true } }) : null;

  return (
    <div className="space-y-4">
      {ref && (
        <Card>
          <CardHeader title={`Referência: anúncio de ${ref.competitor?.name ?? ref.pageName}`} description="Inspire-se no ângulo (oferta, benefício, urgência), não no texto: escreva uma mensagem própria do cliente. Copiar anúncios de concorrentes pode violar direitos de autor e as políticas das plataformas." />
          <div className="space-y-1 px-4 py-3 text-[13px]">
            {ref.titles[0] && <p className="font-medium">{ref.titles[0]}</p>}
            {ref.bodies.slice(0, 2).map((b, i) => (
              <p key={i} className="whitespace-pre-line text-fg-2">
                {b}
              </p>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Onde criar o anúncio" description="Google: anúncios responsivos de pesquisa (só campanhas de Pesquisa). Meta: anúncio de imagem com texto e link. Vídeo e carrossel não são suportados." />
        <form method="get" className="flex flex-wrap items-end gap-3 px-4 py-3">
          <input type="hidden" name="view" value="anuncios" />
          {ref && <input type="hidden" name="ref" value={ref.id} />}
          <label className="min-w-[320px] flex-1 text-xs">
            <span className="mb-1 block font-medium text-fg-2">Grupo de anúncios (Google) ou conjunto (Meta)</span>
            <select name="group" defaultValue={group?.id ?? ""} className={inputClass}>
              <option value="">Escolher…</option>
              {eligible.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.campaign.platform === "GOOGLE_ADS" ? "Google" : "Meta"} · {g.campaign.name} › {g.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Continuar
          </button>
        </form>
      </Card>

      {!group ? (
        <Card>
          <EmptyState title="Escolha um grupo ou conjunto" description="Para editar um anúncio existente, use “Editar” em Campanhas e anúncios: é criada uma nova versão e, depois de aplicada, uma proposta para pausar o original." />
        </Card>
      ) : !canWrite ? (
        <Notice variant="neutral">Só administradores e proprietários podem criar anúncios.</Notice>
      ) : (
        <Card>
          <CardHeader title={from ? `Nova versão de “${from.name}”` : "Novo anúncio"} description={`${group.campaign.name} › ${group.name} · será criado em PAUSA; ative-o depois de aprovado pela plataforma.`} />
          <ActionForm action={draftAdAction} submitLabel="Criar proposta" className="space-y-4 px-4 py-4">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="adGroupId" value={group.id} />
            {from && <input type="hidden" name="replaceAdId" value={from.id} />}
            {group.campaign.platform === "GOOGLE_ADS" ? (
              <>
                <input type="hidden" name="kind" value="GOOGLE_RSA" />
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs font-medium text-fg-2">
                    Títulos ({RSA_LIMITS.headlines[0]}–{RSA_LIMITS.headlines[1]}, até {RSA_LIMITS.headlineLen} caracteres)
                  </legend>
                  <div className="grid gap-1.5 md:grid-cols-3">
                    {Array.from({ length: RSA_LIMITS.headlines[1] }, (_, i) => (
                      <input key={i} name="h[]" maxLength={RSA_LIMITS.headlineLen} defaultValue={from?.headlines[i] ?? ""} placeholder={`Título ${i + 1}${i < 3 ? " *" : ""}`} aria-label={`Título ${i + 1}`} className={inputClass} />
                    ))}
                  </div>
                </fieldset>
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs font-medium text-fg-2">
                    Descrições ({RSA_LIMITS.descriptions[0]}–{RSA_LIMITS.descriptions[1]}, até {RSA_LIMITS.descriptionLen} caracteres)
                  </legend>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {Array.from({ length: RSA_LIMITS.descriptions[1] }, (_, i) => (
                      <input key={i} name="d[]" maxLength={RSA_LIMITS.descriptionLen} defaultValue={from?.descriptions[i] ?? ""} placeholder={`Descrição ${i + 1}${i < 2 ? " *" : ""}`} aria-label={`Descrição ${i + 1}`} className={inputClass} />
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
                  <Field label="URL final">
                    <input name="finalUrl" type="url" required defaultValue={from?.finalUrl ?? ""} placeholder="https://" className={inputClass} />
                  </Field>
                  <Field label="Caminho 1 (opcional)">
                    <input name="path1" maxLength={RSA_LIMITS.pathLen} className={inputClass} />
                  </Field>
                  <Field label="Caminho 2 (opcional)">
                    <input name="path2" maxLength={RSA_LIMITS.pathLen} className={inputClass} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <input type="hidden" name="kind" value="META_LINK" />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Nome do anúncio">
                    <input name="name" required maxLength={200} defaultValue={from ? `${from.name} v2` : ""} className={inputClass} />
                  </Field>
                  <Field label="ID da Página do Facebook" hint="A Página que publica o anúncio.">
                    <input name="pageId" required inputMode="numeric" defaultValue={page && /^\d+$/.test(page.externalId) ? page.externalId : ""} className={inputClass} />
                  </Field>
                </div>
                <Field label={`Texto principal (recomendado até ${META_LIMITS.recommendedMessage} caracteres)`}>
                  <textarea name="message" required maxLength={META_LIMITS.message} defaultValue={from?.creative?.primaryText ?? ""} className={textarea} />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={`Título (recomendado até ${META_LIMITS.recommendedHeadline} caracteres)`}>
                    <input name="headline" required maxLength={META_LIMITS.headline} defaultValue={from?.creative?.title ?? ""} className={inputClass} />
                  </Field>
                  <Field label="Descrição (opcional)">
                    <input name="description" maxLength={META_LIMITS.description} defaultValue={from?.creative?.description ?? ""} className={inputClass} />
                  </Field>
                  <Field label="Link de destino">
                    <input name="link" type="url" required defaultValue={from?.finalUrl ?? ""} placeholder="https://" className={inputClass} />
                  </Field>
                  <Field label="URL da imagem" hint="Imagem pública em https; a Meta descarrega-a.">
                    <input name="imageUrl" type="url" required defaultValue={from?.creative?.imageUrl ?? ""} placeholder="https://" className={inputClass} />
                  </Field>
                  <Field label="Botão">
                    <select name="cta" defaultValue={from?.creative?.callToAction && META_CTAS.includes(from.creative.callToAction as (typeof META_CTAS)[number]) ? from.creative.callToAction : "LEARN_MORE"} className={inputClass}>
                      {META_CTAS.map((c) => (
                        <option key={c} value={c}>
                          {CTA_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
