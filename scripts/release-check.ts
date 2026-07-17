import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "..");
const target = mkdtempSync(join(tmpdir(), "zoanalytics-release-check-"));
const port = 41793;
let server: ReturnType<typeof Bun.spawn> | null = null;

function run(command: string[], cwd = root, env?: Record<string, string>) {
  console.log(`\n> ${command.join(" ")}`);
  const result = Bun.spawnSync(command, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${result.exitCode}`);
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function expectResponse(path: string, status: number, contains?: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: "manual",
    headers: { Accept: "application/json,text/javascript,text/html" },
  });
  const body = await response.text();
  if (response.status !== status || (contains && !body.includes(contains))) {
    throw new Error(`${path} returned ${response.status}; expected ${status}${contains ? ` containing ${contains}` : ""}`);
  }
}

try {
  run(["bun", "scripts/package-audit.ts"]);
  run(["bun", "scripts/preflight.ts", "--mode", "install", "--target", target]);
  run(["bun", "scripts/install.ts", "--target", target, "--port", String(port), "--label", "zoanalytics-release-check", "--owner-handle", "releasecheck"]);

  if (!existsSync(join(target, "zosite.json")) || existsSync(join(target, "zosite.template.json"))) {
    throw new Error("Installed target did not rename zosite.template.json to zosite.json");
  }
  if (existsSync(join(target, "data", "zoanalytics.db"))) throw new Error("Install copied a runtime database");

  run(["bunx", "tsc", "--noEmit"], target);
  run(["bun", "test", "backend-lib"], target, { ZOANALYTICS_DB_PATH: join(target, "data", "test.db") });
  run(["bun", "run", "build"], target);
  run(["bun", "run", "doctor"], target);

  server = Bun.spawn(["bun", "server.ts"], {
    cwd: target,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ZOANALYTICS_COLLECTOR_ONLY: "true",
      ZOANALYTICS_DB_PATH: join(target, "data", "zoanalytics.db"),
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitFor(`http://127.0.0.1:${port}/api/health`);
  await expectResponse("/api/health", 200, "ZoAnalytics");
  await expectResponse("/api/pulse", 200, '"properties":[]');
  await expectResponse("/api/analytics/setup", 404, "unavailable");
  await expectResponse("/zowa.js", 200, "navigator.webdriver");

  const unknown = await fetch(`http://127.0.0.1:${port}/api/analytics/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 release-check" },
    body: JSON.stringify({ siteId: "unknown-release-check", path: "/" }),
  });
  if (unknown.status !== 404) throw new Error(`Unknown collector property returned ${unknown.status}; expected 404`);

  console.log(`\nRelease check passed on Bun ${Bun.version}.`);
} finally {
  if (server) {
    server.kill();
    await server.exited.catch(() => {});
  }
  rmSync(target, { recursive: true, force: true });
}

