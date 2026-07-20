import { describe, expect, test } from "bun:test";
import { inferKeywordCandidates, isUsefulKeyword } from "./keyword-quality";

describe("keyword quality", () => {
  test("rejects generic and stopword-only terms", () => {
    for (const term of ["for", "was", "model", "click here", "how to", "across source prior", "pages for better"]) expect(isUsefulKeyword(term)).toBe(false);
  });

  test("prefers intent-bearing phrases from important fields", () => {
    const candidates = inferKeywordCandidates([
      { value: "Free Mortgage Calculator | CalcWorks", weight: 6 },
      { value: "Mortgage Calculator", weight: 5 },
      { value: "Estimate monthly mortgage payments and total interest.", weight: 3 },
      { value: "Use this calculator to estimate mortgage payments.", weight: 1 },
    ]);
    expect(candidates[0].keyword).toContain("mortgage calculator");
    expect(candidates.some((item) => item.keyword === "for")).toBe(false);
  });

  test("falls back to a meaningful single term when no phrase exists", () => {
    expect(inferKeywordCandidates([{ value: "DNSSEC", weight: 5 }])).toEqual([
      { keyword: "dnssec", weight: 5, source: "page-copy" },
    ]);
  });
});
