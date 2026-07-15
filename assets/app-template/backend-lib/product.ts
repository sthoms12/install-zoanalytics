import { db, getProperties, getProperty, APP_VERSION } from "./db";
import { FIXABLE_CODES } from "./fixes";
import { listSurfaceInventory } from "./surfaces";
import { scheduleCampaignOutcome } from "./campaign-outcomes";

type FunnelStep = { type: "page" | "event"; value: string };

export type AtomicAction = {
  key: string; propertyId: string; pageUrl: string; category: string; severity: string; title: string;
  why: string; evidence: string; fix: string; impact: number; confidence: number; effort: number;
  fixCode: string | null; priority: number; state: string; snoozedUntil: string | null; note: string | null;
  freshness: string; verificationMethod: string; expectedImpact: string;
};

function stableKey(parts: Array<string | number | null | undefined>) {
  return parts.filter(Boolean).join(":").toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 240);
}

function percentile(values: number[], target = .75) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * target) - 1)];
}

export function getSetupStatus() {
  const properties = getProperties().filter((item) => item.url.startsWith("http"));
  const counts = db.query(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN verified_at IS NOT NULL OR status='tracked' THEN 1 ELSE 0 END), 0) AS verified,
      COALESCE(SUM(CASE WHEN lifecycle='active' THEN 1 ELSE 0 END), 0) AS active
    FROM properties WHERE lifecycle='active' AND url LIKE 'http%'`).get() as { total: number; verified: number; active: number };
  const crawled = db.query("SELECT COUNT(DISTINCT crawl_runs.property_id) AS count FROM crawl_runs JOIN properties ON properties.id=crawl_runs.property_id WHERE crawl_runs.status='completed' AND properties.lifecycle='active'").get() as { count: number };
  const goals = db.query("SELECT COUNT(*) AS count FROM goals WHERE active=1").get() as { count: number };
  const latestDiscovery = db.query("SELECT MAX(last_discovered_at) AS at FROM properties").get() as { at: string | null };
  const inventory = listSurfaceInventory();
  const steps = [
    { id: "discover", label: "Discover public surfaces", complete: counts.total > 0, detail: `${counts.total} public ${counts.total === 1 ? "surface" : "surfaces"}` },
    { id: "verify", label: "Verify tracker coverage", complete: counts.total > 0 && counts.verified === counts.total, detail: `${counts.verified} of ${counts.total} verified` },
    { id: "audit", label: "Run a baseline audit", complete: counts.total > 0 && crawled.count >= counts.total, detail: `${crawled.count} of ${counts.total} audited` },
    { id: "goals", label: "Choose meaningful outcomes", complete: goals.count > 0, detail: `${goals.count} active ${goals.count === 1 ? "goal" : "goals"}` },
  ];
  return {
    appVersion: APP_VERSION,
    complete: steps.every((step) => step.complete),
    completedSteps: steps.filter((step) => step.complete).length,
    steps,
    properties,
    inventory,
    nextActions: properties.map((property) => ({
      propertyId: property.id,
      name: property.name,
      status: property.status,
      projectPath: property.projectPath,
      action: property.status === "tracked" ? "Tracker verified; no action required." : property.projectPath ? "Preview and apply the tracker to the linked Zo Site." : "Copy the tracker snippet into this public surface, then verify it.",
    })),
    latestDiscovery: latestDiscovery.at,
  };
}

export async function verifyTracker(propertyId: string, collectorOrigin: string) {
  const property = getProperty(propertyId);
  if (!property?.url.startsWith("http")) return { ok: false, reason: "Property does not have a public URL" };
  try {
    const response = await fetch(property.url, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "ZoAnalytics tracker verifier" } });
    const html = await response.text();
    const sitePattern = new RegExp(`data-site(?:-id)?=["']${propertyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
    const originHost = collectorOrigin ? new URL(collectorOrigin).hostname : "";
    const installed = response.ok && /zowa\.js/i.test(html) && sitePattern.test(html) && (!originHost || html.includes(originHost));
    if (installed) db.prepare("UPDATE properties SET status='tracked', verified_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(propertyId);
    else db.prepare("UPDATE properties SET status=CASE WHEN status='tracked' THEN status ELSE 'missing-tracker' END, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(propertyId);
    return { ok: installed, status: response.status, finalUrl: response.url, reason: installed ? null : "Tracker snippet was not found in the public HTML" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Verification failed" };
  }
}

function actionState(actionKey: string) {
  return db.query("SELECT status, snoozed_until AS snoozedUntil, note FROM action_states WHERE action_key=?").get(actionKey) as { status: string; snoozedUntil: string | null; note: string | null } | null;
}

export function getActionCenter(): AtomicAction[] {
  const actions: Array<Record<string, unknown>> = [];
  const activePropertyIds = new Set((db.query("SELECT id FROM properties WHERE lifecycle='active'").all() as Array<{ id: string }>).map((item) => item.id));
  for (const property of getProperties().filter((item) => activePropertyIds.has(item.id) && item.url.startsWith("http"))) {
    if (property.status !== "tracked") actions.push({
      key: stableKey(["tracker", property.id]), propertyId: property.id, pageUrl: property.url, category: "tracking", severity: "critical",
      title: `Verify analytics on ${property.name}`, why: "Unverified tracking creates blind spots in every traffic and conversion report.",
      evidence: `Current tracker state: ${property.status.replaceAll("-", " ")}.`, fix: "Install the generated snippet, then run tracker verification.", impact: 5, confidence: 5, effort: 1,
      freshness: property.verifiedAt ? `Last verified ${property.verifiedAt}` : "Never verified", verificationMethod: "Fetch the public HTML and confirm the tracker origin and property ID without recording a visit.", expectedImpact: "Restores trustworthy traffic and conversion coverage.",
    });
  }
  const crawlHealth = db.query(`SELECT p.id AS propertyId, p.name, p.url, MAX(c.started_at) AS lastCrawlAt,
      MAX(CASE WHEN c.status='completed' THEN c.started_at END) AS lastCompletedAt,
      (SELECT status FROM crawl_runs latest WHERE latest.property_id=p.id ORDER BY latest.started_at DESC LIMIT 1) AS latestStatus
    FROM properties p LEFT JOIN crawl_runs c ON c.property_id=p.id
    WHERE p.lifecycle='active' AND p.url LIKE 'http%' GROUP BY p.id`).all() as Array<Record<string, string | null>>;
  for (const item of crawlHealth) {
    const ageDays = item.lastCompletedAt ? (Date.now() - new Date(`${item.lastCompletedAt}Z`).getTime()) / 86400000 : Infinity;
    if (item.latestStatus !== "completed" || ageDays > 8) actions.push({
      key: stableKey(["crawl", item.propertyId]), propertyId: item.propertyId, pageUrl: item.url, category: "data health", severity: item.latestStatus === "failed" ? "critical" : "warning",
      title: item.latestStatus === "failed" ? `Repair failed audit for ${item.name}` : `Refresh stale audit for ${item.name}`,
      why: "Stale audit evidence can hide broken pages, metadata regressions, and internal-link problems.", evidence: item.lastCompletedAt ? `Last completed crawl: ${item.lastCompletedAt}; latest status: ${item.latestStatus ?? "unknown"}.` : "No completed crawl is recorded.",
      fix: "Run a fresh property crawl and investigate any request or parsing failure.", impact: 4, confidence: 5, effort: 1, freshness: item.lastCrawlAt ? `Last attempt ${item.lastCrawlAt}` : "No crawl observed", verificationMethod: "Run the crawler and require a completed crawl receipt with current page evidence.", expectedImpact: "Restores current technical and content diagnostics.",
    });
  }
  const findings = db.query(`SELECT f.property_id AS propertyId, f.page_url AS pageUrl, f.severity, f.code, f.message, MAX(f.created_at) AS createdAt
    FROM seo_findings f JOIN properties p ON p.id=f.property_id WHERE p.lifecycle='active'
    GROUP BY f.property_id, f.page_url, f.code ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, createdAt DESC LIMIT 80`).all() as Array<Record<string, string>>;
  const fixes: Record<string, string> = {
    missing_title: "Add a concise, unique title that describes the page.", missing_description: "Add a specific meta description that explains the page value.",
    missing_h1: "Add one descriptive H1 to the main page content.", missing_canonical: "Add a self-referencing canonical URL.", noindex: "Remove noindex if this page should appear in search.",
    bad_status: "Restore the page or redirect it to the most relevant active URL.", thin_content: "Expand or consolidate the page so it answers the visitor's intent.",
    missing_alt: "Add useful alternative text to meaningful images.", slow_response: "Inspect server work and large dependencies before the response completes.",
  };
  for (const item of findings) actions.push({
    key: stableKey(["seo", item.propertyId, item.code, item.pageUrl]), propertyId: item.propertyId, pageUrl: item.pageUrl, category: "site audit", severity: item.severity,
    title: item.message, why: item.severity === "critical" ? "This can prevent discovery or a reliable visit." : "Resolving this improves clarity, accessibility, or search presentation.",
    evidence: `${item.code.replaceAll("_", " ")} detected during the latest crawl.`, fix: fixes[item.code] ?? "Review the affected page and rerun the audit after correcting it.",
    impact: item.severity === "critical" ? 5 : item.severity === "warning" ? 3 : 2, confidence: 5, effort: ["missing_title", "missing_description", "missing_h1", "missing_canonical", "missing_alt"].includes(item.code) ? 1 : 3,
    fixCode: (FIXABLE_CODES as readonly string[]).includes(item.code) ? item.code : null,
    freshness: `Observed ${item.createdAt}`, verificationMethod: "Rerun the property audit and confirm the finding no longer appears.", expectedImpact: item.severity === "critical" ? "Restores reliable discovery or page access." : "Improves accessibility, search presentation, or page clarity.",
  });
  const errors = db.query(`SELECT property_id AS propertyId, path, message, COUNT(*) AS occurrences FROM client_errors
    WHERE created_at >= datetime('now','-7 days') GROUP BY property_id, path, message HAVING COUNT(*) >= 3 ORDER BY occurrences DESC LIMIT 20`).all() as Array<Record<string, string | number>>;
  for (const item of errors) actions.push({
    key: stableKey(["error", String(item.propertyId), String(item.path), String(item.message)]), propertyId: item.propertyId, pageUrl: item.path, category: "reliability", severity: "warning",
    title: "Repeated browser error", why: "Repeated client errors can block an action even when the page still loads.", evidence: `${item.occurrences} occurrences in the last 7 days: ${item.message}`,
    fix: "Reproduce the affected path, inspect the browser error, deploy the correction, then verify this action.", impact: 4, confidence: 4, effort: 3,
    freshness: "Observed within the last 7 days", verificationMethod: "Revisit the path and confirm no matching client error is recorded after deployment.", expectedImpact: "Reduces failed or interrupted visitor actions.",
  });
  const vitals = db.query(`SELECT property_id AS propertyId, path, metric, COUNT(*) AS samples,
      SUM(CASE WHEN rating='poor' THEN 1 ELSE 0 END) AS poorSamples, MAX(created_at) AS observedAt
    FROM performance_metrics WHERE created_at>=datetime('now','-30 days') AND metric IN ('LCP','INP','CLS')
    GROUP BY property_id,path,metric HAVING samples>=5 AND poorSamples*1.0/samples>=0.25`).all() as Array<Record<string, string | number>>;
  for (const item of vitals) actions.push({
    key: stableKey(["performance", item.propertyId, item.path, item.metric]), propertyId: item.propertyId, pageUrl: item.path, category: "performance", severity: "warning",
    title: `Improve poor ${item.metric} on ${item.path}`, why: "A sustained poor Core Web Vital can make the page slower or less stable for real visitors.", evidence: `${item.poorSamples} of ${item.samples} observations were rated poor in the last 30 days.`,
    fix: "Inspect the affected page and its field metric, deploy a targeted performance change, then collect at least five new observations.", impact: 4, confidence: 4, effort: 3, freshness: `Observed through ${item.observedAt}`, verificationMethod: "Require at least five post-change field observations and a non-poor p75 rating.", expectedImpact: "Improves the real visitor loading, responsiveness, or visual-stability experience.",
  });
  const engagement = db.query(`WITH daily AS (
      SELECT property_id, path, date(created_at) AS day, COUNT(*) AS views,
        AVG(CASE WHEN COALESCE(duration_ms,0)>=10000 THEN 1.0 ELSE 0.0 END) AS rate
      FROM pageviews WHERE created_at>=datetime('now','-28 days') GROUP BY property_id,path,day), windows AS (
      SELECT property_id AS propertyId,path,
        SUM(CASE WHEN day>=date('now','-14 days') THEN views ELSE 0 END) AS recentViews,
        SUM(CASE WHEN day<date('now','-14 days') THEN views ELSE 0 END) AS priorViews,
        AVG(CASE WHEN day>=date('now','-14 days') THEN rate END) AS recentRate,
        AVG(CASE WHEN day<date('now','-14 days') THEN rate END) AS priorRate FROM daily GROUP BY property_id,path)
      SELECT * FROM windows WHERE recentViews>=20 AND priorViews>=20 AND priorRate-recentRate>=0.15`).all() as Array<Record<string, string | number>>;
  for (const item of engagement) actions.push({
    key: stableKey(["engagement", item.propertyId, item.path]), propertyId: item.propertyId, pageUrl: item.path, category: "engagement", severity: "warning",
    title: `Investigate declining engagement on ${item.path}`, why: "A meaningful decline on an important page can signal a content, intent, or experience regression.", evidence: `Engagement fell from ${Math.round(Number(item.priorRate) * 100)}% to ${Math.round(Number(item.recentRate) * 100)}% across ${item.priorViews} prior and ${item.recentViews} recent views.`,
    fix: "Review recent page changes, acquisition mix, content clarity, and performance before choosing a targeted correction.", impact: 4, confidence: 3, effort: 3, freshness: "Compared the latest 14 days with the preceding 14 days", verificationMethod: "Collect at least 20 post-change views and compare engagement with the recorded baseline.", expectedImpact: "Recovers meaningful interaction on a page with demonstrated traffic.",
  });
  return actions.map((item) => {
    const key = String(item.key); const state = actionState(key);
    const priority = Number(item.impact) * Number(item.confidence) * 4 - Number(item.effort) * 3;
    return { ...item, freshness: String(item.freshness ?? "Current observation"), verificationMethod: String(item.verificationMethod ?? "Rerun the originating check."), expectedImpact: String(item.expectedImpact ?? item.why), fixCode: item.fixCode ? String(item.fixCode) : null, priority, state: state?.status ?? "open", snoozedUntil: state?.snoozedUntil ?? null, note: state?.note ?? null } as AtomicAction;
  }).filter((item) => item.state === "open" && (!item.snoozedUntil || new Date(item.snoozedUntil) <= new Date())).sort((a, b) => b.priority - a.priority);
}

export type ActionCampaign = {
  key: string;
  propertyId: string;
  category: string;
  severity: string;
  title: string;
  rationale: string;
  recommendedFix: string;
  affectedPages: number;
  representativeEvidence: string;
  priority: number;
  effort: number;
  fixability: "fixable" | "partially-fixable" | "manual";
  fixCode: string | null;
  childKeys: string[];
  actions: AtomicAction[];
  freshness: string;
  verificationMethod: string;
  expectedImpact: string;
  confidence: number;
};

const severityRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };

function campaignTitle(action: AtomicAction, count: number) {
  const subject = count === 1 ? "page" : `${count} pages`;
  if (action.category === "tracking") return `Verify analytics on ${count === 1 ? "this property" : `${count} properties`}`;
  const code = action.fixCode ?? String(action.key).split(":")[2] ?? "finding";
  const titles: Record<string, string> = {
    missing_title: `Add missing titles to ${subject}`,
    missing_description: `Add meta descriptions to ${subject}`,
    missing_h1: `Add a clear heading to ${subject}`,
    missing_canonical: `Add canonical URLs to ${subject}`,
    noindex: `Review noindex on ${subject}`,
    bad_status: `Repair broken responses on ${subject}`,
    thin_content: `Improve thin content on ${subject}`,
    missing_alt: `Add image descriptions on ${subject}`,
    slow_response: `Improve response time on ${subject}`,
  };
  return titles[code] ?? (action.category === "reliability" ? `Investigate repeated browser errors on ${subject}` : `${action.title} · ${subject}`);
}

export function getActionCampaigns(): ActionCampaign[] {
  const groups = new Map<string, AtomicAction[]>();
  for (const action of getActionCenter()) {
    const actionCode = action.fixCode ?? String(action.key).split(":")[2] ?? String(action.title);
    const groupKey = stableKey(["campaign", action.propertyId, action.category, actionCode, action.fix, action.fixCode ? "safe-fix" : "manual"]);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), action]);
  }
  return [...groups.entries()].map(([key, actions]) => {
    const representative = actions[0];
    const fixableCount = actions.filter((action) => Boolean(action.fixCode)).length;
    const fixability: ActionCampaign["fixability"] = fixableCount === actions.length ? "fixable" : fixableCount ? "partially-fixable" : "manual";
    return {
      key,
      propertyId: String(representative.propertyId),
      category: String(representative.category),
      severity: actions.reduce((highest, action) => severityRank[String(action.severity)] > severityRank[highest] ? String(action.severity) : highest, "info"),
      title: campaignTitle(representative, actions.length),
      rationale: String(representative.why),
      recommendedFix: String(representative.fix),
      affectedPages: new Set(actions.map((action) => String(action.pageUrl))).size,
      representativeEvidence: String(representative.evidence),
      priority: Math.max(...actions.map((action) => Number(action.priority))),
      effort: Math.max(...actions.map((action) => Number(action.effort))),
      fixability,
      fixCode: fixability === "fixable" ? String(representative.fixCode) : null,
      childKeys: actions.map((action) => String(action.key)),
      actions,
      freshness: representative.freshness,
      verificationMethod: representative.verificationMethod,
      expectedImpact: representative.expectedImpact,
      confidence: Math.min(...actions.map((action) => action.confidence)),
    };
  }).sort((a, b) => b.priority - a.priority || b.affectedPages - a.affectedPages);
}

