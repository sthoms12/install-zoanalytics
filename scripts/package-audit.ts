import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const template = join(root, "assets", "app-template");
const forbiddenEntries = ["node_modules", "dist", "data", ".env", "zosite.json"];
const forbiddenText = [
  /thomstech/gi,
  /sthoms/gi,
  /m365-barometer/gi,
  /root-cause/gi,
  /internet-case-files/gi,
  /project-failure-intelligence/gi,
  /napmovies/gi,
  /b4wemeet/gi,
  /formuladeck/gi,
  /omniunit/gi,
];

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const errors: string[] = [];
for (const entry of forbiddenEntries) if (existsSync(join(template, entry))) errors.push(`Forbidden template entry: ${entry}`);
if (!existsSync(join(template, "zosite.template.json"))) errors.push("Missing zosite.template.json");

const candidates = files(template).filter((path) => !path.endsWith("bun.lock"));
for (const path of candidates) {
  const content = readFileSync(path, "utf8");
  for (const pattern of forbiddenText) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) errors.push(`Personal marker ${pattern.source} in ${relative(root, path)}`);
  }
}

const result = { ok: errors.length === 0, files: candidates.length, template: relative(root, template), errors };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
