import { getDashboard } from "./db";
import { getLedger } from "./ledger";
import { getActionCampaigns } from "./product";

type LedgerRow = Awaited<ReturnType<typeof getLedger>>[number];

function outcomeDirection(event: LedgerRow) {
  const outcome = event.outcome;
  const signals = [
    { metric: "pageviews", label: "pageviews", value: outcome.pageviews.change },
    { metric: "visitors", label: "visitors", value: outcome.visitors.change },
    { metric: "engagement", label: "tracked events", value: outcome.engagement.change },
    { metric: "seoScore", label: "SEO score", value: outcome.seoScore?.change ?? 0 },
    { metric: "poorVitals", label: "poor performance samples", value: -outcome.poorVitals.change },
  ].filter((signal) => signal.value !== 0);
  if (!signals.length) return null;
  const strongest = signals.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  return { direction: strongest.value > 0 ? "win" as const : "regression" as const, metric: strongest.metric, metricLabel: strongest.label, change: strongest.value };
}

function briefEvent(event: LedgerRow) {
  const direction = outcomeDirection(event);
  return {
    id: event.id,
    propertyId: event.propertyId,
    propertyName: event.propertyName,
    source: event.source,
    title: event.title,
    occurredAt: event.occurredAt,
    confidence: event.outcome.confidence,
    sampleSize: event.outcome.sampleSize,
    direction: direction?.direction ?? null,
    metric: direction?.metric ?? null,
    metricLabel: direction?.metricLabel ?? null,
    change: direction?.change ?? 0,
    wording: direction ? `${direction.metricLabel} ${direction.change > 0 ? "improved" : "declined"} after this change` : "No material movement observed yet",
  };
}

export async function getOverviewBrief(days = 30) {
  const dashboard = getDashboard(days);
  const [ledger, campaigns] = await Promise.all([getLedger(), Promise.resolve(getActionCampaigns())]);
  const completed = ledger.filter((event) => event.outcome.sampleSize >= 20 && event.outcome.confidence !== "low").map(briefEvent).filter((event) => event.direction);
  const pending = ledger.filter((event) => event.outcome.sampleSize < 20 || event.outcome.confidence === "low").slice(0, 6).map(briefEvent);
  const qualityExceptions = dashboard.dataQuality.properties.flatMap((property) => {
    const name = dashboard.properties.find((item) => item.id === property.propertyId)?.name ?? property.propertyId;
    return [
      ...(property.tracker.state === "current" || property.tracker.state === "live" ? [] : [{ propertyId: property.propertyId, propertyName: name, source: "tracker", ...property.tracker }]),
      ...(property.crawler.state === "current" || property.crawler.state === "live" ? [] : [{ propertyId: property.propertyId, propertyName: name, source: "crawler", ...property.crawler }]),
    ];
  });
  return {
    generatedAt: new Date().toISOString(),
    range: dashboard.range,
    portfolio: {
      pageviews: dashboard.totals.pageviews,
      visitors: dashboard.totals.visitors,
      activeProperties: dashboard.totals.activeProperties,
      properties: dashboard.totals.properties,
      pageviewsComparison: dashboard.comparison.pageviewsQuality,
      visitorsComparison: dashboard.comparison.visitorsQuality,
    },
    wins: completed.filter((event) => event.direction === "win").slice(0, 4),
    regressions: completed.filter((event) => event.direction === "regression").slice(0, 4),
    pending,
    campaigns: campaigns.slice(0, 3),
    qualityExceptions: qualityExceptions.slice(0, 8),
    setupHealth: dashboard.dataQuality.counts,
  };
}
