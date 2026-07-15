import { db, getDashboard, getProperty, getPropertySources } from "./db";
import { getIntelligence } from "./intelligence";
import { getActionCampaigns, listFunnels } from "./product";
import { listCampaignOutcomes } from "./campaign-outcomes";
import { getLedger } from "./ledger";
import { listPulseConfig } from "./pulse";

type Section<T> = { status: "ready" | "partial" | "missing"; data: T; error: string | null };

function section<T>(read: () => T, fallback: T): Section<T> {
  try {
    const data = read();
    const empty = Array.isArray(data) && data.length === 0;
    return { status: empty ? "missing" : "ready", data, error: null };
  } catch (error) {
    return { status: "partial", data: fallback, error: error instanceof Error ? error.message : "Source unavailable" };
  }
}

export async function getPropertyWorkspace(propertyId: string, requestedDays = 30) {
  const property = getProperty(propertyId);
  if (!property) return null;
  const days = [7, 14, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const dashboard = getDashboard(days);
  const owns = (row: any) => row.propertyId === propertyId;
  const quality = dashboard.dataQuality.properties.find(owns) ?? null;
  const rollup = dashboard.propertyRollups.find(owns) ?? null;
  const comparison = dashboard.propertyComparisons.find(owns) ?? null;
  const sources = getPropertySources().filter(owns);
  const aliases = db.query("SELECT url, active, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM surface_aliases WHERE property_id=? ORDER BY active DESC, url").all(propertyId);
  const pulse = listPulseConfig().find(owns) ?? null;
  const trend = db.query(`WITH dates(day) AS (
      SELECT date('now', ?) UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < date('now')
    ) SELECT dates.day AS date, COUNT(p.id) AS pageviews, COUNT(DISTINCT p.visitor_hash) AS visitors,
      0 AS searchClicks, 0 AS impressions FROM dates LEFT JOIN pageviews p ON p.property_id=? AND date(p.created_at)=dates.day
    GROUP BY dates.day ORDER BY dates.day`).all(`-${days - 1} days`, propertyId) as typeof dashboard.trend;
  const intelligence = section(() => getIntelligence(), null as ReturnType<typeof getIntelligence> | null);
  const signals = intelligence.data;

  return {
    property: { ...property, aliases, sources },
    days,
    freshness: {
      tracker: quality?.tracker ?? null,
      crawler: quality?.crawler ?? null,
      rankings: dashboard.dataQuality.sources.ranks,
      links: dashboard.dataQuality.sources.backlinks,
      authority: dashboard.dataQuality.sources.authority,
      pulse: pulse?.updatedAt ? { status: "ready", updatedAt: pulse.updatedAt } : { status: "missing", updatedAt: null },
    },
    summary: section(() => ({ rollup, comparison, trend, pulse, openCampaigns: getActionCampaigns().filter(owns) }), { rollup: null, comparison: null, trend: [], pulse, openCampaigns: [] }),
    audience: section(() => ({
      topPages: dashboard.topPages.filter(owns), recentActivity: dashboard.recentActivity.filter(owns),
      referrers: dashboard.referrerSummary.filter(owns), devices: dashboard.deviceSummary.filter(owns), events: dashboard.eventSummary.filter(owns),
      sessions: signals?.sessions.filter(owns) ?? [], journeys: signals?.journeys.filter(owns) ?? [],
    }), { topPages: [], recentActivity: [], referrers: [], devices: [], events: [], sessions: [], journeys: [] }),
    visibility: section(() => ({
      pages: dashboard.latestCrawledPages.filter(owns), findings: dashboard.seoFindings.filter(owns), rankings: dashboard.rankVisibility.filter(owns),
      authority: dashboard.authorityScores.filter(owns), links: dashboard.commonCrawlLinks.filter(owns), backlinks: signals?.backlinks.filter(owns) ?? [],
      vitals: signals?.vitals.filter(owns) ?? [],
    }), { pages: [], findings: [], rankings: [], authority: [], links: [], backlinks: [], vitals: [] }),
    improve: section(() => ({ campaigns: getActionCampaigns().filter(owns), opportunities: dashboard.opportunityPages.filter(owns), errors: signals?.errors.filter(owns) ?? [] }), { campaigns: [], opportunities: [], errors: [] }),
    outcomes: {
      status: "ready" as const,
      data: {
        goals: signals?.goals.filter(owns) ?? [], funnels: listFunnels().filter(owns),
        ledger: (await getLedger()).filter(owns), campaignOutcomes: listCampaignOutcomes(propertyId), conversions: (signals?.goals.filter(owns) ?? []).reduce((sum: number, goal: any) => sum + Number(goal.conversions || 0), 0),
      },
      error: intelligence.error,
    },
  };
}
