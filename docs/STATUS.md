# Estado da implementação

Atualizado em 15/10/2026. Legenda:

- **Implementado e verificado**: código completo, exercitado com dados de demonstração e/ou testes automáticos.
- **Implementado, depende de credenciais**: código completo e testado com respostas HTTP simuladas, mas **nunca executado contra a API real** neste ambiente. Só pode ser considerado funcional depois de ligar uma conta real e ver uma sincronização concluída (a página Integrações só mostra «Verificada» quando existe uma sincronização real com sucesso).
- **Não implementado**: ausente ou apenas preparado no modelo de dados.

## Verificação realizada

| Verificação | Resultado |
| --- | --- |
| `tsc --noEmit` | sem erros |
| Testes unitários (Vitest) | 135 testes: métricas, datas e fusos, agendamentos, ritmo de orçamento, câmbio, criptografia, RBAC, isolamento de clientes, clientes HTTP com retry/backoff, paginação dos conectores, renovação de tokens, regras de recomendação e alertas, CSV/PDF, dados demo, configuração encriptada, Top 10, gestão de anúncios (validação, releitura, proteções, distribuição de budget, criativos), agente (Holt-Winters, curvas de resposta, anomalias, preferências, verificação de números, ciclo de ferramentas com LLM simulado, streaming Ollama), concorrência (SSRF, robots.txt, extração HTML/sitemap, rastreio, PageSpeed, Keyword Planner, Ad Library, análises, proposta de palavras-chave) |
| Verificação manual (15/10/2026) | Cliente demo: gestão de anúncios (aplicar, reverter, novo anúncio), chat do agente com Ollama local (`qwen2.5:7b-instruct`), resumo IA nos relatórios, página Concorrência (todas as fontes, sugestões, proposta de palavra-chave confirmada em Gestão, rascunho de anúncio a partir de um anúncio de concorrente). Rastreio real de `example.com`; bloqueio confirmado de `localhost`, `127.0.0.1`, `localtest.me` e de DNS rebinding |
| `next build` | sem erros (15/10/2026) |
| Testes de integração (Postgres real) | 4 testes: isolamento entre organizações, acesso de leitores, clientes arquivados, geração de relatório, link de partilha (hash, expiração, revogação), envio sem SMTP registado como `SKIPPED_NOT_CONFIGURED` |
| Testes e2e (Playwright) | 8 testes: login, redirecionamento sem sessão, 401 em exportações anónimas, painel global com clientes DEMO, navegação nas secções do cliente (incluindo Gestão, Agente IA e os cinco separadores de Concorrência), configuração das integrações sem expor segredos, registo de taxa de câmbio, 404 entre clientes, geração e exportação de relatório PDF/CSV/Excel |
| Smoke test | todas as páginas e exportações respondem 200 com sessão; 401/404 onde esperado, em desenvolvimento e na imagem Docker de produção |
| Build de produção | imagens `app` e `worker` construídas; a `app` passou o smoke test e o worker arrancou ligado ao Redis |
| `npm run integrations:verify` | chama cada conector REAL de um cliente (`--client` id ou nome) para o dia de ontem, sem escrever métricas; tabela plataforma/conta/linhas/erro, sai com 1 se algum falhar; fontes simuladas são ignoradas |
| `npm run load:sync` | teste de carga do `writeSyncResult`: conta fictícia com 3000 anúncios (`--ads`) e 30 dias de métricas escrita duas vezes (inserções; sem alterações) numa organização/cliente LOADTEST descartáveis, apagados no fim; recusa em produção |
| `npm run agent:eval` | 20 perguntas em português sobre o cliente demo "Loja Atlântico (DEMO)" ao agente com Ollama e BD reais (`tests/eval/cases.json`); verifica frases obrigatórias/proibidas e a ferramenta usada, exige ≥ 80%; ignorado sem Ollama/BD e fora do `npm test` |

## Módulos

