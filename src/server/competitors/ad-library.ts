import { graphGet } from "@/server/integrations/meta/graph";

/** Sem ad_snapshot_url: esse link inclui o access token e não pode ser guardado nem mostrado. */
export const AD_LIBRARY_FIELDS = "id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms";

export interface LibraryAd {
  externalId: string;
  pageId: string;
  pageName: string;
  bodies: string[];
  titles: string[];
  descriptions: string[];
  captions: string[];
  platforms: string[];
  startDate: Date | null;
  stopDate: Date | null;
  snapshotUrl: string | null;
}

type Raw = {
  id?: string;
  page_id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
};

const texts = (v: unknown, max = 5) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 2000)).filter(Boolean))].slice(0, max) : []);
const date = (v?: string) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export function mapLibraryAd(r: Raw): LibraryAd | null {
  if (!r.id || !r.page_id) return null;
  return {
    externalId: String(r.id),
    pageId: String(r.page_id),
    pageName: (r.page_name ?? "").slice(0, 200),
    bodies: texts(r.ad_creative_bodies),
    titles: texts(r.ad_creative_link_titles),
    descriptions: texts(r.ad_creative_link_descriptions),
    captions: texts(r.ad_creative_link_captions),
    platforms: texts(r.publisher_platforms, 8).map((p) => p.toUpperCase()),
    startDate: date(r.ad_delivery_start_time),
    stopDate: date(r.ad_delivery_stop_time),
    snapshotUrl: /^\d+$/.test(String(r.id)) ? `https://www.facebook.com/ads/library/?id=${r.id}` : null,
  };
}

export type LibraryQuery = { pageIds: string[] } | { terms: string };

export function libraryParams(q: LibraryQuery, country = "PT"): Record<string, string> {
  const p: Record<string, string> = { ad_reached_countries: JSON.stringify([country]), ad_active_status: "ACTIVE", ad_type: "ALL", fields: AD_LIBRARY_FIELDS, limit: "100" };
  if ("pageIds" in q) p.search_page_ids = q.pageIds.filter((id) => /^\d+$/.test(id)).slice(0, 10).join(",");
  else p.search_terms = q.terms.slice(0, 100);
  return p;
}

/**
 * GET /ads_archive. Exige que o utilizador da credencial tenha confirmado a identidade na Biblioteca de Anúncios
 * (facebook.com/ID); sem isso a Meta devolve erro de permissão. As imagens não vêm pela API: liga-se à página pública do anúncio na Biblioteca.
 */
export async function searchAdLibrary(token: string, q: LibraryQuery, opts: { maxPages?: number; fetchImpl?: typeof fetch } = {}): Promise<LibraryAd[]> {
  const out: LibraryAd[] = [];
  let page = await graphGet<{ data?: Raw[]; paging?: { next?: string } }>("ads_archive", token, libraryParams(q), opts.fetchImpl);
  for (let n = 1; ; n++) {
    for (const r of page.data ?? []) {
      const ad = mapLibraryAd(r);
      if (ad) out.push(ad);
    }
    if (!page.paging?.next || n >= (opts.maxPages ?? 3)) break;
    page = await graphGet<{ data?: Raw[]; paging?: { next?: string } }>(page.paging.next, token, {}, opts.fetchImpl);
  }
  return out;
}

/** Domínio do anunciante a partir das legendas do link (ex.: "LOJA-EXEMPLO.PT"). */
export function domainFromCaptions(captions: string[]): string | null {
  for (const c of captions) {
    const m = c
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .match(/^([a-z0-9-]+(\.[a-z0-9-]+)+)(\/|$)/);
    if (m && !/^(facebook|instagram|fb|m\.me|wa\.me)\./.test(m[1]!)) return m[1]!;
  }
  return null;
}
