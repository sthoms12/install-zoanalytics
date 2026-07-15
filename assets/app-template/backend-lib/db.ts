import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { assessComparison, assessFreshness, assessTracker } from "./confidence";

const dbPath = join(process.cwd(), "data", "zoanalytics.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export type Property = {
  id: string;
  name: string;
  kind: "space" | "site" | "service" | "external";
  url: string;
  projectPath: string | null;
  status: "tracked" | "missing-tracker" | "needs-review";
  tags: string;
  gscProperty: string | null;
  ahrefsTarget: string | null;
  verifiedAt: string | null;
};

export type DiscoveredProperty = {
  id: string;
  name: string;
  kind: "space" | "site" | "service" | "external";
  url: string;
  projectPath?: string | null;
  source?: string;
};

export type CommonCrawlPropertyResult = {
  propertyId: string;
  targetHosts: string[];
  indexedHosts: string[];
  links: Array<{ sourceHost: string; targetHost: string }>;
};

export type CollectPayload = {
  siteId?: string;
  path?: string;
  title?: string;
  referrer?: string;
  url?: string;
  event?: string;
  data?: Record<string, unknown>;
  screen?: string;
  language?: string;
  timezone?: string;
  sessionId?: string;
  durationMs?: number;
  campaign?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
};

export const APP_VERSION = "0.9.0";

