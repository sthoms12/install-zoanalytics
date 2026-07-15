import { db, getDashboard } from "./db";
import { getActionCampaigns } from "./product";
import { listCampaignOutcomes } from "./campaign-outcomes";
import { getOverviewBrief } from "./overview";

type EvidenceLink = {
  id: string;
  kind: "property" | "campaign" | "outcome" | "data-quality";
  propertyId: string | null;
  campaignKey: string | null;
  label: string;
  href: string;
};

function reportId() { return `report_${crypto.randomUUID()}`; }
function propertyHref(propertyId: string, section = "summary") { return `/?property=${encodeURIComponent(propertyId)}&section=${section}`; }
function campaignHref(campaignKey: string) { return `/?area=improve&tab=campaigns&campaign=${encodeURIComponent(campaignKey)}`; }

function evidence(input: Omit<EvidenceLink, "href"> & { href?: string }): EvidenceLink {
  return { ...input, href: input.href ?? (input.campaignKey ? campaignHref(input.campaignKey) : input.propertyId ? propertyHref(input.propertyId) : "/?area=overview") };
}

export async function buildWeeklyBrief(now = new Date()) {
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - 7 * 86_400_000);
  const [overview, campaigns] = await Promise.all([getOverviewBrief(7), Promise.resolve(getActionCampaigns())]);
  const dashboard = getDashboard(7);
  const outcomes = listCampaignOutcomes() as Array<Record<string, any>>;

  const priorities = campaigns.slice(0, 3).map((campaign, index) => ({
    rank: index + 1,
    title: campaign.title,
    reason: campaign.rationale,
    action: campaign.recommendedFix,
    evidence: evidence({ id: `campaign:${campaign.key}`, kind: "campaign", propertyId: campaign.propertyId, campaignKey: campaign.key, label: campaign.representativeEvidence }),
  }));

  const wins = overview.verifiedCampaigns.map((item: any) => ({
    title: item.title,
    detail: item.resultDetail || "The expected source check or outcome was verified.",
    evidence: evidence({ id: `outcome:${item.id}`, kind: "outcome", propertyId: item.propertyId, campaignKey: item.campaignKey, label: item.propertyName, href: propertyHref(item.propertyId, "outcomes") }),
  }));
  const regressions = [...overview.campaignRegressions.map((item: any) => ({
    title: item.title,
    detail: item.resultDetail || "The expected result did not appear after this campaign.",
    evidence: evidence({ id: `outcome:${item.id}`, kind: "outcome", propertyId: item.propertyId, campaignKey: item.campaignKey, label: item.propertyName, href: propertyHref(item.propertyId, "outcomes") }),
  })), ...overview.regressions.map((item: any) => ({
    title: item.title,
    detail: item.wording,
    evidence: evidence({ id: `ledger:${item.id}`, kind: "property", propertyId: item.propertyId, campaignKey: null, label: item.propertyName, href: propertyHref(item.propertyId, "outcomes") }),
  }))].slice(0, 6);

  const followups = outcomes.filter((item) => ["pending", "awaiting-verification", "insufficient-sample", "confounded"].includes(item.state)).slice(0, 8).map((item) => ({
    title: item.title,
    state: item.state,
    dueAt: item.dueAt,
    detail: item.resultDetail || `${item.expectedMeasurement} is due for review.`,
    evidence: evidence({ id: `outcome:${item.id}`, kind: "outcome", propertyId: item.propertyId, campaignKey: item.campaignKey, label: item.propertyName, href: propertyHref(item.propertyId, "outcomes") }),
  }));

  const dataGaps = overview.qualityExceptions.map((item: any) => ({
    title: `${item.propertyName}: ${item.source} is ${item.state}`,
    detail: item.explanation,
    evidence: evidence({ id: `quality:${item.propertyId}:${item.source}`, kind: "data-quality", propertyId: item.propertyId, campaignKey: null, label: item.propertyName }),
  }));

  const movement = {
    pageviews: dashboard.totals.pageviews,
    visitors: dashboard.totals.visitors,
    activeProperties: dashboard.totals.activeProperties,
    pageviewsComparison: dashboard.comparison.pageviewsQuality,
    visitorsComparison: dashboard.comparison.visitorsQuality,
  };
  const summary = priorities.length
    ? `${priorities.length} priority action${priorities.length === 1 ? "" : "s"} need attention across ${movement.activeProperties} active public properties.`
    : `No open priority campaigns were found across ${movement.activeProperties} active public properties.`;

  return {
    schemaVersion: 2,
    generatedAt: periodEnd.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    summary,
    movement,
    priorities,
    wins: wins.slice(0, 6),
    regressions,
    followups,
    dataGaps: dataGaps.slice(0, 8),
    evidencePolicy: "Every recommendation references a stored property, campaign, outcome, or data-quality record. Missing data is never treated as poor performance.",
  };
}

export async function createWeeklyOwnerBrief(now = new Date()) {
  const payload = await buildWeeklyBrief(now);
  const existing = db.query("SELECT id FROM report_snapshots WHERE period_start=? AND period_end=? LIMIT 1").get(payload.periodStart, payload.periodEnd) as { id: string } | null;
  if (existing) return { id: existing.id, ...payload };
  const id = reportId();
  db.prepare("INSERT INTO report_snapshots (id,period_start,period_end,payload) VALUES (?,?,?,?)")
    .run(id, payload.periodStart, payload.periodEnd, JSON.stringify(payload));
  return { id, ...payload };
}