| Módulo | Estado | Notas |
| --- | --- | --- |
| Autenticação e sessões | Implementado e verificado | Sessões na BD (só hash do token), cookie httpOnly/SameSite, limite de 5 tentativas de login por 15 min, bcrypt |
| RBAC e isolamento | Implementado e verificado | Proprietário, Administrador, Analista, Leitor (só clientes atribuídos). Acesso a cliente de outra organização devolve 404 |
| Painel global | Implementado e verificado | Totais separados por moeda; sinalização de dados simulados |
| Clientes | Implementado e verificado | Criar, editar, arquivar, restaurar, eliminar (confirmação por nome), objetivos, acessos |
| Integrações (ecrã, OAuth, cofre de tokens) | Implementado, depende de credenciais | Fluxo OAuth com estado assinado, tokens AES-256-GCM, renovação automática, revogação no fornecedor |
| Google Ads (GAQL) | Implementado, depende de credenciais | Requer developer token aprovado. Campanhas, grupos, anúncios, termos de pesquisa, segmentos |
| Meta Ads (Marketing API) | Implementado, depende de credenciais | Insights por nível, paginação por cursor, divisão de intervalos longos |
| Search Console | Implementado, depende de credenciais | Paginação por `startRow`, dimensões consulta/página/dispositivo/país |
| GA4 (Data API) | Implementado, depende de credenciais | Sessões, utilizadores, envolvimento, conversões por canal e página |
| Conteúdo orgânico Facebook/Instagram | Implementado, depende de credenciais | Requer páginas e contas Instagram Business ligadas |
| Semrush | Implementado, depende de credenciais | Requer `SEMRUSH_API_KEY` (consome unidades da conta) |
| Sincronização | Implementado e verificado (com fonte demo) | Incremental, histórica (até ~3 anos), reprocessamento, deduplicação por chave natural, logs, repetição de jobs falhados |
| Campanhas, SEO, Orçamento, Histórico | Implementado e verificado | Com dados demo |
| Relatórios (22 secções) | Implementado e verificado | PDF, CSV, Excel, layout de impressão, link partilhável com expiração e revogação |
| Agendamento de relatórios | Implementado e verificado (lógica) | Executado pelo worker a cada 15 min |
| Envio de relatórios e alertas por email | Implementado, depende de SMTP | **Sem `SMTP_HOST` nada é enviado** e o envio fica registado como «Não enviado: SMTP não configurado». Com SMTP, só fica «Enviado» após aceitação pelo servidor |
| Recomendações por regras e estatísticas | Implementado e verificado | 10 regras determinísticas e 1 projeção estatística (ritmo de orçamento); aprovação/recusa humana; nada é aplicado nas plataformas |
| Configuração das integrações na interface | Implementado e verificado | Integrações → Configuração; valores encriptados na BD, sobrepõem-se ao `.env`; `SETTINGS_ENV_ONLY=1` bloqueia |
| Top 10 conteúdos | Implementado e verificado | Com dados demo |
| Gestão de anúncios Google/Meta (pausar/ativar, orçamentos, distribuição por objetivo, criar/editar anúncios, palavras-chave) | Implementado e verificado com dados demo; **depende de credenciais** para contas reais | Cada alteração é uma proposta que exige confirmação explícita; `validate_only` e releitura do estado antes de aplicar; limite de variação de orçamento; reverter; auditoria. Google precisa de developer token com Basic access; Meta precisa de `ads_management` (App Review, acesso avançado, Business Verification). Nunca executado contra uma conta real neste ambiente |
| Agente de IA local (Ollama) | Implementado e verificado localmente | Modelos estatísticos próprios em TypeScript + LLM local via Ollama com ferramentas de leitura e de rascunho. Nunca aplica: só cria propostas. Números verificados contra os dados; texto de terceiros tratado como não confiável. Aprende com aprovações/recusas; exportação JSONL opcional para LoRA |
| Recomendações por IA | Implementado e verificado (demo + Ollama local) | Ciclo autónomo no worker (registo `AgentRun`); separado das recomendações por regras |
| Pesquisa de concorrência | Implementado e verificado com dados demo; rastreio verificado em site real | Fontes: rastreio próprio de páginas públicas (robots.txt, 1 pedido/s, proteção SSRF), Keyword Planner, Biblioteca de Anúncios da Meta, PageSpeed Insights. Lacunas de palavras-chave e de conteúdo, ângulos de mensagens, comparação de velocidade, sugestões de concorrentes. **Keyword Planner, Ad Library e PageSpeed dependem de credenciais** e nunca foram executados contra as APIs reais neste ambiente |
| Alertas | Implementado e verificado | 10 tipos, limiares por regra, deduplicação por impressão digital, contador de ocorrências, cooldown, resolução automática |
| Taxas de câmbio | Implementado e verificado | Registo manual com fonte obrigatória em Definições; sem taxa, o valor não é convertido |
| Definições e auditoria | Implementado e verificado | Organização, membros e papéis, sessões, registo de auditoria filtrável |
| RGPD | Implementado e verificado | Exportação JSON por cliente e por utilizador (sem tokens nem hashes); eliminação em cascata |
| Docker, CI | Implementado | Imagens verificadas localmente; o workflow do GitHub Actions ainda não correu num repositório remoto |

## Limitações conhecidas

- O rate limiting de login, partilhas, testes de configuração e sincronizações usa o Redis quando está configurado. Sem Redis, fica em memória neste processo.
- As taxas de câmbio são globais à instalação (pensado para um único operador).
- Não há autenticação de dois fatores nem recuperação de password por email.
- A aplicação só altera orçamentos, estados, anúncios e palavras-chave nas plataformas depois de a gestão ser ativada para o cliente e de cada proposta ser confirmada por um utilizador. Não altera licitações. Anúncios e palavras-chave novos são criados em pausa.
- Auction Insights e o Centro de Transparência de Anúncios da Google não têm API pública; não estão disponíveis. Não é feito scraping dos resultados da Google.
- O agente de IA depende de um Ollama a correr no mesmo servidor; o desempenho depende do hardware.
- A CSP usa `'unsafe-inline'` em `script-src` porque o Next.js injeta scripts inline sem nonces.
- Os dados demo são realistas mas fictícios. Não servem para avaliar a qualidade das integrações reais.
