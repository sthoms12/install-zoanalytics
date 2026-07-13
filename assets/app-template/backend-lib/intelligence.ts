import { Glob } from "bun";
import { db, getProperties, upsertDiscoveredProperty } from "./db";
import { getActionCenter } from "./product";

const WORKSPACE = "/home/workspace";

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export type DiscoverySurface = { id?: string; name: string; kind: "space" | "site" | "service"; url: string; public: boolean; mode?: string; projectPath?: string | null; source?: string };

function publicUrl(value: string) {
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || host.endsWith(".zo.computer")) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    url.hash = ""; return url;
  } catch { return null; }
}

async function reachableWithoutAuth(url: URL) {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "ZoAnalytics public-surface discovery" } });
    return response.status >= 200 && response.status < 400;
  } catch { return false; }
}

export async function importDiscoveryManifest(surfaces: DiscoverySurface[]) {
  const discovered: Array<{ id: string; name: string; url: string; projectPath: string | null; status: string }> = [];
  const skipped: Array<{ name: string; url: string; reason: string }> = [];
  for (const surface of surfaces) {
    if (surface.public !== true) { skipped.push({ name: surface.name, url: surface.url, reason: "not-public" }); continue; }
    if (surface.mode && surface.mode !== "http") { skipped.push({ name: surface.name, url: surface.url, reason: "not-http" }); continue; }
    const url = publicUrl(surface.url);
    if (!url) { skipped.push({ name: surface.name, url: surface.url, reason: "invalid-or-private-url" }); continue; }
    if (!await reachableWithoutAuth(url)) { skipped.push({ name: surface.name, url: surface.url, reason: "not-publicly-reachable" }); continue; }
    const propertyId = slug(surface.id || `${surface.kind}-${url.hostname}${url.pathname === "/" ? "" : `-${url.pathname}`}`);
    const property = upsertDiscoveredProperty({ id: propertyId, name: surface.name, kind: surface.kind, url: url.toString().replace(/\/$/, ""), projectPath: surface.projectPath ?? null, source: surface.source ?? "zo-inventory" });
    discovered.push({ id: propertyId, name: surface.name, url: property?.url ?? url.toString(), projectPath: property?.projectPath ?? null, status: property?.status ?? "missing-tracker" });
  }
  return { discovered, skipped, total: getProperties().length };
}

export async function discoverProperties() {
  const existing = new Set(getProperties().map((item) => item.id));
  const discovered: Array<{ id: string; name: string; url: string; projectPath: string; status: string }> = [];
  const skipped: Array<{ projectPath: string; reason: string }> = [];
  const glob = new Glob("*/zosite.json");
  const configuredHandle = process.env.ZO_OWNER_HANDLE?.trim();
  const inferredHandle = getProperties().map((item) => item.url.match(/^[a-z]+:\/\/[^/]+-([a-z0-9-]+)\.zocomputer\.io/i)?.[1]).find(Boolean);
  const ownerHandle = configuredHandle || inferredHandle;

  for await (const relative of glob.scan({ cwd: WORKSPACE, onlyFiles: true })) {
    const projectPath = `${WORKSPACE}/${relative.replace(/\/zosite\.json$/, "")}`;
    try {
      const config = await Bun.file(`${WORKSPACE}/${relative}`).json() as { name?: string; publish?: { label?: string; type?: string; public?: boolean; env?: Record<string, string> } };
      if (!config.publish?.label || config.publish.type !== "http") { skipped.push({ projectPath, reason: "not-published-http" }); continue; }
      if (config.publish.public === false || config.publish.env?.ZOANALYTICS_COLLECTOR_ONLY === "true" || config.publish.label === "zoanalytics") { skipped.push({ projectPath, reason: "private-or-collector" }); continue; }
      const propertyId = slug(config.name || config.publish.label);
      if (!ownerHandle) { skipped.push({ projectPath, reason: "owner-handle-required" }); continue; }
      if (existing.has(propertyId)) { db.prepare("UPDATE properties SET last_discovered_at=CURRENT_TIMESTAMP, lifecycle='active', retired_at=NULL WHERE id=?").run(propertyId); continue; }
      const url = `https://${config.publish.label}-${ownerHandle}.zocomputer.io`;
      upsertDiscoveredProperty({ id: propertyId, name: config.name || config.publish.label, kind: "site", url, projectPath, source: "workspace-site" });
      existing.add(propertyId);
      discovered.push({ id: propertyId, name: config.name || config.publish.label, url, projectPath, status: "missing-tracker" });
    } catch { skipped.push({ projectPath, reason: "invalid-config" }); }
  }
  return { discovered, skipped, total: getProperties().length };
}