export function setActionState(actionKey: string, status: "open" | "dismissed" | "resolved", snoozedUntil?: string, note?: string) {
  const effectiveStatus = snoozedUntil ? "open" : status;
  db.prepare(`INSERT INTO action_states (action_key, status, snoozed_until, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(action_key) DO UPDATE SET status=excluded.status, snoozed_until=excluded.snoozed_until, note=excluded.note, updated_at=CURRENT_TIMESTAMP`)
    .run(actionKey, effectiveStatus, snoozedUntil ?? null, note?.slice(0, 500) ?? null);
  return { ok: true };
}

export function setActionCampaignState(campaignKey: string, status: "open" | "dismissed" | "resolved", snoozedUntil?: string, note?: string) {
  const campaign = getActionCampaigns().find((item) => item.key === campaignKey);
  if (!campaign) throw new Error("Action campaign not found");
  const effectiveStatus = snoozedUntil ? "open" : status;
  const statement = db.prepare(`INSERT INTO action_states (action_key, status, snoozed_until, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(action_key) DO UPDATE SET status=excluded.status, snoozed_until=excluded.snoozed_until, note=excluded.note, updated_at=CURRENT_TIMESTAMP`);
  const transaction = db.transaction(() => {
    for (const actionKey of campaign.childKeys) statement.run(actionKey, effectiveStatus, snoozedUntil ?? null, note?.slice(0, 500) ?? null);
  });
  transaction();
  const outcomeId = status === "resolved" && !snoozedUntil ? scheduleCampaignOutcome(campaign) : null;
  return { ok: true, updated: campaign.childKeys.length, outcomeId };
}

