import { describe, expect, test } from "bun:test";
import { normalizeZoReceipt } from "./ledger";

describe("Zo change receipt normalization", () => {
  test("normalizes a Space revision with a stable external reference", () => {
    const receipt = normalizeZoReceipt({ provider: "zo-space", sourceId: "/blog", propertyId: "space", url: "https://example.test/blog", metadata: { revisionId: "rev-4", updatedAt: "2026-07-15T12:00:00Z" } });
    expect(receipt?.kind).toBe("space-route-revised");
    expect(receipt?.externalRef).toBe("zo-space:/blog:space-route-revised:rev-4");
    expect(receipt?.metadata.knowledge).toBe("observed");
  });

  test("normalizes Site publications and service restarts", () => {
    expect(normalizeZoReceipt({ provider: "zo-site", sourceId: "site", propertyId: "p", metadata: { deploymentId: "dep-2", publishedAt: "2026-07-15T12:00:00Z" } })?.kind).toBe("site-published");
    expect(normalizeZoReceipt({ provider: "zo-service", sourceId: "service", propertyId: "p", metadata: { restartId: "run-3", restartedAt: "2026-07-15T12:00:00Z" } })?.kind).toBe("service-restarted");
  });

  test("does not invent a receipt without revision evidence", () => {
    expect(normalizeZoReceipt({ provider: "zo-site", sourceId: "site", propertyId: "p", metadata: {} })).toBeNull();
    expect(normalizeZoReceipt({ provider: "zo-site", sourceId: "site", propertyId: "p", metadata: { publishedAt: "2026-07-15T12:00:00Z" } })).toBeNull();
    expect(normalizeZoReceipt({ provider: "zo-space", sourceId: "/blog", propertyId: "p", metadata: { updatedAt: "2026-07-15T12:00:00Z" } })).toBeNull();
    expect(normalizeZoReceipt({ provider: "zo-service", sourceId: "service", propertyId: "p", metadata: { restartedAt: "2026-07-15T12:00:00Z" } })).toBeNull();
  });
});
