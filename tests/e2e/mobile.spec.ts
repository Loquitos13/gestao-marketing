import { devices, expect, test, type Page } from "@playwright/test";

// shortcut: só o Chromium está instalado; mantém viewport/toque do iPhone 13
test.use({ ...devices["iPhone 13"], browserName: "chromium" });

async function expectFits(page: Page, label: string) {
  await expect(page.locator("main")).toBeVisible();
  // Em emulação móvel o viewport de layout cresce com o conteúdo, por isso compara-se com a largura do dispositivo.
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${label}: largura ${scrollWidth} > ecrã ${width}`).toBeLessThanOrEqual(width + 1);
}

async function expectMenuOpens(page: Page) {
  const menu = page.getByRole("button", { name: "Abrir menu" });
  await expect(menu).toBeVisible();
  // Cliques antes da hidratação são repetidos pelo React (abre e fecha); espera pelo marcador de hidratação no botão.
  await page.waitForFunction(() => Object.keys(document.querySelector('button[aria-label="Abrir menu"]') ?? {}).some((k) => k.startsWith("__reactProps")), null, { timeout: 60_000 });
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Clientes" })).toBeVisible();
}

async function firstClientPath(page: Page) {
  await page.goto("/clients");
  const href = await page.locator('a[href^="/c/"]').first().getAttribute("href");
  expect(href, "É necessário pelo menos um cliente (execute o seed de demonstração).").toBeTruthy();
  return href!.match(/^\/c\/[^/]+/)![0];
}

test("páginas principais cabem num iPhone sem scroll horizontal", async ({ page }) => {
  test.slow();
  await page.goto("/");
  await expectFits(page, "/");
  await expectMenuOpens(page);

  const base = await firstClientPath(page);
  for (const seg of ["overview", "campaigns", "reports"]) {
    await page.goto(`${base}/${seg}`);
    await expectFits(page, seg);
    await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Secções do cliente" })).toBeVisible();
  }

  const report = await page.locator(`a[href^="${base}/reports/"]:not([href$="/new"])`).first().getAttribute("href");
  expect(report, "É necessário pelo menos um relatório no cliente de demonstração.").toBeTruthy();
  await page.goto(report!);
  await expectFits(page, "relatório");
});
