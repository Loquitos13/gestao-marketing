import type { Platform, PrismaClient } from "@prisma/client";
import { addDays, dayCount, toDate, type ISODate } from "@/lib/dates";
import { generateCampaignDay, type BreakdownRow, type MetricRow, type TermRow } from "./paid";
import { generateOrganicPosts, generateSearchDay, generateWebDay, type SearchRowOut, type WebRowOut } from "./web";
import type { DemoClientSpec } from "./specs";

export const DEMO_HISTORY_DAYS = 400;

const SOURCES: { platform: Platform; ext: (s: DemoClientSpec) => string; name: (s: DemoClientSpec) => string }[] = [
  { platform: "GOOGLE_ADS", ext: (s) => `demo-gads-${s.key}`, name: (s) => `Google Ads · ${s.name}` },
  { platform: "META_ADS", ext: (s) => `act_demo_${s.key}`, name: (s) => `Meta Ads · ${s.name}` },
  { platform: "SEARCH_CONSOLE", ext: (s) => `${s.website}/`, name: (s) => `Search Console · ${s.website}` },
  { platform: "GA4", ext: (s) => `properties/demo-${s.key}`, name: (s) => `GA4 · ${s.name}` },
  { platform: "META_ORGANIC", ext: (s) => `page_demo_${s.key}`, name: (s) => `Página Facebook/Instagram · ${s.name}` },
];

export interface GeneratedDemo {
  metrics: MetricRow[];
  breakdowns: BreakdownRow[];
  terms: TermRow[];
  search: SearchRowOut[];
  web: WebRowOut[];
}

/** Gera todos os dados de um cliente num intervalo. `anchor` = último dia com dados. */
export function generateDemo(spec: DemoClientSpec, anchor: ISODate, days = DEMO_HISTORY_DAYS): GeneratedDemo {
  const out: GeneratedDemo = { metrics: [], breakdowns: [], terms: [], search: [], web: [] };
  const start = addDays(anchor, -(days - 1));
  for (let d = start; d <= anchor; d = addDays(d, 1)) {
    const ago = dayCount(d, anchor) - 1;
    const paid = { googleSearchClicks: 0, googleOtherClicks: 0, metaLinkClicks: 0 };
    for (const c of spec.campaigns) {
      const r = generateCampaignDay(spec, c, d, ago);
      out.metrics.push(...r.adRows);
      if (r.campaignRow) {
        out.metrics.push(r.campaignRow);
        if (c.platform === "META_ADS") paid.metaLinkClicks += r.campaignRow.linkClicks ?? 0;
        else if (c.type === "SEARCH" || c.type === "PERFORMANCE_MAX") paid.googleSearchClicks += r.campaignRow.clicks;
        else paid.googleOtherClicks += r.campaignRow.clicks;
      }
      out.breakdowns.push(...r.breakdowns);
      out.terms.push(...r.terms);
    }
    const search = generateSearchDay(spec, d, ago);
    out.search.push(...search);
    const gscTotal = search.find((s) => s.dimension === "TOTAL")?.clicks ?? 0;
    out.web.push(...generateWebDay(spec, d, gscTotal, paid));
  }
  return out;
}

async function batches<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/**
 * Cria/regenera fontes de dados SIMULADAS de um cliente demo.
 * Apaga apenas dados de fontes com origin=SIMULATED deste cliente.
 */