export function getIntelligence() {
  bootstrapDefaults();
  syncObservedBacklinks();
  generateAlerts();
  const sessions = db.query(`
    WITH grouped AS (
      SELECT property_id AS propertyId, session_id AS sessionId, MIN(created_at) AS startedAt, MAX(created_at) AS endedAt,
        COUNT(*) AS pageviews, COUNT(DISTINCT path) AS uniquePages,
        CAST((julianday(MAX(created_at)) - julianday(MIN(created_at))) * 86400 AS INTEGER) AS durationSeconds,
        MIN(path) AS entryPath, MAX(path) AS exitPath, MAX(referrer) AS referrer
      FROM pageviews WHERE created_at >= datetime('now','-30 days') AND session_id IS NOT NULL
      GROUP BY property_id, session_id
    ) SELECT * FROM grouped ORDER BY startedAt DESC LIMIT 100
  `).all();

  const sessionTotals = db.query(`SELECT COUNT(DISTINCT session_id) AS sessions,
      ROUND(AVG(page_count), 1) AS pagesPerSession,
      ROUND(AVG(duration_seconds), 0) AS averageDurationSeconds,
      ROUND(SUM(CASE WHEN page_count = 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*),0), 3) AS bounceRate
    FROM (SELECT session_id, COUNT(*) AS page_count,
      (julianday(MAX(created_at))-julianday(MIN(created_at))) * 86400 AS duration_seconds
      FROM pageviews WHERE created_at >= datetime('now','-30 days') AND session_id IS NOT NULL GROUP BY session_id)`)
    .get() as Record<string, number | null>;

  const journeys = db.query(`SELECT property_id AS propertyId, session_id AS sessionId,
      GROUP_CONCAT(path, ' → ') AS journey, COUNT(*) AS steps, MIN(created_at) AS startedAt
    FROM (SELECT * FROM pageviews WHERE session_id IS NOT NULL ORDER BY created_at)
    WHERE created_at >= datetime('now','-30 days') GROUP BY property_id, session_id ORDER BY startedAt DESC LIMIT 20`).all();

  const goals = db.query(`SELECT g.id, g.property_id AS propertyId, g.name, g.event_name AS eventName, g.path_pattern AS pathPattern,
      COUNT(e.id) AS conversions, COUNT(DISTINCT e.property_id || ':' || COALESCE(e.session_id, e.id)) AS converters
    FROM goals g LEFT JOIN events e ON e.property_id = g.property_id AND e.name = g.event_name
      AND (g.path_pattern IS NULL OR g.path_pattern = '' OR e.path GLOB g.path_pattern)
      AND e.created_at >= datetime('now','-30 days') WHERE g.active = 1 GROUP BY g.id ORDER BY conversions DESC`).all();

  const vitalRows = db.query(`SELECT property_id AS propertyId, metric, value, rating
    FROM performance_metrics WHERE created_at >= datetime('now','-30 days') ORDER BY property_id, metric, value`).all() as Array<{ propertyId: string; metric: string; value: number; rating: string }>;
  const vitalGroups = new Map<string, typeof vitalRows>();
  for (const row of vitalRows) { const key = `${row.propertyId}:${row.metric}`; vitalGroups.set(key, [...(vitalGroups.get(key) ?? []), row]); }
  const vitals = [...vitalGroups.values()].map((rows) => {
    const index = Math.min(rows.length - 1, Math.ceil(rows.length * .75) - 1);
    return { propertyId: rows[0].propertyId, metric: rows[0].metric, p75: Math.round(rows[index].value * 10) / 10, samples: rows.length, poorSamples: rows.filter((row) => row.rating === "poor").length };
  });
  const errors = db.query(`SELECT property_id AS propertyId, kind, message, source, COUNT(*) AS occurrences, MAX(created_at) AS lastSeenAt
    FROM client_errors WHERE created_at >= datetime('now','-30 days') GROUP BY property_id, kind, message, source ORDER BY occurrences DESC LIMIT 25`).all();
  const changes = db.query(`SELECT property_id AS propertyId, page_url AS pageUrl, field, previous_value AS previousValue,
      current_value AS currentValue, detected_at AS detectedAt FROM page_changes ORDER BY detected_at DESC LIMIT 30`).all();
  const linkGraph = db.query(`WITH latest AS (SELECT property_id, MAX(created_at) AS at FROM link_edges GROUP BY property_id)
    SELECT le.property_id AS propertyId, le.source_url AS sourceUrl, le.target_url AS targetUrl, le.external
    FROM link_edges le JOIN latest ON latest.property_id = le.property_id AND latest.at = le.created_at LIMIT 500`).all();
  const orphanPages = db.query(`WITH pages AS (SELECT property_id, url, title, path, MAX(captured_at) FROM crawled_pages GROUP BY property_id, url)
    SELECT p.property_id AS propertyId, p.url, p.title, p.path FROM pages p LEFT JOIN link_edges e
      ON e.property_id = p.property_id AND e.target_url = p.url AND e.external = 0 WHERE e.id IS NULL AND p.path != '/' LIMIT 30`).all();
  const campaigns = db.query(`SELECT property_id AS propertyId, COALESCE(utm_campaign,'(none)') AS campaign,
      COALESCE(utm_source,'direct') AS source, COALESCE(utm_medium,'none') AS medium,
      COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions
    FROM pageviews WHERE created_at >= datetime('now','-30 days') GROUP BY property_id, campaign, source, medium ORDER BY pageviews DESC LIMIT 30`).all();
  const ranks = db.query(`SELECT w.id, w.property_id AS propertyId, w.keyword, w.target_url AS targetUrl,
      r.observed_position AS observedPosition, r.observed_url AS observedUrl, r.engine, r.checked_at AS checkedAt
    FROM rank_watchlist w LEFT JOIN rank_checks r ON r.id = (SELECT id FROM rank_checks WHERE property_id = w.property_id AND keyword = w.keyword ORDER BY checked_at DESC LIMIT 1)
    WHERE w.active = 1 ORDER BY w.keyword`).all();
  const backlinks = db.query(`SELECT property_id AS propertyId, source_url AS sourceUrl, target_url AS targetUrl,
      first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, status, visits FROM discovered_backlinks ORDER BY visits DESC, lastSeenAt DESC LIMIT 50`).all();
  const competitors = db.query(`SELECT id, property_id AS propertyId, name, domain, created_at AS createdAt FROM competitors ORDER BY name`).all();
  const alerts = db.query(`SELECT id, property_id AS propertyId, kind, severity, title, message, status, detected_at AS detectedAt
    FROM alerts WHERE status = 'open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, detected_at DESC LIMIT 30`).all();
  const reports = db.query(`SELECT id, period_start AS periodStart, period_end AS periodEnd, created_at AS createdAt FROM report_snapshots ORDER BY created_at DESC LIMIT 12`).all();
  const trackerCoverage = db.query(`SELECT id AS propertyId, name, url, status, verified_at AS verifiedAt,
      (SELECT MAX(created_at) FROM pageviews WHERE property_id = properties.id) AS lastSignalAt,
      CASE WHEN verified_at IS NOT NULL OR status = 'tracked' THEN 1 ELSE 0 END AS installed FROM properties WHERE lifecycle='active' ORDER BY installed, name`).all();

  return { sessions, sessionTotals: { sessions: sessionTotals.sessions ?? 0, pagesPerSession: sessionTotals.pagesPerSession ?? 0, averageDurationSeconds: sessionTotals.averageDurationSeconds ?? 0, bounceRate: sessionTotals.bounceRate ?? 0 }, journeys, goals, vitals, errors, changes, linkGraph, orphanPages, campaigns, ranks, backlinks, competitors, alerts, reports, trackerCoverage };
}

