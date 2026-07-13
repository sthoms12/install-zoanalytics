import { mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { db, getCommonCrawlTargets, saveCommonCrawlResults, type CommonCrawlPropertyResult } from "../backend-lib/db";

const DATA_ORIGIN = "https://data.commoncrawl.org/";
const GRAPH_INDEX = "https://index.commoncrawl.org/graphinfo.json";
const root = process.cwd();
const cacheRoot = join(root, "data", "common-crawl");
const runtimeRoot = join(cacheRoot, "runtime");
const cargoHome = join(runtimeRoot, "cargo");
const rustupHome = join(runtimeRoot, "rustup");
const targetDir = join(runtimeRoot, "build");

type GraphRelease = {
  id: string;
  index: string;
  stats: { host: { nodes: number; arcs: number } };
};

type Target = { propertyId: string; hostname: string; reverseHost: string; nodeId?: number };

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function formatBytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

async function run(command: string[], options: { cwd?: string; quiet?: boolean; env?: Record<string, string> } = {}) {
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdout: options.quiet ? "pipe" : "inherit",
    stderr: options.quiet ? "pipe" : "inherit",
  });
  const stdout = options.quiet ? new Response(child.stdout).text() : Promise.resolve("");
  const stderr = options.quiet ? new Response(child.stderr).text() : Promise.resolve("");
  const [exitCode, output, errors] = await Promise.all([child.exited, stdout, stderr]);
  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited ${exitCode}${errors ? `: ${errors.trim()}` : ""}`);
  }
  return output;
}

async function contentLength(url: string) {
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) throw new Error(`HEAD ${url} returned ${response.status}`);
  return Number(response.headers.get("content-length") ?? 0);
}

async function download(url: string, destination: string) {
  mkdirSync(join(destination, ".."), { recursive: true });
  const expected = await contentLength(url);
  try {
    if (expected > 0 && statSync(destination).size === expected) return;
  } catch {}
  console.log(`Downloading ${basename(destination)} (${formatBytes(expected)})`);
  await run(["curl", "-fL", "--retry", "5", "--retry-delay", "2", "--continue-at", "-", "-o", destination, url]);
}

async function release() {
  const response = await fetch(GRAPH_INDEX);
  if (!response.ok) throw new Error(`Common Crawl graph index returned ${response.status}`);
  const releases = await response.json() as GraphRelease[];
  const requested = argument("--release");
  const selected = requested ? releases.find((item) => item.id === requested) : releases[0];
  if (!selected) throw new Error(`Unknown Common Crawl release: ${requested}`);
  return selected;
}

function reverseHost(hostname: string) {
  return hostname.toLowerCase().split(".").reverse().join(".");
}

async function gunzipText(path: string) {
  return run(["gzip", "-dc", path], { quiet: true });
}

async function* gzipLines(path: string) {
  const child = Bun.spawn(["gzip", "-dc", path], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      yield pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending) yield pending;
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`gzip exited ${exitCode}: ${await new Response(child.stderr).text()}`);
}

async function mapPool<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index], index);
    }
  }));
}

async function ensureRuntime() {
  const webgraph = join(runtimeRoot, "bin", "webgraph");
  const query = join(targetDir, "release", "common-crawl-query");
  if (!(await Bun.file(webgraph).exists()) || !(await Bun.file(query).exists())) {
    mkdirSync(runtimeRoot, { recursive: true });
    const installer = join(runtimeRoot, "rustup-init.sh");
    await download("https://sh.rustup.rs", installer);
    await run(["sh", installer, "-y", "--profile", "minimal", "--no-modify-path"], { env: { CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome } });
    const cargo = join(cargoHome, "bin", "cargo");
    await run([cargo, "install", "webgraph-cli", "--version", "0.4.2", "--root", runtimeRoot], { env: { CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome } });
    await run([cargo, "build", "--release", "--manifest-path", join(root, "scripts", "common-crawl-query", "Cargo.toml")], { env: { CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome, CARGO_TARGET_DIR: targetDir } });
  }
  return { webgraph, query };
}

async function findNodeIds(vertexFiles: string[], targets: Target[]) {
  const wanted = new Map(targets.map((target) => [target.reverseHost, target]));
  for (const [index, file] of vertexFiles.entries()) {
    if (!wanted.size) break;
    console.log(`Indexing tracked hosts from vertex shard ${index + 1}/${vertexFiles.length}`);
    for await (const line of gzipLines(file)) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const target = wanted.get(line.slice(tab + 1));
      if (!target) continue;
      target.nodeId = Number(line.slice(0, tab));
      wanted.delete(target.reverseHost);
    }
  }
  return targets.filter((target) => target.nodeId !== undefined);
}

async function mapSourceHosts(vertexFiles: string[], sourceIds: Set<number>) {
  const hosts = new Map<number, string>();
  for (const [index, file] of vertexFiles.entries()) {
    if (hosts.size === sourceIds.size) break;
    console.log(`Resolving referring hosts from vertex shard ${index + 1}/${vertexFiles.length}`);
    for await (const line of gzipLines(file)) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const nodeId = Number(line.slice(0, tab));
      if (!sourceIds.has(nodeId)) continue;
      hosts.set(nodeId, line.slice(tab + 1).split(".").reverse().join("."));
    }
  }
  return hosts;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: bun run common-crawl-sync [--metadata-only] [--release <id>] [--force] [--rebuild]");
    return;
  }
  const graphRelease = await release();
  const targets: Target[] = getCommonCrawlTargets().map((item) => ({ ...item, reverseHost: reverseHost(item.hostname) }));
  console.log(`Common Crawl ${graphRelease.id}: ${graphRelease.stats.host.nodes.toLocaleString()} hosts, ${graphRelease.stats.host.arcs.toLocaleString()} links`);
  console.log(`Tracked host targets: ${targets.length}`);
  if (process.argv.includes("--metadata-only")) {
    for (const target of targets) console.log(`  ${target.propertyId}: ${target.hostname}`);
    return;
  }

  const previous = db.query(`
    SELECT status, targets
    FROM common_crawl_runs
    WHERE release_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(graphRelease.id) as { status: string; targets: number } | null;
  if (!process.argv.includes("--force") && previous?.status === "success" && previous.targets === targets.length) {
    console.log(`Already synced ${graphRelease.id}; use --force to rebuild the snapshot.`);
    return;
  }

  const runId = `cc_${crypto.randomUUID()}`;
  db.prepare("INSERT INTO common_crawl_runs (id, release_id, status, targets) VALUES (?, ?, 'running', ?)").run(runId, graphRelease.id, targets.length);
  try {
    const releaseDir = join(cacheRoot, graphRelease.id);
    const hostDir = join(releaseDir, "host");
    const verticesDir = join(hostDir, "vertices");
    mkdirSync(verticesDir, { recursive: true });
    const listUrl = `${DATA_ORIGIN}projects/hyperlinkgraph/${graphRelease.id}/host/${graphRelease.id}-host-vertices.paths.gz`;
    const listPath = join(hostDir, `${graphRelease.id}-host-vertices.paths.gz`);
    await download(listUrl, listPath);
    const vertexPaths = (await gunzipText(listPath)).trim().split("\n").filter(Boolean);
    const vertexFiles = vertexPaths.map((path) => join(verticesDir, basename(path)));
    await mapPool(vertexPaths, 4, async (path, index) => {
      await download(`${DATA_ORIGIN}${path}`, vertexFiles[index]);
    });

    const foundTargets = await findNodeIds(vertexFiles, targets);
    const missingTargets = targets.filter((target) => target.nodeId === undefined);
    for (const target of missingTargets) console.log(`Not present in graph: ${target.hostname}`);
    if (!foundTargets.length) {
      saveCommonCrawlResults(graphRelease.id, [...new Set(targets.map((target) => target.propertyId))].map((propertyId) => ({ propertyId, targetHosts: targets.filter((target) => target.propertyId === propertyId).map((target) => target.hostname), indexedHosts: [], links: [] })));
      db.prepare("UPDATE common_crawl_runs SET status = 'success', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(runId);
      return;
    }

    const graphBase = join(hostDir, `${graphRelease.id}-host-t`);
    await download(`${DATA_ORIGIN}projects/hyperlinkgraph/${graphRelease.id}/host/${graphRelease.id}-host-t.properties`, `${graphBase}.properties`);
    await download(`${DATA_ORIGIN}projects/hyperlinkgraph/${graphRelease.id}/host/${graphRelease.id}-host-t.graph`, `${graphBase}.graph`);
    const runtime = await ensureRuntime();
    if (process.argv.includes("--rebuild") || !(await Bun.file(`${graphBase}.offsets`).exists())) await run([runtime.webgraph, "build", "offsets", graphBase]);
    if (process.argv.includes("--rebuild") || !(await Bun.file(`${graphBase}.ef`).exists())) await run([runtime.webgraph, "build", "ef", graphBase]);
    const output = await run([runtime.query, graphBase, ...foundTargets.map((target) => String(target.nodeId))], { quiet: true });
    const incoming = new Map<number, Set<number>>();
    const sourceIds = new Set<number>();
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const [targetValue, sourceValue] = line.split("\t");
      const targetId = Number(targetValue);
      const sourceId = Number(sourceValue);
      if (!incoming.has(targetId)) incoming.set(targetId, new Set());
      incoming.get(targetId)!.add(sourceId);
      sourceIds.add(sourceId);
    }
    const sourceHosts = await mapSourceHosts(vertexFiles, sourceIds);
    const propertyIds = [...new Set(targets.map((target) => target.propertyId))];
    const results: CommonCrawlPropertyResult[] = propertyIds.map((propertyId) => {
      const propertyTargets = targets.filter((target) => target.propertyId === propertyId);
      const ownHosts = new Set(propertyTargets.map((target) => target.hostname));
      const links = new Map<string, { sourceHost: string; targetHost: string }>();
      for (const target of propertyTargets) {
        if (target.nodeId === undefined) continue;
        for (const sourceId of incoming.get(target.nodeId) ?? []) {
          const sourceHost = sourceHosts.get(sourceId);
          if (!sourceHost || ownHosts.has(sourceHost)) continue;
          links.set(`${sourceHost}\t${target.hostname}`, { sourceHost, targetHost: target.hostname });
        }
      }
      return { propertyId, targetHosts: propertyTargets.map((target) => target.hostname), indexedHosts: propertyTargets.filter((target) => target.nodeId !== undefined).map((target) => target.hostname), links: [...links.values()] };
    });
    saveCommonCrawlResults(graphRelease.id, results);
    const linksFound = results.reduce((sum, result) => sum + result.links.length, 0);
    db.prepare("UPDATE common_crawl_runs SET status = 'success', finished_at = CURRENT_TIMESTAMP, links_found = ? WHERE id = ?").run(linksFound, runId);
    for (const result of results) console.log(`${result.propertyId}: ${new Set(result.links.map((link) => link.sourceHost)).size} referring hosts, ${result.links.length} host links`);
  } catch (error) {
    db.prepare("UPDATE common_crawl_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?").run(String(error).slice(0, 1000), runId);
    throw error;
  }
}

await main();
