# Métricas e regras de cálculo

As definições (nome, fórmula, fonte, se é «maior é melhor») estão em `src/server/metrics/definitions.ts` e são mostradas nos tooltips de cada KPI.

## Regras gerais

1. **Nada é inventado.** Se a fonte não está ligada, não tem dados no período ou a métrica não existe nessa plataforma, o valor é `null` e aparece «Não disponível».
2. **Divisões por zero** devolvem `null`, nunca 0 nem infinito.
3. **Rácios recalculam-se a partir dos totais** (ex.: CTR = Σ cliques ÷ Σ impressões), nunca como média de rácios diários.
4. **Não se somam métricas incompatíveis.** O alcance da Meta não é aditivo entre dias ou campanhas e só é mostrado como reportado. Conversões da Google Ads e da Meta usam modelos de atribuição diferentes: são apresentadas por plataforma e o total é identificado como «soma das conversões reportadas pelas plataformas».
5. **Moedas.** Valores em moedas diferentes nunca são somados. O painel global mostra totais separados por moeda. Uma conta noutra moeda só é convertida para a moeda do cliente se existir uma taxa registada em **Definições → Taxas de câmbio** (com fonte), usando a mais recente até ao fim do período; sem taxa, o custo dessa conta fica «Não disponível».
6. **Fusos horários.** Timestamps guardados em UTC. «Ontem», «últimos 30 dias», etc. são calculados no fuso do cliente. Dias de métricas seguem o fuso da conta de origem.
7. **Origem dos dados.** Cada valor tem origem `REAL`, `SIMULATED` ou `MIXED`. Dados simulados (modo demo) estão marcados em todo o lado, incluindo PDF e exportações. Períodos com dias em falta são marcados como incompletos.

## Fórmulas

| Métrica | Fórmula |
| --- | --- |
| CTR | Cliques ÷ Impressões |
| CPC | Investimento ÷ Cliques |
| CPM | Investimento ÷ Impressões × 1000 |
| Frequência (Meta) | Impressões ÷ Alcance |
| Taxa de conversão | Conversões ÷ Cliques |
| CPA | Investimento ÷ Conversões |
| CPL | Investimento ÷ Leads |
| ROAS | Receita atribuída ÷ Investimento |
| ROI | (Receita atribuída × Margem bruta − Investimento) ÷ Investimento (só com margem bruta definida no cliente) |
| CTR orgânico | Cliques ÷ Impressões (Search Console) |
| Posição média | Σ(posição × impressões) ÷ Σ impressões |
| Taxa de envolvimento (GA4) | Sessões com interação ÷ Sessões |
| Envolvimento de conteúdo | (Reações + Comentários + Partilhas + Guardados + Cliques) ÷ Impressões |

Valores da Google Ads em micros são divididos por 1 000 000. Conversões ausentes na resposta da API ficam `null`, não 0.

## Comparações

Cada KPI mostra valor atual, valor anterior, variação absoluta e percentual. A comparação pode ser com o período anterior de igual duração ou com o mesmo período do ano anterior. Sem valor anterior, a variação fica «Não disponível». A cor da variação respeita o sentido da métrica (ex.: subida do CPA a vermelho).

## Ritmo de orçamento

Projeção do período = investimento até à data + média diária dos últimos 7 dias (dentro do período) × dias restantes; se não houver dias recentes, usa a média desde o início do período. Estado:

- **Acima do orçamento**: projeção acima de 105% do orçamento.
- **Abaixo do ritmo**: projeção abaixo de 85% do orçamento.
- **No ritmo**: entre os dois limites.
- **Não iniciado** / **Terminado**: antes do início ou depois do fim do período.
