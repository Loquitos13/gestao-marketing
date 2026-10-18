/**
 * Especificação dos clientes de demonstração. Todos os dados derivados são SIMULADOS.
 * Cada cliente inclui cenários que alimentam recomendações e alertas reais do motor:
 *  - budgetLimited: bom ROAS mas limitado por orçamento
 *  - cpaSpike: aumento do custo por conversão nas últimas semanas
 *  - overspend: ritmo de investimento acima do orçamento mensal
 *  - fatigue (anúncio): CTR decrescente e frequência crescente
 */
import type { DemoClientSpec } from "./spec-types";
import { atlantico } from "./clients/atlantico";
import { sorriso } from "./clients/sorriso";
import { horizonte } from "./clients/horizonte";

export type * from "./spec-types";

export const DEMO_CLIENTS: DemoClientSpec[] = [atlantico, sorriso, horizonte];
