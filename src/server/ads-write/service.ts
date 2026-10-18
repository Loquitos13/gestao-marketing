import type { AdChange, AdChangeOperation, DataSource, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultDb } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { fromDate } from "@/lib/dates";
import { IntegrationError } from "@/server/integrations/http";
import { convertAmount, loadRates } from "@/server/queries/fx";
import { getValidAccessToken } from "@/server/integrations/tokens";
import { AdsWriteError, loadEntity, localState, updateLocal } from "./entities";
import { checkBudgetChange, fieldsOf, MAX_APPLIED_PER_HOUR, nativeStatus, sameState, type Desired } from "./guards";
import { googleExecutor } from "./google";
import { metaExecutor } from "./meta";
import type { AdsExecutor, ChangeSpec, EntityLevel, RemoteState, Target, WriteContext } from "./types";
import { createAdOnPlatform, persistCreatedAd, validateAdOnPlatform } from "./create";
import type { AdSpec } from "./creative";
import { addKeywordsOnPlatform, validateKeywordsOnPlatform, type KeywordSpec } from "./keywords";

export { AdsWriteError };

export interface DraftInput {
  clientId: string;
  organizationId: string;
  userId: string | null;
  level: EntityLevel;
  entityId: string;
  operation: "SET_STATUS" | "SET_DAILY_BUDGET";
  desiredStatus?: Desired;
  dailyBudget?: number;
  /** Moeda em que dailyBudget vem expresso; por omissão a da conta (ALLOCATION: a do cliente). */
  currency?: string;
  reason?: string | null;
  source?: "MANUAL" | "RULE" | "ALLOCATION" | "AGENT";
  recommendationId?: string | null;
  planId?: string | null;
}

