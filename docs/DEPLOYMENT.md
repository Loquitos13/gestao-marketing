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
- `npm run db:backup` grava em `backups/` (mesmo disco do Postgres). Em Integrações → Configuração → **Cópia de segurança**, indique uma pasta noutro disco ou unidade de rede para receber uma segunda cópia de cada dump.
- Nessa segunda pasta, as cópias `mih-*.dump` com mais de 30 dias são apagadas automaticamente; a pasta `backups/` local não tem limpeza automática.
- O botão “Testar” do grupo verifica se a pasta existe e aceita escrita a partir do processo da aplicação (em Docker, o caminho tem de estar montado no contentor).

## Imagens publicadas

Em cada push para `main` a CI publica no GHCR (tags `latest` e `sha-<commit>`):

- `ghcr.io/loquitos13/gestao-marketing/app`
- `ghcr.io/loquitos13/gestao-marketing/worker` (também usada pelo serviço `migrate`)

O `docker-compose.yml` referencia estas imagens, por isso atualizar o servidor sem compilar localmente é:

```bash
docker compose pull && docker compose --profile full up -d
```

Com `--build` continua a compilar a partir do código local em vez de usar as imagens publicadas.

## Variáveis obrigatórias

`DATABASE_URL`, `ENCRYPTION_KEY` (32 bytes base64), `SESSION_SECRET` (≥ 32 caracteres), `APP_URL`. As restantes estão descritas no `.env.example` e em [API_SETUP.md](API_SETUP.md).

## Escala

O rate limiting usa o Redis quando `REDIS_URL` está definido, por isso várias instâncias da aplicação partilham os limites; sem Redis fica em memória e assume uma instância. O IP do cliente é lido de `X-Real-IP` ou do último valor de `X-Forwarded-For`: o proxy tem de definir um deles, senão todos os pedidos partilham o mesmo limite. Podem correr vários workers; os jobs recorrentes são registados de forma idempotente (`upsertJobScheduler`).

## CI (GitHub Actions)

`.github/workflows/ci.yml` executa, em cada push para `main` e em pull requests:

1. `npm ci`, `npm audit --omit=dev --audit-level=critical` (dependências de produção; as altas conhecidas em `postcss`, `prisma` e `vitest` exigem majors e ficam para o Dependabot), migrações e seed num Postgres e Redis de serviço.
2. `typecheck`, testes unitários e de integração.
3. `next build` e testes e2e Playwright (Chromium) contra o build.
4. Build das imagens Docker `app` e `worker`; em push para `main` publica-as no GHCR (ver acima).
5. `restore-check`: sobe o Postgres do `docker-compose.yml`, migra, faz seed, `npm run db:backup` e `npm run db:restore-check` sobre a cópia criada, garantindo que o backup restaura.

O Dependabot (`.github/dependabot.yml`) abre PRs semanais para npm (minor/patch agrupados; majors de Next, React e Prisma ignorados), GitHub Actions e imagens base do `Dockerfile`.

Os valores de `ENCRYPTION_KEY`, `SESSION_SECRET` e da password de admin no workflow servem apenas para a CI e não protegem dados reais.
