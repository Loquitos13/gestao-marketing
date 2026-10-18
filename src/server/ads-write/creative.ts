/** Especificações de anúncios suportadas e validação segundo os limites das plataformas. */

export interface RsaSpec {
  kind: "GOOGLE_RSA";
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  path1?: string | null;
  path2?: string | null;
}

export const META_CTAS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "BOOK_TRAVEL", "GET_OFFER", "SUBSCRIBE", "DOWNLOAD", "APPLY_NOW", "GET_QUOTE"] as const;
export type MetaCta = (typeof META_CTAS)[number];

export const CTA_LABELS: Record<MetaCta, string> = {
  LEARN_MORE: "Saber mais",
  SHOP_NOW: "Comprar agora",
  SIGN_UP: "Registar",
  CONTACT_US: "Contactar",
  BOOK_TRAVEL: "Reservar",
  GET_OFFER: "Obter oferta",
  SUBSCRIBE: "Subscrever",
  DOWNLOAD: "Transferir",
  APPLY_NOW: "Candidatar",
  GET_QUOTE: "Pedir orçamento",
};

export interface MetaLinkAdSpec {
  kind: "META_LINK";
  name: string;
  pageId: string;
  link: string;
  message: string;
  headline: string;
  description?: string | null;
  imageUrl: string;
  callToAction: MetaCta;
}

export type AdSpec = RsaSpec | MetaLinkAdSpec;

export const RSA_LIMITS = { headlines: [3, 15], descriptions: [2, 4], headlineLen: 30, descriptionLen: 90, pathLen: 15 } as const;
export const META_LIMITS = { message: 2200, headline: 255, description: 255, recommendedMessage: 125, recommendedHeadline: 40 } as const;

/** Só URLs https públicas (sem credenciais, sem anfitriões locais). */
export function validPublicUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
    if (/^(\d+\.){3}\d+$/.test(h) || h.includes(":")) return false;
    return true;
  } catch {
    return false;
  }
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const hasBadChars = (s: string) => /[<>{}]|!{2,}|\?{2,}/.test(s);

export function normalizeRsa(s: RsaSpec): RsaSpec {
  return { ...s, headlines: s.headlines.map(clean).filter(Boolean), descriptions: s.descriptions.map(clean).filter(Boolean), finalUrl: s.finalUrl.trim(), path1: s.path1?.trim() || null, path2: s.path2?.trim() || null };
}

/** Erros de validação de um anúncio responsivo de pesquisa (RSA). */
export function validateRsa(raw: RsaSpec): string[] {
  const s = normalizeRsa(raw);
  const e: string[] = [];
  const [hMin, hMax] = RSA_LIMITS.headlines;
  const [dMin, dMax] = RSA_LIMITS.descriptions;
  if (s.headlines.length < hMin || s.headlines.length > hMax) e.push(`São necessários ${hMin} a ${hMax} títulos (tem ${s.headlines.length}).`);
  if (s.descriptions.length < dMin || s.descriptions.length > dMax) e.push(`São necessárias ${dMin} a ${dMax} descrições (tem ${s.descriptions.length}).`);
  s.headlines.forEach((h, i) => h.length > RSA_LIMITS.headlineLen && e.push(`Título ${i + 1} tem ${h.length} caracteres (máximo ${RSA_LIMITS.headlineLen}).`));
  s.descriptions.forEach((d, i) => d.length > RSA_LIMITS.descriptionLen && e.push(`Descrição ${i + 1} tem ${d.length} caracteres (máximo ${RSA_LIMITS.descriptionLen}).`));
  if (new Set(s.headlines.map((h) => h.toLowerCase())).size !== s.headlines.length) e.push("Há títulos repetidos.");
  if (new Set(s.descriptions.map((d) => d.toLowerCase())).size !== s.descriptions.length) e.push("Há descrições repetidas.");
  if ([...s.headlines, ...s.descriptions].some(hasBadChars)) e.push("Evite os caracteres < > { } e pontuação repetida (!! ou ??): a Google reprova estes anúncios.");
  if (!validPublicUrl(s.finalUrl)) e.push("O URL final tem de ser um endereço https público.");
  for (const [k, v] of [["Caminho 1", s.path1], ["Caminho 2", s.path2]] as const) if (v && (v.length > RSA_LIMITS.pathLen || /[\s/]/.test(v))) e.push(`${k}: até ${RSA_LIMITS.pathLen} caracteres, sem espaços nem barras.`);
  if (s.path2 && !s.path1) e.push("O caminho 2 exige o caminho 1.");
  return e;
}

export function validateMetaAd(s: MetaLinkAdSpec): string[] {
  const e: string[] = [];
  if (!clean(s.name)) e.push("Indique um nome para o anúncio.");
  if (!/^\d{5,25}$/.test(s.pageId)) e.push("ID da Página do Facebook inválido.");
  if (!validPublicUrl(s.link)) e.push("O link de destino tem de ser um endereço https público.");
  if (!validPublicUrl(s.imageUrl)) e.push("O URL da imagem tem de ser um endereço https público (a Meta descarrega a imagem).");
  if (!clean(s.message)) e.push("O texto principal é obrigatório.");
  if (s.message.length > META_LIMITS.message) e.push(`Texto principal com ${s.message.length} caracteres (máximo ${META_LIMITS.message}).`);
  if (!clean(s.headline)) e.push("O título é obrigatório.");
  if (s.headline.length > META_LIMITS.headline) e.push(`Título com ${s.headline.length} caracteres (máximo ${META_LIMITS.headline}).`);
  if (s.description && s.description.length > META_LIMITS.description) e.push(`Descrição com ${s.description.length} caracteres (máximo ${META_LIMITS.description}).`);
  if (!META_CTAS.includes(s.callToAction)) e.push("Botão de chamada para ação inválido.");
  return e;
}

/** Avisos não bloqueantes (boas práticas). */
export function adWarnings(s: AdSpec): string[] {
  if (s.kind === "GOOGLE_RSA") return s.headlines.length < 8 ? ["A Google recomenda pelo menos 8 a 10 títulos distintos para melhor otimização."] : [];
  const w: string[] = [];
  if (s.message.length > META_LIMITS.recommendedMessage) w.push(`O texto principal é cortado após ~${META_LIMITS.recommendedMessage} caracteres no feed.`);
  if (s.headline.length > META_LIMITS.recommendedHeadline) w.push(`Títulos acima de ~${META_LIMITS.recommendedHeadline} caracteres podem ser cortados.`);
  return w;
}

export const summarizeAd = (s: AdSpec) => (s.kind === "GOOGLE_RSA" ? `RSA: “${s.headlines[0]}” + ${s.headlines.length - 1} títulos, ${s.descriptions.length} descrições → ${s.finalUrl}` : `Imagem + texto: “${s.headline}” → ${s.link}`);
