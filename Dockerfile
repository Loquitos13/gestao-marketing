# syntax=docker/dockerfile:1.7
# Alvos: "app" (Next.js standalone) e "worker" (BullMQ + migrações + seed).

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
COPY . .
# Valores fictícios apenas para o build (nenhum segredo é incorporado na imagem).
RUN ENCRYPTION_KEY=$(node -e "process.stdout.write(Buffer.alloc(32).toString('base64'))") \
    SESSION_SECRET=build-only-placeholder-secret-0000000000 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npm run build

FROM base AS worker
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN useradd --system --uid 1001 mih && chown -R mih /app
USER mih
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3199/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "worker"]

FROM base AS app
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 mih
COPY --from=builder --chown=mih /app/.next/standalone ./
COPY --from=builder --chown=mih /app/.next/static ./.next/static
USER mih
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
