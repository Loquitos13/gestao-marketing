import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { approvalProbability, describeFeature, featuresOf, strongestObjection, SUPPRESS_BELOW, trainPreference, type Example, type PreferenceModel, type SuggestionTraits } from "./ml/preference";

const BRAND = /\b(marca|brand)\b/i;

/** Exemplos de decisões da organização: recomendações decididas e propostas confirmadas ou canceladas pelo utilizador. */
export async function decisionExamples(organizationId: string): Promise<Example[]> {
  const [recs, changes] = await Promise.all([
    prisma.recommendation.findMany({
      where: { client: { organizationId }, status: { in: ["APPROVED", "DONE", "DISMISSED"] }, decidedAt: { not: null } },
      select: { type: true, platform: true, source: true, confidence: true, priority: true, entityName: true, status: true },
      take: 5000,
    }),
    // Propostas canceladas automaticamente (substituídas) têm `error` preenchido e não contam como recusa.
    prisma.adChange.findMany({
      where: { client: { organizationId }, OR: [{ status: { in: ["APPLIED", "REVERTED"] } }, { status: "CANCELLED", error: null }] },
      select: { operation: true, platform: true, source: true, entityName: true, before: true, after: true, status: true },
      take: 5000,
    }),
  ]);
  const out: Example[] = [];
  for (const r of recs) out.push({ approved: r.status !== "DISMISSED", features: featuresOf({ kind: r.type, platform: r.platform, source: r.source, confidence: r.confidence, priority: r.priority, brand: BRAND.test(r.entityName ?? "") }) });
  for (const c of changes) out.push({ approved: c.status !== "CANCELLED", features: featuresOf(changeTraits(c)) });
  return out;
}

export function changeTraits(c: { operation: string; platform: string; source: string; entityName: string; before: unknown; after: unknown }): SuggestionTraits {
  const b = (c.before ?? {}) as { dailyBudget?: number };
  const a = (c.after ?? {}) as { dailyBudget?: number; status?: string };
  const magnitude = b.dailyBudget && a.dailyBudget ? a.dailyBudget / b.dailyBudget - 1 : null;
  const kind = c.operation === "SET_STATUS" && a.status ? `SET_STATUS_${a.status === "PAUSED" ? "PAUSE" : "ACTIVATE"}` : c.operation;
  return { kind, platform: c.platform, source: c.source, magnitude, brand: BRAND.test(c.entityName) };
}

export async function trainOrgPreference(organizationId: string) {
  const examples = await decisionExamples(organizationId);
  const model = trainPreference(examples);
  if (!model) return { organizationId, examples: examples.length, trained: false };
  const data = { weights: { bias: model.bias, weights: model.weights } as Prisma.InputJsonValue, n: model.n, accuracy: model.accuracy, trainedAt: new Date() };
  await prisma.agentPreference.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return { organizationId, examples: examples.length, trained: true, accuracy: model.accuracy };
}

export async function trainAllPreferences() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const out = [];
  for (const o of orgs) out.push(await trainOrgPreference(o.id));
  return out;
}

export async function loadPreference(organizationId: string): Promise<PreferenceModel | null> {
  const p = await prisma.agentPreference.findUnique({ where: { organizationId } });
  if (!p) return null;
  const w = p.weights as { bias: number; weights: Record<string, number> };
  return { bias: w.bias, weights: w.weights, n: p.n, accuracy: p.accuracy };
}

export interface GateResult {
  allowed: boolean;
  probability: number | null;
  reason: string | null;
}

/** Suprime sugestões que o utilizador recusa de forma consistente; caso contrário devolve a probabilidade de aprovação. */
export function gateSuggestion(model: PreferenceModel | null, traits: SuggestionTraits): GateResult {
  if (!model) return { allowed: true, probability: null, reason: null };
  const f = featuresOf(traits);
  const p = approvalProbability(model, f);
  const objection = strongestObjection(model, f);
  return { allowed: p >= SUPPRESS_BELOW, probability: p, reason: objection ? describeFeature(objection) : null };
}
