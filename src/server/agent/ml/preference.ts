/**
 * Modelo de preferência: regressão logística (descida de gradiente com regularização L2) sobre
 * características esparsas das sugestões, treinada com as aprovações (1) e recusas (0) do utilizador.
 */

export type Features = Record<string, number>;

export interface Example {
  features: Features;
  approved: boolean;
}

export interface PreferenceModel {
  bias: number;
  weights: Record<string, number>;
  n: number;
  accuracy: number | null;
}

export const MIN_EXAMPLES = 10;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function trainPreference(examples: Example[], { epochs = 300, lr = 0.3, l2 = 0.01 } = {}): PreferenceModel | null {
  if (examples.length < MIN_EXAMPLES) return null;
  const weights: Record<string, number> = {};
  const rate = examples.filter((e) => e.approved).length / examples.length;
  let bias = Math.log(Math.max(0.01, rate) / Math.max(0.01, 1 - rate));
  const n = examples.length;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad: Record<string, number> = {};
    let gBias = 0;
    for (const ex of examples) {
      const err = predictRaw(bias, weights, ex.features) - (ex.approved ? 1 : 0);
      gBias += err;
      for (const [k, v] of Object.entries(ex.features)) grad[k] = (grad[k] ?? 0) + err * v;
    }
    bias -= (lr * gBias) / n;
    for (const k of new Set([...Object.keys(grad), ...Object.keys(weights)])) {
      weights[k] = (weights[k] ?? 0) - lr * ((grad[k] ?? 0) / n + l2 * (weights[k] ?? 0));
    }
  }
  const correct = examples.filter((e) => predictRaw(bias, weights, e.features) >= 0.5 === e.approved).length;
  return { bias, weights, n, accuracy: correct / n };
}

function predictRaw(bias: number, weights: Record<string, number>, f: Features) {
  let z = bias;
  for (const [k, v] of Object.entries(f)) z += (weights[k] ?? 0) * v;
  return sigmoid(z);
}

export function approvalProbability(m: PreferenceModel, f: Features): number {
  return predictRaw(m.bias, m.weights, f);
}

/** Característica com mais peso negativo presente na sugestão (para explicar uma supressão). */
export function strongestObjection(m: PreferenceModel, f: Features): string | null {
  let worst: [string, number] | null = null;
  for (const [k, v] of Object.entries(f)) {
    const contrib = (m.weights[k] ?? 0) * v;
    if (contrib < 0 && (!worst || contrib < worst[1])) worst = [k, contrib];
  }
  return worst?.[0] ?? null;
}

/** Abaixo desta probabilidade, com modelo treinado, a sugestão do agente não é criada. */
export const SUPPRESS_BELOW = 0.15;

export interface SuggestionTraits {
  kind: string;
  platform?: string | null;
  source?: string | null;
  confidence?: string | null;
  priority?: number | null;
  /** Magnitude relativa (ex.: variação de orçamento 0,15). */
  magnitude?: number | null;
  /** Campanha de marca (nome contém "marca" ou "brand"). */
  brand?: boolean;
}

export function featuresOf(t: SuggestionTraits): Features {
  const f: Features = { [`kind=${t.kind}`]: 1 };
  if (t.platform) f[`platform=${t.platform}`] = 1;
  if (t.source) f[`source=${t.source}`] = 1;
  if (t.confidence) f[`confidence=${t.confidence}`] = 1;
  if (t.priority) f[`priority=${t.priority}`] = 1;
  if (t.magnitude !== null && t.magnitude !== undefined) f.magnitude = Math.min(1, Math.abs(t.magnitude));
  if (t.brand) {
    f.brand = 1;
    f[`brand&kind=${t.kind}`] = 1;
  }
  return f;
}

const KIND_LABELS: Record<string, string> = {
  SET_STATUS: "pausas ou ativações",
  SET_DAILY_BUDGET: "alterações de orçamento",
  CREATE_AD: "anúncios novos",
  UPDATE_AD: "novas versões de anúncios",
};

/** Texto legível para uma característica ("costuma recusar pausas em campanhas de marca"). */
export function describeFeature(key: string): string {
  if (key.startsWith("brand&kind=")) return `costuma recusar ${KIND_LABELS[key.slice(11)] ?? key.slice(11)} em campanhas de marca`;
  if (key === "brand") return "costuma recusar sugestões em campanhas de marca";
  if (key.startsWith("kind=")) return `costuma recusar ${KIND_LABELS[key.slice(5)] ?? `sugestões do tipo ${key.slice(5)}`}`;
  if (key.startsWith("platform=")) return `costuma recusar sugestões para ${key.slice(9) === "GOOGLE_ADS" ? "Google Ads" : key.slice(9) === "META_ADS" ? "Meta Ads" : key.slice(9)}`;
  if (key.startsWith("confidence=")) return `costuma recusar sugestões de confiança ${key.slice(11).toLowerCase()}`;
  if (key === "magnitude") return "costuma recusar alterações grandes";
  return `costuma recusar sugestões com ${key}`;
}
