import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

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
if (!existsSync(join(target, "package.json")) || !existsSync(join(target, "data", "zoanalytics.db"))) throw new Error(`ZoAnalytics installation was not found at ${target}`);

const backup = Bun.spawnSync(["bun", "run", "backup"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (backup.exitCode !== 0) throw new Error("Backup failed; update stopped before changing source");

for (const entry of ["backend-lib", "src", "scripts", "public", "server.ts", "index.html", "index.tsx", "package.json", "tsconfig.json", "vite.config.ts", "components.json"]) {
  const source = join(template, entry);
  if (existsSync(source)) cpSync(source, join(target, entry), { recursive: true, force: true });
}

const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (install.exitCode !== 0) throw new Error("Dependency installation failed");
const build = Bun.spawnSync(["bun", "run", "build"], { cwd: target, stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("Build failed after update; restore the latest backup before restarting the service");
console.log(JSON.stringify({ ok: true, target, preserved: ["data", ".env", "zosite.json"] }, null, 2));
