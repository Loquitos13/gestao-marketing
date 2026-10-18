import type { Client, PrismaClient } from "@prisma/client";

/** Dados de demonstração (domínios .example, nunca contactados). Tudo fica marcado como simulado. */
const COMPETITORS = [
  { name: "Linho & Co.", domain: "linho-e-co.example", page: "900000000000001" },
  { name: "Casa da Lã", domain: "casadala.example", page: "900000000000002" },
  { name: "Moda Costa", domain: "modacosta.example", page: "900000000000003" },
];

type P = { path: string; title: string; h1: string; h2: string[]; words: number; ld?: string[] };
const PAGES: Record<string, P[]> = {
  "linho-e-co.example": [
    { path: "/", title: "Linho & Co. | Roupa de linho portuguesa", h1: "Roupa de linho feita em Portugal", h2: ["Vestidos de cerimónia", "Camisas de linho homem", "Envio grátis acima de 50 €"], words: 640, ld: ["Organization", "WebSite"] },
    { path: "/vestidos-cerimonia", title: "Vestidos de cerimónia em linho", h1: "Vestidos de cerimónia", h2: ["Vestidos para casamento", "Guia de tamanhos"], words: 910, ld: ["Product", "BreadcrumbList"] },
    { path: "/blog/cuidados-linho", title: "Guia de cuidados com linho: lavar e passar", h1: "Guia de cuidados com linho", h2: ["Como passar linho", "Como guardar roupa de linho"], words: 1450, ld: ["Article"] },
    { path: "/cartao-oferta", title: "Cartão de oferta Linho & Co.", h1: "Cartão de oferta", h2: ["Como funciona"], words: 320 },
  ],
  "casadala.example": [
    { path: "/", title: "Casa da Lã | Casacos e malhas de lã merino", h1: "Malhas e casacos de lã", h2: ["Casacos impermeáveis", "Nova coleção cápsula", "Cartão de oferta"], words: 520, ld: ["Organization"] },
    { path: "/casacos-impermeaveis", title: "Casacos impermeáveis de lã", h1: "Casacos impermeáveis", h2: ["Casacos para chuva", "Guia de tamanhos"], words: 780, ld: ["Product"] },
    { path: "/colecao-capsula", title: "Coleção cápsula outono", h1: "Coleção cápsula", h2: ["Peças essenciais", "Vestidos de cerimónia"], words: 600 },
    { path: "/blog/cuidados-linho-e-la", title: "Cuidados com lã e linho", h1: "Guia de cuidados com lã", h2: ["Como passar linho", "Lavar lã à mão"], words: 1200, ld: ["Article", "FAQPage"] },
  ],
  "modacosta.example": [
    { path: "/", title: "Moda Costa | Roupa de mulher e criança", h1: "Roupa para toda a família", h2: ["Roupa de criança em algodão orgânico", "Casacos impermeáveis"], words: 450 },
    { path: "/crianca", title: "Roupa de criança em algodão orgânico", h1: "Roupa de criança", h2: ["Algodão orgânico certificado"], words: 700, ld: ["Product"] },
    { path: "/promocoes", title: "Promoções e outlet", h1: "Outlet", h2: ["Vestidos de cerimónia", "Até 50% de desconto"], words: 380 },
  ],
};

const CLIENT_PAGES: P[] = [
  { path: "/", title: "Loja Atlântico | Moda em tecidos naturais", h1: "Moda em tecidos naturais", h2: ["Vestidos de linho", "Casacos de lã merino", "Camisas de linho homem"], words: 580, ld: ["Organization"] },
  { path: "/vestidos", title: "Vestidos de linho mulher", h1: "Vestidos", h2: ["Vestidos de verão", "Guia de tamanhos"], words: 640, ld: ["Product"] },
  { path: "/casacos", title: "Casacos de lã para mulher", h1: "Casacos", h2: ["Casacos de inverno"], words: 520, ld: ["Product"] },
  { path: "/blog/como-lavar-linho", title: "Como lavar linho", h1: "Como lavar linho", h2: ["Temperatura certa"], words: 900, ld: ["Article"] },
  { path: "/saldos", title: "Saldos de roupa mulher", h1: "Saldos", h2: [], words: 260 },
];

