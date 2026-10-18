import type { ConnectedAccount, Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { integrationStatus } from "@/server/config/settings";
import { logger } from "@/lib/logger";
import { emailFromIdToken, type GoogleTokenResponse } from "./google/oauth";
import { discoverGoogleAdsAccounts } from "./google/ads";
import { discoverSearchConsoleSites } from "./google/search-console";
import { discoverGa4Properties } from "./google/ga4";
import { discoverMetaAdAccounts } from "./meta/ads";
import { discoverMetaPages } from "./meta/organic";
import { graphGet, grantedMetaScopes } from "./meta/graph";
import { getValidAccessToken } from "./tokens";
import type { DiscoveredAccount } from "./types";

export interface DiscoveryReport {
  credentialId: string;
  found: Partial<Record<Platform, number>>;
  errors: { platform: Platform; message: string }[];
}

async function upsertAccounts(credentialId: string, accounts: DiscoveredAccount[]) {
  for (const a of accounts) {
    await prisma.connectedAccount.upsert({
      where: { credentialId_platform_externalId: { credentialId, platform: a.platform, externalId: a.externalId } },
      create: { credentialId, platform: a.platform, externalId: a.externalId, name: a.name, currency: a.currency ?? null, timezone: a.timezone ?? null, managerId: a.managerId ?? null, metadata: (a.metadata ?? {}) as Prisma.InputJsonValue },
      update: { name: a.name, currency: a.currency ?? null, timezone: a.timezone ?? null, managerId: a.managerId ?? null, metadata: (a.metadata ?? {}) as Prisma.InputJsonValue, discoveredAt: new Date() },
    });
  }
}

async function runDiscovery(credentialId: string, token: string, tasks: DiscoveryTask[]): Promise<DiscoveryReport> {
  const report: DiscoveryReport = { credentialId, found: {}, errors: [] };
  for (const [platform, fn] of tasks) {
    try {
      const accounts = await fn(token);
      await upsertAccounts(credentialId, accounts);
      report.found[platform] = accounts.length;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report.errors.push({ platform, message });
      logger.warn({ credentialId, platform, error: message }, "Descoberta de contas falhou");
    }
  }
  return report;
}

type DiscoveryTask = [Platform, (t: string) => Promise<DiscoveredAccount[]>];

async function googleTasks(): Promise<DiscoveryTask[]> {
  const tasks: DiscoveryTask[] = [
    ["SEARCH_CONSOLE", discoverSearchConsoleSites],
    ["GA4", discoverGa4Properties],
  ];
  if ((await integrationStatus()).googleAds) tasks.unshift(["GOOGLE_ADS", discoverGoogleAdsAccounts]);
  return tasks;
}

const metaTasks: DiscoveryTask[] = [
  ["META_ADS", discoverMetaAdAccounts],
  ["META_ORGANIC", discoverMetaPages],
];

/** Guarda (ou atualiza) a credencial Google do mesmo utilizador externo; tokens apenas encriptados. */
export async function saveGoogleCredential(organizationId: string, t: GoogleTokenResponse): Promise<DiscoveryReport> {
  const email = emailFromIdToken(t.id_token);
  const existing = email ? await prisma.oAuthCredential.findFirst({ where: { organizationId, provider: "GOOGLE", externalUserId: email } }) : null;
  const data = {
    scopes: t.scope.split(" "),
    accessTokenEnc: encrypt(t.access_token),
    accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    status: "ACTIVE",
    lastRefreshedAt: new Date(),
    lastError: null,
    ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token) } : {}),
  };
  const cred = existing
    ? await prisma.oAuthCredential.update({ where: { id: existing.id }, data })
    : await prisma.oAuthCredential.create({ data: { organizationId, provider: "GOOGLE", externalUserId: email, externalUserName: email, ...data } });
  return runDiscovery(cred.id, t.access_token, await googleTasks());
}

export async function saveMetaCredential(organizationId: string, t: { access_token: string; expires_in?: number }): Promise<DiscoveryReport> {
  const me = await graphGet<{ id: string; name?: string }>("me", t.access_token, { fields: "id,name" });
  const existing = await prisma.oAuthCredential.findFirst({ where: { organizationId, provider: "META", externalUserId: me.id } });
  const data = {
    scopes: await grantedMetaScopes(t.access_token),
    accessTokenEnc: encrypt(t.access_token),
    accessTokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    status: "ACTIVE",
    lastRefreshedAt: new Date(),
    lastError: null,
    externalUserName: me.name ?? null,
  };
  const cred = existing
    ? await prisma.oAuthCredential.update({ where: { id: existing.id }, data })
    : await prisma.oAuthCredential.create({ data: { organizationId, provider: "META", externalUserId: me.id, ...data } });
  return runDiscovery(cred.id, t.access_token, metaTasks);
}

/** Volta a listar as contas acessíveis com a credencial existente. */
export async function rediscover(credentialId: string): Promise<DiscoveryReport> {
  const cred = await prisma.oAuthCredential.findUniqueOrThrow({ where: { id: credentialId } });
  const token = await getValidAccessToken(cred, { db: prisma });
  return runDiscovery(cred.id, token, cred.provider === "GOOGLE" ? await googleTasks() : metaTasks);
}

/** Liga uma conta descoberta a um cliente como fonte de dados REAL. */
export async function linkAccountToClient(clientId: string, account: ConnectedAccount & { credential: { organizationId: string } }, clientDefaults: { currency: string; timezone: string }) {
  const meta = (account.metadata ?? {}) as Record<string, unknown>;
  return prisma.dataSource.upsert({
    where: { clientId_platform_externalId: { clientId, platform: account.platform, externalId: account.externalId } },
    create: {
      clientId,
      connectedAccountId: account.id,
      platform: account.platform,
      origin: "REAL",
      externalId: account.externalId,
      name: account.name,
      currency: account.currency ?? clientDefaults.currency,
      timezone: account.timezone ?? clientDefaults.timezone,
      status: "ACTIVE",
      settings: { managerId: account.managerId ?? null, ...(meta.instagramId ? { instagramId: meta.instagramId } : {}) },
    },
    update: { connectedAccountId: account.id, status: "ACTIVE", name: account.name },
  });
}

/** Semrush não usa OAuth: a fonte é o domínio do cliente e a chave fica no servidor. */
export async function linkSemrush(clientId: string, domain: string, currency: string, timezone: string) {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new Error("Domínio inválido");
  return prisma.dataSource.upsert({
    where: { clientId_platform_externalId: { clientId, platform: "SEMRUSH", externalId: clean } },
    create: { clientId, platform: "SEMRUSH", origin: "REAL", externalId: clean, name: `Semrush · ${clean}`, currency, timezone, status: "ACTIVE" },
    update: { status: "ACTIVE" },
  });
}