export type DataState = "live" | "current" | "stale" | "missing" | "unverified" | "insufficient-sample";

export type DataQualitySignal = {
  state: DataState;
  label: string;
  explanation: string;
  observedAt: string | null;
  ageMinutes: number | null;
};

const tones: Record<DataState, string> = {
  live: "border-[#58e0c0]/25 bg-[#58e0c0]/[.07] text-[#70d9b9]",
  current: "border-white/10 bg-white/[.035] text-[#9dacA7]",
  stale: "border-[#efc86b]/25 bg-[#efc86b]/[.06] text-[#efc86b]",
  missing: "border-white/10 bg-white/[.025] text-[#71807c]",
  unverified: "border-[#ff8178]/25 bg-[#ff8178]/[.06] text-[#ff9d96]",
  "insufficient-sample": "border-[#efc86b]/25 bg-[#efc86b]/[.06] text-[#efc86b]",
};

function parseTimestamp(value: string) {
  return new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

export function exactTime(value: string | null) {
  if (!value) return "No timestamp available";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parseTimestamp(value));
}

export function relativeTime(value: string | null) {
  if (!value) return "No data";
  const minutes = Math.max(0, Math.floor((Date.now() - parseTimestamp(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DataStateBadge({ signal, compact = false }: { signal: DataQualitySignal; compact?: boolean }) {
  const title = `${signal.explanation}${signal.observedAt ? ` Last signal: ${exactTime(signal.observedAt)}.` : ""}`;
  return <span title={title} aria-label={title} className={`inline-flex items-center gap-1.5 border font-semibold uppercase tracking-[.1em] ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-1 text-[9px]"} ${tones[signal.state]}`}>
    <span className={`size-1.5 rounded-full ${signal.state === "live" ? "animate-pulse bg-[#58e0c0]" : "bg-current opacity-70"}`} />
    {signal.label}
  </span>;
}

export function FreshnessLabel({ signal }: { signal: DataQualitySignal }) {
  return <span className="inline-flex items-center gap-2" title={`${signal.explanation}${signal.observedAt ? ` ${exactTime(signal.observedAt)}` : ""}`}>
    <DataStateBadge signal={signal} compact />
    <span className="text-[10px] text-[#60706b]">{relativeTime(signal.observedAt)}</span>
  </span>;
}

export function SampleWarning({ sample, minimum, subject }: { sample: number; minimum: number; subject: string }) {
  if (sample >= minimum) return null;
  return <span className="border border-[#efc86b]/25 bg-[#efc86b]/[.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#efc86b]" title={`${subject} needs at least ${minimum} observations before it is treated as reliable.`}>{sample}/{minimum} samples</span>;
}
