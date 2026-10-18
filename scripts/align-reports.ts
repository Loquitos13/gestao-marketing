/** Alinha a comparação gravada de cada relatório com o último relatório anterior. */
import { prisma } from "../src/lib/prisma";
import { alignReportComparisons } from "../src/server/reports/service";

const r = await alignReportComparisons();
console.log(`atualizados ${r.updated}, iguais ${r.unchanged}, falhas ${r.failed}`);
await prisma.$disconnect();