export async function writeDemoClient(db: PrismaClient, clientId: string, spec: DemoClientSpec, anchor: ISODate, days = DEMO_HISTORY_DAYS) {
  const sourceIds = {} as Record<Platform, string>;
  const startDate = addDays(anchor, -(days - 1));
  for (const s of SOURCES) {
    const ds = await db.dataSource.upsert({
      where: { clientId_platform_externalId: { clientId, platform: s.platform, externalId: s.ext(spec) } },
      update: {
        origin: "SIMULATED",
        status: "ACTIVE",
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        dataAvailableUntil: toDate(anchor),
        historyStartDate: toDate(startDate),
        lastError: null,
        settings: { demoKey: spec.key, anchor },
      },
      create: {
        clientId,
        platform: s.platform,
        origin: "SIMULATED",
        externalId: s.ext(spec),
        name: s.name(spec),
        currency: spec.currency,
        timezone: spec.timezone,
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        dataAvailableUntil: toDate(anchor),
        historyStartDate: toDate(startDate),
        settings: { demoKey: spec.key, anchor },
      },
    });
    sourceIds[s.platform] = ds.id;
  }
  const simulatedIds = Object.values(sourceIds);
  await db.adMetricDaily.deleteMany({ where: { dataSourceId: { in: simulatedIds } } });
  await db.campaignBreakdownDaily.deleteMany({ where: { dataSourceId: { in: simulatedIds } } });
  await db.adsTermDaily.deleteMany({ where: { dataSourceId: { in: simulatedIds } } });
  await db.searchMetricDaily.deleteMany({ where: { dataSourceId: { in: simulatedIds } } });
  await db.webAnalyticsDaily.deleteMany({ where: { dataSourceId: { in: simulatedIds } } });
  await db.organicContent.deleteMany({ where: { dataSourceId: { in: simulatedIds } } });

  // Entidades
  for (const c of spec.campaigns) {
    const dsId = sourceIds[c.platform];
    const camp = await db.campaign.upsert({
      where: { dataSourceId_externalId: { dataSourceId: dsId, externalId: c.id } },
      // Estado e orçamento não são repostos: preservam alterações simuladas feitas na gestão de anúncios.
      update: { name: c.name },
      create: {
        clientId,
        dataSourceId: dsId,
        platform: c.platform,
        externalId: c.id,
        name: c.name,
        status: c.platform === "META_ADS" ? "ACTIVE" : "ENABLED",
        objective: c.objective,
        campaignType: c.type,
        biddingStrategy: c.bidding ?? null,
        dailyBudget: c.dailyBudget,
        startDate: toDate(addDays(anchor, -c.startDaysAgo)),
      },
    });
    for (const g of c.adGroups) {
      const ag = await db.adGroup.upsert({
        where: { campaignId_externalId: { campaignId: camp.id, externalId: g.id } },
        update: { name: g.name },
        create: { campaignId: camp.id, externalId: g.id, name: g.name, status: c.platform === "META_ADS" ? "ACTIVE" : "ENABLED" },
      });
      for (const a of g.ads) {
        let creativeId: string | null = null;
        if (c.platform === "META_ADS") {
          const cr = await db.creative.upsert({
            where: { dataSourceId_externalId: { dataSourceId: dsId, externalId: `cr_${a.id}` } },
            update: {},
            create: {
              dataSourceId: dsId,
              externalId: `cr_${a.id}`,
              format: a.format ?? "IMAGE",
              primaryText: a.primaryText ?? null,
              title: a.title ?? null,
              description: a.description ?? null,
              callToAction: a.cta ?? null,
            },
          });
          creativeId = cr.id;
        }
        await db.ad.upsert({
          where: { adGroupId_externalId: { adGroupId: ag.id, externalId: a.id } },
          update: { name: a.name, creativeId },
          create: {
            adGroupId: ag.id,
            externalId: a.id,
            name: a.name,
            status: c.platform === "META_ADS" ? "ACTIVE" : "ENABLED",
            adType: c.platform === "META_ADS" ? (a.format ?? "IMAGE") : c.type === "DISPLAY" ? "RESPONSIVE_DISPLAY_AD" : c.type === "VIDEO" ? "VIDEO_AD" : "RESPONSIVE_SEARCH_AD",
            finalUrl: a.finalUrl,
            headlines: a.headlines ?? [],
            descriptions: a.descriptions ?? [],
            creativeId,
            createdTime: a.createdDaysAgo !== undefined ? toDate(addDays(anchor, -a.createdDaysAgo)) : null,
          },
        });
      }
    }
  }

  const g = generateDemo(spec, anchor, days);
  const date = (d: string) => toDate(d);
  await batches(g.metrics, 4000, (chunk) =>
    db.adMetricDaily.createMany({
      data: chunk.map((m) => ({ ...m, clientId, dataSourceId: sourceIds[m.platform], date: date(m.date) })),
    }),
  );
  await batches(g.breakdowns, 5000, (chunk) =>
    db.campaignBreakdownDaily.createMany({ data: chunk.map((b) => ({ ...b, clientId, dataSourceId: sourceIds[b.platform], date: date(b.date) })) }),
  );
  await batches(g.terms, 5000, (chunk) =>
    db.adsTermDaily.createMany({ data: chunk.map((t) => ({ ...t, clientId, dataSourceId: sourceIds.GOOGLE_ADS, date: date(t.date) })) }),
  );
  await batches(g.search, 5000, (chunk) =>
    db.searchMetricDaily.createMany({ data: chunk.map((s) => ({ ...s, clientId, dataSourceId: sourceIds.SEARCH_CONSOLE, date: date(s.date) })) }),
  );
  await batches(g.web, 5000, (chunk) =>
    db.webAnalyticsDaily.createMany({ data: chunk.map((w) => ({ ...w, clientId, dataSourceId: sourceIds.GA4, date: date(w.date) })) }),
  );
  const posts = generateOrganicPosts(spec, anchor);
  await db.organicContent.createMany({
    data: posts.map((p) => ({ ...p, clientId, dataSourceId: sourceIds.META_ORGANIC, metricsAsOf: new Date() })),
  });
  return { sourceIds, rows: g.metrics.length + g.breakdowns.length + g.terms.length + g.search.length + g.web.length + posts.length };
}
