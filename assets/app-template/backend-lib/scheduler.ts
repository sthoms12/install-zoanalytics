import { appendFile } from "node:fs/promises";
import { db } from "./db";

const TIMEZONE = "America/Chicago";
const TARGET_HOUR = 10;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const SETTING_KEY = "weekly_refresh_last_run";
const LOG_PATH = "./data/weekly-refresh.log";

const STEPS: { label: string; cmd: string[] }[] = [
  { label: "crawl", cmd: ["bun", "scripts/crawl.ts", "--all", "--max-pages", "20"] },
  { label: "common-crawl-sync", cmd: ["bun", "scripts/common-crawl-sync.ts"] },
  { label: "ahrefs-sync", cmd: ["bun", "scripts/ahrefs-sync.ts"] },
  { label: "intelligence-all", cmd: ["bun", "scripts/intelligence.ts", "all"] },
  { label: "weekly-owner-brief", cmd: ["bun", "scripts/weekly-brief.ts"] },
];

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: parts.weekday,
  };
}

function mostRecentScheduledRun(now: Date): Date {
  const zoned = getZonedParts(now, TIMEZONE);
  const offsetMinutes = (Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second) - now.getTime()) / 60000;
  const daysSinceMonday = WEEKDAY_INDEX[zoned.weekday] ?? 0;
  const mondayUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day - daysSinceMonday, TARGET_HOUR, 0, 0) - offsetMinutes * 60000;
  const scheduled = new Date(mondayUtc);
  return scheduled.getTime() > now.getTime() ? new Date(scheduled.getTime() - 7 * 24 * 60 * 60 * 1000) : scheduled;
}

function getLastRun(): Date | null {
  const row = db.query("SELECT value FROM app_settings WHERE key=?").get(SETTING_KEY) as { value: string } | undefined;
  return row ? new Date(row.value) : null;
}

function setLastRun(date: Date) {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(SETTING_KEY, date.toISOString());
}

async function appendLog(line: string) {
  await appendFile(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`).catch(() => {});
}

async function runStep(cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  const tail = (stdout + stderr).trim().split("\n").slice(-5).join(" | ").slice(0, 2000);
  return { ok: exitCode === 0, tail };
}

export async function runWeeklyRefresh(now: Date = new Date()) {
  await appendLog("weekly refresh starting");
  for (const step of STEPS) {
    const result = await runStep(step.cmd);
    await appendLog(`${step.label}: ${result.ok ? "ok" : "FAILED"}${result.tail ? ` — ${result.tail}` : ""}`);
  }
  setLastRun(now);
  await appendLog("weekly refresh complete");
}

export async function maybeRunWeeklyRefresh() {
  const now = new Date();
  const scheduled = mostRecentScheduledRun(now);
  const lastRun = getLastRun();
  if (lastRun && lastRun.getTime() >= scheduled.getTime()) return;
  await runWeeklyRefresh(now);
}

export function startWeeklyRefreshScheduler() {
  maybeRunWeeklyRefresh().catch((error) => appendLog(`scheduler check failed: ${error instanceof Error ? error.message : String(error)}`));
  setInterval(() => {
    maybeRunWeeklyRefresh().catch((error) => appendLog(`scheduler check failed: ${error instanceof Error ? error.message : String(error)}`));
  }, CHECK_INTERVAL_MS);
}
