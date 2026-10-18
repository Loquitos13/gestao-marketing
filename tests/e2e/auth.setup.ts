import { expect, test as setup } from "@playwright/test";

setup("autenticação do administrador", async ({ page }) => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD (utilizador criado pelo seed) para os testes e2e.");

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await page.context().storageState({ path: "tests/e2e/.auth/admin.json" });
});