export interface WriteDeps {
  db?: PrismaClient;
  executors?: Partial<Record<"GOOGLE_ADS" | "META_ADS", AdsExecutor>>;
  writeContext?: (ds: DataSource) => Promise<WriteContext>;
  createAd?: typeof createAdOnPlatform;
  addKeywords?: typeof addKeywordsOnPlatform;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;
const asState = (v: Prisma.JsonValue) => (v ?? {}) as RemoteState;
const targetOf = (c: AdChange) => (c.validation as { target?: Target } | null)?.target;

function executorFor(platform: string, deps: WriteDeps): AdsExecutor {
  const ex = platform === "GOOGLE_ADS" ? (deps.executors?.GOOGLE_ADS ?? googleExecutor) : platform === "META_ADS" ? (deps.executors?.META_ADS ?? metaExecutor) : null;
  if (!ex) throw new AdsWriteError("Plataforma sem suporte de escrita.");
  return ex;
}

/** Contexto de escrita: token válido (cifrado em repouso) e verificação das permissões concedidas. */
export async function defaultWriteContext(ds: DataSource, db: PrismaClient = defaultDb): Promise<WriteContext> {
  const full = await db.dataSource.findUniqueOrThrow({ where: { id: ds.id }, include: { connectedAccount: { include: { credential: true } } } });
  const cred = full.connectedAccount?.credential;
  if (!cred) throw new IntegrationError("Fonte sem credencial OAuth associada", "CONFIG");
  if (ds.platform === "META_ADS" && !cred.scopes.includes("ads_management")) {
    throw new IntegrationError("A ligação Meta só tem permissão de leitura. Em Fontes de dados, use “Ligar com gestão de anúncios”.", "PERMISSION");
  }
  const token = await getValidAccessToken(cred, { db });
  const settings = (ds.settings ?? {}) as { managerId?: string };
  return { ds, token, loginCustomerId: settings.managerId ?? full.connectedAccount?.managerId ?? null };
}

/** Cria (ou substitui) uma proposta em rascunho. Nada é enviado à plataforma neste passo. */
export async function createDraft(input: DraftInput, deps: WriteDeps = {}): Promise<AdChange> {
  const db = deps.db ?? defaultDb;
  const client = await db.client.findFirstOrThrow({ where: { id: input.clientId, organizationId: input.organizationId } });
  const e = await loadEntity(db, client.id, input.level, input.entityId);
  const ds = await db.dataSource.findUniqueOrThrow({ where: { id: e.dataSourceId } });
  if (ds.platform !== "GOOGLE_ADS" && ds.platform !== "META_ADS") throw new AdsWriteError("Plataforma sem suporte de escrita.");
  const before = localState(e);
  let after: RemoteState;
  if (input.operation === "SET_STATUS") {
    if (!input.desiredStatus) throw new AdsWriteError("Estado pretendido em falta.");
    after = { status: nativeStatus(e.platform, input.desiredStatus) };
    if (after.status === e.status) throw new AdsWriteError(`Já está ${input.desiredStatus === "PAUSED" ? "pausado" : "ativo"}.`);
    if (!["ENABLED", "ACTIVE", "PAUSED"].includes(e.status)) throw new AdsWriteError(`Estado atual (${e.status}) não permite esta alteração.`);
  } else {
    // dailyBudget guarda-se na moeda da conta; distribuição e agente raciocinam na moeda do cliente, converte-se aqui.
    const from = input.currency ?? (input.source === "ALLOCATION" ? client.currency : ds.currency);
    let value = input.dailyBudget ?? NaN;
    if (from !== ds.currency) {
      const conv = convertAmount(value, from, ds.currency, await loadRates(fromDate(new Date())));
      if (conv === null) throw new AdsWriteError(`Sem taxa de câmbio ${from}→${ds.currency} registada: não é possível converter o orçamento para a moeda da conta.`);
      value = conv;
    }
    value = Math.round(value * 100) / 100;
    const err = checkBudgetChange(e.budget, value, Number(client.maxBudgetStepPct));
    if (err) throw new AdsWriteError(err);
    if (e.platform === "GOOGLE_ADS" && ds.origin === "REAL" && !e.target.budgetResourceName) throw new AdsWriteError("Orçamento sem referência na plataforma: sincronize a fonte antes de alterar.");
    after = { dailyBudget: value };
  }
  await db.adChange.updateMany({ where: { clientId: client.id, entityId: e.id, operation: input.operation, source: input.source ?? "MANUAL", status: "DRAFT" }, data: { status: "CANCELLED", error: "Substituída por uma proposta mais recente." } });
  const change = await db.adChange.create({
    data: {
      clientId: client.id,
      dataSourceId: ds.id,
      platform: e.platform,
      operation: input.operation as AdChangeOperation,
      entityLevel: e.level,
      entityId: e.id,
      externalId: e.target.externalId,
      entityName: e.level === "CAMPAIGN" ? e.name : `${e.campaignName} › ${e.name}`,
      before: json({ ...before, currency: ds.currency }),
      after: json({ ...after, currency: ds.currency }),
      reason: input.reason ?? null,
      source: input.source ?? "MANUAL",
      recommendationId: input.recommendationId ?? null,
      planId: input.planId ?? null,
      simulated: ds.origin === "SIMULATED",
      validation: json({ target: e.target }),
      createdById: input.userId,
    },
  });
  await audit({ organizationId: input.organizationId, clientId: client.id, userId: input.userId, action: "ads.change.draft", targetType: "AdChange", targetId: change.id, metadata: json({ operation: input.operation, entity: change.entityName, before, after }) });
  return change;
}

/** Pré-validação na plataforma (sem efeitos). Fontes simuladas: validação local apenas. */
export async function previewChange(changeId: string, clientId: string, deps: WriteDeps = {}): Promise<{ ok: boolean; message: string }> {
  const db = deps.db ?? defaultDb;
  const c = await db.adChange.findFirstOrThrow({ where: { id: changeId, clientId } });
  if (c.simulated) return { ok: true, message: "Fonte simulada: a alteração só afeta os dados de demonstração." };
  const target = targetOf(c);
  if (!target) throw new AdsWriteError("Proposta sem alvo.");
  const ds = await db.dataSource.findUniqueOrThrow({ where: { id: c.dataSourceId } });
  try {
    const ctx = await (deps.writeContext ?? ((d) => defaultWriteContext(d, db)))(ds);
    if (c.operation === "CREATE_AD" || c.operation === "UPDATE_AD") await validateAdOnPlatform(ctx, c.externalId!, (c.after as unknown as { spec: AdSpec }).spec);
    else if (c.operation === "ADD_KEYWORDS") await validateKeywordsOnPlatform(ctx, c.externalId!, (c.after as unknown as { keywords: KeywordSpec[] }).keywords);
    else await executorFor(c.platform, deps).validate(ctx, { operation: c.operation as ChangeSpec["operation"], target, after: asState(c.after) });
    await db.adChange.update({ where: { id: c.id }, data: { validation: json({ target, preview: { ok: true, at: new Date().toISOString() } }) } });
    return { ok: true, message: "A plataforma validou o pedido (sem aplicar)." };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.adChange.update({ where: { id: c.id }, data: { validation: json({ target, preview: { ok: false, message, at: new Date().toISOString() } }) } });
    return { ok: false, message };
  }
}

export interface ConfirmInput {
  changeId: string;
  clientId: string;
  organizationId: string;
  userId: string;
  acknowledged: boolean;
}

/**
 * Aplica uma proposta após confirmação explícita. Transição atómica DRAFT→APPLYING (idempotente),
 * releitura do estado atual antes de escrever (aborta se mudou fora do hub) e verificação depois.
 */
export async function confirmAndApply(input: ConfirmInput, deps: WriteDeps = {}): Promise<AdChange> {
  const db = deps.db ?? defaultDb;
  const client = await db.client.findFirstOrThrow({ where: { id: input.clientId, organizationId: input.organizationId } });
  if (!client.adsManagementEnabled) throw new AdsWriteError("A gestão de anúncios está desligada para este cliente (Definições do cliente).");
  if (!input.acknowledged) throw new AdsWriteError("Confirme explicitamente a aplicação na conta.");
  const recent = await db.adChange.count({ where: { clientId: client.id, status: { in: ["APPLIED", "APPLYING"] }, confirmedAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= MAX_APPLIED_PER_HOUR) throw new AdsWriteError(`Limite de ${MAX_APPLIED_PER_HOUR} alterações por hora atingido para este cliente.`);
  const claimed = await db.adChange.updateMany({ where: { id: input.changeId, clientId: client.id, status: "DRAFT" }, data: { status: "APPLYING", confirmedById: input.userId, confirmedAt: new Date() } });
  if (claimed.count === 0) throw new AdsWriteError("Esta proposta já foi processada ou cancelada.");
  const c = await db.adChange.findUniqueOrThrow({ where: { id: input.changeId } });
  const before = asState(c.before);
  const after = asState(c.after);
  const fields = fieldsOf(c.operation);
  const level = c.entityLevel as EntityLevel;
  const finish = async (data: Prisma.AdChangeUpdateInput, action: string, meta: Record<string, unknown> = {}) => {
    const row = await db.adChange.update({ where: { id: c.id }, data });
    await audit({ organizationId: input.organizationId, clientId: client.id, userId: input.userId, action, targetType: "AdChange", targetId: c.id, metadata: json({ operation: c.operation, entity: c.entityName, simulated: c.simulated, before, after, ...meta }) });
    return row;
  };
  // Depois de enviar à plataforma, um erro (timeout, escrita local) já não significa recusa.
  let sent = false;
  let reread: (() => Promise<RemoteState | null>) | null = null;
  try {
    if (c.operation === "CREATE_AD" || c.operation === "UPDATE_AD") {
      const a = c.after as unknown as { spec: AdSpec; replaceAdId?: string | null };
      let externalId: string;
      if (c.simulated) externalId = `sim_${c.id}`;
      else {
        const ds = await db.dataSource.findUniqueOrThrow({ where: { id: c.dataSourceId } });
        const ctx = await (deps.writeContext ?? ((d) => defaultWriteContext(d, db)))(ds);
        sent = true;
        externalId = await (deps.createAd ?? createAdOnPlatform)(ctx, c.externalId!, a.spec);
      }
      await db.adChange.update({ where: { id: c.id }, data: { validation: json({ ...((c.validation ?? {}) as object), createdExternalId: externalId }) } });
      let note = "Anúncio criado em pausa: ative-o depois de aprovado pela plataforma.";
      await persistCreatedAd(db, c, externalId, a.spec).catch(() => {
        note += ` (ID ${externalId}; aparece no hub após a próxima sincronização.)`;
      });
      if (a.replaceAdId) {
        try {
          await createDraft({ clientId: client.id, organizationId: input.organizationId, userId: input.userId, level: "AD", entityId: a.replaceAdId, operation: "SET_STATUS", desiredStatus: "PAUSED", reason: "Substituído pela nova versão do anúncio.", source: c.source as DraftInput["source"] }, deps);
          note += " Foi criada uma proposta para pausar o anúncio original.";
        } catch (e) {
          note += ` Não foi possível propor a pausa do original: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      return finish({ status: "APPLIED", appliedAt: new Date(), error: note }, "ads.change.apply", { externalId, note });
    }
    if (c.operation === "ADD_KEYWORDS") {
      const kws = (c.after as unknown as { keywords: KeywordSpec[] }).keywords;
      let created = kws.length;
      if (!c.simulated) {
        const ds = await db.dataSource.findUniqueOrThrow({ where: { id: c.dataSourceId } });
        const ctx = await (deps.writeContext ?? ((d) => defaultWriteContext(d, db)))(ds);
        sent = true;
        created = await (deps.addKeywords ?? addKeywordsOnPlatform)(ctx, c.externalId!, kws);
      }
      const note = `${created} palavra(s)-chave criada(s) em pausa: ative-as no grupo quando quiser que comecem a gerar impressões.`;
      return finish({ status: "APPLIED", appliedAt: new Date(), error: note }, "ads.change.apply", { keywords: created, note });
    }
    const entity = await loadEntity(db, client.id, level, c.entityId!);
    // O passo máximo pode ter mudado desde o rascunho; reversões repõem o valor anterior e ficam isentas.
    if (c.operation === "SET_DAILY_BUDGET" && !c.revertOfId) {
      const err = checkBudgetChange({ ...entity.budget, dailyBudget: before.dailyBudget ?? null }, after.dailyBudget ?? NaN, Number(client.maxBudgetStepPct));
      if (err) throw new AdsWriteError(err);
    }
    let note: string | null = null;
    if (c.simulated) {
      const current = localState(entity);
      if (!sameState(current, before, fields)) throw new AdsWriteError("O estado mudou desde que a proposta foi criada. Crie uma nova proposta.");
    } else {
      const ds = await db.dataSource.findUniqueOrThrow({ where: { id: c.dataSourceId } });
      const ctx = await (deps.writeContext ?? ((d) => defaultWriteContext(d, db)))(ds);
      const ex = executorFor(c.platform, deps);
      const target = targetOf(c) ?? entity.target;
      const current = await ex.read(ctx, target);
      if (sameState(current, after, fields)) note = "A plataforma já tinha este valor; nada foi enviado.";
      else if (!sameState(current, before, fields)) throw new AdsWriteError(`Alterado fora do hub desde a proposta (valor atual: ${JSON.stringify(current)}). Nada foi enviado.`);
      else {
        sent = true;
        reread = () => ex.read(ctx, target).catch(() => null);
        await ex.apply(ctx, { operation: c.operation as ChangeSpec["operation"], target, after });
        const readBack = await ex.read(ctx, target).catch(() => null);
        if (!readBack || !sameState(readBack, after, fields)) note = "Pedido aceite pela plataforma; a releitura ainda não reflete o novo valor (pode demorar alguns minutos).";
      }
    }
    await updateLocal(db, level, c.entityId!, after);
    if (c.revertOfId) await db.adChange.update({ where: { id: c.revertOfId }, data: { status: "REVERTED" } });
    if (c.recommendationId) {
      await db.recommendation.updateMany({ where: { id: c.recommendationId, clientId: client.id }, data: { status: "DONE", decidedById: input.userId, decidedAt: new Date(), decisionNote: "Aplicada através do hub após confirmação." } });
    }
    return finish({ status: "APPLIED", appliedAt: new Date(), error: note }, "ads.change.apply", { note });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    if (reread) {
      const current = await reread();
      if (current && sameState(current, after, fields)) {
        await updateLocal(db, level, c.entityId!, after).catch(() => undefined);
        return finish({ status: "APPLIED", appliedAt: new Date(), error: `Aplicado na plataforma apesar de um erro posterior: ${message}` }, "ads.change.apply", { note: message });
      }
    }
    await finish({ status: "FAILED", error: message }, "ads.change.fail", { error: message });
    if (e instanceof AdsWriteError) throw e;
    throw new AdsWriteError(sent ? `Resultado desconhecido: confirme na plataforma antes de repetir. (${message})` : `A plataforma recusou a alteração: ${message}`);
  }
}

export async function cancelChange(changeId: string, clientId: string, organizationId: string, userId: string, db: PrismaClient = defaultDb) {
  const r = await db.adChange.updateMany({ where: { id: changeId, clientId, status: "DRAFT" }, data: { status: "CANCELLED" } });
  if (!r.count) throw new AdsWriteError("Só é possível cancelar propostas em rascunho.");
  await audit({ organizationId, clientId, userId, action: "ads.change.cancel", targetType: "AdChange", targetId: changeId });
}

/** Cria uma proposta inversa (também exige confirmação). */
export async function revertChange(changeId: string, clientId: string, organizationId: string, userId: string, db: PrismaClient = defaultDb): Promise<AdChange> {
  const c = await db.adChange.findFirst({ where: { id: changeId, clientId, status: "APPLIED" } });
  if (!c) throw new AdsWriteError("Só é possível reverter alterações aplicadas.");
  if (c.operation !== "SET_STATUS" && c.operation !== "SET_DAILY_BUDGET") throw new AdsWriteError("Este tipo de alteração não pode ser revertido automaticamente.");
  // APPLYING há mais de 10 min é um processo que morreu, não uma reversão em curso.
  const pending = await db.adChange.findFirst({ where: { revertOfId: c.id, OR: [{ status: "DRAFT" }, { status: "APPLYING", updatedAt: { gte: new Date(Date.now() - 600_000) } }] } });
  if (pending) throw new AdsWriteError("Já existe uma reversão pendente para esta alteração.");
  const fields = fieldsOf(c.operation);
  const pick = (s: RemoteState) => Object.fromEntries(fields.map((f) => [f, s[f] ?? null]));
  const row = await db.adChange.create({
    data: {
      clientId,
      dataSourceId: c.dataSourceId,
      platform: c.platform,
      operation: c.operation,
      entityLevel: c.entityLevel,
      entityId: c.entityId,
      externalId: c.externalId,
      entityName: c.entityName,
      before: json(pick(asState(c.after))),
      after: json(pick(asState(c.before))),
      reason: `Reverter alteração de ${c.appliedAt?.toISOString().slice(0, 10) ?? ""}`,
      source: "MANUAL",
      revertOfId: c.id,
      simulated: c.simulated,
      validation: c.validation ?? undefined,
      createdById: userId,
    },
  });
  await audit({ organizationId, clientId, userId, action: "ads.change.draft", targetType: "AdChange", targetId: row.id, metadata: json({ revertOf: c.id }) });
  return row;
}
