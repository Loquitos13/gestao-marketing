/**
 * Teste de carga do writeSyncResult: conta paga fictícia com N anúncios (10 por conjunto, 5 conjuntos por campanha)
 * e ~30 dias de métricas diárias, escrita duas vezes (1ª inserções; 2ª sem alterações) numa organização/cliente
 * descartáveis marcados LOADTEST, apagados no fim (cascata). Usa a DATABASE_URL real; recusa em produção.
 *
 *   npm run load:sync -- [--ads 3000] [--days 30]
 */
import { prisma } from "@/lib/prisma";
import { addDays, eachDay, todayInTz } from "@/lib/dates";
import { writeSyncResult } from "@/server/sync/writer";
import type { AdMetricInput, EntityBatch, SyncResult } from "@/server/integrations/types";

if (process.env.NODE_ENV === "production") {
  console.error("Recusado: NODE_ENV=production");
  process.exit(1);
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Conta determinística: a 2ª escrita tem de ver exatamente os mesmos valores. */
function buildAccount(ads: number, dates: string[]): SyncResult {
  const e: EntityBatch = { campaigns: [], adGroups: [], ads: [] };
  const adMetrics: AdMetricInput[] = [];
  for (let i = 0; i < ads; i++) {
    const g = Math.floor(i / 10);
    const c = Math.floor(g / 5);
    if (i % 50 === 0) e.campaigns.push({ externalId: `c${c}`, name: `Campanha ${c}`, status: "ENABLED", campaignType: "SEARCH", dailyBudget: 50 });
    if (i % 10 === 0) e.adGroups.push({ externalId: `g${g}`, campaignExternalId: `c${c}`, name: `Grupo ${g}`, status: "ENABLED" });
    e.ads.push({ externalId: `a${i}`, adGroupExternalId: `g${g}`, name: `Anúncio ${i}`, status: "ENABLED", adType: "RESPONSIVE_SEARCH_AD", headlines: ["Título"], descriptions: ["Descrição"] });
    for (const date of dates) adMetrics.push({ level: "AD", campaignExternalId: `c${c}`, adGroupExternalId: `g${g}`, adExternalId: `a${i}`, date, currency: "EUR", impressions: 1000 + i, clicks: 10 + (i % 7), cost: 5.5 + (i % 13) / 10, conversions: i % 3 });
  }
  for (const c of e.campaigns) for (const date of dates) adMetrics.push({ level: "CAMPAIGN", campaignExternalId: c.externalId, date, currency: "EUR", impressions: 50_000, clicks: 500, cost: 275, conversions: 50 });
  return { entities: e, adMetrics };
}

async function main() {
  const ads = Number(arg("ads") ?? 3000);
  const days = Number(arg("days") ?? 30);
  if (!(ads > 0 && days > 0)) throw new Error("--ads e --days têm de ser inteiros positivos");
  const tag = `LOADTEST-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: tag, slug: tag.toLowerCase() } });
  try {
    const client = await prisma.client.create({ data: { organizationId: org.id, name: tag, slug: "loadtest" } });
    const ds = await prisma.dataSource.create({ data: { clientId: client.id, platform: "GOOGLE_ADS", origin: "SIMULATED", externalId: tag, name: tag, currency: "EUR", timezone: client.timezone, settings: { loadtest: true } } });
    const end = addDays(todayInTz(client.timezone), -1);
    const range = { start: addDays(end, -(days - 1)), end };
    const result = buildAccount(ads, eachDay(range.start, range.end));
    console.log(`${ads} anúncios · ${result.entities!.adGroups.length} grupos · ${result.entities!.campaigns.length} campanhas · ${result.adMetrics!.length} linhas de métricas (${range.start} a ${range.end})\n`);
    for (const label of ["1ª escrita (inserções)", "2ª escrita (sem alterações)"]) {
      const t0 = performance.now();
      const rows = await writeSyncResult(prisma, ds, range, result);
      console.log(`${label}: ${Math.round(performance.now() - t0)} ms · ${rows} linhas`);
    }
    const stored = await prisma.ad.count({ where: { adGroup: { campaign: { dataSourceId: ds.id } } } });
    if (stored !== ads) throw new Error(`Esperava ${ads} anúncios na BD, encontrei ${stored}`);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } }); // cascata: cliente, fonte, entidades e métricas
  }
  console.log("\nDados de teste removidos.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
