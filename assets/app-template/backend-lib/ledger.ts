import { db, getProperties } from "./db";

export type ChangeEvent = {
  id: string;
  propertyId: string;
  source: "commit" | "content" | "tracker" | "manual" | "fix";
  kind: string;
  title: string;
  detail: string | null;
  pageUrl: string | null;
  occurredAt: string;
};

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

const insertEvent = db.prepare(`INSERT INTO change_events (id, property_id, source, kind, title, detail, page_url, external_ref, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(property_id, source, external_ref) DO NOTHING`);

export function logFixEvent(input: { propertyId: string; kind: string; title: string; detail?: string; externalRef: string }) {
  insertEvent.run(id("change"), input.propertyId, "fix", input.kind, input.title.slice(0, 200), input.detail?.slice(0, 1000) ?? null, null, input.externalRef, new Date().toISOString());
}

async function syncCommitEvents() {
  for (const property of getProperties().filter((item) => item.projectPath)) {
    try {
      const proc = Bun.spawn(["git", "log", "--max-count=50", "--pretty=format:%H%x1f%cI%x1f%s", "--", "."], {
        cwd: property.projectPath!, stdout: "pipe", stderr: "ignore",
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) continue;
      for (const line of output.split("\n")) {
        const [sha, committedAt, subject] = line.split("\x1f");
        if (!sha || !committedAt) continue;
        insertEvent.run(id("change"), property.id, "commit", "commit", (subject || "Code change").slice(0, 200), subject?.slice(0, 500) ?? null, null, sha, committedAt);
      }
    } catch { /* not a git repository, or git is unavailable */ }
  }
}

function syncTrackerEvents() {
  const rows = db.query(`SELECT id AS propertyId, verified_at AS verifiedAt FROM properties
    WHERE verified_at IS NOT NULL AND lifecycle='active'`).all() as Array<{ propertyId: string; verifiedAt: string }>;
  for (const row of rows) insertEvent.run(id("change"), row.propertyId, "tracker", "tracker-installed",
    "Analytics tracker verified", "The tracker snippet was confirmed live on the public page.", null, "verified", row.verifiedAt);
}

export function logManualChangeEvent(input: { propertyId: string; title: string; detail?: string; pageUrl?: string; occurredAt?: string }) {
  if (!getProperties().some((item) => item.id === input.propertyId)) throw new Error("Unknown property");
  if (!input.title?.trim()) throw new Error("A title is required");
  const eventId = id("change");
  db.prepare(`INSERT INTO change_events (id, property_id, source, kind, title, detail, page_url, external_ref, occurred_at)
    VALUES (?, ?, 'manual', 'manual', ?, ?, ?, ?, ?)`).run(
    eventId, input.propertyId, input.title.slice(0, 200), input.detail?.slice(0, 1000) ?? null,
    input.pageUrl?.slice(0, 500) ?? null, eventId, input.occurredAt ?? new Date().toISOString(),
  );
  return { id: eventId };
}

export function deleteChangeEvent(eventId: string) {
  const result = db.prepare("DELETE FROM change_events WHERE id=? AND source='manual'").run(eventId);
  return { ok: result.changes > 0 };
}

function windowCounts(propertyId: string, occurredAt: string, days: number) {
  const before = db.query(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews WHERE property_id=? AND created_at < ? AND created_at >= datetime(?, '-' || ? || ' days')`)
    .get(propertyId, occurredAt, occurredAt, days) as { pageviews: number; visitors: number };
  const after = db.query(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews WHERE property_id=? AND created_at >= ? AND created_at < datetime(?, '+' || ? || ' days')`)
    .get(propertyId, occurredAt, occurredAt, days) as { pageviews: number; visitors: number };
  const eventsBefore = db.query(`SELECT COUNT(*) AS count FROM events
    WHERE property_id=? AND created_at < ? AND created_at >= datetime(?, '-' || ? || ' days')`)
    .get(propertyId, occurredAt, occurredAt, days) as { count: number };
  const eventsAfter = db.query(`SELECT COUNT(*) AS count FROM events
    WHERE property_id=? AND created_at >= ? AND created_at < datetime(?, '+' || ? || ' days')`)
    .get(propertyId, occurredAt, occurredAt, days) as { count: number };
  const poorVitalsBefore = db.query(`SELECT COUNT(*) AS count FROM performance_metrics
    WHERE property_id=? AND rating='poor' AND created_at < ? AND created_at >= datetime(?, '-' || ? || ' days')`)
    .get(propertyId, occurredAt, occurredAt, days) as { count: number };
  const poorVitalsAfter = db.query(`SELECT COUNT(*) AS count FROM performance_metrics
    WHERE property_id=? AND rating='poor' AND created_at >= ? AND created_at < datetime(?, '+' || ? || ' days')`)
    .get(propertyId, occurredAt, occurredAt, days) as { count: number };
  const seoBefore = db.query(`SELECT AVG(seo_score) AS score FROM (SELECT seo_score,
      ROW_NUMBER() OVER (PARTITION BY url ORDER BY captured_at DESC) AS rn
    FROM crawled_pages WHERE property_id=? AND captured_at <= ?) WHERE rn=1`).get(propertyId, occurredAt) as { score: number | null };
  const seoAfter = db.query(`SELECT AVG(seo_score) AS score FROM (SELECT seo_score,
      ROW_NUMBER() OVER (PARTITION BY url ORDER BY captured_at DESC) AS rn
    FROM crawled_pages WHERE property_id=?) WHERE rn=1`).get(propertyId) as { score: number | null };
  return { before, after, eventsBefore, eventsAfter, poorVitalsBefore, poorVitalsAfter, seoBefore, seoAfter };
}

function delta(before: number, after: number) {
  const change = after - before;
  const pct = before ? Math.round((change / before) * 1000) / 10 : (after ? 100 : 0);
  return { before, after, change, pct };
}

function computeOutcome(propertyId: string, occurredAt: string, coOccurring: number, windowDays = 7) {
  const stats = windowCounts(propertyId, occurredAt, windowDays);
  const pageviews = delta(stats.before.pageviews, stats.after.pageviews);
  const visitors = delta(stats.before.visitors, stats.after.visitors);
  const engagement = delta(stats.eventsBefore.count, stats.eventsAfter.count);
  const poorVitals = delta(stats.poorVitalsBefore.count, stats.poorVitalsAfter.count);
  const seoScore = stats.seoBefore.score != null && stats.seoAfter.score != null
    ? delta(Math.round(stats.seoBefore.score), Math.round(stats.seoAfter.score)) : null;
  const sampleSize = stats.before.pageviews + stats.after.pageviews;
  const confidence = sampleSize < 15 ? "low" : coOccurring > 1 ? (sampleSize < 60 ? "low" : "medium") : sampleSize < 60 ? "medium" : "high";
  return { windowDays, pageviews, visitors, engagement, poorVitals, seoScore, sampleSize, coOccurring, confidence };
}

export async function getLedger() {
  await syncCommitEvents();
  syncTrackerEvents();
  const events = db.query(`
    SELECT id, property_id AS propertyId, 'content' AS source, field AS kind,
      (REPLACE(field, '_', ' ') || ' changed') AS title,
      ('from "' || COALESCE(previous_value, '(empty)') || '" to "' || COALESCE(current_value, '(empty)') || '"') AS detail,
      page_url AS pageUrl, detected_at AS occurredAt
    FROM page_changes WHERE detected_at >= datetime('now', '-180 days')
    UNION ALL
    SELECT id, property_id AS propertyId, source, kind, title, detail, page_url AS pageUrl, occurred_at AS occurredAt
    FROM change_events WHERE occurred_at >= datetime('now', '-180 days')
    ORDER BY occurredAt DESC LIMIT 300
  `).all() as ChangeEvent[];

  const properties = new Map(getProperties().map((item) => [item.id, item]));
  return events.map((event) => {
    const coOccurring = events.filter((other) => other.id !== event.id && other.propertyId === event.propertyId
      && Math.abs(new Date(other.occurredAt).getTime() - new Date(event.occurredAt).getTime()) <= 7 * 86_400_000).length;
    return { ...event, propertyName: properties.get(event.propertyId)?.name ?? event.propertyId, outcome: computeOutcome(event.propertyId, event.occurredAt, coOccurring) };
  });
}