export type CrawlPageInput = {
  propertyId: string;
  url: string;
  path: string;
  statusCode: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  robots: string | null;
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  images: number;
  imagesMissingAlt: number;
  schemaTypes: string[];
  ogTitle: string | null;
  twitterTitle: string | null;
  htmlBytes: number;
  loadMs: number;
  seoScore: number;
  issues: Array<{ severity: "critical" | "warning" | "info"; code: string; message: string }>;
  keywords: Array<{ keyword: string; weight: number; source: string }>;
  internalUrls: string[];
  externalUrls: string[];
};

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      project_path TEXT,
      status TEXT NOT NULL DEFAULT 'missing-tracker',
      tags TEXT NOT NULL DEFAULT '',
      gsc_property TEXT,
      ahrefs_target TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pageviews (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      title TEXT,
      url TEXT,
      referrer TEXT,
      user_agent TEXT,
      screen TEXT,
      language TEXT,
      timezone TEXT,
      visitor_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_pageviews_property_created ON pageviews(property_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews(path);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gsc_daily (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      page TEXT NOT NULL,
      query TEXT,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (property_id, date, page, query)
    );

    CREATE TABLE IF NOT EXISTS ahrefs_metrics (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      captured_at TEXT NOT NULL,
      domain_rating REAL,
      url_rating REAL,
      referring_domains INTEGER,
      backlinks INTEGER,
      organic_keywords INTEGER,
      organic_traffic INTEGER,
      PRIMARY KEY (property_id, captured_at)
    );

    CREATE TABLE IF NOT EXISTS crawl_runs (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      status TEXT NOT NULL,
      pages_seen INTEGER NOT NULL DEFAULT 0,
      pages_crawled INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS crawled_pages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      title TEXT,
      description TEXT,
      h1 TEXT,
      canonical TEXT,
      robots TEXT,
      word_count INTEGER NOT NULL DEFAULT 0,
      internal_links INTEGER NOT NULL DEFAULT 0,
      external_links INTEGER NOT NULL DEFAULT 0,
      images INTEGER NOT NULL DEFAULT 0,
      images_missing_alt INTEGER NOT NULL DEFAULT 0,
      schema_types TEXT NOT NULL DEFAULT '[]',
      og_title TEXT,
      twitter_title TEXT,
      html_bytes INTEGER NOT NULL DEFAULT 0,
      load_ms INTEGER NOT NULL DEFAULT 0,
      seo_score INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_crawled_pages_property_captured ON crawled_pages(property_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_crawled_pages_path ON crawled_pages(property_id, path);

    CREATE TABLE IF NOT EXISTS seo_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      severity TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS keyword_candidates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      keyword TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rank_checks (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      target_url TEXT NOT NULL,
      observed_position INTEGER,
      observed_url TEXT,
      engine TEXT NOT NULL DEFAULT 'manual',
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      event_name TEXT NOT NULL,
      path_pattern TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS performance_metrics (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      session_id TEXT,
      path TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      rating TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_performance_property_created ON performance_metrics(property_id, created_at);

    CREATE TABLE IF NOT EXISTS client_errors (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      session_id TEXT,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS link_edges (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      external INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_link_edges_property ON link_edges(property_id, external, created_at);

    CREATE TABLE IF NOT EXISTS page_changes (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      field TEXT NOT NULL,
      previous_value TEXT,
      current_value TEXT,
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rank_watchlist (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      target_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(property_id, keyword)
    );

    CREATE TABLE IF NOT EXISTS discovered_backlinks (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      target_url TEXT,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'observed',
      visits INTEGER NOT NULL DEFAULT 0,
      UNIQUE(property_id, source_url)
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(property_id, domain)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS report_snapshots (
      id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS action_states (
      action_key TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open',
      snoozed_until TEXT,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS funnels (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      window_minutes INTEGER NOT NULL DEFAULT 60,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS funnel_steps (
      id TEXT PRIMARY KEY,
      funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(funnel_id, position)
    );

    CREATE TABLE IF NOT EXISTS surface_aliases (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id, url)
    );

    CREATE TABLE IF NOT EXISTS property_sources (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      source_id TEXT NOT NULL,
      repository TEXT,
      repository_url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id, provider)
    );

    CREATE TABLE IF NOT EXISTS surface_inventory (
      source_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT,
      canonical_url TEXT,
      project_path TEXT,
      classification TEXT NOT NULL,
      property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
      conflict TEXT,
      next_action TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      retired_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_surface_inventory_classification ON surface_inventory(classification);

    CREATE TABLE IF NOT EXISTS pulse_config (
      property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      show_url INTEGER NOT NULL DEFAULT 1,
      show_pageviews INTEGER NOT NULL DEFAULT 1,
      show_visitors INTEGER NOT NULL DEFAULT 0,
      show_trend INTEGER NOT NULL DEFAULT 1,
      show_audit INTEGER NOT NULL DEFAULT 1,
      show_vitals INTEGER NOT NULL DEFAULT 1,
      show_authority INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pulse_snapshots (
      id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS common_crawl_targets (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      hostname TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id, hostname)
    );

    CREATE TABLE IF NOT EXISTS common_crawl_runs (
      id TEXT PRIMARY KEY,
      release_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error TEXT,
      targets INTEGER NOT NULL DEFAULT 0,
      links_found INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS common_crawl_snapshots (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      release_id TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      target_hosts TEXT NOT NULL DEFAULT '[]',
      indexed_target_hosts TEXT NOT NULL DEFAULT '[]',
      indexed_hosts INTEGER NOT NULL DEFAULT 0,
      referring_hosts INTEGER NOT NULL DEFAULT 0,
      link_edges INTEGER NOT NULL DEFAULT 0,
      authority_score INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (property_id, release_id)
    );

    CREATE TABLE IF NOT EXISTS common_crawl_links (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      release_id TEXT NOT NULL,
      source_host TEXT NOT NULL,
      target_host TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id, release_id, source_host, target_host)
    );

    CREATE INDEX IF NOT EXISTS idx_common_crawl_links_property ON common_crawl_links(property_id, release_id);

    CREATE TABLE IF NOT EXISTS change_events (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      page_url TEXT,
      external_ref TEXT,
      receipt_metadata TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(property_id, source, external_ref)
    );

    CREATE INDEX IF NOT EXISTS idx_change_events_property ON change_events(property_id, occurred_at);

    CREATE TABLE IF NOT EXISTS safe_fixes (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      action_key TEXT,
      code TEXT NOT NULL,
      file_path TEXT NOT NULL,
      before_content TEXT NOT NULL,
      after_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'applied',
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reverted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_safe_fixes_property ON safe_fixes(property_id, applied_at);
  `);

  ensureColumn("pageviews", "session_id", "TEXT");
  ensureColumn("pageviews", "duration_ms", "INTEGER");
  ensureColumn("pageviews", "utm_source", "TEXT");
  ensureColumn("pageviews", "utm_medium", "TEXT");
  ensureColumn("pageviews", "utm_campaign", "TEXT");
  ensureColumn("pageviews", "utm_content", "TEXT");
  ensureColumn("pageviews", "utm_term", "TEXT");
  ensureColumn("common_crawl_snapshots", "indexed_target_hosts", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("common_crawl_snapshots", "indexed_hosts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("change_events", "receipt_metadata", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("events", "session_id", "TEXT");
  ensureColumn("properties", "verified_at", "TEXT");
  ensureColumn("properties", "last_discovered_at", "TEXT");
  ensureColumn("properties", "lifecycle", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("properties", "retired_at", "TEXT");
  db.prepare("UPDATE properties SET lifecycle='retired', retired_at=COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE url NOT LIKE 'http%'").run();
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (4)").run();
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (5)").run();
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (6)").run();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('app_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(APP_VERSION);
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

migrate();

function seedCommonCrawlTargets() {
  const insert = db.prepare("INSERT OR IGNORE INTO common_crawl_targets (property_id, hostname) VALUES (?, ?)");
  for (const property of getProperties()) {
    if (!property.url.startsWith("http")) continue;
    insert.run(property.id, new URL(property.url).hostname.toLowerCase());
  }
}

seedCommonCrawlTargets();

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function getProperties(): Property[] {
  return db.query(`
    SELECT id, name, kind, url, project_path AS projectPath, status, tags,
      gsc_property AS gscProperty, ahrefs_target AS ahrefsTarget, verified_at AS verifiedAt
    FROM properties
    WHERE lifecycle = 'active'
    ORDER BY name COLLATE NOCASE
  `).all() as Property[];
}

export function getProperty(id: string): Property | null {
  return db.query(`
    SELECT id, name, kind, url, project_path AS projectPath, status, tags,
      gsc_property AS gscProperty, ahrefs_target AS ahrefsTarget, verified_at AS verifiedAt
    FROM properties
    WHERE id = ?
  `).get(id) as Property | null;
}

export function upsertDiscoveredProperty(input: DiscoveredProperty) {
  db.prepare(`INSERT INTO properties (id, name, kind, url, project_path, status, tags, last_discovered_at, lifecycle)
    VALUES (?, ?, ?, ?, ?, 'missing-tracker', ?, CURRENT_TIMESTAMP, 'active')
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, url=excluded.url,
      project_path=COALESCE(excluded.project_path, properties.project_path), tags=excluded.tags,
      last_discovered_at=CURRENT_TIMESTAMP, lifecycle='active', retired_at=NULL, updated_at=CURRENT_TIMESTAMP`)
    .run(input.id, input.name, input.kind, input.url, input.projectPath ?? null, `auto-discovered,public,${input.source ?? "manifest"}`);
  db.prepare("INSERT OR IGNORE INTO common_crawl_targets (property_id, hostname) VALUES (?, ?)").run(input.id, new URL(input.url).hostname.toLowerCase());
  return getProperty(input.id);
}

export function upsertPropertySource(input: { propertyId: string; provider: string; sourceId: string; repository?: string | null; repositoryUrl?: string | null; metadata?: Record<string, unknown> }) {
  db.prepare(`INSERT INTO property_sources (property_id, provider, source_id, repository, repository_url, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(property_id, provider) DO UPDATE SET source_id=excluded.source_id,
      repository=COALESCE(excluded.repository, property_sources.repository),
      repository_url=COALESCE(excluded.repository_url, property_sources.repository_url),
      metadata=excluded.metadata, last_synced_at=CURRENT_TIMESTAMP`)
    .run(input.propertyId, input.provider, input.sourceId, input.repository ?? null, input.repositoryUrl ?? null, JSON.stringify(input.metadata ?? {}));
}

export function upsertSurfaceAlias(propertyId: string, url: string) {
  db.prepare(`INSERT INTO surface_aliases (property_id, url) VALUES (?, ?)
    ON CONFLICT(property_id, url) DO UPDATE SET active=1, last_seen_at=CURRENT_TIMESTAMP`).run(propertyId, url);
  try {
    db.prepare("INSERT OR IGNORE INTO common_crawl_targets (property_id, hostname) VALUES (?, ?)").run(propertyId, new URL(url).hostname.toLowerCase());
  } catch {}
}

export function getPropertySources() {
  return db.query(`SELECT property_id AS propertyId, provider, source_id AS sourceId, repository,
      repository_url AS repositoryUrl, metadata, last_synced_at AS lastSyncedAt
    FROM property_sources ORDER BY provider, repository, source_id`).all().map((row: any) => ({
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
    }));
}

export function getCommonCrawlTargets() {
  return db.query(`
    SELECT property_id AS propertyId, hostname
    FROM common_crawl_targets
    ORDER BY property_id, hostname
  `).all() as Array<{ propertyId: string; hostname: string }>;
}

export function saveCommonCrawlResults(releaseId: string, results: CommonCrawlPropertyResult[]) {
  const snapshot = db.prepare(`
    INSERT INTO common_crawl_snapshots
      (property_id, release_id, captured_at, target_hosts, indexed_target_hosts, indexed_hosts, referring_hosts, link_edges, authority_score)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(property_id, release_id) DO UPDATE SET
      captured_at = CURRENT_TIMESTAMP,
      target_hosts = excluded.target_hosts,
      indexed_target_hosts = excluded.indexed_target_hosts,
      indexed_hosts = excluded.indexed_hosts,
      referring_hosts = excluded.referring_hosts,
      link_edges = excluded.link_edges,
      authority_score = excluded.authority_score
  `);
  const clearLinks = db.prepare("DELETE FROM common_crawl_links WHERE property_id = ? AND release_id = ?");
  const insertLink = db.prepare(`
    INSERT INTO common_crawl_links (property_id, release_id, source_host, target_host)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(property_id, release_id, source_host, target_host) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP
  `);
  const transaction = db.transaction(() => {
    for (const result of results) {
      const uniqueHosts = new Set(result.links.map((link) => link.sourceHost));
      const authority = Math.min(100, Math.round(100 * Math.log10(1 + uniqueHosts.size) / 6));
      snapshot.run(result.propertyId, releaseId, JSON.stringify(result.targetHosts), JSON.stringify(result.indexedHosts), result.indexedHosts.length, uniqueHosts.size, result.links.length, authority);
      clearLinks.run(result.propertyId, releaseId);
      for (const link of result.links) insertLink.run(result.propertyId, releaseId, link.sourceHost, link.targetHost);
    }
  });
  transaction();
}

const BOT_UA_PATTERN = /bot|crawl|spider|slurp|headless|phantom|lighthouse|pagespeed|pingdom|uptime|monitor|scanner|scrape|curl|wget|python-requests|python-httpx|aiohttp|go-http-client|java\/|okhttp|node-fetch|axios|libwww|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|bingpreview|dataminr|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexity|amazonbot|applebot/i;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_HITS = 60;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function rateLimited(key: string) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (now - v.windowStart >= RATE_WINDOW_MS) rateBuckets.delete(k);
    }
    rateBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX_HITS;
}

export function recordHit(payload: CollectPayload, request: Request) {
  const property = db.query("SELECT id FROM properties WHERE id = ?").get(payload.siteId ?? "") as { id: string } | null;
  if (!property) return { ok: false, status: 404, error: "Unknown siteId" };

  const userAgent = request.headers.get("user-agent") ?? "";
  if (!userAgent || BOT_UA_PATTERN.test(userAgent)) return { ok: true, status: 202, dropped: "bot" };
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  if (purpose.includes("prefetch") || purpose.includes("preview")) return { ok: true, status: 202, dropped: "prefetch" };
  const clientIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const visitorSeed = `${clientIp}|${userAgent}|${payload.language ?? ""}`;
  const visitorHash = new Bun.CryptoHasher("sha256").update(visitorSeed).digest("hex").slice(0, 24);
  if (rateLimited(visitorHash)) return { ok: true, status: 202, dropped: "rate-limited" };

  if (!payload.event) {
    db.prepare(`
      INSERT INTO pageviews (id, property_id, path, title, url, referrer, user_agent, screen, language, timezone, visitor_hash,
        session_id, duration_ms, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id("pv"), property.id, payload.path || "/", payload.title ?? null, payload.url ?? null, payload.referrer ?? null, userAgent, payload.screen ?? null, payload.language ?? null, payload.timezone ?? null, visitorHash,
      payload.sessionId?.slice(0, 80) ?? null, payload.durationMs ?? null, payload.campaign?.source ?? null, payload.campaign?.medium ?? null, payload.campaign?.campaign ?? null, payload.campaign?.content ?? null, payload.campaign?.term ?? null);
  }

  db.prepare("UPDATE properties SET status = 'tracked', verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(property.id);

  if (payload.event) {
    db.prepare(`
      INSERT INTO events (id, property_id, name, path, payload, session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id("ev"), property.id, payload.event.slice(0, 50), payload.path || "/", JSON.stringify(payload.data ?? {}), payload.sessionId?.slice(0, 80) ?? null);

    if (payload.event === "web-vital") {
      const metric = typeof payload.data?.metric === "string" ? payload.data.metric.slice(0, 20) : "unknown";
      const value = typeof payload.data?.value === "number" ? payload.data.value : 0;
      const rating = typeof payload.data?.rating === "string" ? payload.data.rating.slice(0, 20) : null;
      db.prepare("INSERT INTO performance_metrics (id, property_id, session_id, path, metric, value, rating) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id("perf"), property.id, payload.sessionId ?? null, payload.path || "/", metric, value, rating);
    }
    if (payload.event === "client-error" || payload.event === "resource-error") {
      const message = typeof payload.data?.message === "string" ? payload.data.message.slice(0, 500) : "Unknown client error";
      const source = typeof payload.data?.source === "string" ? payload.data.source.slice(0, 500) : null;
      db.prepare("INSERT INTO client_errors (id, property_id, session_id, path, kind, message, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id("err"), property.id, payload.sessionId ?? null, payload.path || "/", payload.event, message, source);
    }
  }

  return { ok: true, status: 202 };
}

export function getDashboard(requestedDays = 30) {
  const days = [7, 14, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const currentWindow = `-${days} days`;
  const previousWindow = `-${days * 2} days`;
  const properties = getProperties();
  const totals = db.query(`
    SELECT
      COUNT(*) AS pageviews,
      COUNT(DISTINCT visitor_hash) AS visitors,
      COUNT(DISTINCT property_id) AS activeProperties
    FROM pageviews
    WHERE created_at >= datetime('now', ?)
  `).get(currentWindow) as { pageviews: number; visitors: number; activeProperties: number };

  const previousTotals = db.query(`
    SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews
    WHERE created_at >= datetime('now', ?) AND created_at < datetime('now', ?)
  `).get(previousWindow, currentWindow) as { pageviews: number; visitors: number };

  const propertyComparisons = db.query(`
    SELECT property_id AS propertyId,
      SUM(CASE WHEN created_at >= datetime('now', '${currentWindow}') THEN 1 ELSE 0 END) AS pageviews,
      COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '${currentWindow}') THEN visitor_hash END) AS visitors,
      SUM(CASE WHEN created_at < datetime('now', '${currentWindow}') THEN 1 ELSE 0 END) AS previousPageviews,
      COUNT(DISTINCT CASE WHEN created_at < datetime('now', '${currentWindow}') THEN visitor_hash END) AS previousVisitors
    FROM pageviews
    WHERE created_at >= datetime('now', '${previousWindow}')
    GROUP BY property_id
  `).all() as Array<{ propertyId: string; pageviews: number; visitors: number; previousPageviews: number; previousVisitors: number }>;

  const gsc = db.query(`
    SELECT
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(impressions), 0) AS impressions,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks) * 1.0 / SUM(impressions), 4) ELSE 0 END AS ctr,
      ROUND(AVG(NULLIF(position, 0)), 1) AS position
    FROM gsc_daily
    WHERE date >= date('now', '-30 days')
  `).get() as { clicks: number; impressions: number; ctr: number; position: number | null };

  const ahrefs = db.query(`
    SELECT
      COALESCE(SUM(referring_domains), 0) AS referringDomains,
      COALESCE(SUM(backlinks), 0) AS backlinks,
      COALESCE(SUM(organic_keywords), 0) AS organicKeywords,
      COALESCE(SUM(organic_traffic), 0) AS organicTraffic
    FROM ahrefs_metrics
    WHERE captured_at >= datetime('now', '-30 days')
  `).get() as { referringDomains: number; backlinks: number; organicKeywords: number; organicTraffic: number };

  const trend = db.query(`
    WITH days(day) AS (
      SELECT date('now', ?)
      UNION ALL
      SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    )
    SELECT days.day AS date,
      COUNT(pageviews.id) AS pageviews,
      COUNT(DISTINCT pageviews.visitor_hash) AS visitors,
      COALESCE(SUM(gsc_daily.clicks), 0) AS searchClicks,
      COALESCE(SUM(gsc_daily.impressions), 0) AS impressions
    FROM days
    LEFT JOIN pageviews ON date(pageviews.created_at) = days.day
    LEFT JOIN gsc_daily ON gsc_daily.date = days.day
    GROUP BY days.day
    ORDER BY days.day
  `).all(`-${days - 1} days`);

  const topPages = db.query(`
    SELECT property_id AS propertyId, path, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews
    WHERE created_at >= datetime('now', '${currentWindow}')
    GROUP BY property_id, path
    ORDER BY views DESC
    LIMIT 8
  `).all();

  const searchPages = db.query(`
    SELECT property_id AS propertyId, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
      ROUND(AVG(position), 1) AS position
    FROM gsc_daily
    GROUP BY property_id, page
    ORDER BY clicks DESC, impressions DESC
    LIMIT 8
  `).all();

  const rankVisibility = db.query(`SELECT current.property_id AS propertyId, current.keyword,
      current.observed_position AS observedPosition, current.observed_url AS observedUrl,
      current.engine, current.checked_at AS checkedAt
    FROM rank_checks current
    WHERE current.id = (SELECT latest.id FROM rank_checks latest
      WHERE latest.property_id=current.property_id AND latest.keyword=current.keyword
      ORDER BY latest.checked_at DESC LIMIT 1)
    ORDER BY CASE WHEN current.observed_position IS NULL THEN 1 ELSE 0 END, current.observed_position, current.keyword
    LIMIT 30`).all();

  const crawlSummary = db.query(`
    WITH latest_pages AS (
      SELECT cp.*
      FROM crawled_pages cp
      JOIN (
        SELECT property_id, path, MAX(captured_at) AS captured_at
        FROM crawled_pages
        GROUP BY property_id, path
      ) latest ON latest.property_id = cp.property_id
        AND latest.path = cp.path
        AND latest.captured_at = cp.captured_at
    )
    SELECT
      COUNT(*) AS crawledPages,
      ROUND(AVG(NULLIF(seo_score, 0)), 0) AS averageSeoScore,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS brokenPages,
      COALESCE(SUM(CASE WHEN title IS NULL OR title = '' THEN 1 ELSE 0 END), 0) AS missingTitles,
      COALESCE(SUM(CASE WHEN description IS NULL OR description = '' THEN 1 ELSE 0 END), 0) AS missingDescriptions,
      COALESCE(SUM(CASE WHEN word_count < 250 THEN 1 ELSE 0 END), 0) AS thinPages,
      COALESCE(SUM(images_missing_alt), 0) AS imagesMissingAlt
    FROM latest_pages
  `).get() as {
    crawledPages: number;
    averageSeoScore: number | null;
    brokenPages: number;
    missingTitles: number;
    missingDescriptions: number;
    thinPages: number;
    imagesMissingAlt: number;
  };

  const latestCrawledPages = db.query(`
    SELECT cp.property_id AS propertyId, cp.url, cp.path, cp.status_code AS statusCode,
      cp.title, cp.description, cp.h1, cp.word_count AS wordCount,
      cp.internal_links AS internalLinks, cp.external_links AS externalLinks,
      cp.images_missing_alt AS imagesMissingAlt, cp.seo_score AS seoScore,
      cp.html_bytes AS htmlBytes, cp.load_ms AS loadMs, cp.captured_at AS capturedAt
    FROM crawled_pages cp
    JOIN (
      SELECT property_id, path, MAX(captured_at) AS captured_at
      FROM crawled_pages
      GROUP BY property_id, path
    ) latest ON latest.property_id = cp.property_id
      AND latest.path = cp.path
      AND latest.captured_at = cp.captured_at
    ORDER BY cp.seo_score ASC, cp.status_code DESC
    LIMIT 10
  `).all();

  const seoFindings = db.query(`
    SELECT property_id AS propertyId, page_url AS pageUrl, severity, code, message, created_at AS createdAt
    FROM seo_findings
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 12
  `).all();

  const keywordCandidates = db.query(`
    SELECT property_id AS propertyId, page_url AS pageUrl, keyword, ROUND(SUM(weight), 1) AS weight, source
    FROM keyword_candidates
    GROUP BY property_id, page_url, keyword
    ORDER BY weight DESC
    LIMIT 12
  `).all();

  const referrerDomains = db.query(`
    SELECT property_id AS propertyId,
      lower(replace(replace(replace(referrer, 'https://', ''), 'http://', ''), 'www.', '')) AS referrer,
      COUNT(*) AS visits
    FROM pageviews
    WHERE referrer IS NOT NULL AND referrer != ''
      AND referrer NOT LIKE '%' || (SELECT replace(replace(url, 'https://', ''), 'http://', '') FROM properties WHERE id = pageviews.property_id) || '%'
    GROUP BY property_id, referrer
    ORDER BY visits DESC
    LIMIT 10
  `).all();

  const propertyRollups = db.query(`
    WITH latest_pages AS (
      SELECT cp.*
      FROM crawled_pages cp
      JOIN (
        SELECT property_id, path, MAX(captured_at) AS captured_at
        FROM crawled_pages
        GROUP BY property_id, path
      ) latest ON latest.property_id = cp.property_id
        AND latest.path = cp.path
        AND latest.captured_at = cp.captured_at
    ),
    traffic AS (
      SELECT property_id,
        SUM(CASE WHEN created_at >= datetime('now', '${currentWindow}') THEN 1 ELSE 0 END) AS pageviews,
        COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '${currentWindow}') THEN visitor_hash END) AS visitors,
        MIN(created_at) AS firstSeenAt, MAX(created_at) AS lastHitAt
      FROM pageviews
      GROUP BY property_id
    ),
    events30 AS (
      SELECT property_id, COUNT(*) AS events
      FROM events
      WHERE created_at >= datetime('now', '${currentWindow}')
      GROUP BY property_id
    ),
    crawl AS (
      SELECT property_id, COUNT(*) AS crawledPages, ROUND(AVG(NULLIF(seo_score, 0)), 0) AS averageSeoScore,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS brokenPages,
        SUM(CASE WHEN title IS NULL OR title = '' THEN 1 ELSE 0 END) AS missingTitles,
        SUM(CASE WHEN description IS NULL OR description = '' THEN 1 ELSE 0 END) AS missingDescriptions,
        SUM(CASE WHEN word_count < 250 THEN 1 ELSE 0 END) AS thinPages,
        MAX(captured_at) AS lastCrawledAt
      FROM latest_pages
      GROUP BY property_id
    ),
    findings AS (
      SELECT property_id,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS criticalFindings,
        SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warningFindings,
        COUNT(*) AS totalFindings
      FROM seo_findings
      GROUP BY property_id
    )
    SELECT p.id AS propertyId, p.name, p.kind, p.status, p.url, p.verified_at AS verifiedAt,
      COALESCE(traffic.pageviews, 0) AS pageviews,
      COALESCE(traffic.visitors, 0) AS visitors,
      COALESCE(events30.events, 0) AS events,
      traffic.firstSeenAt, traffic.lastHitAt,
      COALESCE(crawl.crawledPages, 0) AS crawledPages,
      COALESCE(crawl.averageSeoScore, 0) AS averageSeoScore,
      COALESCE(crawl.brokenPages, 0) AS brokenPages,
      COALESCE(crawl.missingTitles, 0) AS missingTitles,
      COALESCE(crawl.missingDescriptions, 0) AS missingDescriptions,
      COALESCE(crawl.thinPages, 0) AS thinPages,
      crawl.lastCrawledAt,
      COALESCE(findings.criticalFindings, 0) AS criticalFindings,
      COALESCE(findings.warningFindings, 0) AS warningFindings,
      COALESCE(findings.totalFindings, 0) AS totalFindings
    FROM properties p
    LEFT JOIN traffic ON traffic.property_id = p.id
    LEFT JOIN events30 ON events30.property_id = p.id
    LEFT JOIN crawl ON crawl.property_id = p.id
    LEFT JOIN findings ON findings.property_id = p.id
    ORDER BY pageviews DESC, totalFindings DESC, p.name COLLATE NOCASE
  `).all();

  const eventSummary = db.query(`
    SELECT property_id AS propertyId, name, path, COUNT(*) AS count, MAX(created_at) AS lastSeenAt
    FROM events
    WHERE created_at >= datetime('now', '${currentWindow}')
    GROUP BY property_id, name, path
    ORDER BY count DESC, lastSeenAt DESC
    LIMIT 12
  `).all();

  const recentActivity = db.query(`
    SELECT property_id AS propertyId, path, title, referrer, screen, language, timezone, created_at AS createdAt
    FROM pageviews
    ORDER BY created_at DESC
    LIMIT 12
  `).all();

  const referrerSummary = db.query(`
    SELECT property_id AS propertyId,
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN 'Direct / none'
        ELSE lower(replace(replace(replace(referrer, 'https://', ''), 'http://', ''), 'www.', ''))
      END AS source,
      COUNT(*) AS visits,
      COUNT(DISTINCT path) AS pages
    FROM pageviews
    WHERE created_at >= datetime('now', '${currentWindow}')
    GROUP BY property_id, source
    ORDER BY visits DESC
    LIMIT 12
  `).all();

  const deviceSummary = db.query(`
    SELECT property_id AS propertyId,
      CASE
        WHEN lower(user_agent) LIKE '%mobile%' THEN 'Mobile'
        WHEN lower(user_agent) LIKE '%tablet%' OR lower(user_agent) LIKE '%ipad%' THEN 'Tablet'
        WHEN user_agent IS NULL OR user_agent = '' THEN 'Unknown'
        ELSE 'Desktop'
      END AS device,
      COUNT(*) AS visits,
      COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews
    WHERE created_at >= datetime('now', '${currentWindow}')
    GROUP BY property_id, device
    ORDER BY visits DESC
  `).all();

  const opportunityPages = db.query(`
    WITH latest_pages AS (
      SELECT cp.*
      FROM crawled_pages cp
      JOIN (
        SELECT property_id, path, MAX(captured_at) AS captured_at
        FROM crawled_pages
        GROUP BY property_id, path
      ) latest ON latest.property_id = cp.property_id
        AND latest.path = cp.path
        AND latest.captured_at = cp.captured_at
    ),
    traffic AS (
      SELECT property_id, path, COUNT(*) AS views
      FROM pageviews
      WHERE created_at >= datetime('now', '${currentWindow}')
      GROUP BY property_id, path
    )
    SELECT latest_pages.property_id AS propertyId, latest_pages.path, latest_pages.url,
      latest_pages.title, latest_pages.seo_score AS seoScore,
      latest_pages.word_count AS wordCount, latest_pages.internal_links AS internalLinks,
      latest_pages.external_links AS externalLinks, latest_pages.load_ms AS loadMs,
      COALESCE(traffic.views, 0) AS views,
      (
        CASE WHEN latest_pages.seo_score < 85 THEN 20 ELSE 0 END +
        CASE WHEN latest_pages.word_count < 250 THEN 15 ELSE 0 END +
        CASE WHEN latest_pages.description IS NULL OR latest_pages.description = '' THEN 15 ELSE 0 END +
        CASE WHEN latest_pages.internal_links = 0 THEN 10 ELSE 0 END +
        CASE WHEN COALESCE(traffic.views, 0) > 0 THEN 10 ELSE 0 END
      ) AS opportunityScore
    FROM latest_pages
    LEFT JOIN traffic ON traffic.property_id = latest_pages.property_id AND traffic.path = latest_pages.path
    ORDER BY opportunityScore DESC, views DESC, seoScore ASC
    LIMIT 10
  `).all();

  const actionItems = db.query(`
    SELECT property_id AS propertyId,
      CASE severity WHEN 'critical' THEN 'Fix critical SEO issue' WHEN 'warning' THEN 'Review SEO warning' ELSE 'Inspect SEO note' END AS action,
      code, message, page_url AS pageUrl, severity, created_at AS createdAt
    FROM seo_findings
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 8
  `).all();

  const freshness = db.query(`
    SELECT
      (SELECT MAX(created_at) FROM pageviews) AS traffic,
      (SELECT MAX(captured_at) FROM crawled_pages) AS crawler,
      (SELECT MAX(checked_at) FROM rank_checks) AS ranks,
      MAX(
        COALESCE((SELECT MAX(last_seen_at) FROM discovered_backlinks), ''),
        COALESCE((SELECT MAX(captured_at) FROM common_crawl_snapshots), '')
      ) AS backlinks,
      (SELECT MAX(captured_at) FROM common_crawl_snapshots) AS authority
  `).get() as { traffic: string | null; crawler: string | null; ranks: string | null; backlinks: string | null; authority: string | null };

  const observedBacklinks = db.query(`
    SELECT COUNT(*) AS backlinks, COUNT(DISTINCT lower(replace(replace(replace(source_url, 'https://', ''), 'http://', ''), 'www.', ''))) AS referringDomains
    FROM discovered_backlinks
    WHERE status != 'lost'
  `).get() as { backlinks: number; referringDomains: number };

  const observedRanks = db.query(`
    SELECT COUNT(DISTINCT keyword) AS keywords
    FROM rank_checks
    WHERE observed_position IS NOT NULL
  `).get() as { keywords: number };

  const domainRatings = db.query(`
    SELECT property_id AS propertyId, domain_rating AS domainRating, MAX(captured_at) AS capturedAt
    FROM ahrefs_metrics
    WHERE domain_rating IS NOT NULL
    GROUP BY property_id
  `).all() as Array<{ propertyId: string; domainRating: number; capturedAt: string }>;

  const authorityScores = db.query(`
    SELECT snapshot.property_id AS propertyId, snapshot.release_id AS releaseId,
      snapshot.authority_score AS authorityScore, snapshot.referring_hosts AS referringHosts,
      snapshot.link_edges AS linkEdges, snapshot.target_hosts AS targetHosts,
      snapshot.indexed_target_hosts AS indexedTargetHosts, snapshot.indexed_hosts AS indexedHosts,
      snapshot.captured_at AS capturedAt
    FROM common_crawl_snapshots snapshot
    JOIN (
      SELECT property_id, MAX(captured_at) AS captured_at
      FROM common_crawl_snapshots
      GROUP BY property_id
    ) latest ON latest.property_id = snapshot.property_id AND latest.captured_at = snapshot.captured_at
    ORDER BY snapshot.authority_score DESC, snapshot.referring_hosts DESC
  `).all() as Array<{ propertyId: string; releaseId: string; authorityScore: number; referringHosts: number; linkEdges: number; targetHosts: string; indexedTargetHosts: string; indexedHosts: number; capturedAt: string }>;

  const commonCrawlLinks = db.query(`
    SELECT link.property_id AS propertyId, link.source_host AS sourceHost,
      GROUP_CONCAT(DISTINCT link.target_host) AS targetHosts,
      COUNT(*) AS linkEdges
    FROM common_crawl_links link
    JOIN (
      SELECT property_id, release_id
      FROM common_crawl_snapshots current
      WHERE captured_at = (SELECT MAX(captured_at) FROM common_crawl_snapshots WHERE property_id = current.property_id)
    ) latest ON latest.property_id = link.property_id AND latest.release_id = link.release_id
    GROUP BY link.property_id, link.source_host
    ORDER BY linkEdges DESC, link.source_host
    LIMIT 100
  `).all() as Array<{ propertyId: string; sourceHost: string; targetHosts: string; linkEdges: number }>;

  const pageviewsComparison = assessComparison(totals.pageviews, previousTotals.pageviews);
  const visitorsComparison = assessComparison(totals.visitors, previousTotals.visitors, 10);
  const sourceQuality = {
    traffic: assessFreshness("traffic", freshness.traffic),
    crawler: assessFreshness("crawler", freshness.crawler),
    ranks: assessFreshness("ranks", freshness.ranks),
    backlinks: assessFreshness("backlinks", freshness.backlinks),
    authority: assessFreshness("authority", freshness.authority),
  };
  const propertyQuality = propertyRollups.map((item: any) => ({
    propertyId: item.propertyId,
    tracker: assessTracker(item.status, item.verifiedAt, item.lastHitAt),
    crawler: assessFreshness("crawler", item.lastCrawledAt),
  }));

  return {
    range: { days, label: `Last ${days} days` },
    comparison: {
      pageviews: pageviewsComparison.change,
      visitors: visitorsComparison.change,
      previousPageviews: previousTotals.pageviews,
      previousVisitors: previousTotals.visitors,
      pageviewsQuality: pageviewsComparison,
      visitorsQuality: visitorsComparison,
    },
    propertyComparisons: propertyComparisons.map((item) => ({
      ...item,
      pageviewsChange: assessComparison(item.pageviews, item.previousPageviews).change,
      visitorsChange: assessComparison(item.visitors, item.previousVisitors, 10).change,
      pageviewsQuality: assessComparison(item.pageviews, item.previousPageviews),
      visitorsQuality: assessComparison(item.visitors, item.previousVisitors, 10),
    })),
    dataQuality: {
      sources: sourceQuality,
      properties: propertyQuality,
      counts: {
        unverified: propertyQuality.filter((item) => item.tracker.state === "unverified").length,
        missingTraffic: propertyQuality.filter((item) => item.tracker.state === "missing").length,
        staleTraffic: propertyQuality.filter((item) => item.tracker.state === "stale").length,
        staleSources: Object.values(sourceQuality).filter((item) => item.state === "stale").length,
      },
    },
    freshness,
    sources: {
      traffic: { kind: "first-party", label: "First-party tracker" },
      crawler: { kind: "observed", label: "Local crawler" },
      rankings: { kind: "observed", label: "Observed public results" },
      backlinks: { kind: "independent", label: "First-party + Common Crawl" },
      authority: { kind: "independent", label: "Zo Authority · Common Crawl" },
    },
    domainRatings,
    authorityScores: authorityScores.map((row) => ({ ...row, targetHosts: JSON.parse(row.targetHosts) as string[], indexedTargetHosts: JSON.parse(row.indexedTargetHosts) as string[] })),
    commonCrawlLinks,
    properties,
    totals: {
      properties: properties.length,
      tracked: properties.filter((p) => p.status === "tracked").length,
      missingTracker: properties.filter((p) => p.status === "missing-tracker").length,
      pageviews: totals.pageviews,
      visitors: totals.visitors,
      activeProperties: totals.activeProperties,
      searchClicks: gsc.clicks,
      impressions: gsc.impressions,
      ctr: gsc.ctr,
      position: gsc.position ?? 0,
      referringDomains: observedBacklinks.referringDomains,
      backlinks: observedBacklinks.backlinks,
      organicKeywords: observedRanks.keywords,
      organicTraffic: 0,
      crawledPages: crawlSummary.crawledPages,
      averageSeoScore: crawlSummary.averageSeoScore ?? 0,
      brokenPages: crawlSummary.brokenPages,
      missingTitles: crawlSummary.missingTitles,
      missingDescriptions: crawlSummary.missingDescriptions,
      thinPages: crawlSummary.thinPages,
      imagesMissingAlt: crawlSummary.imagesMissingAlt,
    },
    trend,
    topPages,
    searchPages,
    rankVisibility,
    latestCrawledPages,
    seoFindings,
    keywordCandidates,
    referrerDomains,
    propertyRollups,
    eventSummary,
    recentActivity,
    referrerSummary,
    deviceSummary,
    opportunityPages,
    actionItems,
  };
}

export function startCrawlRun(propertyId: string) {
  const runId = id("crawl");
  db.prepare("INSERT INTO crawl_runs (id, property_id, status) VALUES (?, ?, 'running')").run(runId, propertyId);
  return runId;
}

export function finishCrawlRun(runId: string, status: "completed" | "failed", pagesSeen: number, pagesCrawled: number, error?: string) {
  db.prepare(`
    UPDATE crawl_runs
    SET finished_at = CURRENT_TIMESTAMP, status = ?, pages_seen = ?, pages_crawled = ?, error = ?
    WHERE id = ?
  `).run(status, pagesSeen, pagesCrawled, error ?? null, runId);
}

export function saveCrawledPage(runId: string, page: CrawlPageInput) {
  const previous = db.query(`SELECT title, description, h1, canonical, status_code AS statusCode, seo_score AS seoScore
    FROM crawled_pages WHERE property_id = ? AND path = ? ORDER BY captured_at DESC LIMIT 1`).get(page.propertyId, page.path) as Record<string, unknown> | null;
  db.prepare(`
    INSERT INTO crawled_pages (
      id, run_id, property_id, url, path, status_code, title, description, h1, canonical, robots,
      word_count, internal_links, external_links, images, images_missing_alt, schema_types,
      og_title, twitter_title, html_bytes, load_ms, seo_score
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id("page"),
    runId,
    page.propertyId,
    page.url,
    page.path,
    page.statusCode,
    page.title,
    page.description,
    page.h1,
    page.canonical,
    page.robots,
    page.wordCount,
    page.internalLinks,
    page.externalLinks,
    page.images,
    page.imagesMissingAlt,
    JSON.stringify(page.schemaTypes),
    page.ogTitle,
    page.twitterTitle,
    page.htmlBytes,
    page.loadMs,
    page.seoScore,
  );

  const insertFinding = db.prepare(`
    INSERT INTO seo_findings (id, run_id, property_id, page_url, severity, code, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const issue of page.issues) {
    insertFinding.run(id("seo"), runId, page.propertyId, page.url, issue.severity, issue.code, issue.message);
  }

  const insertKeyword = db.prepare(`
    INSERT INTO keyword_candidates (id, run_id, property_id, page_url, keyword, weight, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const keyword of page.keywords) {
    insertKeyword.run(id("kw"), runId, page.propertyId, page.url, keyword.keyword, keyword.weight, keyword.source);
  }

  const insertEdge = db.prepare("INSERT INTO link_edges (id, run_id, property_id, source_url, target_url, external) VALUES (?, ?, ?, ?, ?, ?)");
  for (const target of page.internalUrls) insertEdge.run(id("edge"), runId, page.propertyId, page.url, target, 0);
  for (const target of page.externalUrls) insertEdge.run(id("edge"), runId, page.propertyId, page.url, target, 1);

  if (previous) {
    const current: Record<string, unknown> = { title: page.title, description: page.description, h1: page.h1, canonical: page.canonical, statusCode: page.statusCode, seoScore: page.seoScore };
    const insertChange = db.prepare("INSERT INTO page_changes (id, property_id, page_url, field, previous_value, current_value) VALUES (?, ?, ?, ?, ?, ?)");
    for (const [field, value] of Object.entries(current)) {
      if (String(previous[field] ?? "") !== String(value ?? "")) insertChange.run(id("change"), page.propertyId, page.url, field, String(previous[field] ?? ""), String(value ?? ""));
    }
  }
}
