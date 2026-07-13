import { discoverProperties, importDiscoveryManifest, type DiscoverySurface } from "../backend-lib/intelligence";

function value(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes("--help")) {
  console.log("bun scripts/discover.ts [--manifest data/discovery-manifest.json] [--local-only | --manifest-only]");
  process.exit(0);
}

const startedAt = new Date().toISOString();
const manifestPath = value("--manifest") ?? "data/discovery-manifest.json";
const local = process.argv.includes("--manifest-only")
  ? { discovered: [], skipped: [], total: 0 }
  : await discoverProperties();
let manifest = { discovered: [], skipped: [], total: local.total } as Awaited<ReturnType<typeof importDiscoveryManifest>>;

if (!process.argv.includes("--local-only") && await Bun.file(manifestPath).exists()) {
  const input = await Bun.file(manifestPath).json() as { surfaces?: DiscoverySurface[] };
  if (!Array.isArray(input.surfaces)) throw new Error("Discovery manifest must contain a surfaces array");
  manifest = await importDiscoveryManifest(input.surfaces);
}

const receipt = {
  startedAt,
  finishedAt: new Date().toISOString(),
  local,
  manifest,
  discovered: local.discovered.length + manifest.discovered.length,
  skipped: local.skipped.length + manifest.skipped.length,
  total: manifest.total,
};
await Bun.write("data/discovery-status.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
