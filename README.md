# Marketing Intelligence Hub

Plataforma para gerir, monitorizar e analisar o marketing digital de vários clientes: Google Ads, Meta Ads, SEO (Search Console, GA4, Semrush opcional), conteúdo orgânico, orçamentos, relatórios, recomendações e alertas.

> **Estado honesto:** o que está implementado e testado, e o que depende de credenciais reais, está em [`docs/STATUS.md`](docs/STATUS.md). As integrações reais ainda não foram validadas contra as APIs oficiais (sem credenciais neste ambiente).

## Arranque rápido (desenvolvimento)

Requisitos: Node.js 22+, Docker.

```bash
cp .env.example .env              # preencher ENCRYPTION_KEY e SESSION_SECRET (ver comentários)
npm install
npm run db:up                     # Postgres (5442) e Redis (6392)
npx prisma migrate deploy
npm run db:seed                   # utilizador ADMIN_EMAIL + 3 clientes DEMO (dados simulados)
npm run dev                       # http://localhost:3100
npm run worker                    # noutro terminal: sincronizações, alertas, agendamentos
```

Gerar as chaves:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" # SESSION_SECRET
```

Sem Redis, as sincronizações correm a pedido dentro da aplicação; alertas automáticos, sincronizações diárias e relatórios agendados exigem o worker.

## Modo de demonstração

Com `SEED_DEMO=true`, o seed cria três clientes fictícios: **Loja Atlântico (DEMO)**, **Clínica Sorriso Porto (DEMO)** e **Horizonte Software B2B (DEMO)**. Todos os dados são gerados de forma determinística, marcados como `SIMULATED` na base de dados e identificados na interface, nos PDF e nas exportações. Para não criar dados de demonstração: `SEED_DEMO=false`.

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm run dev` / `npm run worker` | Aplicação e worker em desenvolvimento |
| `npm run typecheck` | Verificação de tipos |
| `npm test` | Testes unitários e de integração (Vitest; os de integração usam `DATABASE_URL` e são ignorados se a BD não responder) |
| `npm run test:e2e` | Testes e2e (Playwright; precisa de `ADMIN_EMAIL`/`ADMIN_PASSWORD` do seed) |
| `npm run smoke` | Pede todas as páginas e exportações a uma instância em execução |
| `npm run build` | Build de produção (output `standalone`) |

## Documentação

- [`docs/STATUS.md`](docs/STATUS.md): implementado, dependente de credenciais e não implementado
- [`docs/API_SETUP.md`](docs/API_SETUP.md): como obter credenciais Google, Meta e Semrush
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): arquitetura, segurança e modelo de dados
- [`docs/METRICS.md`](docs/METRICS.md): definições e regras de cálculo
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): Docker, produção e CI

## Princípios

- Apenas APIs oficiais. Sem scraping.
- Nenhuma alteração é feita nas plataformas de anúncios: a aplicação só lê dados. Recomendações são propostas que exigem decisão humana.
- Tokens OAuth encriptados (AES-256-GCM) no servidor; nunca chegam ao browser, ao repositório nem aos relatórios.
- Métricas em falta aparecem como «Não disponível». Nada é inventado, e métricas incompatíveis ou de moedas diferentes não são somadas.
- Datas guardadas em UTC e apresentadas no fuso horário do cliente.