export async function runRankChecks() {
  bootstrapDefaults();
  const watches = db.query("SELECT property_id AS propertyId, keyword, target_url AS targetUrl FROM rank_watchlist WHERE active=1").all() as Array<{ propertyId: string; keyword: string; targetUrl: string | null }>;
  const properties = new Map(getProperties().map((item) => [item.id, item]));
  const results: Array<{ propertyId: string; keyword: string; position: number | null; observedUrl: string | null }> = [];
  for (const watch of watches) {
    const property = properties.get(watch.propertyId); if (!property?.url.startsWith("http")) continue;
    const targetHost = new URL(property.url).hostname;
    const found = await searchDuckDuckGo(watch.keyword, targetHost);
    recordRank({ propertyId: watch.propertyId, keyword: watch.keyword, targetUrl: watch.targetUrl || property.url, observedPosition: found.position ?? undefined, observedUrl: found.url ?? undefined, engine: "duckduckgo-html" });
    results.push({ propertyId: watch.propertyId, keyword: watch.keyword, position: found.position, observedUrl: found.url });
    await Bun.sleep(350);
  }
  return results;
}

export async function discoverWebBacklinks() {
  const properties = getProperties().filter((item) => item.url.startsWith("http"));
  const discovered: Array<{ propertyId: string; sourceUrl: string }> = [];
  const upsert = db.prepare(`INSERT INTO discovered_backlinks (id, property_id, source_url, target_url, status)
    VALUES (?, ?, ?, ?, 'discovered') ON CONFLICT(property_id, source_url) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP, status='discovered'`);
  for (const property of properties) {
    const targetHost = new URL(property.url).hostname;
    const urls = await searchResultUrls(`\"${targetHost}\"`);
    for (const sourceUrl of urls.filter((url) => { try { return new URL(url).hostname !== targetHost; } catch { return false; } }).slice(0, 20)) {
      upsert.run(id("backlink"), property.id, sourceUrl, property.url);
      discovered.push({ propertyId: property.id, sourceUrl });
    }
    await Bun.sleep(350);
  }
  return discovered;
}

