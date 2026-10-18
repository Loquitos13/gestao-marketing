/**
 * Restauro de uma cópia.
 *   npm run db:restore-check              ensaio numa base temporária (não mexe na base em uso)
 *   MIH_RESTORE_CONFIRM=yes npm run db:restore -- backups/ficheiro.dump
 * A ENCRYPTION_KEY não está na cópia e não é escrita aqui.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] === "apply" ? "apply" : "check";
const arg = process.argv[3];

function latestDump() {
  const dir = join(process.cwd(), "backups");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".dump"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

function run(args: string[], input?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
    child.on("error", reject);
    if (input) createReadStream(input).pipe(child.stdin!);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker ${args.join(" ")} terminou com ${code}`))));
  });
}

async function psql(database: string, sql: string) {
  await run(["compose", "exec", "-T", "postgres", "psql", "-U", "mih", "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

async function main() {
  const file = arg && arg.endsWith(".dump") ? arg : latestDump();
  if (!file || !existsSync(file)) {
    console.error("Não há cópia. Crie uma com npm run db:backup.");
    process.exit(1);
  }
  if (mode === "apply") {
    if (process.env.MIH_RESTORE_CONFIRM !== "yes") {
      console.error("Restauro da base em uso recusado. Repita com MIH_RESTORE_CONFIRM=yes e o caminho do ficheiro.");
      process.exit(1);
    }
    console.log(`A restaurar ${file} para a base mih. A base atual é substituída.`);
    await run(["compose", "exec", "-T", "postgres", "psql", "-U", "mih", "-d", "postgres", "-c", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'mih' AND pid <> pg_backend_pid();"]);
    await psql("postgres", "DROP DATABASE IF EXISTS mih");
    await psql("postgres", "CREATE DATABASE mih");
    await run(["compose", "exec", "-T", "postgres", "pg_restore", "-U", "mih", "-d", "mih", "--no-owner", "--exit-on-error"], file);
    await psql("mih", "SELECT 1");
    console.log("Restauro concluído. A ENCRYPTION_KEY tem de ser a mesma de quando a cópia foi feita.");
    return;
  }
  console.log(`Ensaio de restauro de ${file} para mih_restore_check.`);
  await psql("postgres", "DROP DATABASE IF EXISTS mih_restore_check");
  await psql("postgres", "CREATE DATABASE mih_restore_check");
  try {
    await run(["compose", "exec", "-T", "postgres", "pg_restore", "-U", "mih", "-d", "mih_restore_check", "--no-owner", "--exit-on-error"], file);
    await psql("mih_restore_check", "SELECT 1");
    console.log("Ensaio concluído: a cópia abre e responde. A base em uso não foi alterada.");
  } finally {
    await psql("postgres", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'mih_restore_check' AND pid <> pg_backend_pid()");
    await psql("postgres", "DROP DATABASE IF EXISTS mih_restore_check");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