const ADS: { c: number; body: string; title: string; desc?: string; days: number; platforms: string[] }[] = [
  { c: 0, body: "Vestidos de cerimónia em linho português. Envio grátis acima de 50 €.", title: "Nova coleção de cerimónia", days: 12, platforms: ["FACEBOOK", "INSTAGRAM"] },
  { c: 0, body: "Só até domingo: 20% de desconto em camisas de linho. Feito em Portugal.", title: "20% em camisas de linho", days: 4, platforms: ["INSTAGRAM"] },
  { c: 0, body: "Linho de qualidade que dura anos. Trocas e devoluções grátis em 30 dias.", title: "Linho que dura", days: 40, platforms: ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK"] },
  { c: 1, body: "Casacos impermeáveis de lã merino. Descubra a nova coleção cápsula.", title: "Casacos para a chuva", days: 9, platforms: ["FACEBOOK", "INSTAGRAM"] },
  { c: 1, body: "Últimas unidades! Malhas de lã com 30% de desconto. Compre já.", title: "Últimas unidades", days: 3, platforms: ["INSTAGRAM"] },
  { c: 1, body: "Mais de 10 000 clientes satisfeitos. Lã sustentável, produzida em Portugal.", title: "Lã sustentável", days: 60, platforms: ["FACEBOOK"] },
  { c: 2, body: "Roupa de criança em algodão orgânico. Entrega em 24 h.", title: "Algodão orgânico", days: 15, platforms: ["FACEBOOK", "INSTAGRAM"] },
  { c: 2, body: "Outlet: até 50% de desconto em vestidos. Aproveite!", title: "Outlet até 50%", days: 6, platforms: ["FACEBOOK", "INSTAGRAM", "MESSENGER"] },
];

const IDEAS: [string, number, number, number, string][] = [
  ["vestidos de cerimonia", 6600, 0.45, 1.6, "HIGH"],
  ["vestido cerimonia linho", 480, 0.38, 1.2, "MEDIUM"],
  ["casaco impermeavel mulher", 2900, 0.3, 1.1, "HIGH"],
  ["roupa de linho", 1900, 0.25, 0.9, "MEDIUM"],
  ["camisas de linho homem", 1600, 0.28, 0.95, "MEDIUM"],
  ["vestidos de linho", 2400, 0.3, 1.0, "MEDIUM"],
  ["como passar linho", 880, 0.05, 0.2, "LOW"],
  ["roupa crianca algodao organico", 390, 0.22, 0.8, "MEDIUM"],
  ["cartao oferta roupa", 260, 0.2, 0.7, "LOW"],
  ["casaco la merino", 720, 0.35, 1.3, "MEDIUM"],
  ["moda sustentavel portugal", 590, 0.18, 0.6, "LOW"],
  ["outlet vestidos", 1300, 0.2, 0.75, "HIGH"],
  ["linho e co", 320, 0.1, 0.3, "LOW"],
];

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

export async function ensureDemoCompetitors(db: PrismaClient, client: Client) {
  if ((await db.competitor.count({ where: { clientId: client.id } })) > 0) return;
  await db.competitor.createMany({ data: COMPETITORS.map((c) => ({ clientId: client.id, name: c.name, domain: c.domain, metaPageIds: [c.page], notes: "Concorrente de demonstração (domínio fictício)." })) });
}

export async function demoSuggestions(db: PrismaClient, client: Client) {
  const exists = await db.competitor.findFirst({ where: { clientId: client.id, name: "Tecelagem Norte" } });
  if (exists) return 0;
  await db.competitor.create({ data: { clientId: client.id, name: "Tecelagem Norte", domain: "tecelagem-norte.example", metaPageIds: ["900000000000009"], suggested: true, notes: "Anuncia em “vestidos de linho” (4 anúncios ativos). Sugestão de demonstração." } });
  return 1;
}

export async function demoRefresh(db: PrismaClient, client: Client) {
  await ensureDemoCompetitors(db, client);
  const comps = await db.competitor.findMany({ where: { clientId: client.id, suggested: false } });
  const byDomain = new Map(comps.map((c) => [c.domain, c]));
  const site = (client.website ?? "https://loja-atlantico.example").replace(/\/$/, "");
  const page = (origin: string, p: P, competitorId: string | null) => ({ clientId: client.id, competitorId, url: `${origin}${p.path}`, status: 200, title: p.title, metaDescription: `${p.h1}. ${p.h2.slice(0, 2).join(". ")}.`, h1: [p.h1], h2: p.h2, wordCount: p.words, canonical: `${origin}${p.path}`, lang: "pt-PT", structuredData: p.ld ?? [], simulated: true, fetchedAt: new Date() });
  const rows = [...CLIENT_PAGES.map((p) => page(site, p, null))];
  for (const [domain, pages] of Object.entries(PAGES)) {
    const c = byDomain.get(domain);
    if (c) rows.push(...pages.map((p) => page(`https://${domain}`, p, c.id)));
  }
  await db.$transaction([db.competitorPage.deleteMany({ where: { clientId: client.id } }), db.competitorPage.createMany({ data: rows })]);

  const ads = ADS.flatMap((a, i) => {
    const c = byDomain.get(COMPETITORS[a.c]!.domain);
    return c ? [{ clientId: client.id, competitorId: c.id, source: "META_AD_LIBRARY", externalId: `demo_${i + 1}`, pageId: COMPETITORS[a.c]!.page, pageName: c.name, bodies: [a.body], titles: [a.title], descriptions: a.desc ? [a.desc] : [], captions: [c.domain!.toUpperCase()], platforms: a.platforms, startDate: daysAgo(a.days), simulated: true }] : [];
  });
  await db.$transaction([db.competitorAd.deleteMany({ where: { clientId: client.id } }), db.competitorAd.createMany({ data: ads })]);

  const speed = [
    { url: `${site}/`, competitorId: null, score: 58, lcpMs: 3400, inpMs: 240, cls: 0.06 },
    { url: `${site}/vestidos`, competitorId: null, score: 49, lcpMs: 4100, inpMs: 310, cls: 0.14 },
    { url: `${site}/casacos`, competitorId: null, score: 66, lcpMs: 2900, inpMs: 180, cls: 0.04 },
    ...comps.flatMap((c, i) => [{ url: `https://${c.domain}/`, competitorId: c.id, score: [82, 71, 64][i % 3]!, lcpMs: [2100, 2500, 2800][i % 3]!, inpMs: [150, 190, 220][i % 3]!, cls: [0.02, 0.05, 0.09][i % 3]! }]),
  ];
  await db.$transaction([db.pageSpeedResult.deleteMany({ where: { clientId: client.id } }), db.pageSpeedResult.createMany({ data: speed.map((s) => ({ ...s, clientId: client.id, fieldData: false, simulated: true })) })]);
}

export async function demoKeywordIdeas(db: PrismaClient, client: Client) {
  await ensureDemoCompetitors(db, client);
  const comps = await db.competitor.findMany({ where: { clientId: client.id, suggested: false }, orderBy: { createdAt: "asc" } });
  const data = IDEAS.flatMap(([keyword, vol, low, high, competition], i) => {
    const c = comps[i % Math.max(comps.length, 1)];
    return c ? [{ clientId: client.id, competitorId: c.id, source: "SIMULATED", seed: c.domain ?? c.name, keyword, avgMonthlySearches: vol, competition, competitionIndex: competition === "HIGH" ? 80 : competition === "MEDIUM" ? 50 : 20, lowCpc: low, highCpc: high, currency: client.currency }] : [];
  });
  await db.$transaction([db.keywordIdea.deleteMany({ where: { clientId: client.id } }), db.keywordIdea.createMany({ data })]);
}
