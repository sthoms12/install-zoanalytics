import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db, recordHit } from "./db";
import { getPublicPulse, listPulseConfig, refreshPulseSnapshot, updatePulseConfig } from "./pulse";

const propertyId = "release-check-property";
const browserHeaders = { "user-agent": "Mozilla/5.0 release-check", "cf-connecting-ip": "203.0.113.19" };

beforeAll(() => {
  db.prepare(`INSERT OR REPLACE INTO properties (id, name, kind, url, lifecycle, status)
    VALUES (?, ?, 'site', ?, 'active', 'missing-tracker')`).run(propertyId, "Release Check", "https://release-check.example");
});

afterAll(() => {
  db.prepare("DELETE FROM properties WHERE id = ?").run(propertyId);
});

describe("collector privacy boundaries", () => {
  test("rejects unknown properties", () => {
    const result = recordHit({ siteId: "missing-property", path: "/" }, new Request("https://collector.example", { headers: browserHeaders }));
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  test("drops bots and prefetches without storing pageviews", () => {
    const before = db.query("SELECT COUNT(*) AS count FROM pageviews WHERE property_id = ?").get(propertyId) as { count: number };
    expect(recordHit({ siteId: propertyId, path: "/bot" }, new Request("https://collector.example", { headers: { "user-agent": "Googlebot" } }))).toMatchObject({ dropped: "bot" });
    expect(recordHit({ siteId: propertyId, path: "/prefetch" }, new Request("https://collector.example", { headers: { ...browserHeaders, purpose: "prefetch" } }))).toMatchObject({ dropped: "prefetch" });
    const after = db.query("SELECT COUNT(*) AS count FROM pageviews WHERE property_id = ?").get(propertyId) as { count: number };
    expect(after.count).toBe(before.count);
  });

  test("rate limits a visitor after sixty accepted hits", () => {
    for (let index = 0; index < 60; index += 1) {
      expect(recordHit({ siteId: propertyId, path: `/rate-${index}` }, new Request("https://collector.example", { headers: browserHeaders }))).not.toHaveProperty("dropped");
    }
    expect(recordHit({ siteId: propertyId, path: "/rate-limited" }, new Request("https://collector.example", { headers: browserHeaders }))).toMatchObject({ dropped: "rate-limited" });
  });
});

describe("Pulse privacy defaults", () => {
  test("starts disabled and publishes no properties", () => {
    expect(listPulseConfig().find((item) => item.propertyId === propertyId)?.enabled).toBeFalse();
    expect(refreshPulseSnapshot().properties).toEqual([]);
  });

  test("publishes only selected aggregate fields", () => {
    updatePulseConfig(propertyId, {
      enabled: true,
      showUrl: false,
      showPageviews: true,
      showVisitors: false,
      showTrend: false,
      showAudit: false,
      showVitals: false,
      showAuthority: false,
    });
    const pulse = getPublicPulse();
    expect(pulse.properties).toHaveLength(1);
    expect(pulse.properties[0]).toEqual({ id: propertyId, name: "Release Check", metrics: { pageviews: 60 } });
    expect(JSON.stringify(pulse)).not.toMatch(/visitor_hash|session|referrer|campaign|repository|path/i);
  });
});

