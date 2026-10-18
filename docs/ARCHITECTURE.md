# Arquitetura

## Componentes

```
Browser ──HTTPS──▶ Next.js 15 (App Router, Server Components, Server Actions)
                     │  src/app            páginas e rotas API
                     │  src/server         lógica de domínio (só servidor, "server-only")
                     ▼
                  PostgreSQL 16 (Prisma) ◀── Worker (BullMQ) ◀── Redis 7
                                              │
                                              ▼
                       APIs oficiais: Google Ads, Search Console, GA4, Meta Graph, Semrush
```

- **Aplicação** (`npm run start`): interface, autenticação, exportações e ações do utilizador. Sem Redis, as sincronizações pedidas correm na própria aplicação.
- **Worker** (`npm run worker`): fila `sync` (concorrência 3, máx. 10 jobs/min) e fila `maintenance` com tarefas recorrentes em UTC:
  - `daily-sync` às 05:00: sincronização incremental de todas as fontes ativas.
  - `intelligence` de hora a hora: alertas e recomendações.
  - `report-schedules` a cada 15 min: relatórios agendados.
  - `retention` às 03:00: limpeza de métricas diárias mais antigas do que a retenção da organização, sessões expiradas e logs de sincronização com mais de 90 dias.

## Estrutura de pastas

| Pasta | Conteúdo |
| --- | --- |
| `src/app/(app)` | Páginas autenticadas: painel global, clientes, integrações, alertas, definições e `c/[clientId]/*` (secções do cliente) |
| `src/app/api` | OAuth, exportações de relatórios, partilha pública, RGPD, health check |
| `src/server/auth` | Sessões, passwords, RBAC, guardas de acesso e isolamento por organização/cliente |
| `src/server/integrations` | Cliente HTTP com retry/backoff, conectores de cada API, cofre de tokens |
| `src/server/sync` | Fila, runner (intervalos incremental/histórico) e escrita idempotente |
| `src/server/metrics` | Definições de métricas, cálculos e agregações |
| `src/server/queries` | Consultas de leitura para as páginas (filtros, períodos, comparação, câmbio) |
| `src/server/reports` | Construção do snapshot, secções, PDF, CSV, Excel, agendamento e envio |
| `src/server/intelligence`, `src/server/alerts` | Regras de recomendação e avaliação de alertas |
| `src/demo` | Gerador determinístico de dados simulados |
| `src/worker` | Processo do worker |

## Modelo de dados (resumo)

- **Organization → Client**: todos os dados pertencem a um cliente, e cada cliente a uma organização. `OrganizationMember` define o papel; `ClientMember` dá acesso a leitores.
- **OAuthCredential**: tokens encriptados por organização e fornecedor. **ConnectedAccount**: contas descobertas (cliente Google Ads, conta de anúncios Meta, propriedade GA4, site Search Console, página/Instagram).
- **DataSource**: associação cliente ↔ conta, com `origin` (`REAL` ou `SIMULATED`), estado, janela de dados disponível e última sincronização. **SyncJob/SyncLog**: histórico de cada execução.
- **Métricas diárias**: `AdMetricDaily` (níveis conta/campanha/grupo/anúncio), `CampaignBreakdownDaily` (dispositivo, idade, género, região, posicionamento), `AdsTermDaily`, `SearchMetricDaily`, `WebAnalyticsDaily`, `OrganicContent`, `SeoKeywordSnapshot`. Cada linha tem uma chave natural única: reimportar substitui em vez de duplicar.
- **Budget, Goal, ExchangeRate** · **Report, ReportSchedule, ReportDelivery, ReportTemplate** · **Recommendation, AlertRule, Alert** · **AuditLog**.
- Datas de métricas são dias de calendário no fuso da conta de origem; timestamps em UTC.

## Segurança

| Tema | Implementação |
| --- | --- |
| Tokens OAuth | AES-256-GCM com `ENCRYPTION_KEY` (IV aleatório por valor); nunca enviados ao browser, a logs ou a relatórios. Logs passam por `scrubSecrets` |
| Sessões | Token aleatório em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; só o SHA-256 fica na BD; expiração e revogação |
| Passwords | bcrypt (12 rondas); mínimo 10 caracteres com letras e números; limite de 5 tentativas por 15 min por email+IP |
| Autorização | RBAC por permissão; acesso a clientes verificado em cada página, ação e rota (`requireClient`, `resolveClientAccess`). Recursos de outra organização devolvem 404 |
| CSRF | Server Actions validam a origem (Next.js); cookies `SameSite=Lax`; estado OAuth assinado (HMAC) com expiração de 10 min |
| XSS | React escapa o conteúdo; CSP restritiva (`object-src 'none'`, `frame-ancestors 'none'`); URLs de logótipos só `https:` |
| SQL injection | Prisma com consultas parametrizadas; a única SQL crua é o `SELECT 1` do health check |
| Validação | zod em todas as ações e parâmetros de rota |
| Partilha de relatórios | Token aleatório de 24 bytes, só o hash fica na BD; expiração, revogação, `noindex`, `no-referrer` e rate limit |
| Exportações | CSV protegido contra injeção de fórmulas; `Cache-Control: private, no-store` |
| Auditoria | Ações relevantes registadas com utilizador, cliente e metadados; IP só como hash |
| Ações externas | Não existe nenhuma chamada de escrita às APIs de anúncios. Recomendações são apenas propostas |

## Resiliência das integrações

- `requestJson`: timeout, até 5 tentativas com backoff exponencial e jitter em 429/5xx/erros de rede, respeito por `Retry-After`; erros 401/403 e de configuração não são repetidos.
- Paginação: `nextPageToken` (Google Ads), `startRow` (Search Console), `offset` (GA4), cursores (Meta).
- Intervalos longos divididos em blocos; escrita em lotes com `upsert` pela chave natural.
- Falhas não recuperáveis marcam a fonte em erro e geram alerta; o job pode ser repetido em Histórico.