export function createGoal(input: { propertyId: string; name: string; eventName: string; pathPattern?: string }) {
  const goalId = id("goal");
  db.prepare("INSERT INTO goals (id, property_id, name, event_name, path_pattern) VALUES (?, ?, ?, ?, ?)")
    .run(goalId, input.propertyId, input.name.slice(0, 100), input.eventName.slice(0, 50), input.pathPattern?.slice(0, 200) ?? null);
  return { id: goalId };
}

export function addRankKeyword(input: { propertyId: string; keyword: string; targetUrl?: string }) {
  const watchId = id("rankwatch");
  db.prepare(`INSERT INTO rank_watchlist (id, property_id, keyword, target_url) VALUES (?, ?, ?, ?)
    ON CONFLICT(property_id, keyword) DO UPDATE SET target_url=excluded.target_url, active=1`)
    .run(watchId, input.propertyId, input.keyword.slice(0, 150), input.targetUrl?.slice(0, 500) ?? null);
  return { id: watchId };
}

export function recordRank(input: { propertyId: string; keyword: string; targetUrl: string; observedPosition?: number; observedUrl?: string; engine?: string }) {
  const checkId = id("rank");
  db.prepare("INSERT INTO rank_checks (id, property_id, keyword, target_url, observed_position, observed_url, engine) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(checkId, input.propertyId, input.keyword, input.targetUrl, input.observedPosition ?? null, input.observedUrl ?? null, input.engine ?? "observed");
  return { id: checkId };
}

export function addCompetitor(input: { propertyId: string; name: string; domain: string }) {
  const competitorId = id("competitor");
  db.prepare(`INSERT INTO competitors (id, property_id, name, domain) VALUES (?, ?, ?, ?)
    ON CONFLICT(property_id, domain) DO UPDATE SET name=excluded.name`).run(competitorId, input.propertyId, input.name.slice(0,100), input.domain.slice(0,255));
  return { id: competitorId };
}

export function createWeeklyReport() {
  const periodEnd = new Date(); const periodStart = new Date(periodEnd); periodStart.setUTCDate(periodEnd.getUTCDate() - 7);
  const intelligence = getIntelligence();
  const totals = db.query(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors,
    COUNT(DISTINCT property_id) AS activeProperties FROM pageviews WHERE created_at >= datetime('now','-7 days')`).get();
  const previous = db.query(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews WHERE created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days')`).get() as { pageviews: number; visitors: number };
  const current = totals as { pageviews: number; visitors: number; activeProperties: number };
  const change = (value: number, before: number) => before ? Math.round((value - before) / before * 100) : value ? 100 : 0;
  const payload = {
    generatedAt: periodEnd.toISOString(), totals, comparison: { pageviews: change(current.pageviews, previous.pageviews), visitors: change(current.visitors, previous.visitors) },
    summary: current.pageviews ? `${current.visitors} visitors viewed ${current.pageviews} pages across ${current.activeProperties} public properties.` : "No human visits were recorded during this period.",
    actions: getActionCenter().slice(0, 3), alerts: intelligence.alerts.slice(0, 10), changes: intelligence.changes.slice(0, 10),
    backlinks: intelligence.backlinks.slice(0, 10), topJourneys: intelligence.journeys.slice(0, 10),
  };
  const reportId = id("report");
  db.prepare("INSERT INTO report_snapshots (id, period_start, period_end, payload) VALUES (?, ?, ?, ?)").run(reportId, periodStart.toISOString(), periodEnd.toISOString(), JSON.stringify(payload));
  return { id: reportId, ...payload };
}

function syncObservedBacklinks() {
  const rows = db.query(`SELECT property_id AS propertyId, referrer AS sourceUrl, MAX(url) AS targetUrl, COUNT(*) AS visits,
      MIN(created_at) AS firstSeenAt, MAX(created_at) AS lastSeenAt FROM pageviews
    WHERE referrer IS NOT NULL AND referrer != '' GROUP BY property_id, referrer`).all() as Array<Record<string, string | number>>;
  const upsert = db.prepare(`INSERT INTO discovered_backlinks (id, property_id, source_url, target_url, first_seen_at, last_seen_at, visits)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(property_id, source_url) DO UPDATE SET target_url=excluded.target_url,
    last_seen_at=excluded.last_seen_at, visits=excluded.visits, status='observed'`);
  for (const row of rows) upsert.run(id("backlink"), row.propertyId, row.sourceUrl, row.targetUrl, row.firstSeenAt, row.lastSeenAt, row.visits);
}

function generateAlerts() {
  const candidates = db.query(`SELECT property_id AS propertyId, 'client-errors' AS kind, 'warning' AS severity,
      'Repeated client errors' AS title, COUNT(*) || ' client errors were recorded in the last 24 hours.' AS message
    FROM client_errors WHERE created_at >= datetime('now','-1 day') GROUP BY property_id HAVING COUNT(*) >= 3
    UNION ALL SELECT property_id, 'poor-vitals', 'warning', 'Poor Core Web Vitals', COUNT(*) || ' poor performance samples were recorded.'
    FROM performance_metrics WHERE created_at >= datetime('now','-1 day') AND rating='poor' GROUP BY property_id HAVING COUNT(*) >= 3
    UNION ALL SELECT property_id, 'traffic-drop', 'critical', 'Traffic dropped sharply',
      'Yesterday was more than 60% below the preceding seven-day daily average.'
    FROM (SELECT property_id,
      SUM(CASE WHEN date(created_at)=date('now','-1 day') THEN 1 ELSE 0 END) AS yesterday,
      SUM(CASE WHEN created_at>=datetime('now','-8 days') AND created_at<datetime('now','-1 day') THEN 1 ELSE 0 END)/7.0 AS baseline
      FROM pageviews GROUP BY property_id) WHERE baseline >= 5 AND yesterday < baseline * .4
    UNION ALL SELECT property_id, 'broken-pages', 'critical', 'Broken public pages detected',
      COUNT(*) || ' crawled pages returned an error status.' FROM crawled_pages
      WHERE captured_at >= datetime('now','-1 day') AND status_code >= 400 GROUP BY property_id`)
    .all() as Array<{ propertyId: string; kind: string; severity: string; title: string; message: string }>;
  const exists = db.prepare("SELECT 1 FROM alerts WHERE property_id=? AND kind=? AND status='open' LIMIT 1");
  const insert = db.prepare("INSERT INTO alerts (id, property_id, kind, severity, title, message) VALUES (?, ?, ?, ?, ?, ?)");
  for (const item of candidates) if (!exists.get(item.propertyId, item.kind)) insert.run(id("alert"), item.propertyId, item.kind, item.severity, item.title, item.message);
}

function bootstrapDefaults() {
  const goalInsert = db.prepare(`INSERT OR IGNORE INTO goals (id, property_id, name, event_name)
    VALUES (?, ?, ?, ?)`);
  for (const property of getProperties().filter((item) => item.status === "tracked")) {
    goalInsert.run(`goal_${property.id}_outbound`, property.id, "Outbound clicks", "outbound-click");
    goalInsert.run(`goal_${property.id}_download`, property.id, "Downloads", "download");
  }
  const keywords = db.query(`SELECT property_id AS propertyId, keyword, MAX(weight) AS weight FROM keyword_candidates
    GROUP BY property_id, keyword ORDER BY weight DESC LIMIT 20`).all() as Array<{ propertyId: string; keyword: string }>;
  const counts = new Map<string, number>();
  const insert = db.prepare("INSERT OR IGNORE INTO rank_watchlist (id, property_id, keyword, target_url) VALUES (?, ?, ?, (SELECT url FROM properties WHERE id=?))");
  for (const item of keywords) {
    const count = counts.get(item.propertyId) ?? 0; if (count >= 3) continue;
    insert.run(id("rankwatch"), item.propertyId, item.keyword, item.propertyId);
    counts.set(item.propertyId, count + 1);
  }
}

async function searchDuckDuckGo(query: string, targetHost: string) {
  const urls = await searchResultUrls(query);
  const index = urls.findIndex((url) => { try { return new URL(url).hostname === targetHost || new URL(url).hostname.endsWith(`.${targetHost}`); } catch { return false; } });
  return { position: index >= 0 ? index + 1 : null, url: index >= 0 ? urls[index] : null };
}

async function searchResultUrls(query: string) {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "ZoAnalyticsRankObserver/1.0" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return [];
    const html = await response.text(); const urls: string[] = [];
    for (const match of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/gi)) {
      const raw = match[1].replaceAll("&amp;", "&");
      try { const parsed = new URL(raw, "https://duckduckgo.com"); const target = parsed.searchParams.get("uddg") || parsed.toString(); if (target.startsWith("http")) urls.push(decodeURIComponent(target)); } catch {}
    }
    return [...new Set(urls)];
  } catch { return []; }
}
