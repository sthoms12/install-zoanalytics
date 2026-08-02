import { describe, expect, test } from "bun:test";
import { classifySurface, reconcileSurfaces, type SurfaceObservation } from "./surfaces";

const base: SurfaceObservation = {
  sourceKey: "zo-site:example",
  provider: "zo-site",
  sourceId: "example",
  name: "Example",
  kind: "site",
  url: "https://example.invalid",
  public: true,
  published: true,
  mode: "http",
  reachable: true,
};

describe("surface classification", () => {
  test("keeps private and development surfaces out of the public class", () => {
    expect(classifySurface({ ...base, public: false })).toBe("private");
    expect(classifySurface({ ...base, published: false })).toBe("development-only");
  });

  test("distinguishes unreachable, redirected, and retired surfaces", () => {
    expect(classifySurface({ ...base, reachable: false })).toBe("published-unreachable");
    expect(classifySurface({ ...base, finalUrl: "https://canonical.invalid" })).toBe("redirected-alias");
    expect(classifySurface({ ...base, retired: true })).toBe("retired");
  });

  test("classifies a public HTTP deployment as reachable", () => {
    expect(classifySurface(base)).toBe("public-reachable");
  });
});

describe("surface reconciliation", () => {
  test("is deterministic and exposes duplicate ownership as a conflict", () => {
    const input = [{ ...base, projectPath: "/one" }, { ...base, sourceKey: "zo-service:example", provider: "zo-service" as const, sourceId: "service-example", kind: "service" as const, projectPath: "/two" }];
    const first = reconcileSurfaces(input);
    const second = reconcileSurfaces(input);
    expect(second).toEqual(first);
    expect(first.every((item) => item.conflict?.includes("Multiple unrelated inventory records claim"))).toBe(true);
    expect(first.every((item) => item.propertyId === null)).toBe(true);
  });

  test("deduplicates a Site and its backing service when they share a project", () => {
    const input = [{ ...base, projectPath: "/same" }, { ...base, sourceKey: "zo-service:example", provider: "zo-service" as const, sourceId: "example", kind: "service" as const, projectPath: "/same" }];
    expect(reconcileSurfaces(input).every((item) => item.conflict === null)).toBe(true);
  });

  test("maps public Space routes to one canonical property", () => {
    const routes = [
      { ...base, sourceKey: "zo-space:/blog", provider: "zo-space" as const, sourceId: "/blog", kind: "space" as const, url: "https://example.invalid/blog", aliasOfPropertyId: "zo-space-home" },
      { ...base, sourceKey: "zo-space:/tools", provider: "zo-space" as const, sourceId: "/tools", kind: "space" as const, url: "https://example.invalid/tools", aliasOfPropertyId: "zo-space-home" },
    ];
    expect(reconcileSurfaces(routes).map((item) => item.propertyId)).toEqual(["zo-space-home", "zo-space-home"]);
  });
});
