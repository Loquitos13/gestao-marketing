import { expect, test, type Page } from "@playwright/test";

// Fluxo encadeado sobre o cliente de demonstração: cada passo reutiliza o estado deixado pelo anterior.
test.describe.configure({ mode: "serial" });

let manage: string;
let campaignName: string;
let originalBudget: string;

async function demoManagePath(page: Page) {
  await page.goto("/clients");
  const href = await page.getByRole("link", { name: "Loja Atlântico (DEMO)" }).first().getAttribute("href");
  expect(href, "É necessário o cliente de demonstração (execute o seed).").toBeTruthy();
  return `${href!.match(/^\/c\/[^/]+/)![0]}/manage`;
}

/** Confirma a proposta pendente de uma entidade e espera pelo redirecionamento para o histórico. */
async function applyPending(page: Page, entity: string, operation: string) {
  await page.goto(`${manage}?view=propostas`);
  const li = page.getByRole("listitem").filter({ hasText: entity }).filter({ hasText: operation });
  await li.getByLabel(/Confirmo aplicar esta alteração/).check();
  await li.getByRole("button", { name: "Aplicar (demonstração)" }).click();
  await expect(page).toHaveURL(/view=historico&done=/, { timeout: 30_000 });
  await expect(page.getByText("Aplicada nos dados de demonstração")).toContainText(entity);
}

const campaignRow = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });

test.beforeEach(async ({ page }) => {
  manage ??= await demoManagePath(page);
});

test("ativa a gestão de anúncios e aplica +10% ao orçamento diário de uma campanha", async ({ page }) => {
  await page.goto(manage);
  await page.getByLabel("Permitir aplicar alterações nas contas deste cliente").check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Gestão de anúncios ativada")).toBeVisible();

  await page.goto(`${manage}?view=campanhas`);
  const row = page.getByRole("row").filter({ has: page.getByLabel("Orçamento diário") }).first();
  const budget = row.getByLabel("Orçamento diário");
  originalBudget = await budget.inputValue();
  campaignName = (await row.getByRole("cell").first().innerText()).trim();
  const next = (Number(originalBudget) * 1.1).toFixed(2);
  await budget.fill(next);
  await row.getByRole("button", { name: "Propor" }).click();
  await expect(row.getByText("Proposta de orçamento criada")).toBeVisible();

  await applyPending(page, campaignName, "Orçamento diário");
  const entry = page.getByRole("listitem").filter({ hasText: campaignName }).filter({ hasText: "(+10%)" }).first();
  await expect(entry.getByText("Aplicada", { exact: true })).toBeVisible();

  await page.goto(`${manage}?view=campanhas`);
  await expect(campaignRow(page, campaignName).getByLabel("Orçamento diário")).toHaveValue(next);
});

test("reverte a alteração de orçamento e repõe o valor original", async ({ page }) => {
  await page.goto(`${manage}?view=historico`);
  const applied = page.getByRole("listitem").filter({ hasText: campaignName }).filter({ hasText: "(+10%)" }).first();
  await applied.getByRole("button", { name: "Reverter" }).click();
  await expect(applied.getByText("Proposta de reversão criada")).toBeVisible();

  await applyPending(page, campaignName, "Orçamento diário");
  const inverse = page.getByRole("listitem").filter({ hasText: campaignName }).filter({ has: page.getByText("Reversão", { exact: true }) }).first();
  await expect(inverse.getByText("Aplicada", { exact: true })).toBeVisible();
  await expect(applied.getByText("Revertida", { exact: true })).toBeVisible();

  await page.goto(`${manage}?view=campanhas`);
  await expect(campaignRow(page, campaignName).getByLabel("Orçamento diário")).toHaveValue(originalBudget);
});

test("pausa e reativa uma campanha ativa", async ({ page }) => {
  await page.goto(`${manage}?view=campanhas`);
  // Primeira campanha com orçamento e botão de estado; se ficou pausada de uma execução anterior, reativa-se primeiro.
  const row = page.getByRole("row").filter({ has: page.getByLabel("Orçamento diário") }).filter({ has: page.getByRole("button", { name: /^(Pausar|Ativar)$/ }) }).first();
  const name = (await row.getByRole("cell").first().innerText()).trim();
  const toggle = async (label: "Pausar" | "Ativar", expected: "Pausado" | "Ativo") => {
    await campaignRow(page, name).getByRole("button", { name: label }).click();
    await expect(campaignRow(page, name).getByText("Proposta criada")).toBeVisible();
    await applyPending(page, name, "Estado");
    await page.goto(`${manage}?view=campanhas`);
    await expect(campaignRow(page, name).getByText(expected, { exact: true })).toBeVisible();
  };
  if (await row.getByText("Pausado", { exact: true }).isVisible()) await toggle("Ativar", "Ativo");
  await toggle("Pausar", "Pausado");
  await toggle("Ativar", "Ativo");
});

test("recusa uma variação de orçamento acima do limite do cliente", async ({ page }) => {
  await page.goto(`${manage}?view=campanhas`);
  const row = page.getByRole("row").filter({ has: page.getByLabel("Orçamento diário") }).first();
  const budget = row.getByLabel("Orçamento diário");
  // O browser bloquearia pelo atributo max; retira-se para exercitar a validação do servidor.
  await budget.evaluate((el) => el.removeAttribute("max"));
  await budget.fill((Number(await budget.inputValue()) * 1.8).toFixed(2));
  await row.getByRole("button", { name: "Propor" }).click();
  await expect(row.getByRole("alert")).toContainText("excede o limite");
});
