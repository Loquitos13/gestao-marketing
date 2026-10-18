import { prisma } from "@/lib/prisma";
import { fromDate, toDate, type ISODate } from "@/lib/dates";

export interface RateTable {
  date: ISODate;
  /** "BASE>QUOTE" → taxa */
  rates: Map<string, number>;
}

/** Carrega as taxas mais recentes registadas até à data indicada (inclusive). */
export async function loadRates(onOrBefore: ISODate): Promise<RateTable> {
  const rows = await prisma.exchangeRate.findMany({
    where: { date: { lte: toDate(onOrBefore) } },
    orderBy: { date: "desc" },
    take: 500,
  });
  const rates = new Map<string, number>();
  let date = onOrBefore;
  for (const r of rows) {
    const k = `${r.base}>${r.quote}`;
    if (!rates.has(k)) {
      rates.set(k, Number(r.rate));
      date = fromDate(r.date) < date ? fromDate(r.date) : date;
    }
  }
  return { date, rates };
}

/** Conversão direta, inversa ou via EUR. Devolve null quando não existe taxa conhecida. */
export function convertAmount(amount: number, from: string, to: string, table: RateTable): number | null {
  if (from === to) return amount;
  const direct = table.rates.get(`${from}>${to}`);
  if (direct) return amount * direct;
  const inverse = table.rates.get(`${to}>${from}`);
  if (inverse) return amount / inverse;
  if (from !== "EUR" && to !== "EUR") {
    const toEur = convertAmount(amount, from, "EUR", table);
    return toEur === null ? null : convertAmount(toEur, "EUR", to, table);
  }
  return null;
}
