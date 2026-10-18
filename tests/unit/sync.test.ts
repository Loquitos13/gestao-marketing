import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

const { syncJobOptions } = await import("@/server/sync/queue");
const { alertFingerprint } = await import("@/server/alerts/engine");
const { writeSyncResult } = await import("@/server/sync/writer");

describe("fila de sincronização", () => {
  it("não fixa jobId (o BullMQ ignoraria adds com id ainda existente); deduplica por id", () => {
    const { jobId, options } = syncJobOptions({ dataSourceId: "ds1", kind: "INCREMENTAL" });
    expect(jobId).toBe("sync-ds1-INCREMENTAL");
    expect(options).not.toHaveProperty("jobId");
    expect(options.deduplication).toEqual({ id: jobId });
    expect(options.attempts).toBe(5);
  });
});

describe("alertas: fingerprint", () => {
  it("inclui o id da regra, não só o tipo", () => {
    const f = { fingerprint: "kpi:cost" };
    expect(alertFingerprint({ id: "r-google" }, f)).toBe("r-google:kpi:cost");
    expect(alertFingerprint({ id: "r-google" }, f)).not.toBe(alertFingerprint({ id: "r-meta" }, f));
  });
});

describe("escrita de entidades em lote", () => {
  /** Prisma falso em memória: findMany/createManyAndReturn/update por tabela, com contadores. */
  function fakeDb() {
    const table = (name: string) => {
      const rows = new Map<string, Record<string, unknown>>();
      return {
        findMany: vi.fn(async () => [...rows.values()]),
        createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((d) => { const row = { id: `${name}-${d.externalId}`, ...d }; rows.set(row.id, row); return row; })),
        update: vi.fn(({ where, data }: { where: { id: string }; data: object }) => Object.assign(rows.get(where.id)!, data)),
      };
    };
    return { campaign: table("c"), adGroup: table("g"), creative: table("cr"), ad: table("a"), $transaction: async (ops: unknown[]) => ops, $executeRaw: () => undefined };
  }
  const ds = { id: "ds1", clientId: "cl1", platform: "META_ADS", currency: "EUR" } as never;
  const range = { start: "2026-01-01", end: "2026-01-02" };
  const entities = () => ({
    campaigns: [{ externalId: "c1", name: "Camp", status: "ACTIVE", dailyBudget: 10, raw: { b: 1, a: 2 } }],
    adGroups: [{ externalId: "g1", campaignExternalId: "c1", name: "Set", status: "ACTIVE" }],
    ads: [{ externalId: "a1", adGroupExternalId: "g1", name: "Ad", status: "ACTIVE", creative: { externalId: "cr1", title: "T" } }],
  });
  const counts = (db: ReturnType<typeof fakeDb>, fn: "createManyAndReturn" | "update") => (["campaign", "adGroup", "creative", "ad"] as const).reduce((n, t) => n + db[t][fn].mock.calls.length, 0);

  it("segunda sync igual não escreve nada; nome de anúncio alterado → exatamente um update", async () => {
    const db = fakeDb();
    await writeSyncResult(db as never, ds, range, { entities: entities() });
    expect(counts(db, "createManyAndReturn")).toBe(4);
    expect(db.ad.createManyAndReturn.mock.calls[0][0].data[0]).toMatchObject({ adGroupId: "g-g1", creativeId: "cr-cr1" });
    vi.clearAllMocks();
    await writeSyncResult(db as never, ds, range, { entities: entities() });
    expect(counts(db, "createManyAndReturn")).toBe(0);
    expect(counts(db, "update")).toBe(0);
    const changed = entities();
    changed.ads[0].name = "Ad v2";
    await writeSyncResult(db as never, ds, range, { entities: changed });
    expect(counts(db, "createManyAndReturn")).toBe(0);
    expect(counts(db, "update")).toBe(1);
    expect(db.ad.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a-a1" } }));
  });
});
