import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { toDate, type ISODate } from "@/lib/dates";

/** Taxas de referência diárias do BCE (base EUR, ~30 moedas, sem chave). Publicadas ~16:00 CET nos dias úteis. */
export const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_SOURCE = "ECB";

export interface EcbRates {
  date: ISODate;
  /** Código ISO → unidades por 1 EUR */
  rates: Record<string, number>;
}

/** Parser por regex: o XML é fixo e pequeno, não vale um parser XML. */
export function parseEcbXml(xml: string): EcbRates {
  const date = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml)?.[1];
  if (!date) throw new Error("XML do BCE sem data");
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g)) {
    const rate = Number(m[2]);
    if (Number.isFinite(rate) && rate > 0) rates[m[1]] = rate;
  }
  if (!Object.keys(rates).length) throw new Error("XML do BCE sem taxas");
  return { date, rates };
}

export async function fetchEcbRates(fetchImpl: typeof fetch = fetch): Promise<EcbRates> {
  const res = await fetchImpl(ECB_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`BCE respondeu ${res.status}`);
  return parseEcbXml(await res.text());
}

/** Moedas a gravar: as taxas manuais (fonte ≠ ECB) para o mesmo dia nunca são substituídas. */
export function ecbQuotesToUpsert(rates: Record<string, number>, existing: { quote: string; source: string }[]): string[] {
  const manual = new Set(existing.filter((e) => e.source !== ECB_SOURCE).map((e) => e.quote));
  return Object.keys(rates).filter((q) => !manual.has(q));
}

/** Só EUR→X: convertAmount já resolve inversas e cruzadas via EUR. */
export async function importEcbRates(fetchImpl: typeof fetch = fetch) {
  const { date, rates } = await fetchEcbRates(fetchImpl);
  const day = toDate(date);
  const existing = await prisma.exchangeRate.findMany({ where: { date: day, base: "EUR" }, select: { quote: true, source: true } });
  const quotes = ecbQuotesToUpsert(rates, existing);
  for (const quote of quotes) {
    await prisma.exchangeRate.upsert({
      where: { date_base_quote: { date: day, base: "EUR", quote } },
      create: { date: day, base: "EUR", quote, rate: rates[quote], source: ECB_SOURCE },
      update: { rate: rates[quote], source: ECB_SOURCE },
    });
  }
  logger.info({ date, upserted: quotes.length, keptManual: Object.keys(rates).length - quotes.length }, "Taxas do BCE importadas");
  return { date, upserted: quotes.length };
}
