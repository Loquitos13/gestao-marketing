import { describe, expect, it } from "vitest";
import { onboardingSteps, type OnboardingInput } from "@/server/queries/onboarding";

const empty: OnboardingInput = { clientId: "c1", hasSources: false, hasSync: false, hasPaidSources: false, hasBudget: false, hasGoals: false, hasReport: false, adsManagementEnabled: false };

describe("onboarding", () => {
  it("sem nada feito: 0 de 5 (sem passo de anúncios sem fontes pagas)", () => {
    const r = onboardingSteps(empty);
    expect(r.done).toBe(0);
    expect(r.total).toBe(5);
    expect(r.steps.map((s) => s.key)).not.toContain("ads");
    expect(r.steps[0]!.href).toBe("/c/c1/sources");
  });

  it("com fontes pagas aparece o passo de gestão de anúncios", () => {
    const r = onboardingSteps({ ...empty, hasSources: true, hasPaidSources: true });
    expect(r.total).toBe(6);
    expect(r.done).toBe(1);
    expect(r.steps.at(-1)).toMatchObject({ key: "ads", done: false, href: "/c/c1/manage" });
  });

  it("tudo definido: todos concluídos", () => {
    const r = onboardingSteps({ clientId: "c1", hasSources: true, hasSync: true, hasPaidSources: true, hasBudget: true, hasGoals: true, hasReport: true, adsManagementEnabled: true });
    expect(r.done).toBe(r.total);
    expect(r.steps.every((s) => s.done)).toBe(true);
  });
});
