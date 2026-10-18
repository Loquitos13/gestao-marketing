import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

const { syncJobOptions } = await import("@/server/sync/queue");
const { alertFingerprint } = await import("@/server/alerts/engine");

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
