import { expect, test } from "@playwright/test";

async function firstClientPath(page: import("@playwright/test").Page) {
  await page.goto("/clients");
  const href = await page.locator('a[href^="/c/"]').first().getAttribute("href");
  expect(href, "É necessário pelo menos um cliente (execute o seed de demonstração).").toBeTruthy();
  return href!.match(/^\/c\/[^/]+/)![0];
}

test("visitante anónimo é redirecionado para o login e não exporta relatórios", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Iniciar sessão" })).toBeVisible();
  const res = await page.request.get("/api/reports/abc123/pdf");
  expect(res.status()).toBe(401);
  await ctx.close();
});

test("painel global mostra clientes de demonstração marcados como simulados", async ({ page }) => {
  await page.goto("/");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1, name: "Painel global" })).toBeVisible();
  await expect(main.getByRole("table").first().getByRole("link", { name: /\(DEMO\)/ })).toHaveCount(3);
  await expect(main.getByText("simulados", { exact: true }).first()).toBeVisible();
});

test("navegação pelas secções de um cliente", async ({ page }) => {
  test.slow();
  const base = await firstClientPath(page);
  await page.goto(`${base}/overview`);
  await expect(page.getByRole("navigation", { name: "Secções do cliente" }).getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Desempenho por canal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tarefas" })).toBeVisible();
  const sections: [string, RegExp][] = [
    ["google-ads", /Google Ads/],
    ["meta-ads", /Meta Ads/],
    ["seo", /SEO/],
    ["competitors", /Concorrência/],
    ["competitors?tab=palavras", /Concorrência/],
    ["competitors?tab=anuncios", /Concorrência/],
    ["competitors?tab=paginas", /Concorrência/],
    ["competitors?tab=velocidade", /Concorrência/],
    ["manage", /Gestão de anúncios/],
    ["agent", /Agente IA/],
    ["campaigns", /Campanhas/],
    ["budget", /Orçamento/],
    ["alerts", /Alertas/],
    ["reports", /Relatórios/],
    ["history", /Histórico/],
    ["tasks", /Tarefas/],
    ["notes", /Notas/],
    ["files", /Ficheiros/],
    ["activity", /Atividade/],
  ];
  for (const [path, heading] of sections) {
    const res = await page.goto(`${base}/${path}`);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).first()).toBeVisible();
  }
});

test("regista e remove uma taxa de câmbio com fonte", async ({ page }) => {
  await page.goto("/settings");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Registar taxa" }) });
  await form.locator('input[name="date"]').fill("2001-01-02");
  await form.locator('input[name="base"]').fill("USD");
  await form.locator('input[name="quote"]').fill("EUR");
  await form.locator('input[name="rate"]').fill("1.0123");
  await form.locator('input[name="source"]').fill("E2E teste");
  await form.getByRole("button", { name: "Registar taxa" }).click();
  const row = page.getByRole("row").filter({ hasText: "1 USD = EUR" }).filter({ hasText: "2001-01-02" });
  await expect(row).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remover" }).click();
  await expect(row).toHaveCount(0);
});

test("configuração das integrações valida os valores e não expõe segredos", async ({ page }) => {
  await page.goto("/integrations");
  await expect(page.getByRole("heading", { level: 2, name: "Configuração" })).toBeVisible();
  const meta = page.locator("#cfg-meta");
  await expect(meta.locator('input[name="META_APP_SECRET"]')).toHaveAttribute("type", "password");
  await expect(meta.locator('input[name="META_APP_SECRET"]')).toHaveValue("");
  await meta.locator('input[name="META_APP_ID"]').fill("nao-numerico");
  await meta.getByRole("button", { name: "Guardar" }).click();
  await expect(meta.getByRole("alert")).toContainText("App ID: Apenas dígitos");
});

test("cliente inexistente devolve 404", async ({ page }) => {
  const res = await page.goto("/c/naoexiste000000000000000/overview");
  expect(res?.status()).toBe(404);
});

test("gera e exporta um relatório em PDF, CSV e Excel", async ({ page }) => {
  const base = await firstClientPath(page);
  await page.goto(`${base}/reports/new`);
  await page.getByRole("button", { name: /Gerar/ }).click();
  await expect(page).toHaveURL(/\/reports\/(?!new$)[^/]+$/, { timeout: 60_000 });
  const reportId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { name: "Google Ads — todas as métricas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meta Ads — todas as métricas" })).toBeVisible();
  const top = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Top 10 conteúdos com melhores resultados" }) });
  await expect(top.getByRole("heading", { name: "Anúncios" })).toBeVisible();
  const adRows = top.locator("table").first().locator("tbody tr");
  await expect(adRows.first().locator("td").first()).toHaveText("1");
  expect(await adRows.count()).toBeLessThanOrEqual(10);

  const pdf = await page.request.get(`/api/reports/${reportId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  const csv = await page.request.get(`/api/reports/${reportId}/csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  const xlsx = await page.request.get(`/api/reports/${reportId}/xlsx`);
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");

  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Eliminar relatório" }).click();
  await expect(page).toHaveURL(/\/reports$/, { timeout: 30_000 });
});
