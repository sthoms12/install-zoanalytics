import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function value(flag: string) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; }
const target = resolve(value("--target") ?? "/home/workspace/zoanalytics");
const mode = value("--mode") ?? "install";
const errors: string[] = [];
const warnings: string[] = [];
const bunVersion = Bun.version.split(".").map(Number);
if (bunVersion[0] < 1 || (bunVersion[0] === 1 && bunVersion[1] < 3)) errors.push(`Bun 1.3.0 or newer is required; found ${Bun.version}`);
if (mode === "install" && existsSync(target) && readdirSync(target).length > 0) errors.push(`Install target is not empty: ${target}`);
if (mode === "update") {
  if (!existsSync(`${target}/package.json`)) errors.push(`ZoAnalytics package.json was not found at ${target}`);
  if (!existsSync(`${target}/data/zoanalytics.db`)) errors.push(`ZoAnalytics database was not found at ${target}/data/zoanalytics.db`);
  if (!existsSync(`${target}/zosite.json`)) warnings.push("zosite.json is missing; hosted runtime settings cannot be preserved");
}
const result = { ok: errors.length === 0, mode, target, runtime: { bun: Bun.version }, errors, warnings };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
