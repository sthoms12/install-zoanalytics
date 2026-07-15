import { describe, expect, test } from "bun:test";
import { classifyCampaignOutcome } from "./campaign-outcomes";

describe("campaign outcome classification", () => {
  test("protects low-volume properties from trend claims", () => {
    expect(classifyCampaignOutcome({ category: "engagement", minimumSample: 20, sampleBefore: 30, sampleAfter: 8, valueBefore: .4, valueAfter: .8, overlappingChanges: 0 }).state).toBe("insufficient-sample");
  });
  test("marks overlapping work as confounded", () => {
    expect(classifyCampaignOutcome({ category: "engagement", minimumSample: 20, sampleBefore: 30, sampleAfter: 30, valueBefore: .4, valueAfter: .8, overlappingChanges: 2 }).state).toBe("confounded");
  });
  test("classifies meaningful movement without causal language", () => {
    const result = classifyCampaignOutcome({ category: "engagement", minimumSample: 20, sampleBefore: 30, sampleAfter: 30, valueBefore: .4, valueAfter: .55, overlappingChanges: 0 });
    expect(result.state).toBe("improved"); expect(result.detail).toContain("observed after");
  });
  test("keeps small movement unchanged", () => {
    expect(classifyCampaignOutcome({ category: "traffic", minimumSample: 20, sampleBefore: 30, sampleAfter: 30, valueBefore: 100, valueAfter: 105, overlappingChanges: 0 }).state).toBe("unchanged");
  });
});
