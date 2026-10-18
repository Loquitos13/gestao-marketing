import type { DataSource } from "@prisma/client";

export type EntityLevel = "CAMPAIGN" | "AD_GROUP" | "AD";

/** Estado relevante de uma entidade na plataforma (valores nativos: Google ENABLED/PAUSED, Meta ACTIVE/PAUSED). */
export interface RemoteState {
  status?: string | null;
  dailyBudget?: number | null;
}

export interface Target {
  level: EntityLevel;
  externalId: string;
  /** Google: necessário para anúncios (adGroupAds/{grupo}~{anúncio}). */
  adGroupExternalId?: string | null;
  /** Google: o orçamento é um recurso próprio (campaignBudgets/…). */
  budgetResourceName?: string | null;
}

export type SimpleOperation = "SET_STATUS" | "SET_DAILY_BUDGET";

export interface ChangeSpec {
  operation: SimpleOperation;
  target: Target;
  after: RemoteState;
}

export interface WriteContext {
  ds: DataSource;
  token: string;
  loginCustomerId?: string | null;
  fetchImpl?: typeof fetch;
}

export interface AdsExecutor {
  read(ctx: WriteContext, target: Target): Promise<RemoteState>;
  /** Pré-validação na plataforma sem efeitos (validateOnly / validate_only). */
  validate(ctx: WriteContext, spec: ChangeSpec): Promise<void>;
  apply(ctx: WriteContext, spec: ChangeSpec): Promise<void>;
}