export function getPageDetail(propertyId: string, path: string) {
  const property = getProperty(propertyId);
  if (!property) return null;
  const page = db.query(`SELECT property_id AS propertyId, url, path, status_code AS statusCode, title, description, h1, canonical, robots,
      word_count AS wordCount, internal_links AS internalLinks, external_links AS externalLinks, images_missing_alt AS imagesMissingAlt,
      schema_types AS schemaTypes, html_bytes AS htmlBytes, load_ms AS loadMs, seo_score AS seoScore, captured_at AS capturedAt
    FROM crawled_pages WHERE property_id=? AND path=? ORDER BY captured_at DESC LIMIT 1`).get(propertyId, path);
  const traffic = db.query(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors, COUNT(DISTINCT session_id) AS sessions,
      MIN(created_at) AS firstSeenAt, MAX(created_at) AS lastSeenAt FROM pageviews WHERE property_id=? AND path=? AND created_at>=datetime('now','-30 days')`).get(propertyId, path);
  const referrals = db.query(`SELECT referrer, COUNT(*) AS visits FROM pageviews WHERE property_id=? AND path=? AND referrer IS NOT NULL AND referrer!=''
    GROUP BY referrer ORDER BY visits DESC LIMIT 10`).all(propertyId, path);
  const events = db.query(`SELECT name, COUNT(*) AS count FROM events WHERE property_id=? AND path=? AND created_at>=datetime('now','-30 days') GROUP BY name ORDER BY count DESC`).all(propertyId, path);
  const metricRows = db.query(`SELECT metric, value, rating FROM performance_metrics WHERE property_id=? AND path=? AND created_at>=datetime('now','-30 days')`).all(propertyId, path) as Array<{ metric: string; value: number; rating: string }>;
  const vitals = [...new Set(metricRows.map((row) => row.metric))].map((metric) => {
    const rows = metricRows.filter((row) => row.metric === metric); return { metric, p75: percentile(rows.map((row) => row.value)), samples: rows.length, poorSamples: rows.filter((row) => row.rating === "poor").length };
  });
  const findings = db.query("SELECT severity, code, message, created_at AS createdAt FROM seo_findings WHERE property_id=? AND page_url LIKE ? ORDER BY created_at DESC LIMIT 30").all(propertyId, `%${path}`);
  const changes = db.query("SELECT field, previous_value AS previousValue, current_value AS currentValue, detected_at AS detectedAt FROM page_changes WHERE property_id=? AND page_url LIKE ? ORDER BY detected_at DESC LIMIT 20").all(propertyId, `%${path}`);
  const errors = db.query("SELECT kind, message, source, COUNT(*) AS occurrences, MAX(created_at) AS lastSeenAt FROM client_errors WHERE property_id=? AND path=? GROUP BY kind,message,source ORDER BY occurrences DESC LIMIT 20").all(propertyId, path);
  const ranks = db.query(`SELECT keyword, observed_position AS observedPosition, observed_url AS observedUrl, checked_at AS checkedAt FROM rank_checks
    WHERE property_id=? AND (target_url LIKE ? OR observed_url LIKE ?) ORDER BY checked_at DESC LIMIT 20`).all(propertyId, `%${path}%`, `%${path}%`);
  const links = db.query("SELECT source_url AS sourceUrl, target_url AS targetUrl, external FROM link_edges WHERE property_id=? AND (source_url LIKE ? OR target_url LIKE ?) ORDER BY created_at DESC LIMIT 50").all(propertyId, `%${path}%`, `%${path}%`);
  return { property, path, page, traffic, referrals, events, vitals, findings, changes, errors, ranks, links };
}

export function listFunnels() {
  const funnels = db.query("SELECT id, property_id AS propertyId, name, window_minutes AS windowMinutes, active, created_at AS createdAt FROM funnels WHERE active=1 ORDER BY created_at DESC").all() as Array<Record<string, string | number>>;
  return funnels.map((funnel) => {
    const steps = db.query("SELECT step_type AS type, value FROM funnel_steps WHERE funnel_id=? ORDER BY position").all(funnel.id) as FunnelStep[];
    return { ...funnel, steps, results: calculateFunnel(String(funnel.propertyId), steps, Number(funnel.windowMinutes)) };
  });
}

export function createFunnel(input: { propertyId: string; name: string; windowMinutes?: number; steps: FunnelStep[] }) {
  if (!getProperty(input.propertyId)) throw new Error("Unknown property");
  if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 8) throw new Error("Funnels require 2 to 8 steps");
  const funnelId = `funnel_${crypto.randomUUID()}`;
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO funnels (id, property_id, name, window_minutes) VALUES (?, ?, ?, ?)").run(funnelId, input.propertyId, input.name.slice(0, 100), Math.max(1, Math.min(1440, input.windowMinutes ?? 60)));
    const insert = db.prepare("INSERT INTO funnel_steps (id, funnel_id, position, step_type, value) VALUES (?, ?, ?, ?, ?)");
    input.steps.forEach((step, index) => insert.run(`step_${crypto.randomUUID()}`, funnelId, index, step.type, step.value.slice(0, 300)));
  });
  transaction();
  return { id: funnelId };
}

function calculateFunnel(propertyId: string, steps: FunnelStep[], windowMinutes: number) {
  const rows = db.query(`SELECT session_id AS sessionId, created_at AS at, 'page' AS type, path AS value FROM pageviews
      WHERE property_id=? AND session_id IS NOT NULL AND created_at>=datetime('now','-30 days')
    UNION ALL SELECT session_id, created_at, 'event', name FROM events
      WHERE property_id=? AND session_id IS NOT NULL AND created_at>=datetime('now','-30 days') ORDER BY sessionId, at`).all(propertyId, propertyId) as Array<{ sessionId: string; at: string; type: string; value: string }>;
  const sessions = new Map<string, typeof rows>();
  for (const row of rows) sessions.set(row.sessionId, [...(sessions.get(row.sessionId) ?? []), row]);
  const reached = Array(steps.length).fill(0) as number[];
  for (const events of sessions.values()) {
    let position = 0; let previousAt = 0;
    for (const event of events) {
      const step = steps[position]; if (!step) break;
      const matches = event.type === step.type && (step.type === "page" ? event.value === step.value || event.value.startsWith(step.value.replace(/\*$/, "")) : event.value === step.value);
      const at = new Date(event.at.endsWith("Z") ? event.at : `${event.at}Z`).getTime();
      if (matches && (!previousAt || at - previousAt <= windowMinutes * 60_000)) { reached[position] += 1; position += 1; previousAt = at; }
    }
  }
  return steps.map((step, index) => ({ ...step, sessions: reached[index], conversionFromPrevious: index === 0 ? 1 : reached[index - 1] ? reached[index] / reached[index - 1] : 0 }));
}

export function getBriefs() {
  return db.query("SELECT id, period_start AS periodStart, period_end AS periodEnd, payload, created_at AS createdAt FROM report_snapshots ORDER BY created_at DESC LIMIT 12").all().map((row) => {
    const item = row as Record<string, unknown>; return { ...item, payload: JSON.parse(String(item.payload)) };
  });
}

export function exportRows(dataset: string) {
  const queries: Record<string, string> = {
    properties: "SELECT id,name,kind,url,status,lifecycle,verified_at,last_discovered_at FROM properties ORDER BY name",
    pageviews: "SELECT property_id,path,title,url,referrer,screen,language,timezone,session_id,utm_source,utm_medium,utm_campaign,created_at FROM pageviews ORDER BY created_at DESC",
    events: "SELECT property_id,name,path,session_id,payload,created_at FROM events ORDER BY created_at DESC",
    pages: "SELECT property_id,url,path,status_code,title,description,h1,canonical,robots,word_count,seo_score,captured_at FROM crawled_pages ORDER BY captured_at DESC",
    findings: "SELECT property_id,page_url,severity,code,message,created_at FROM seo_findings ORDER BY created_at DESC",
    backlinks: "SELECT property_id,source_url,target_url,first_seen_at,last_seen_at,status,visits FROM discovered_backlinks ORDER BY last_seen_at DESC",
    ledger: "SELECT property_id,source,kind,title,detail,page_url,occurred_at FROM change_events ORDER BY occurred_at DESC",
  };
  if (!queries[dataset]) return null;
  return db.query(queries[dataset]).all() as Array<Record<string, unknown>>;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [keys.map(cell).join(","), ...rows.map((row) => keys.map((key) => cell(row[key])).join(","))].join("\n");
}
