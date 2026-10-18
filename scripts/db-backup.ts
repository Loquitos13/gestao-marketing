/**
 * Cópia da base Postgres (formato custom) para backups/.
 * Não inclui a ENCRYPTION_KEY: guarde-a fora deste computador.
 * Agendar no Windows: Programador de Tarefas, diário, `npm run db:backup` nesta pasta.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const dir = join(process.cwd(), "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = join(dir, `mih-${stamp}.dump`);
const out = createWriteStream(file);

const child = spawn("docker", ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "mih", "-d", "mih", "-Fc"], { stdio: ["ignore", "pipe", "inherit"] });
child.stdout.pipe(out);

child.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
child.on("close", (code) => {
  out.close();
  if (code !== 0) {
    console.error("A cópia falhou. Confirme que o Docker está a correr (npm run dev:up).");
    process.exit(code ?? 1);
  }
  console.log(`Cópia gravada em ${file}`);
  console.log("Esta cópia não contém a ENCRYPTION_KEY. Guarde essa chave num sítio fora deste computador (gestor de palavras-passe). Sem ela, os tokens não se recuperam.");
  console.log("Ensaio de restauro: npm run db:restore-check");
});
