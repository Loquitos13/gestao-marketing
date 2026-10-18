# Implementação em produção

## Docker Compose (uma máquina)

```bash
cp .env.example .env    # NODE_ENV=production, APP_URL=https://o-seu-dominio, chaves geradas, credenciais
docker compose --profile full up -d --build
docker compose --profile full run --rm migrate npm run db:seed   # só na primeira vez
```

Serviços:

| Serviço | Imagem / alvo | Função |
| --- | --- | --- |
| `postgres` | `postgres:16-alpine` | Base de dados (volume `pgdata`) |
| `redis` | `redis:7-alpine` | Filas BullMQ (AOF ativo, volume `redisdata`) |
| `migrate` | `Dockerfile`, alvo `worker` | `prisma migrate deploy` antes de arrancar app e worker |
| `app` | `Dockerfile`, alvo `app` | Next.js standalone na porta 3100, health check em `/api/health` |
| `worker` | `Dockerfile`, alvo `worker` | Sincronizações, alertas, recomendações, relatórios agendados, retenção |

Antes de expor publicamente:

- Altere a password do Postgres no `docker-compose.yml` e não publique as portas 5442/6392.
- Coloque um proxy com TLS à frente (Caddy, Nginx, Traefik). O cookie de sessão é `Secure` em produção e é enviado HSTS.
- `APP_URL` tem de corresponder ao domínio público; os URIs de redirecionamento OAuth derivam dele.
- Altere a password do utilizador inicial após o primeiro login e defina `SEED_DEMO=false` se não quiser clientes de demonstração.
- Faça backups regulares do Postgres. **Guarde a `ENCRYPTION_KEY` em local seguro:** sem ela, os tokens guardados não podem ser desencriptados e é preciso voltar a ligar as contas.

## Variáveis obrigatórias

`DATABASE_URL`, `ENCRYPTION_KEY` (32 bytes base64), `SESSION_SECRET` (≥ 32 caracteres), `APP_URL`. As restantes estão descritas no `.env.example` e em [API_SETUP.md](API_SETUP.md).

## Escala

O rate limiting é em memória e assume uma instância da aplicação. Várias instâncias exigem mover o rate limiter para Redis. Podem correr vários workers; os jobs recorrentes são registados de forma idempotente (`upsertJobScheduler`).

## CI (GitHub Actions)

`.github/workflows/ci.yml` executa, em cada push para `main` e em pull requests:

1. `npm ci`, migrações e seed num Postgres e Redis de serviço.
2. `typecheck`, testes unitários e de integração.
3. `next build` e testes e2e Playwright (Chromium) contra o build.
4. Build das imagens Docker `app` e `worker` (sem publicar).

Os valores de `ENCRYPTION_KEY`, `SESSION_SECRET` e da password de admin no workflow servem apenas para a CI e não protegem dados reais.
