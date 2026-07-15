import { readFileSync } from "node:fs";
import { commitMigration, previewMigration, type MigrationSource } from "../backend-lib/migration-import";

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
if (args.includes("--help") || !value("--source") || !value("--property") || !value("--file")) {
  console.log("Usage: bun run migrate -- --source umami|plausible --property PROPERTY_ID --file /absolute/export.csv [--commit]");
  console.log("Without --commit, the command performs a read-only dry run.");
  process.exit(args.includes("--help") ? 0 : 1);
}
const source = value("--source") as MigrationSource;
if (!(["umami", "plausible"] as string[]).includes(source)) throw new Error("--source must be umami or plausible");
const fileName = value("--file")!;
const input = { source, propertyId: value("--property")!, fileName, content: readFileSync(fileName, "utf8") };
const result = args.includes("--commit") ? commitMigration(input) : previewMigration(input);
console.log(JSON.stringify({ dryRun: !args.includes("--commit"), ...result }, null, 2));
