import { afterAll, describe, expect, test } from "bun:test";
import { db } from "./db";
import { commitMigration, previewMigration } from "./migration-import";

const propertyId = "migration-test";
db.prepare("INSERT OR IGNORE INTO properties (id,name,kind,url) VALUES (?,?,?,?)").run(propertyId, "Migration test", "external", "https://migration-test.invalid");
afterAll(() => db.prepare("DELETE FROM properties WHERE id=?").run(propertyId));

describe("analytics migration", () => {
  test("previews Plausible aggregates without fabricating visits", () => {
    const content = "date,page,pageviews,visitors,visits\n2026-01-01,/docs,12,8,9\n";
    const result = previewMigration({ source: "plausible", propertyId, fileName: "plausible.csv", content });
    expect(result.mode).toBe("aggregate"); expect(result.validRows).toBe(1); expect(result.warnings[0]).toContain("will not fabricate");
  });
  test("imports Umami events once", () => {
    const content = "created_at,url_path,event_type,event_name,session_id,visitor_id\n2026-01-01T12:00:00Z,/docs,1,,s1,v1\n";
    const first = commitMigration({ source: "umami", propertyId, fileName: "umami.csv", content });
    expect(first.importedRows).toBe(1);
    expect(() => commitMigration({ source: "umami", propertyId, fileName: "umami.csv", content })).toThrow("already been imported");
    db.prepare("DELETE FROM pageviews WHERE id LIKE ?").run(`import:${first.fingerprint}:%`);
    db.prepare("DELETE FROM import_runs WHERE id=?").run(first.id);
  });
});
