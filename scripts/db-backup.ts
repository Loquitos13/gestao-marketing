/**
 * Cópia da base Postgres (formato custom) para backups/ e, se configurado (Integrações → Cópia de segurança),
 * uma segunda cópia noutra pasta/disco, onde as cópias com mais de 30 dias são apagadas.
 * Não inclui a ENCRYPTION_KEY: guarde-a fora deste computador.
 * Agendar no Windows: Programador de Tarefas, diário, `npm run db:backup` nesta pasta.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { getConfig } from "@/server/config/settings";

// `npm run db:backup` não passa --env-file; a configuração guardada precisa de DATABASE_URL e ENCRYPTION_KEY.
try {
  process.loadEnvFile(".env");
} catch {
  /* sem .env: usa o ambiente */
}

const COPY_RETENTION_MS = 30 * 24 * 3_600_000;

/** Segunda cópia na pasta configurada; só apaga ficheiros mih-*.dump para não tocar no resto de uma pasta partilhada. */
async function copyToSecondary(file: string) {
  let dir: string | undefined;
  try {
    dir = (await getConfig()).BACKUP_COPY_DIR;
  } catch (e) {
    console.warn(`Segunda cópia ignorada: configuração indisponível (${(e as Error).message}).`);
    return;
  }
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const target = join(dir, basename(file));
  await copyFile(file, target);
  console.log(`Segunda cópia gravada em ${target}`);
  const limit = Date.now() - COPY_RETENTION_MS;
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if (/^mih-.*\.dump$/.test(name) && (await stat(p)).mtimeMs < limit) await unlink(p);
  }
}

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
  out.once("close", () =>
    copyToSecondary(file)
      .catch((e: Error) => {
        console.error(`A segunda cópia falhou (a cópia local existe): ${e.message}`);
        process.exitCode = 1;
      })
      .finally(() => process.exit()),
  );
});
