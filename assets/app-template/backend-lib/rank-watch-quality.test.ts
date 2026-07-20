import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { refreshAutomaticRankWatches } from "./intelligence";

let database: Database | null = null;

afterEach(() => database?.close());

describe("automatic rank watches", () => {
  test("uses the latest completed crawl and preserves manual terms", () => {
    database = new Database(":memory:");
    database.exec(`
      CREATE TABLE properties (id TEXT PRIMARY KEY, url TEXT NOT NULL, lifecycle TEXT NOT NULL);
      CREATE TABLE crawl_runs (id TEXT PRIMARY KEY, property_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL);
      CREATE TABLE keyword_candidates (run_id TEXT NOT NULL, property_id TEXT NOT NULL, keyword TEXT NOT NULL, weight REAL NOT NULL);
      CREATE TABLE rank_watchlist (id TEXT PRIMARY KEY, property_id TEXT NOT NULL, keyword TEXT NOT NULL, target_url TEXT, active INTEGER NOT NULL, source TEXT NOT NULL, UNIQUE(property_id, keyword));
      INSERT INTO properties VALUES ('site', 'https://example.com', 'active');
      INSERT INTO crawl_runs VALUES ('old', 'site', 'completed', '2026-07-01'), ('new', 'site', 'completed', '2026-07-02'), ('failed', 'site', 'failed', '2026-07-03');
      INSERT INTO keyword_candidates VALUES ('old', 'site', 'stale phrase', 99), ('new', 'site', 'mortgage calculator', 12), ('new', 'site', 'monthly payment estimate', 10), ('failed', 'site', 'failed crawl phrase', 100);
      INSERT INTO rank_watchlist VALUES ('manual', 'site', 'custom mortgage term', 'https://example.com/custom', 1, 'manual');
      INSERT INTO rank_watchlist VALUES ('legacy', 'site', 'for', 'https://example.com', 1, 'legacy-auto');
    `);

    refreshAutomaticRankWatches(database);

    const rows = database.query("SELECT keyword, active, source, target_url AS targetUrl FROM rank_watchlist ORDER BY keyword").all();
    expect(rows).toContainEqual({ keyword: "custom mortgage term", active: 1, source: "manual", targetUrl: "https://example.com/custom" });
    expect(rows).toContainEqual({ keyword: "mortgage calculator", active: 1, source: "auto", targetUrl: "https://example.com" });
    expect(rows).not.toContainEqual(expect.objectContaining({ keyword: "stale phrase", active: 1 }));
    expect(rows).not.toContainEqual(expect.objectContaining({ keyword: "failed crawl phrase", active: 1 }));
    expect(rows).toContainEqual({ keyword: "for", active: 0, source: "legacy-auto", targetUrl: "https://example.com" });
  });
});
