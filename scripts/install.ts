import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function value(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes("--help")) {
  console.log("bun scripts/install.ts [--target /home/workspace/zoanalytics] [--port 57681] [--label zoanalytics] [--owner-handle HANDLE] [--skip-install]");
  process.exit(0);
}

const target = resolve(value("--target") ?? "/home/workspace/zoanalytics");
const port = Number.parseInt(value("--port") ?? "57681", 10);
const label = value("--label") ?? "zoanalytics";
const ownerHandle = value("--owner-handle")?.trim();
const template = resolve(import.meta.dir, "../assets/app-template");

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be an integer between 1024 and 65535");
if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(label)) throw new Error("--label must contain lowercase letters, numbers, and hyphens");
if (existsSync(target) && readdirSync(target).length > 0) throw new Error(`Target is not empty: ${target}`);

mkdirSync(target, { recursive: true });
cpSync(template, target, { recursive: true, errorOnExist: true });

const configPath = join(target, "zosite.json");
const config = JSON.parse(await Bun.file(configPath).text());
config.local_port = port;
config.publish.label = label;
config.publish.published_port = port;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

if (ownerHandle) writeFileSync(join(target, ".env"), `ZO_OWNER_HANDLE=${ownerHandle}\n`);

if (!process.argv.includes("--skip-install")) {
  const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: target, stdout: "inherit", stderr: "inherit" });
  if (install.exitCode !== 0) throw new Error("bun install failed");
}

console.log(JSON.stringify({ ok: true, target, port, label, cleanDatabase: true }, null, 2));
