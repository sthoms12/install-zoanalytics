export type DataState = "live" | "current" | "stale" | "missing" | "unverified" | "insufficient-sample";

export type DataQualitySignal = {
  state: DataState;
  label: string;
  explanation: string;
  observedAt: string | null;
  ageMinutes: number | null;
};

export type ComparisonQuality = {
  current: number;
  previous: number;
  change: number | null;
  displayPercent: boolean;
  state: "current" | "insufficient-sample";
  explanation: string;
};

const thresholds: Record<string, { liveMinutes?: number; currentMinutes: number }> = {
  traffic: { liveMinutes: 15, currentMinutes: 48 * 60 },
  crawler: { currentMinutes: 8 * 24 * 60 },
  ranks: { currentMinutes: 8 * 24 * 60 },
  backlinks: { currentMinutes: 8 * 24 * 60 },
  authority: { currentMinutes: 8 * 24 * 60 },
  pulse: { currentMinutes: 8 * 24 * 60 },
  ledger: { currentMinutes: 30 * 24 * 60 },
};

function timestamp(value: string) {
  return new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime();
}

export function assessFreshness(source: keyof typeof thresholds | string, observedAt: string | null): DataQualitySignal {
  if (!observedAt) return { state: "missing", label: "No data", explanation: "This source has not produced a signal yet.", observedAt: null, ageMinutes: null };
  const ageMinutes = Math.max(0, Math.floor((Date.now() - timestamp(observedAt)) / 60_000));
  const threshold = thresholds[source] ?? { currentMinutes: 24 * 60 };
  if (threshold.liveMinutes !== undefined && ageMinutes <= threshold.liveMinutes) {
    return { state: "live", label: "Live", explanation: "A signal arrived within the last 15 minutes.", observedAt, ageMinutes };
  }
  if (ageMinutes <= threshold.currentMinutes) {
    return { state: "current", label: "Current", explanation: "This source is within its expected refresh window.", observedAt, ageMinutes };
  }
  return { state: "stale", label: "Stale", explanation: "This source is older than its expected refresh window.", observedAt, ageMinutes };
}

export function assessTracker(status: string, verifiedAt: string | null, lastSignalAt: string | null): DataQualitySignal {
  if (status !== "tracked" || !verifiedAt) {
    return { state: "unverified", label: "Not verified", explanation: "Tracker installation has not been verified for this property.", observedAt: lastSignalAt, ageMinutes: null };
  }
  if (!lastSignalAt) {
    return { state: "missing", label: "No visits", explanation: "Tracking is verified, but no human visits have been recorded.", observedAt: null, ageMinutes: null };
  }
  return assessFreshness("traffic", lastSignalAt);
}

export function assessComparison(current: number, previous: number, minimumSample = 20): ComparisonQuality {
  const sample = current + previous;
  if (previous <= 0) {
    return {
      current, previous, change: null, displayPercent: false, state: "insufficient-sample",
      explanation: current > 0 ? `${current} this period, with no previous baseline.` : "No visits in either period.",
    };
  }
  const change = (current - previous) / previous;
  if (sample < minimumSample) {
    return {
      current, previous, change, displayPercent: false, state: "insufficient-sample",
      explanation: `${current} this period, ${previous} previously. More data is needed for a reliable trend.`,
    };
  }
  return {
    current, previous, change, displayPercent: true, state: "current",
    explanation: `${current} this period, ${previous} previously.`,
  };
}

export function assessSample(sample: number, minimum: number, subject: string): DataQualitySignal {
  if (sample >= minimum) return { state: "current", label: `${sample} samples`, explanation: `${subject} meets the ${minimum}-sample reporting threshold.`, observedAt: null, ageMinutes: null };
  return { state: "insufficient-sample", label: `${sample}/${minimum} samples`, explanation: `${subject} needs at least ${minimum} observations before it is treated as reliable.`, observedAt: null, ageMinutes: null };
}
