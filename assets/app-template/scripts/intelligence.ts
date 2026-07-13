import { createWeeklyReport, discoverProperties, discoverWebBacklinks, getIntelligence, runRankChecks } from "../backend-lib/intelligence";

const command = process.argv[2] || "all";
if (command === "--help" || command === "help") {
  console.log(`Usage: bun scripts/intelligence.ts [all|discover|ranks|backlinks|report|status]`);
  process.exit(0);
}

const output: Record<string, unknown> = {};
if (command === "all" || command === "discover") output.discovery = await discoverProperties();
if (command === "all" || command === "ranks") output.ranks = await runRankChecks();
if (command === "all" || command === "backlinks") output.backlinks = await discoverWebBacklinks();
if (command === "all" || command === "report") output.report = createWeeklyReport();
if (command === "status") output.status = getIntelligence();
console.log(JSON.stringify(output, null, 2));
