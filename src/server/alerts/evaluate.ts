import { delta } from "@/server/metrics/calc";

export const ALERT_TYPES = {
  CPA_INCREASE: { label: "Aumento do custo por conversão", unit: "%", help: "Dispara quando o CPA sobe mais do que X% face à janela anterior." },
  CONVERSIONS_DROP: { label: "Queda de conversões", unit: "%", help: "Dispara quando as conversões descem mais do que X%." },
  ORGANIC_DROP: { label: "Redução de tráfego orgânico", unit: "%", help: "Cliques orgânicos (Search Console) descem mais do que X%." },
  POSITION_DROP: { label: "Queda de posições", unit: "posições", help: "Posição média piora mais do que X posições." },
  BUDGET_DEVIATION: { label: "Desvio de orçamento", unit: "%", help: "Projeção do mês desvia mais do que X% do orçamento." },
  SYNC_FAILURE: { label: "Falha de sincronização", unit: "", help: "Uma fonte de dados está em erro." },
  TOKEN_EXPIRED: { label: "Token OAuth expirado/a expirar", unit: "dias", help: "Credencial expirada ou a expirar em menos de X dias." },
  STALE_DATA: { label: "Ausência de dados recentes", unit: "dias", help: "Última data com dados há mais de X dias." },
  CAMPAIGN_INACTIVE: { label: "Campanha sem atividade", unit: "dias", help: "Campanha ativa sem impressões nos últimos X dias." },
  KPI_CHANGE: { label: "Alteração significativa de KPI", unit: "%", help: "Investimento, cliques ou conversões variam mais do que ±X%." },
} as const;
export type AlertType = keyof typeof ALERT_TYPES;

export interface AlertFinding {
  fingerprint: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  message: string;
  context?: Record<string, unknown>;
}

/** Variação relativa que excede o limiar na direção indicada. Exige amostra mínima. */
export function exceeds(cur: number | null, prev: number | null, thresholdPct: number, direction: "up" | "down" | "both", minPrev = 0): boolean {
  if (cur === null || prev === null || prev < minPrev) return false;
  const d = delta(cur, prev);
  if (d.pct === null) return false;
  if (direction === "up") return d.pct >= thresholdPct;
  if (direction === "down") return d.pct <= -thresholdPct;
  return Math.abs(d.pct) >= thresholdPct;
}

/** Controlo de frequência: só notifica se passou o período de silêncio desde a última notificação. */
export function shouldNotify(lastNotifiedAt: Date | null, cooldownHours: number, now = new Date()): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= cooldownHours * 3_600_000;
}

export function severityFor(pctChange: number | null, threshold: number): "CRITICAL" | "WARNING" {
  return pctChange !== null && Math.abs(pctChange) >= threshold * 2 ? "CRITICAL" : "WARNING";
}
