import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function value(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes("--help")) {
  console.log("bun scripts/update.ts [--target /home/workspace/zoanalytics]");
  process.exit(0);
}

const target = resolve(value("--target") ?? "/home/workspace/zoanalytics");
const template = resolve(import.meta.dir, "../assets/app-template");
const release = await Bun.file(resolve(import.meta.dir, "../release.json")).json() as { version: string; summary: string; highlights: string[] };
const preflight = Bun.spawnSync(["bun", join(import.meta.dir, "preflight.ts"), "--mode", "update", "--target", target], { stdout: "inherit", stderr: "inherit" });
if (preflight.exitCode !== 0) throw new Error("Preflight failed; update was not started");

const backup = Bun.spawnSync(["bun", "run", "backup"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (backup.exitCode !== 0) throw new Error("Backup failed; update stopped before changing source");

const entries = ["backend-lib", "src", "scripts", "public", "server.ts", "index.html", "index.tsx", "package.json", "bun.lock", "tsconfig.json", "vite.config.ts", "components.json"];
const rollbackRoot = join(dirname(target), ".zoanalytics-update-rollbacks", `${basename(target)}-${Date.now()}-${release.version}`);
mkdirSync(rollbackRoot, { recursive: true });
for (const entry of entries) if (existsSync(join(target, entry))) cpSync(join(target, entry), join(rollbackRoot, entry), { recursive: true });

function restoreSource() {
  for (const entry of entries) {
    const destination = join(target, entry); rmSync(destination, { recursive: true, force: true });
    const saved = join(rollbackRoot, entry); if (existsSync(saved)) cpSync(saved, destination, { recursive: true });
  }
}

try {
  for (const entry of entries) {
    const source = join(template, entry); const destination = join(target, entry);
    if (!existsSync(source)) continue;
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }

const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (install.exitCode !== 0) throw new Error("Dependency installation failed");
const types = Bun.spawnSync(["bunx", "tsc", "--noEmit"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (types.exitCode !== 0) throw new Error("TypeScript validation failed");
const build = Bun.spawnSync(["bun", "run", "build"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("Production build failed");
const doctor = Bun.spawnSync(["bun", "run", "doctor"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (doctor.exitCode !== 0) throw new Error("Database or application doctor failed");
} catch (error) {
  restoreSource();
  Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: target, stdout: "ignore", stderr: "ignore" });
  throw new Error(`Update failed and application source was rolled back automatically. Database backup and source snapshot remain available. ${error instanceof Error ? error.message : String(error)}`);
}
console.log(JSON.stringify({ ok: true, target, version: release.version, summary: release.summary, highlights: release.highlights, preserved: ["data/zoanalytics.db", "Pulse configuration", ".env", "zosite.json"], rollbackSource: rollbackRoot }, null, 2));
