import { describe, expect, it } from "vitest";
import { ecbQuotesToUpsert, parseEcbXml } from "@/server/fx/ecb";
import { WORKER_DOWN_AFTER_MS, workerDownDecision } from "@/server/sync/worker-presence";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time="2026-10-16">
      <Cube currency="USD" rate="1.0837"/>
      <Cube currency="GBP" rate="0.8412"/>
      <Cube currency="BRL" rate="6.1023"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("taxas do BCE", () => {
  it("extrai data e taxas do XML", () => {
    expect(parseEcbXml(SAMPLE)).toEqual({ date: "2026-10-16", rates: { USD: 1.0837, GBP: 0.8412, BRL: 6.1023 } });
  });

  it("rejeita XML sem data ou sem taxas", () => {
    expect(() => parseEcbXml("<Cube/>")).toThrow();
    expect(() => parseEcbXml('<Cube time="2026-10-16"/>')).toThrow();
  });

  it("não substitui taxas manuais do mesmo dia", () => {
    const rates = { USD: 1.0837, GBP: 0.8412, BRL: 6.1023 };
    const existing = [
      { quote: "USD", source: "Banco de Portugal" },
      { quote: "GBP", source: "ECB" },
    ];
    expect(ecbQuotesToUpsert(rates, existing)).toEqual(["GBP", "BRL"]);
  });
});

describe("aviso de worker parado", () => {
  const now = 1_000_000_000;
  it("avisa quando está parado há 15 min e ainda não avisou", () => {
    expect(workerDownDecision({ up: false, lastSeenAt: now - WORKER_DOWN_AFTER_MS, notified: false, now })).toBe("notify");
    expect(workerDownDecision({ up: false, lastSeenAt: now - 60_000, notified: false, now })).toBe("none");
    expect(workerDownDecision({ up: false, lastSeenAt: null, notified: false, now })).toBe("none");
  });

  it("não repete o aviso", () => {
    expect(workerDownDecision({ up: false, lastSeenAt: now - 2 * WORKER_DOWN_AFTER_MS, notified: true, now })).toBe("none");
  });

  it("limpa o marcador quando o worker volta", () => {
    expect(workerDownDecision({ up: true, lastSeenAt: now, notified: true, now })).toBe("clear");
    expect(workerDownDecision({ up: true, lastSeenAt: now, notified: false, now })).toBe("none");
  });
});
