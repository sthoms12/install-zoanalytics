import { crawlAllPublicProperties, crawlProperty } from "../backend-lib/crawler";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=", 2);
  const value = inlineValue ?? process.argv[i + 1];
  args.set(key, value);
  if (!inlineValue) i += 1;
}

if (args.has("help")) {
  console.log(`Usage:
  bun scripts/crawl.ts --all --max-pages 20
  bun scripts/crawl.ts --property zo-space-home --max-pages 10

Options:
  --all                 Crawl every property with a public HTTP URL
  --property <siteId>   Crawl one property
  --max-pages <number>  Maximum pages per property, default 20
`);
  process.exit(0);
}

const maxPages = Math.max(1, Math.min(100, Number(args.get("max-pages") ?? "20") || 20));
const propertyId = args.get("property");

const result = propertyId ? await crawlProperty(propertyId, maxPages) : await crawlAllPublicProperties(maxPages);
console.log(JSON.stringify(result, null, 2));
