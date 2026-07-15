import { describe, expect, test } from "bun:test";
import { buildWeeklyBrief } from "./weekly-brief";

describe("weekly owner brief", () => {
  test("is deterministic, structured, and evidence-backed without an LLM", async () => {
    const now = new Date("2026-07-15T18:00:00.000Z");
    const brief = await buildWeeklyBrief(now);
    expect(brief.schemaVersion).toBe(2);
    expect(brief.generatedAt).toBe(now.toISOString());
    expect(brief.priorities.length).toBeLessThanOrEqual(3);
    for (const priority of brief.priorities) {
      expect(priority.evidence.id.length).toBeGreaterThan(3);
      expect(priority.evidence.href.startsWith("/?")).toBe(true);
    }
    expect(brief.evidencePolicy).toContain("Missing data");
  });
});
