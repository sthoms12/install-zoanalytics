import { createWeeklyReport, discoverProperties, discoverWebBacklinks, getIntelligence, runRankChecks } from "../backend-lib/intelligence";
import { discoverExternalProperties } from "../backend-lib/external";
import { refreshPulseSnapshot } from "../backend-lib/pulse";

const command = process.argv[2] || "all";
if (command === "--help" || command === "help") {
  console.log(`Usage: bun scripts/intelligence.ts [all|discover|external|ranks|backlinks|report|pulse|status]`);
  process.exit(0);
}

const output: Record<string, unknown> = {};
if (command === "all" || command === "discover") output.discovery = await discoverProperties();
if (command === "all" || command === "external") output.externalDiscovery = await discoverExternalProperties();
if (command === "all" || command === "ranks") output.ranks = await runRankChecks();
if (command === "all" || command === "backlinks") output.backlinks = await discoverWebBacklinks();
if (command === "all" || command === "report") output.report = createWeeklyReport();
if (command === "all" || command === "pulse") output.pulse = refreshPulseSnapshot();
if (command === "status") output.status = getIntelligence();
console.log(JSON.stringify(output, null, 2));
