/**
 * Verifica as integrações REAIS de um cliente: chama cada conector uma vez para o dia de ontem e mostra o que
 * devolve, sem escrever métricas na BD (só a renovação de tokens, como numa sincronização normal).
 *
 *   npm run integrations:verify -- [--client <id|nome>]
 *
 * Sem --client usa o primeiro cliente não arquivado com fontes REAIS. Sai com código 1 se algum conector falhar.
 */
import { prisma } from "@/lib/prisma";
import { addDays, todayInTz } from "@/lib/dates";
import { CONNECTORS, PLATFORM_LABELS } from "@/server/integrations/registry";
import { IntegrationError } from "@/server/integrations/http";
import { getValidAccessToken } from "@/server/integrations/tokens";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const q = arg("client");
  const client = q
    ? await prisma.client.findFirst({ where: { OR: [{ id: q }, { name: q }] } })
    : await prisma.client.findFirst({ where: { archivedAt: null, dataSources: { some: { origin: "REAL" } } }, orderBy: { createdAt: "asc" } });
  if (!client) throw new Error(q ? `Cliente "${q}" não encontrado` : "Nenhum cliente não arquivado com fontes REAIS");
  const sources = await prisma.dataSource.findMany({ where: { clientId: client.id }, include: { connectedAccount: { include: { credential: true } } }, orderBy: { platform: "asc" } });
  const day = addDays(todayInTz(client.timezone), -1);
  console.log(`Cliente: ${client.name} (${client.id}) · ${sources.length} fonte(s) · dia ${day}\n`);

  const table: Record<string, string>[] = [];
  let failures = 0;
  for (const ds of sources) {
    const row = { plataforma: PLATFORM_LABELS[ds.platform], conta: `${ds.name} (${ds.externalId})`, estado: "", linhas: "", chaves: "", erro: "" };
    table.push(row);
    if (ds.origin === "SIMULATED") {
      row.estado = "simulado (ignorado)";
      continue;
    }
    if (ds.status === "DISCONNECTED") {
      row.estado = "desligada (ignorada)";
      continue;
    }
    try {
      const res = await CONNECTORS[ds.platform].sync({
        dataSource: ds,
        range: { start: day, end: day },
        log: { info: async () => undefined, warn: async (m) => console.warn(`  aviso ${ds.platform}: ${m}`) },
        accessToken: async () => {
          if (ds.platform === "SEMRUSH") return "";
          const cred = ds.connectedAccount?.credential;
          if (!cred) throw new IntegrationError("Fonte sem credencial OAuth associada", "CONFIG");
          return getValidAccessToken(cred, { db: prisma });
        },
      });
      const lists: [string, object[]][] = [...Object.entries(res.entities ?? {}), ...Object.entries(res).filter((e): e is [string, object[]] => Array.isArray(e[1]))];
      const first = lists.find(([, l]) => l.length);
      row.estado = "ok";
      row.linhas = String(lists.reduce((s, [, l]) => s + l.length, 0));
      row.chaves = first ? `${first[0]}: ${Object.keys(first[1][0]!).slice(0, 8).join(", ")}` : "—";
    } catch (e) {
      failures++;
      row.estado = "erro";
      row.erro = `${e instanceof IntegrationError ? e.kind : "UNKNOWN"}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    }
  }
  console.table(table);
  if (failures) {
    console.error(`\n${failures} conector(es) com erro`);
    process.exit(1);
  }
  console.log("\nTodos os conectores responderam.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
