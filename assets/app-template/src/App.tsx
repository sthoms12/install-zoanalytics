import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Bar, BarChart,
} from "recharts";
import {
  IconActivity, IconAlertTriangle, IconArrowUpRight, IconBolt, IconBrandSpeedtest,
  IconChartAreaLine, IconCheck, IconChevronRight, IconClick, IconCode,
  IconDeviceDesktopAnalytics, IconExternalLink, IconFileAnalytics, IconFilter,
  IconGlobe, IconLink, IconListCheck, IconRadar, IconRefresh, IconSearch,
  IconSeo, IconSparkles, IconTargetArrow, IconWorldSearch,
  IconBell, IconGitBranch, IconHeartbeat, IconHistory, IconRoute, IconTrophy,
  IconBrandCloudflare, IconBrandGithub, IconEye, IconArrowLeft,
} from "@tabler/icons-react";
import { ThemeProvider } from "@/components/theme-provider";
import { DataStateBadge, FreshnessLabel, SampleWarning, relativeTime, type DataQualitySignal } from "@/components/data-state";
import { ActionCenter, Ledger, Outcomes, PageExplorer, PulseSettings, SetupGuide, type ActionCampaignData, type BriefData, type FunnelData, type LedgerEvent, type SetupData } from "@/product";

type Property = {
  id: string; name: string; kind: "space" | "site" | "service" | "external"; url: string;
  projectPath: string | null; status: "tracked" | "missing-tracker" | "needs-review";
  tags: string; gscProperty: string | null; ahrefsTarget: string | null; verifiedAt: string | null;
};

type ComparisonQuality = { current: number; previous: number; change: number | null; displayPercent: boolean; state: "current" | "insufficient-sample"; explanation: string };

type Dashboard = {
  range: { days: number; label: string };
  comparison: { pageviews: number | null; visitors: number | null; previousPageviews: number; previousVisitors: number; pageviewsQuality: ComparisonQuality; visitorsQuality: ComparisonQuality };
  propertyComparisons: Array<{ propertyId: string; pageviews: number; visitors: number; previousPageviews: number; previousVisitors: number; pageviewsChange: number | null; visitorsChange: number | null; pageviewsQuality: ComparisonQuality; visitorsQuality: ComparisonQuality }>;
  freshness: { traffic: string | null; crawler: string | null; ranks: string | null; backlinks: string | null; authority: string | null };
  dataQuality: { sources: Record<"traffic" | "crawler" | "ranks" | "backlinks" | "authority", DataQualitySignal>; properties: Array<{ propertyId: string; tracker: DataQualitySignal; crawler: DataQualitySignal }>; counts: { unverified: number; missingTraffic: number; staleTraffic: number; staleSources: number } };
  sources: Record<string, { kind: string; label: string }>;
  domainRatings: Array<{ propertyId: string; domainRating: number; capturedAt: string }>;
  authorityScores: Array<{ propertyId: string; releaseId: string; authorityScore: number; referringHosts: number; linkEdges: number; targetHosts: string[]; indexedTargetHosts: string[]; indexedHosts: number; capturedAt: string }>;
  commonCrawlLinks: Array<{ propertyId: string; sourceHost: string; targetHosts: string; linkEdges: number }>;
  properties: Property[];
  totals: Record<string, number> & {
    properties: number; tracked: number; missingTracker: number; pageviews: number; visitors: number;
    activeProperties: number; searchClicks: number; impressions: number; ctr: number; position: number;
    referringDomains: number; backlinks: number; organicKeywords: number; organicTraffic: number;
    crawledPages: number; averageSeoScore: number; brokenPages: number; missingTitles: number;
    missingDescriptions: number; thinPages: number; imagesMissingAlt: number;
  };
  trend: Array<{ date: string; pageviews: number; visitors: number; searchClicks: number; impressions: number }>;
  topPages: Array<{ propertyId: string; path: string; views: number; visitors: number }>;
  searchPages: Array<{ propertyId: string; page: string; clicks: number; impressions: number; position: number }>;
  rankVisibility: Array<{ propertyId: string; keyword: string; observedPosition: number | null; observedUrl: string | null; engine: string; checkedAt: string }>;
  latestCrawledPages: Array<{ propertyId: string; url: string; path: string; statusCode: number; title: string | null; description: string | null; h1: string | null; wordCount: number; internalLinks: number; externalLinks: number; imagesMissingAlt: number; seoScore: number; htmlBytes: number; loadMs: number; capturedAt: string }>;
  seoFindings: Array<{ propertyId: string; pageUrl: string; severity: "critical" | "warning" | "info"; code: string; message: string; createdAt: string }>;
  keywordCandidates: Array<{ propertyId: string; pageUrl: string; keyword: string; weight: number; source: string }>;
  referrerDomains: Array<{ propertyId: string; referrer: string; visits: number }>;
  propertyRollups: Array<{ propertyId: string; name: string; kind: string; status: string; url: string; verifiedAt: string | null; pageviews: number; visitors: number; events: number; firstSeenAt: string | null; lastHitAt: string | null; crawledPages: number; averageSeoScore: number; brokenPages: number; missingTitles: number; missingDescriptions: number; thinPages: number; lastCrawledAt: string | null; criticalFindings: number; warningFindings: number; totalFindings: number }>;
  eventSummary: Array<{ propertyId: string; name: string; path: string | null; count: number; lastSeenAt: string }>;
  recentActivity: Array<{ propertyId: string; path: string; title: string | null; referrer: string | null; screen: string | null; language: string | null; timezone: string | null; createdAt: string }>;
  referrerSummary: Array<{ propertyId: string; source: string; visits: number; pages: number }>;
  deviceSummary: Array<{ propertyId: string; device: string; visits: number; visitors: number }>;
  opportunityPages: Array<{ propertyId: string; path: string; url: string; title: string | null; seoScore: number; wordCount: number; internalLinks: number; externalLinks: number; loadMs: number; views: number; opportunityScore: number }>;
  actionItems: Array<{ propertyId: string; action: string; code: string; message: string; pageUrl: string; severity: "critical" | "warning" | "info"; createdAt: string }>;
};

type Intelligence = {
  sessionTotals: { sessions: number; pagesPerSession: number; averageDurationSeconds: number; bounceRate: number };
  sessions: Array<{ propertyId: string; sessionId: string; startedAt: string; endedAt: string; pageviews: number; uniquePages: number; durationSeconds: number; entryPath: string; exitPath: string; referrer: string | null }>;
  journeys: Array<{ propertyId: string; sessionId: string; journey: string; steps: number; startedAt: string }>;
  goals: Array<{ id: string; propertyId: string; name: string; eventName: string; pathPattern: string | null; conversions: number; converters: number }>;
  vitals: Array<{ propertyId: string; metric: string; p75: number; samples: number; poorSamples: number }>;
  errors: Array<{ propertyId: string; kind: string; message: string; source: string | null; occurrences: number; lastSeenAt: string }>;
  changes: Array<{ propertyId: string; pageUrl: string; field: string; previousValue: string | null; currentValue: string | null; detectedAt: string }>;
  linkGraph: Array<{ propertyId: string; sourceUrl: string; targetUrl: string; external: number }>;
  orphanPages: Array<{ propertyId: string; url: string; title: string | null; path: string }>;
  campaigns: Array<{ propertyId: string; campaign: string; source: string; medium: string; pageviews: number; sessions: number }>;
  ranks: Array<{ id: string; propertyId: string; keyword: string; targetUrl: string | null; observedPosition: number | null; observedUrl: string | null; engine: string | null; checkedAt: string | null }>;
  backlinks: Array<{ propertyId: string; sourceUrl: string; targetUrl: string | null; firstSeenAt: string; lastSeenAt: string; status: string; visits: number }>;
  competitors: Array<{ id: string; propertyId: string; name: string; domain: string; createdAt: string }>;
  alerts: Array<{ id: string; propertyId: string | null; kind: string; severity: string; title: string; message: string; status: string; detectedAt: string }>;
  reports: Array<{ id: string; periodStart: string; periodEnd: string; createdAt: string }>;
  trackerCoverage: Array<{ propertyId: string; name: string; url: string; status: string; lastSignalAt: string | null; installed: number }>;
  externalSources: Array<{ propertyId: string; provider: string; sourceId: string; repository: string | null; repositoryUrl: string | null; metadata: Record<string, unknown>; lastSyncedAt: string }>;
  collectorOrigin: string;
};

type View = "overview" | "actions" | "traffic" | "content" | "seo" | "technical" | "outcomes" | "ledger" | "pulse" | "intelligence";
type WorkspaceSection = "summary" | "audience" | "visibility" | "improve" | "outcomes";
type PropertyWorkspaceData = {
  property: Property & { aliases: Array<{ url: string }>; sources: Array<{ provider: string; repository: string | null; repositoryUrl: string | null }> };
  days: number; freshness: Record<string, any>;
  summary: { status: string; error: string | null; data: { rollup: Dashboard["propertyRollups"][number] | null; comparison: Dashboard["propertyComparisons"][number] | null; trend: Dashboard["trend"]; pulse: any; openCampaigns: ActionCampaignData[] } };
  audience: { status: string; error: string | null; data: { topPages: Dashboard["topPages"]; recentActivity: Dashboard["recentActivity"]; referrers: Dashboard["referrerSummary"]; devices: Dashboard["deviceSummary"]; events: Dashboard["eventSummary"] } };
  visibility: { status: string; error: string | null; data: { pages: Dashboard["latestCrawledPages"]; findings: Dashboard["seoFindings"]; rankings: Dashboard["rankVisibility"]; authority: Dashboard["authorityScores"]; vitals: Intelligence["vitals"] } };
  improve: { status: string; error: string | null; data: { campaigns: ActionCampaignData[]; opportunities: Dashboard["opportunityPages"]; errors: Intelligence["errors"] } };
  outcomes: { status: string; error: string | null; data: { goals: Intelligence["goals"]; funnels: FunnelData[]; ledger: LedgerEvent[]; conversions: number } };
};
type OverviewBriefData = {
  generatedAt: string; range: { days: number; label: string };
  portfolio: { pageviews: number; visitors: number; activeProperties: number; properties: number; pageviewsComparison: ComparisonQuality; visitorsComparison: ComparisonQuality };
  wins: OverviewEvent[]; regressions: OverviewEvent[]; pending: OverviewEvent[];
  campaigns: ActionCampaignData[];
  qualityExceptions: Array<{ propertyId: string; propertyName: string; source: string; state: DataQualitySignal["state"]; label: string; explanation: string; observedAt: string | null; ageMinutes: number | null }>;
  setupHealth: Dashboard["dataQuality"]["counts"];
};
type OverviewEvent = { id: string; propertyId: string; propertyName: string; source: string; title: string; occurredAt: string; confidence: "low" | "medium" | "high"; sampleSize: number; direction: "win" | "regression" | null; metric: string | null; metricLabel: string | null; change: number; wording: string };
const views: Array<{ id: View; label: string; icon: typeof IconRadar }> = [
  { id: "overview", label: "Overview", icon: IconRadar },
  { id: "actions", label: "Actions", icon: IconTargetArrow },
  { id: "traffic", label: "Traffic", icon: IconChartAreaLine },
  { id: "content", label: "Content", icon: IconFileAnalytics },
  { id: "seo", label: "Search & links", icon: IconWorldSearch },
  { id: "technical", label: "Site audit", icon: IconBrandSpeedtest },
  { id: "outcomes", label: "Outcomes", icon: IconTrophy },
  { id: "ledger", label: "Ledger", icon: IconHistory },
  { id: "pulse", label: "Public Pulse", icon: IconEye },
  { id: "intelligence", label: "Intelligence", icon: IconSparkles },
];

const viewCopy: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
  overview: { eyebrow: "Overview", title: "See what earns attention.", subtitle: "Fix what quietly leaks it." },
  actions: { eyebrow: "Actions", title: "Know exactly what to fix next.", subtitle: "Ranked by impact, confidence, and effort." },
  traffic: { eyebrow: "Traffic", title: "Where your attention comes from.", subtitle: "Pageviews, visitors, and referrers, first-party." },
  content: { eyebrow: "Content", title: "See which pages are working.", subtitle: "Opportunities and page-level detail, ranked." },
  seo: { eyebrow: "Search & links", title: "Rankings, clicks, and backlinks.", subtitle: "Search Console signals and the public link graph." },
  technical: { eyebrow: "Site audit", title: "Catch what's quietly broken.", subtitle: "Crawl findings and technical health, by severity." },
  outcomes: { eyebrow: "Outcomes", title: "Turn traffic into results.", subtitle: "Goals, funnels, weekly briefs, and data exports." },
  ledger: { eyebrow: "Ledger", title: "Every change, and what happened next.", subtitle: "Commits and edits lined up against real outcomes." },
  pulse: { eyebrow: "Public Pulse", title: "Share proof, not private analytics.", subtitle: "Opt-in, sanitized metrics you can publish publicly." },
  intelligence: { eyebrow: "Intelligence", title: "Deeper signals, every property.", subtitle: "Sessions, journeys, vitals, errors, and the link graph." },
};

const n = (value: number) => new Intl.NumberFormat("en-US", { notation: value > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value || 0);
const pct = (value: number) => `${Math.round((value || 0) * 100)}%`;
const trend = (quality: ComparisonQuality) => quality.displayPercent && quality.change !== null ? `${quality.change > 0 ? "+" : ""}${Math.round(quality.change * 100)}% vs previous period` : quality.explanation;
const when = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value.endsWith("Z") ? value : `${value}Z`)) : "No data";
const host = (value: string) => { try { return new URL(value).hostname; } catch { return value; } };

export default function App() {
  return <ThemeProvider defaultTheme="dark" storageKey="zoanalytics-theme"><DashboardApp /></ThemeProvider>;
}

function DashboardApp() {
  const initialParams = new URLSearchParams(window.location.search);
  const [data, setData] = useState<Dashboard | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [actionCampaigns, setActionCampaigns] = useState<ActionCampaignData[]>([]);
  const [funnels, setFunnels] = useState<FunnelData[]>([]);
  const [briefs, setBriefs] = useState<BriefData[]>([]);
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [overviewBrief, setOverviewBrief] = useState<OverviewBriefData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [property, setProperty] = useState(initialParams.get("property") ?? "all");
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>((initialParams.get("section") as WorkspaceSection) || "summary");
  const [workspace, setWorkspace] = useState<PropertyWorkspaceData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [summaryResponse, intelligenceResponse, setupResponse, campaignsResponse, funnelsResponse, briefsResponse, ledgerResponse, overviewResponse] = await Promise.all([
        fetch(`/api/analytics/summary?days=${days}`, { headers: { Accept: "application/json" } }),
        fetch("/api/analytics/intelligence", { headers: { Accept: "application/json" } }),
        fetch("/api/analytics/setup", { headers: { Accept: "application/json" } }),
        fetch("/api/analytics/action-campaigns", { headers: { Accept: "application/json" } }),
        fetch("/api/analytics/funnels", { headers: { Accept: "application/json" } }),
        fetch("/api/analytics/briefs", { headers: { Accept: "application/json" } }),
        fetch("/api/analytics/ledger", { headers: { Accept: "application/json" } }),
        fetch(`/api/analytics/overview?days=${days}`, { headers: { Accept: "application/json" } }),
      ]);
      if (![summaryResponse, intelligenceResponse, setupResponse, campaignsResponse, funnelsResponse, briefsResponse, ledgerResponse, overviewResponse].every((response) => response.ok)) throw new Error("One or more dashboard signals could not be read");
      const [summary, signals, setupState, campaignState, funnelState, briefState, ledgerState, overviewState] = await Promise.all([summaryResponse.json(), intelligenceResponse.json(), setupResponse.json(), campaignsResponse.json(), funnelsResponse.json(), briefsResponse.json(), ledgerResponse.json(), overviewResponse.json()]);
      setData(summary); setIntelligence(signals); setSetup(setupState); setActionCampaigns(campaignState.campaigns); setFunnels(funnelState.funnels); setBriefs(briefState.briefs); setLedger(ledgerState.events);
      setOverviewBrief(overviewState);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Dashboard request failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [days]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (property === "all") { params.delete("property"); params.delete("section"); }
    else { params.set("property", property); params.set("section", workspaceSection); }
    history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }, [property, workspaceSection]);
  useEffect(() => {
    if (property === "all") { setWorkspace(null); return; }
    let cancelled = false;
    setWorkspace(null);
    fetch(`/api/analytics/properties/${encodeURIComponent(property)}/workspace?days=${days}`, { headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error("Property workspace could not be read"); return response.json(); })
      .then((value) => { if (!cancelled) setWorkspace(value); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Property workspace failed"); });
    return () => { cancelled = true; };
  }, [property, days, actionCampaigns.length, ledger.length]);

  function openProperty(id: string) { setProperty(id); setWorkspaceSection("summary"); }
  function closeProperty() { setProperty("all"); setWorkspace(null); setView("overview"); }
  function navigate(id: View) { setProperty("all"); setWorkspace(null); setView(id); }

  async function crawl() {
    setCrawling(true); setError("");
    try {
      const response = await fetch("/api/analytics/crawl", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ propertyId: property === "all" ? undefined : property, maxPages: 20 }) });
      if (!response.ok) throw new Error(`Crawl failed (${response.status})`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Crawl failed"); }
    finally { setCrawling(false); }
  }

  if (!data) return <LoadingState error={error} retry={load} />;
  const filtered = filterDashboard(data, property);
  const name = property === "all" ? "All properties" : data.properties.find((item) => item.id === property)?.name ?? property;
  const score = healthScore(filtered);

  return (
    <main id="main" className="min-h-screen bg-[#090d0f] text-[#eef5f3] selection:bg-[#58e0c0]/30">
      <a href="#dashboard-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:text-black">Skip to dashboard</a>
      <div className="fixed inset-0 pointer-events-none za-grid" />
      <div className="relative mx-auto max-w-[1500px] px-3 pb-16 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-30 -mx-3 border-b border-white/[.07] bg-[#090d0f]/90 px-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-8 place-items-center rounded-[9px] bg-[#58e0c0] text-[#07110e]"><IconRadar size={19} stroke={2.2} /></div>
              <div><p className="text-sm font-semibold tracking-[-.02em]">ZoAnalytics</p><p className="hidden text-[10px] text-[#73827e] sm:block">PRIVATE INTELLIGENCE</p></div>
            </div>
            <nav className="za-scrollbar-none hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex" aria-label="Dashboard views">
              {views.map(({ id, label, icon: Icon }) => <NavButton key={id} active={property === "all" && view === id} onClick={() => navigate(id)} icon={Icon} label={label} />)}
            </nav>
            <div className="flex items-center gap-2">
              <button onClick={() => void load()} disabled={loading} className="za-icon-button" aria-label="Refresh dashboard"><IconRefresh size={17} className={loading ? "animate-spin" : ""} /></button>
              <button onClick={() => void crawl()} disabled={crawling} className="za-primary-button"><IconBolt size={16} className={crawling ? "animate-pulse" : ""} /><span>{crawling ? "Crawling" : "Run audit"}</span></button>
            </div>
          </div>
          <nav className="za-scrollbar-none -mx-1 flex gap-1 overflow-x-auto pb-2 lg:hidden" aria-label="Dashboard views">
            {views.map(({ id, label, icon: Icon }) => <NavButton key={id} active={property === "all" && view === id} onClick={() => navigate(id)} icon={Icon} label={label} />)}
          </nav>
        </header>

        <section className="flex flex-col gap-5 pb-7 pt-8 sm:pt-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-[#58e0c0]"><span className="size-1.5 rounded-full bg-[#58e0c0] shadow-[0_0_12px_#58e0c0]" />{property === "all" ? viewCopy[view].eyebrow : "Property workspace"}</div>
            <h1 className="max-w-4xl text-[2.35rem] font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl lg:text-[4.6rem]">{property === "all" ? viewCopy[view].title : name}<br/><span className="text-[#7f8e8a]">{property === "all" ? viewCopy[view].subtitle : "One property. Every signal in context."}</span></h1>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#65736f]">Scope & period</span>
            <div className="za-scrollbar-none flex max-w-full gap-2 overflow-x-auto pb-1">
              <div className="relative"><IconFilter className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#71807c]" size={15}/><select aria-label="Property scope" value={property} onChange={(event) => event.target.value === "all" ? closeProperty() : openProperty(event.target.value)} className="h-10 min-w-48 appearance-none rounded-lg border border-white/10 bg-white/[.045] pl-9 pr-9 text-sm font-medium text-[#dbe6e3] outline-none transition focus:border-[#58e0c0]/60 focus:ring-2 focus:ring-[#58e0c0]/15"><option value="all">All properties</option>{data.properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><IconChevronRight className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-[#71807c]" size={14}/></div>
              <div className="flex rounded-lg border border-white/10 bg-white/[.025] p-1">{[7,14,30,90].map((value) => <button key={value} onClick={() => setDays(value)} className={`rounded-md px-2.5 text-xs font-semibold tabular-nums transition ${days === value ? "bg-[#58e0c0] text-[#07110e]" : "text-[#71807c] hover:text-white"}`}>{value}d</button>)}</div>
            </div>
          </div>
        </section>

        {error && <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-[#ff796f]/25 bg-[#ff796f]/8 px-4 py-3 text-sm text-[#ffc2bd]"><span>{error}</span><button onClick={() => setError("")} className="text-xs font-semibold">Dismiss</button></div>}

        <div id="dashboard-content">
          {property !== "all" ? workspace ? <PropertyWorkspace workspace={workspace} dashboard={filtered} section={workspaceSection} onSection={setWorkspaceSection} onBack={closeProperty} onAudit={crawl} /> : <div className="grid min-h-64 place-items-center"><div className="size-8 animate-spin rounded-full border-2 border-white/10 border-t-[#58e0c0]" /></div> : <>
          {view !== "pulse" && <>
            {setup && !setup.complete && <SetupGuide setup={setup} onRefresh={load} onAudit={crawl} />}
            <section className="mb-6 grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08] sm:grid-cols-2 xl:grid-cols-5">
              <Kpi label="Portfolio health" value={`${score}`} suffix="/100" note={`${filtered.totals.tracked}/${filtered.totals.properties} tracked · ${filtered.totals.averageSeoScore || 0} audit`} icon={IconSparkles} accent />
              <Kpi label="Pageviews" value={n(filtered.totals.pageviews)} note={trend(filtered.comparison.pageviewsQuality)} icon={IconActivity} state={filtered.comparison.pageviewsQuality.state} />
              <Kpi label="Visitors" value={n(filtered.totals.visitors)} note={trend(filtered.comparison.visitorsQuality)} icon={IconSearch} state={filtered.comparison.visitorsQuality.state} />
              <Kpi label="Crawled pages" value={n(filtered.totals.crawledPages)} note={`${filtered.totals.averageSeoScore || 0} average SEO score`} icon={IconSeo} />
              <Kpi label="Observed links" value={n(filtered.totals.backlinks)} note={`${n(filtered.totals.referringDomains)} referring domains`} icon={IconLink} />
            </section>
            <SourceStrip data={filtered} />
          </>}

          {view === "overview" && <Overview data={filtered} brief={overviewBrief} name={name} onSelectProperty={openProperty} onOpenActions={() => navigate("actions")} />}
          {view === "actions" && <ActionCenter campaigns={actionCampaigns.filter((item) => property === "all" || item.propertyId === property)} properties={data.properties} onRefresh={load} />}
          {view === "traffic" && <Traffic data={filtered} />}
          {view === "content" && <Content data={filtered} />}
          {view === "seo" && <SearchLinks data={filtered} />}
          {view === "technical" && <Technical data={filtered} />}
          {view === "outcomes" && intelligence && <Outcomes properties={filtered.properties} goals={filterIntelligence(intelligence, property).goals} funnels={funnels.filter((item) => property === "all" || item.propertyId === property)} briefs={briefs} onRefresh={load} />}
          {view === "ledger" && <Ledger events={ledger.filter((item) => property === "all" || item.propertyId === property)} properties={data.properties} onRefresh={load} />}
          {view === "pulse" && <PulseSettings />}
          {view === "intelligence" && intelligence && <IntelligenceView data={filtered} intelligence={filterIntelligence(intelligence, property)} reload={load} />}
          </>}
        </div>
      </div>
    </main>
  );
}

function PropertyWorkspace({ workspace, dashboard, section, onSection, onBack, onAudit }: { workspace: PropertyWorkspaceData; dashboard: Dashboard; section: WorkspaceSection; onSection: (section: WorkspaceSection) => void; onBack: () => void; onAudit: () => Promise<void> }) {
  const property = workspace.property;
  const rollup = workspace.summary.data.rollup;
  const tracker = workspace.freshness.tracker as DataQualitySignal | null;
  const crawler = workspace.freshness.crawler as DataQualitySignal | null;
  const tabs: Array<{ id: WorkspaceSection; label: string }> = [
    { id: "summary", label: "Summary" }, { id: "audience", label: "Audience" }, { id: "visibility", label: "Visibility" }, { id: "improve", label: "Improve" }, { id: "outcomes", label: "Outcomes" },
  ];
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-[#58e0c0]/20 bg-[#0d1516]">
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><button onClick={onBack} className="mb-4 flex items-center gap-2 text-xs font-semibold text-[#71807c] transition hover:text-[#58e0c0]"><IconArrowLeft size={15}/>Portfolio overview</button><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#58e0c0]">Property workspace</span>{tracker && <DataStateBadge signal={tracker} compact />}</div><h2 className="mt-3 text-3xl font-semibold tracking-[-.045em] sm:text-5xl">{property.name}</h2><a href={property.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-[#71807c] hover:text-[#70d9b9]">{property.url}<IconExternalLink size={13}/></a></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => void onAudit()} className="za-primary-button"><IconBolt size={15}/>Run property audit</button>{workspace.summary.data.pulse?.enabled && <span className="flex items-center border border-[#58e0c0]/20 px-3 text-[10px] font-semibold uppercase tracking-wider text-[#70d9b9]">Published in Pulse</span>}</div>
      </div>
      <div className="grid gap-px border-t border-white/[.07] bg-white/[.07] sm:grid-cols-2 lg:grid-cols-4"><WorkspaceSignal label="Tracking" signal={tracker}/><WorkspaceSignal label="Last crawl" signal={crawler}/><WorkspaceSignal label="Rankings" signal={workspace.freshness.rankings}/><WorkspaceSignal label="Links" signal={workspace.freshness.links}/></div>
      <nav className="za-scrollbar-none flex overflow-x-auto border-t border-white/[.07] px-3 pt-2" aria-label="Property workspace sections">{tabs.map((tab) => <button key={tab.id} onClick={() => onSection(tab.id)} className={`shrink-0 border-b-2 px-4 py-3 text-xs font-semibold transition ${section === tab.id ? "border-[#58e0c0] text-white" : "border-transparent text-[#71807c] hover:text-[#cbd6d3]"}`}>{tab.label}</button>)}</nav>
    </section>
    {section === "summary" && <><section className="grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08] sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Pageviews" value={n(rollup?.pageviews ?? 0)} note={workspace.summary.data.comparison?.pageviewsQuality.explanation ?? "No comparison available"} icon={IconActivity}/><Kpi label="Visitors" value={n(rollup?.visitors ?? 0)} note={workspace.summary.data.comparison?.visitorsQuality.explanation ?? "No comparison available"} icon={IconSearch}/><Kpi label="Audit score" value={rollup?.crawledPages ? String(rollup.averageSeoScore) : "—"} note={rollup?.crawledPages ? `${rollup.crawledPages} pages crawled` : "Not crawled"} icon={IconSeo}/><Kpi label="Open campaigns" value={String(workspace.summary.data.openCampaigns.length)} note={`${rollup?.totalFindings ?? 0} page-level findings`} icon={IconTargetArrow}/></section><section className="grid gap-4 xl:grid-cols-[1.4fr_.6fr]"><Panel title="Attention over time" eyebrow={`${workspace.days}-day property trend`} icon={IconChartAreaLine}><TrafficChart data={workspace.summary.data.trend}/></Panel><Panel title="Top work" eyebrow="Grouped campaigns" icon={IconTargetArrow}>{workspace.summary.data.openCampaigns.length ? <div className="space-y-2">{workspace.summary.data.openCampaigns.slice(0,5).map((campaign) => <div key={campaign.key} className="rounded-lg bg-white/[.025] p-3"><p className="text-sm font-medium">{campaign.title}</p><p className="mt-1 text-[10px] text-[#65736f]">{campaign.affectedPages} pages · {campaign.fixability.replace("-", " ")}</p></div>)}</div> : <Empty icon={IconCheck} title="No open campaigns" text="This property has no open grouped work."/>}</Panel></section></>}
    {section === "audience" && <><section className="grid gap-4 lg:grid-cols-3"><Panel title="Top pages" eyebrow={`${workspace.days}-day traffic`} icon={IconFileAnalytics}><RankedRows rows={workspace.audience.data.topPages.map((row) => ({ title: row.path, label: property.name, value: row.views, suffix: `${row.visitors} visitors` }))}/></Panel><Panel title="Acquisition" eyebrow="Observed referrers" icon={IconExternalLink}><RankedRows rows={workspace.audience.data.referrers.map((row) => ({ title: row.source, label: `${row.pages} pages`, value: row.visits, suffix: "visits" }))}/></Panel><Panel title="Devices" eyebrow="Visitor mix" icon={IconDeviceDesktopAnalytics}><MixBars data={dashboard}/></Panel></section><Panel title="Recent activity" eyebrow="Latest first-party signals" icon={IconActivity}><ActivityFeed data={dashboard} expanded/></Panel></>}
    {section === "visibility" && <><section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]"><Panel title="Audit health" eyebrow={`${rollup?.crawledPages ?? 0} pages inspected`} icon={IconBrandSpeedtest}>{rollup?.crawledPages ? <div className="grid place-items-center py-4"><ScoreRing score={rollup.averageSeoScore}/></div> : <Empty icon={IconBrandSpeedtest} title="Not crawled" text="Run the property audit to create a technical baseline."/>}</Panel><Panel title="Core Web Vitals" eyebrow="Real-user p75" icon={IconHeartbeat}>{workspace.visibility.data.vitals.length ? <div className="grid gap-px overflow-hidden rounded-lg bg-white/[.07] sm:grid-cols-3">{workspace.visibility.data.vitals.map((item) => <div key={item.metric} className="bg-[#0d1315] p-4"><p className="text-xs text-[#71807c]">{item.metric}</p><p className="mt-2 text-2xl font-semibold">{item.samples >= 5 ? item.p75 : "—"}</p><p className="mt-1 text-[10px] text-[#61706c]">{item.samples} samples</p></div>)}</div> : <Empty icon={IconHeartbeat} title="Collecting field data" text="Vitals appear after real visitors provide samples."/>}</Panel></section><PageAuditTable data={dashboard}/></>}
    {section === "improve" && <><ActionCenter campaigns={workspace.improve.data.campaigns} properties={[property]} onRefresh={async () => { window.location.reload(); }}/><Panel title="Content opportunities" eyebrow="Highest potential first" icon={IconSparkles}><OpportunityList data={dashboard} expanded/></Panel></>}
    {section === "outcomes" && <><section className="grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08] sm:grid-cols-3"><Kpi label="Conversions" value={n(workspace.outcomes.data.conversions)} note={`${workspace.outcomes.data.goals.length} active goals`} icon={IconTargetArrow}/><Kpi label="Funnels" value={n(workspace.outcomes.data.funnels.length)} note="Configured journeys" icon={IconRoute}/><Kpi label="Recorded changes" value={n(workspace.outcomes.data.ledger.length)} note="Ledger events in 180 days" icon={IconHistory}/></section><Ledger events={workspace.outcomes.data.ledger} properties={[property]} onRefresh={async () => { window.location.reload(); }}/></>}
  </div>;
}

function WorkspaceSignal({ label, signal }: { label: string; signal: DataQualitySignal | null }) {
  return <div className="bg-[#0b1113] p-4"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#60706b]">{label}</p><div className="mt-2">{signal ? <FreshnessLabel signal={signal}/> : <span className="text-xs text-[#71807c]">Unavailable</span>}</div><p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#61706c]">{signal?.explanation ?? "No source state is available."}</p></div>;
}

function Overview({ data, brief, name, onSelectProperty, onOpenActions }: { data: Dashboard; brief: OverviewBriefData | null; name: string; onSelectProperty: (id: string) => void; onOpenActions: () => void }) {
  return <div className="space-y-4">
    <section className="grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08] sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Portfolio attention" value={n(brief?.portfolio.pageviews ?? data.totals.pageviews)} note={trend(brief?.portfolio.pageviewsComparison ?? data.comparison.pageviewsQuality)} icon={IconActivity} accent />
      <Kpi label="Visitors" value={n(brief?.portfolio.visitors ?? data.totals.visitors)} note={trend(brief?.portfolio.visitorsComparison ?? data.comparison.visitorsQuality)} icon={IconSearch} />
      <Kpi label="Properties earning attention" value={n(brief?.portfolio.activeProperties ?? data.totals.activeProperties)} note={`of ${brief?.portfolio.properties ?? data.totals.properties} properties`} icon={IconGlobe} />
      <Kpi label="Decision-ready changes" value={n((brief?.wins.length ?? 0) + (brief?.regressions.length ?? 0))} note={`${brief?.pending.length ?? 0} still gathering evidence`} icon={IconHistory} />
    </section>
    <DataQualitySummary data={data} />
    <section className="grid gap-4 xl:grid-cols-2">
      <OutcomeBrief title="Recent wins" eyebrow="Observed after changes · confidence gated" events={brief?.wins ?? []} tone="win" onSelectProperty={onSelectProperty} />
      <OutcomeBrief title="Recent regressions" eyebrow="Observed after changes · confidence gated" events={brief?.regressions ?? []} tone="regression" onSelectProperty={onSelectProperty} />
    </section>
    <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <Panel title="Top work campaigns" eyebrow="The next three decisions" icon={IconTargetArrow}><div className="space-y-2">{(brief?.campaigns ?? []).map((campaign) => <button key={campaign.key} onClick={onOpenActions} className="flex w-full items-center justify-between gap-4 rounded-lg border border-white/[.06] bg-white/[.025] p-3 text-left transition hover:border-[#58e0c0]/25 hover:bg-[#58e0c0]/[.035]"><div><p className="text-sm font-medium text-[#dce6e3]">{campaign.title}</p><p className="mt-1 text-[11px] text-[#71807c]">{propertyName(data.properties, campaign.propertyId)} · {campaign.affectedPages} affected · {campaign.fixability.replace("-", " ")}</p></div><IconChevronRight size={16} className="shrink-0 text-[#58e0c0]" /></button>)}{!brief?.campaigns.length && <Empty icon={IconCheck} title="No open campaigns" text="The portfolio has no open grouped work campaigns." />}</div></Panel>
      <Panel title="Changes gathering evidence" eyebrow="Not yet labeled a win or regression" icon={IconHistory}><div className="space-y-2">{(brief?.pending ?? []).slice(0, 4).map((event) => <button key={event.id} onClick={() => onSelectProperty(event.propertyId)} className="w-full rounded-lg border border-white/[.06] bg-white/[.02] p-3 text-left"><p className="text-sm text-[#dce6e3]">{event.title}</p><p className="mt-1 text-[10px] text-[#71807c]">{event.propertyName} · {event.sampleSize}/20 observations · {relativeTime(event.occurredAt)}</p></button>)}{!brief?.pending.length && <Empty icon={IconHistory} title="No pending changes" text="New changes will wait here until enough post-change evidence exists." />}</div></Panel>
    </section>
    <Panel title="Property portfolio" eyebrow="Traffic, health and recency" icon={IconGlobe}><PropertyTable data={data} onSelect={onSelectProperty} /></Panel>
    <Panel title="Supporting traffic trend" eyebrow={`${name} · ${data.range.label}`} icon={IconChartAreaLine}><TrafficChart data={data.trend} /></Panel>
  </div>;
}

function OutcomeBrief({ title, eyebrow, events, tone, onSelectProperty }: { title: string; eyebrow: string; events: OverviewEvent[]; tone: "win" | "regression"; onSelectProperty: (id: string) => void }) {
  const Icon = tone === "win" ? IconTrophy : IconAlertTriangle;
  return <Panel title={title} eyebrow={eyebrow} icon={Icon}><div className="space-y-2">{events.map((event) => <button key={event.id} onClick={() => onSelectProperty(event.propertyId)} className="w-full rounded-lg border border-white/[.06] bg-white/[.02] p-3 text-left transition hover:border-white/[.12]"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#dce6e3]">{event.title}</p><p className="mt-1 text-[11px] text-[#71807c]">{event.propertyName} · {event.wording}</p></div><span className={`shrink-0 text-sm font-semibold tabular-nums ${tone === "win" ? "text-[#70d9b9]" : "text-[#ff8178]"}`}>{event.change > 0 ? "+" : ""}{event.change}</span></div><p className="mt-2 text-[9px] uppercase tracking-wider text-[#596762]">{event.confidence} confidence · {event.sampleSize} observations · followed this change</p></button>)}{!events.length && <Empty icon={Icon} title={tone === "win" ? "No decision-ready wins yet" : "No decision-ready regressions"} text={tone === "win" ? "Changes appear here only after they meet the confidence and sample thresholds." : "No recent change meets the evidence threshold for a regression."} />}</div></Panel>;
}

function DataQualitySummary({ data }: { data: Dashboard }) {
  const exceptions = [
    { label: "Tracker not verified", count: data.dataQuality.counts.unverified, state: "unverified" as const },
    { label: "Verified, no visits", count: data.dataQuality.counts.missingTraffic, state: "missing" as const },
    { label: "Traffic stale", count: data.dataQuality.counts.staleTraffic, state: "stale" as const },
    { label: "Sources stale", count: data.dataQuality.counts.staleSources, state: "stale" as const },
  ].filter((item) => item.count > 0);
  const reliable = !exceptions.length;
  const signal: DataQualitySignal = reliable
    ? { state: "current", label: "Data current", explanation: "No portfolio-level data quality exceptions were detected.", observedAt: data.freshness.traffic, ageMinutes: null }
    : { state: exceptions.some((item) => item.state === "unverified") ? "unverified" : "stale", label: `${exceptions.reduce((sum, item) => sum + item.count, 0)} exceptions`, explanation: "Some metrics need verification, a fresh signal, or a scheduled refresh.", observedAt: null, ageMinutes: null };
  return <section className="flex flex-col gap-3 rounded-xl border border-white/[.08] bg-[#0d1315] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-3"><DataStateBadge signal={signal} /><div><p className="text-sm font-medium text-[#dce6e3]">Data quality</p><p className="mt-0.5 text-[11px] text-[#71807c]">Trust states reflect tracker verification, source freshness, and sample size.</p></div></div>
    <div className="flex flex-wrap gap-x-4 gap-y-1">{reliable ? <span className="text-xs text-[#70d9b9]">All active sources are within their expected windows.</span> : exceptions.map((item) => <span key={item.label} className="text-xs text-[#9caaa6]"><strong className="mr-1 tabular-nums text-[#eef5f3]">{item.count}</strong>{item.label}</span>)}</div>
  </section>;
}

function Traffic({ data }: { data: Dashboard }) {
  return <div className="space-y-4"><Panel title="Traffic performance" eyebrow="First-party · last 14 days" icon={IconChartAreaLine}><TrafficChart data={data.trend} tall /></Panel><section className="grid gap-4 lg:grid-cols-3"><Panel title="Top pages" eyebrow="By pageviews" icon={IconFileAnalytics}><RankedRows rows={data.topPages.map((row) => ({ title: row.path, label: propertyName(data.properties, row.propertyId), value: row.views, suffix: `${row.visitors} visitors` }))}/></Panel><Panel title="Acquisition sources" eyebrow="Direct and referrals" icon={IconExternalLink}><RankedRows rows={data.referrerSummary.map((row) => ({ title: row.source, label: propertyName(data.properties, row.propertyId), value: row.visits, suffix: `${row.pages} pages` }))}/></Panel><Panel title="Custom events" eyebrow="Intent and conversions" icon={IconClick}>{data.eventSummary.length ? <RankedRows rows={data.eventSummary.map((row) => ({ title: row.name, label: `${propertyName(data.properties, row.propertyId)} · ${row.path ?? "/"}`, value: row.count, suffix: "events" }))}/> : <Empty icon={IconClick} title="No conversion events yet" text="Instrument signups, downloads and key clicks with the tracker event API."/>}</Panel></section><Panel title="Recent sessions" eyebrow="Latest first-party activity" icon={IconActivity}><ActivityFeed data={data} expanded/></Panel></div>;
}

function Content({ data }: { data: Dashboard }) {
  return <div className="space-y-4"><section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><Panel title="Opportunity map" eyebrow="Traffic × content quality" icon={IconSparkles}><OpportunityList data={data} expanded/></Panel><Panel title="Keyword themes" eyebrow="Inferred from your pages" icon={IconSearch}><KeywordCloud data={data}/></Panel></section><PageExplorer pages={data.latestCrawledPages} properties={data.properties}/></div>;
}

function SearchLinks({ data }: { data: Dashboard }) {
  return <div className="space-y-4">
    <div className="rounded-xl border border-[#58e0c0]/15 bg-[#58e0c0]/[.04] p-4 text-sm leading-6 text-[#a9c4bc]"><span className="font-semibold text-[#70d9b9]">Independent data model:</span> rankings are observed from public results, exact referrals come from the first-party tracker, and the wider link graph comes from Common Crawl. Zo Authority is a transparent 0–100 logarithmic score based on unique referring hosts.</div>
    {data.authorityScores.length > 0 && <section className="grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08] sm:grid-cols-2 xl:grid-cols-5">{data.authorityScores.map((row) => {
      const comparison = data.domainRatings.find((item) => item.propertyId === row.propertyId);
      return <article key={row.propertyId} className="bg-[#0d1315] p-4"><p className="truncate text-[10px] font-semibold uppercase tracking-[.14em] text-[#71807c]">{propertyName(data.properties, row.propertyId)}</p><p className="mt-3 text-3xl font-semibold tabular-nums">{row.indexedHosts ? row.authorityScore : "—"}{row.indexedHosts > 0 && <span className="ml-1 text-sm font-medium text-[#71807c]">ZA</span>}</p><p className="mt-1 text-[10px] text-[#61706c]">{row.indexedHosts ? `${row.referringHosts} referring hosts` : "Not indexed in this release"} · {row.releaseId.replace("cc-main-", "")}</p>{comparison && <p className="mt-2 text-[9px] uppercase tracking-wider text-[#52605d]">Ahrefs comparison: DR {comparison.domainRating}</p>}</article>;
    })}</section>}
    <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
      <Panel title="Common Crawl link graph" eyebrow="Independent host-level index" icon={IconGitBranch}>{data.commonCrawlLinks.length ? <RankedRows rows={data.commonCrawlLinks.map((row) => ({ title: row.sourceHost, label: propertyName(data.properties, row.propertyId), value: row.linkEdges, suffix: "target hosts" }))}/> : <Empty icon={IconGitBranch} title={data.authorityScores.length ? "No tracked hosts indexed yet" : "Awaiting the first graph sync"} text={data.authorityScores.length ? "The latest release predates these public surfaces. A later release will be picked up automatically." : "The Common Crawl release will reveal referring hosts beyond traffic that has already reached you."}/>}</Panel>
      <Panel title="Observed referrals" eyebrow="Links that sent real traffic" icon={IconLink}>{data.referrerDomains.length ? <RankedRows rows={data.referrerDomains.map((row) => ({ title: row.referrer, label: propertyName(data.properties, row.propertyId), value: row.visits, suffix: "visits" }))}/> : <Empty icon={IconLink} title="No referrals observed" text="External referrers appear here as they send real traffic."/>}</Panel>
    </section>
    <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><Panel title={data.totals.impressions ? "Google search visibility" : "Observed public rankings"} eyebrow={data.totals.impressions ? "Google-reported clicks, impressions and position" : "Independent checks · not Google impression data"} icon={IconWorldSearch}>{data.totals.impressions ? <><SearchChart data={data}/><RankedRows rows={data.searchPages.map((row) => ({ title: row.page, label: propertyName(data.properties, row.propertyId), value: row.clicks, suffix: `${row.impressions} impr · pos ${row.position}` }))}/></> : <ObservedRanks rows={data.rankVisibility} properties={data.properties}/>}</Panel><Panel title="Keyword landscape" eyebrow="Locally inferred topics and relevance" icon={IconSearch}><KeywordCloud data={data}/></Panel></section>
  </div>;
}

function Technical({ data }: { data: Dashboard }) {
  const issues = [{ label: "Broken pages", value: data.totals.brokenPages }, { label: "Missing titles", value: data.totals.missingTitles }, { label: "Missing descriptions", value: data.totals.missingDescriptions }, { label: "Thin pages", value: data.totals.thinPages }, { label: "Missing alt text", value: data.totals.imagesMissingAlt }];
  return <div className="space-y-4"><section className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]"><Panel title="Audit health" eyebrow={`${data.totals.crawledPages} pages inspected`} icon={IconBrandSpeedtest}><div className="grid place-items-center py-6"><ScoreRing score={data.totals.averageSeoScore}/><div className="mt-6 grid w-full grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/[.07] sm:grid-cols-3">{issues.map((item) => <div key={item.label} className="bg-[#0d1315] p-3"><p className="text-xl font-semibold tabular-nums">{item.value}</p><p className="mt-1 text-xs text-[#71807c]">{item.label}</p></div>)}</div></div></Panel><Panel title="Issue explorer" eyebrow="Ordered by severity" icon={IconListCheck}><div className="space-y-1">{data.seoFindings.map((item, index) => <FindingRow key={`${item.pageUrl}-${index}`} finding={item} properties={data.properties}/>)}</div></Panel></section><Panel title="Page performance and SEO" eyebrow="Latest crawler measurements" icon={IconBrandSpeedtest}><PageAuditTable data={data}/></Panel></div>;
}

function SourceStrip({ data }: { data: Dashboard }) {
  const items = [
    { label: "Traffic", source: data.sources.traffic.label, quality: data.dataQuality.sources.traffic },
    { label: "Audit", source: data.sources.crawler.label, quality: data.dataQuality.sources.crawler },
    { label: "Rankings", source: data.sources.rankings.label, quality: data.dataQuality.sources.ranks },
    { label: "Links", source: data.sources.backlinks.label, quality: data.dataQuality.sources.backlinks },
  ];
  return <section className="mb-4 grid gap-px overflow-hidden rounded-lg border border-white/[.07] bg-white/[.07] sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 bg-[#0b1113] px-3 py-2.5"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#60706b]">{item.label}</p><p className="mt-1 text-xs text-[#aab7b3]">{item.source}</p></div><FreshnessLabel signal={item.quality} /></div>)}</section>;
}

function PropertyBrief({ data, property }: { data: Dashboard; property: Property }) {
  const rollup = data.propertyRollups[0];
  if (!rollup) return null;
  return <section className="mb-4 overflow-hidden rounded-xl border border-[#58e0c0]/15 bg-[#58e0c0]/[.035] p-4 sm:p-5"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="border border-[#58e0c0]/25 px-2 py-1 text-[9px] font-semibold uppercase tracking-[.14em] text-[#70d9b9]">Property detail</span><span className="text-[10px] uppercase tracking-wider text-[#65736f]">{property.kind} · {property.status.replaceAll("-", " ")}</span></div><h2 className="mt-3 text-2xl font-semibold tracking-[-.035em] sm:text-3xl">{property.name}</h2><p className="mt-1 break-all text-xs text-[#71807c]">{property.url}</p></div><div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/[.08] sm:grid-cols-4"><MiniNumber label="Views" value={rollup.pageviews}/><MiniNumber label="Visitors" value={rollup.visitors}/><MiniNumber label="Audit score" value={rollup.averageSeoScore}/><MiniNumber label="Open issues" value={rollup.totalFindings}/></div></div></section>;
}

function IntelligenceView({ data, intelligence, reload }: { data: Dashboard; intelligence: Intelligence; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [operationMessage, setOperationMessage] = useState("");
  async function action(path: string) { setBusy(path); setOperationMessage(""); try { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" }); const result = await response.json().catch(() => ({})); if (!response.ok || result.available === false) throw new Error(result.error || `Request failed (${response.status})`); if (path.endsWith("/external")) setOperationMessage(`${result.discovered?.length ?? 0} external sites added or refreshed · ${result.repositoriesMatched ?? 0} GitHub repositories matched`); await reload(); } catch (error) { setOperationMessage(error instanceof Error ? error.message : "Operation failed"); } finally { setBusy(""); } }
  const sessionRows = intelligence.journeys.map((row) => ({ title: row.journey || "Single-page visit", label: `${propertyName(data.properties, row.propertyId)} · ${row.steps} steps`, value: row.steps, suffix: when(row.startedAt) }));
  return <div className="space-y-4">
    <section className="grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08] sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Sessions" value={n(intelligence.sessionTotals.sessions)} note={`${intelligence.sessionTotals.pagesPerSession} pages per session`} icon={IconRoute}/>
      <Kpi label="Avg. duration" value={`${n(intelligence.sessionTotals.averageDurationSeconds)}s`} note={`${pct(intelligence.sessionTotals.bounceRate)} single-page sessions`} icon={IconHeartbeat}/>
      <Kpi label="Open alerts" value={n(intelligence.alerts.length)} note={`${intelligence.errors.length} client error groups`} icon={IconBell}/>
      <Kpi label="Link edges" value={n(intelligence.linkGraph.length)} note={`${intelligence.orphanPages.length} orphan candidates`} icon={IconGitBranch}/>
    </section>
    <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
      <Panel title="Visitor journeys" eyebrow="Privacy-safe session paths" icon={IconRoute}>{sessionRows.length ? <RankedRows rows={sessionRows}/> : <Empty icon={IconRoute} title="New tracker data is needed" text="Sessions and journeys begin populating as upgraded tracker events arrive."/>}</Panel>
      <Panel title="Core Web Vitals" eyebrow="Real-user p75 performance" icon={IconHeartbeat}>{intelligence.vitals.length ? <div className="grid gap-px overflow-hidden rounded-lg bg-white/[.07] sm:grid-cols-2">{intelligence.vitals.map((item) => <div key={`${item.propertyId}-${item.metric}`} className="bg-[#0d1315] p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-[#93a19d]">{item.metric}</p><SampleWarning sample={item.samples} minimum={5} subject={`${item.metric} p75`} /></div><p className={`mt-3 text-3xl font-semibold tabular-nums ${item.samples < 5 ? "text-[#71807c]" : ""}`}>{item.samples < 5 ? "—" : item.p75}</p><p className="mt-1 text-[10px] text-[#61706c]">{propertyName(data.properties,item.propertyId)} · {item.samples < 5 ? "collecting observations" : `p75 · ${item.samples} samples${item.poorSamples ? ` · ${item.poorSamples} poor` : ""}`}</p></div>)}</div> : <Empty icon={IconHeartbeat} title="Collecting field performance" text="LCP, INP and CLS arrive automatically; TTFB remains a diagnostic."/>}</Panel>
    </section>
    <section className="grid gap-4 lg:grid-cols-3">
      <Panel title="Change intelligence" eyebrow="What changed between crawls" icon={IconHistory}>{intelligence.changes.length ? <div className="space-y-1">{intelligence.changes.slice(0,8).map((item,index) => <div key={`${item.pageUrl}-${index}`} className="rounded-lg px-2 py-3 hover:bg-white/[.03]"><p className="text-sm font-medium text-[#dce6e3]">{item.field} changed</p><p className="mt-1 truncate text-[10px] text-[#65736f]">{propertyName(data.properties,item.propertyId)} · {item.pageUrl}</p></div>)}</div> : <Empty icon={IconHistory} title="No crawl changes yet" text="The next crawl will compare titles, metadata, status and SEO scores."/>}</Panel>
      <Panel title="Rank watchlist" eyebrow="Observed positions" icon={IconTrophy}>{intelligence.ranks.length ? <RankedRows rows={intelligence.ranks.map((item) => ({ title: item.keyword, label: propertyName(data.properties,item.propertyId), value: item.observedPosition || 0, suffix: item.checkedAt ? when(item.checkedAt) : "awaiting check" }))}/> : <Empty icon={IconTrophy} title="No tracked keywords" text="Add keywords through the rank watchlist API to begin recording observed positions."/>}</Panel>
      <Panel title="Backlink ledger" eyebrow="Observed first-party referrers" icon={IconLink}>{intelligence.backlinks.length ? <RankedRows rows={intelligence.backlinks.map((item) => ({ title: host(item.sourceUrl), label: propertyName(data.properties,item.propertyId), value: item.visits, suffix: item.status }))}/> : <Empty icon={IconLink} title="No backlinks yet" text="External referrers are promoted into a persistent backlink ledger."/>}</Panel>
    </section>
    <ExternalSites sources={intelligence.externalSources} busy={busy === "/api/analytics/discover/external"} message={operationMessage} onSync={() => void action("/api/analytics/discover/external")} reload={reload}/>
    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <Panel title="Tracker coverage" eyebrow="Inventory, install status and snippets" icon={IconCode}><div className="space-y-1">{intelligence.trackerCoverage.map((item) => <TrackerRow key={item.propertyId} item={item} origin={intelligence.collectorOrigin} source={intelligence.externalSources.find((source) => source.propertyId === item.propertyId)}/>)}</div></Panel>
      <Panel title="Operations" eyebrow="Discovery, rankings and reporting" icon={IconBolt}><div className="grid gap-3 sm:grid-cols-2"><Operation title="Discover Zo properties" text="Scan published Zo Site configurations and add missing public surfaces." button="Run discovery" busy={busy === "/api/analytics/discover"} onClick={() => void action("/api/analytics/discover")}/><Operation title="Observe rankings" text="Check watched keywords against a public search result surface." button="Check ranks" busy={busy === "/api/analytics/maintenance/ranks"} onClick={() => void action("/api/analytics/maintenance/ranks")}/><Operation title="Discover backlinks" text="Expand the backlink ledger beyond observed first-party referrers." button="Find links" busy={busy === "/api/analytics/maintenance/backlinks"} onClick={() => void action("/api/analytics/maintenance/backlinks")}/><Operation title="Weekly intelligence brief" text="Snapshot traffic, changes, backlinks, journeys and open alerts." button="Generate report" busy={busy === "/api/analytics/reports/weekly"} onClick={() => void action("/api/analytics/reports/weekly")}/></div><div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-white/[.07]"><MiniNumber label="Reports" value={intelligence.reports.length}/><MiniNumber label="Competitors" value={intelligence.competitors.length}/><MiniNumber label="Goals" value={intelligence.goals.length}/></div></Panel>
    </section>
    {intelligence.alerts.length > 0 && <Panel title="Active alerts" eyebrow="Anomalies requiring review" icon={IconBell}><div className="space-y-1">{intelligence.alerts.map((item) => <div key={item.id} className="grid grid-cols-[8px_1fr] gap-3 rounded-lg px-2 py-3 hover:bg-white/[.03]"><span className={`mt-1.5 size-2 rounded-full ${item.severity === "critical" ? "bg-[#ff8178]" : "bg-[#efc86b]"}`}/><div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-[#71807c]">{item.message}</p></div></div>)}</div></Panel>}
  </div>;
}

function ExternalSites({ sources, busy, message, onSync, reload }: { sources: Intelligence["externalSources"]; busy: boolean; message: string; onSync: () => void; reload: () => Promise<void> }) {
  const [name, setName] = useState(""); const [url, setUrl] = useState(""); const [repository, setRepository] = useState(""); const [saving, setSaving] = useState(false); const [formMessage, setFormMessage] = useState("");
  async function add() { setSaving(true); setFormMessage(""); try { const response = await fetch("/api/analytics/properties/external", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name, url, repository }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "Could not add site"); setName(""); setUrl(""); setRepository(""); setFormMessage("External site added. Copy its tracker snippet below to begin collecting visits."); await reload(); } catch (error) { setFormMessage(error instanceof Error ? error.message : "Could not add site"); } finally { setSaving(false); } }
  const linked = sources.filter((source) => source.provider === "cloudflare");
  return <section className="za-panel"><div className="grid gap-6 xl:grid-cols-[.75fr_1.25fr]"><div><div className="flex items-center gap-2 text-[#58e0c0]"><IconBrandCloudflare size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">External sites</p></div><h2 className="mt-2 max-w-md text-2xl font-semibold tracking-[-.04em]">Cloudflare deployment, GitHub source, one analytics view</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#71817c]">Discovery imports enabled production domains only. GitHub matching links the source repository without changing it.</p><button onClick={onSync} disabled={busy} className="za-primary-button mt-5"><IconBrandCloudflare size={16}/>{busy ? "Discovering" : "Sync Cloudflare + GitHub"}</button>{message && <p className="mt-3 text-xs text-[#8fa09a]">{message}</p>}<div className="mt-5 space-y-2">{linked.map((source) => <div key={`${source.propertyId}:${source.provider}`} className="flex items-center justify-between gap-3 border-b border-white/[.055] py-2 last:border-0"><div className="min-w-0"><p className="truncate text-xs text-[#cdd8d4]">{source.metadata.service as string || source.metadata.project as string || source.sourceId}</p><p className="mt-1 truncate text-[10px] text-[#61706c]">{source.repository || "No GitHub repository matched"}</p></div>{source.repositoryUrl && <a href={source.repositoryUrl} target="_blank" rel="noreferrer" className="za-icon-button" aria-label={`Open ${source.repository}`}><IconBrandGithub size={15}/></a>}</div>)}</div></div><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#65736f]">Add any public site</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Site name (optional)" className="za-input"/><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" className="za-input"/><input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository (optional)" className="za-input sm:col-span-2"/></div><button onClick={() => void add()} disabled={saving || !url} className="za-secondary-button mt-3">{saving ? "Checking public access" : "Add external site"}</button>{formMessage && <p className="mt-3 text-xs text-[#8fa09a]">{formMessage}</p>}<div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-white/[.07]"><MiniNumber label="External sites" value={new Set(sources.map((source) => source.propertyId)).size}/><MiniNumber label="Cloudflare" value={linked.length}/><MiniNumber label="GitHub linked" value={sources.filter((source) => source.repository).length}/></div></div></div></section>;
}

function TrackerRow({ item, origin, source }: { item: Intelligence["trackerCoverage"][number]; origin: string; source?: Intelligence["externalSources"][number] }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script defer src="${origin}/zowa.js" data-site="${item.propertyId}"></script>`;
  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }
  return <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-white/[.03]">
    <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{item.name}</p>{source && <span className="border border-white/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[#71807c]">{source.provider}</span>}</div><p className="mt-1 truncate text-[10px] text-[#61706c]">{item.url}{source?.repository ? ` · ${source.repository}` : ""}{item.lastSignalAt ? ` · last signal ${when(item.lastSignalAt)}` : ""}</p></div>
    <div className="flex shrink-0 items-center gap-2">
      {origin && <button onClick={() => void copy()} className="border border-white/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[#9caaa6] transition hover:border-[#58e0c0]/40 hover:text-[#70d9b9]" title={snippet}>{copied ? "Copied" : "Copy snippet"}</button>}
      <span className={`border px-2 py-1 text-[9px] font-semibold uppercase tracking-wider ${item.installed ? "border-[#58e0c0]/25 text-[#70d9b9]" : "border-[#efc86b]/25 text-[#efc86b]"}`}>{item.installed ? "reporting" : "install"}</span>
    </div>
  </div>;
}

function Operation({ title, text, button, busy, onClick }: { title: string; text: string; button: string; busy: boolean; onClick: () => void }) { return <article className="flex min-h-44 flex-col rounded-lg border border-white/[.07] bg-white/[.025] p-4"><p className="text-sm font-semibold">{title}</p><p className="mt-2 text-xs leading-5 text-[#71807c]">{text}</p><button onClick={onClick} disabled={busy} className="za-primary-button mt-auto self-start">{busy ? "Working" : button}</button></article>; }
function MiniNumber({ label, value }: { label: string; value: number }) { return <div className="bg-[#0d1315] p-3"><p className="text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[#65736f]">{label}</p></div>; }

function Panel({ title, eyebrow, icon: Icon, children }: { title: string; eyebrow: string; icon: typeof IconRadar; children: React.ReactNode }) {
  return <section className="za-panel min-w-0"><header className="mb-5 flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#65736f]">{eyebrow}</p><h2 className="mt-1.5 text-[1.05rem] font-semibold tracking-[-.025em] text-[#edf5f2]">{title}</h2></div><Icon size={18} className="mt-1 shrink-0 text-[#58e0c0]" stroke={1.7}/></header>{children}</section>;
}

function Kpi({ label, value, suffix, note, icon: Icon, accent, proxy, state }: { label: string; value: string; suffix?: string; note: string; icon: typeof IconRadar; accent?: boolean; proxy?: boolean; state?: "current" | "insufficient-sample" }) {
  return <article className={`relative bg-[#0d1315] p-4 sm:p-5 ${accent ? "za-kpi-accent" : ""}`}><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#71807c]">{label}</p><Icon size={17} className={accent ? "text-[#58e0c0]" : "text-[#697874]"}/></div><p className="mt-5 text-3xl font-semibold tracking-[-.05em] tabular-nums sm:text-4xl">{value}<span className="ml-1 text-sm font-medium tracking-normal text-[#71807c]">{suffix}</span></p><div className="mt-2 flex items-start gap-2 text-xs text-[#71807c]"><span>{note}</span>{state === "insufficient-sample" && <span className="shrink-0 border border-[#efc86b]/25 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[#efc86b]">low sample</span>}{proxy && <span className="border border-[#efc86b]/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#efc86b]">proxy</span>}</div></article>;
}

function TrafficChart({ data, tall }: { data: Dashboard["trend"]; tall?: boolean }) {
  return <div className={tall ? "h-[390px]" : "h-[280px]"}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 4, left: -24, bottom: 0 }}><defs><linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#58e0c0" stopOpacity={.3}/><stop offset="1" stopColor="#58e0c0" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(255,255,255,.055)"/><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "#64736f", fontSize: 10 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: "#64736f", fontSize: 10 }}/><Tooltip contentStyle={{ background: "#11191b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#8b9a96" }}/><Area type="monotone" dataKey="pageviews" stroke="#58e0c0" strokeWidth={2.2} fill="url(#trafficFill)"/><Area type="monotone" dataKey="visitors" stroke="#879792" strokeWidth={1.2} fill="transparent" strokeDasharray="4 4"/></AreaChart></ResponsiveContainer></div>;
}

function SearchChart({ data }: { data: Dashboard }) {
  return <div className="mb-5 h-[220px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.trend} margin={{ left: -24, right: 0 }}><CartesianGrid vertical={false} stroke="rgba(255,255,255,.055)"/><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#64736f", fontSize: 9 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: "#64736f", fontSize: 9 }}/><Tooltip contentStyle={{ background: "#11191b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, fontSize: 12 }}/><Bar dataKey="impressions" fill="#33413e" radius={[3,3,0,0]}/><Bar dataKey="searchClicks" fill="#efc86b" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div>;
}

function PropertyTable({ data, onSelect }: { data: Dashboard; onSelect: (id: string) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-white/[.07] text-[10px] uppercase tracking-[.13em] text-[#65736f]"><th className="pb-3 font-semibold">Property</th><th className="pb-3 font-semibold">Data state</th><th className="pb-3 font-semibold">Health</th><th className="pb-3 text-right font-semibold">Views</th><th className="pb-3 text-right font-semibold">Visitors</th><th className="pb-3 text-right font-semibold">Issues</th><th className="pb-3 text-right font-semibold">Last signal</th></tr></thead><tbody>{data.propertyRollups.map((item) => { const quality = data.dataQuality.properties.find((row) => row.propertyId === item.propertyId)?.tracker ?? { state: "missing", label: "No data", explanation: "No tracker state is available.", observedAt: null, ageMinutes: null }; return <tr key={item.propertyId} onClick={() => onSelect(item.propertyId)} className="cursor-pointer border-b border-white/[.055] transition hover:bg-white/[.035] last:border-0"><td className="py-3.5"><p className="text-sm font-medium text-[#e9f1ef]">{item.name}</p><p className="mt-1 text-[11px] text-[#61706c]">{host(item.url)}</p></td><td className="py-3.5"><DataStateBadge signal={quality} compact /></td><td className="py-3.5">{item.crawledPages ? <Health score={item.averageSeoScore}/> : <span className="text-xs text-[#71807c]">Not crawled</span>}</td><td className="py-3.5 text-right text-sm tabular-nums">{quality.state === "unverified" ? "—" : n(item.pageviews)}</td><td className="py-3.5 text-right text-sm tabular-nums text-[#9caaa6]">{quality.state === "unverified" ? "—" : n(item.visitors)}</td><td className="py-3.5 text-right"><span className={item.criticalFindings ? "text-[#ff8178]" : "text-[#899893]"}>{item.crawledPages ? item.totalFindings : "—"}</span></td><td className="py-3.5 text-right text-xs text-[#71807c]">{relativeTime(item.lastHitAt)}</td></tr>})}</tbody></table></div>;
}

function OpportunityList({ data, expanded }: { data: Dashboard; expanded?: boolean }) {
  const rows = expanded ? data.opportunityPages : data.opportunityPages.slice(0, 6);
  return <div className="space-y-1">{rows.map((row, index) => <div key={`${row.propertyId}-${row.path}`} className="group grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-white/[.035]"><span className="text-xs tabular-nums text-[#53615e]">{String(index + 1).padStart(2,"0")}</span><div className="min-w-0"><p className="truncate text-sm font-medium text-[#e6eeec]">{row.title || row.path}</p><p className="mt-1 truncate text-[11px] text-[#667570]">{propertyName(data.properties, row.propertyId)} · {row.wordCount} words · {row.views} views</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums text-[#58e0c0]">{row.opportunityScore}</p><p className="text-[9px] uppercase tracking-wider text-[#5d6b68]">potential</p></div></div>)}{!rows.length && <Empty icon={IconSparkles} title="No opportunities yet" text="Run an audit to score your public pages."/>}</div>;
}

function RankedRows({ rows }: { rows: Array<{ title: string; label: string; value: number; suffix: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return <div className="space-y-3">{rows.slice(0, 10).map((row) => <div key={`${row.label}-${row.title}`}><div className="mb-1.5 flex items-end justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm text-[#dce6e3]">{row.title}</p><p className="truncate text-[10px] text-[#61706c]">{row.label}</p></div><div className="shrink-0 text-right"><span className="text-sm font-semibold tabular-nums">{n(row.value)}</span><span className="ml-1 text-[10px] text-[#65736f]">{row.suffix}</span></div></div><div className="h-1 overflow-hidden rounded-full bg-white/[.055]"><div className="h-full rounded-full bg-[#58e0c0]/70" style={{ width: `${Math.max(3, row.value / max * 100)}%` }}/></div></div>)}{!rows.length && <Empty icon={IconActivity} title="Waiting for traffic" text="Tracked visits will populate this view."/>}</div>;
}

function ObservedRanks({ rows, properties }: { rows: Dashboard["rankVisibility"]; properties: Property[] }) {
  return <div className="space-y-1">{rows.map((row) => <div key={`${row.propertyId}:${row.keyword}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg px-2 py-3 hover:bg-white/[.03]"><div><p className="text-sm text-[#dce6e3]">{row.keyword}</p><p className="mt-1 text-[10px] text-[#61706c]">{propertyName(properties, row.propertyId)} · {row.engine} · {when(row.checkedAt)}</p></div><p className="text-right text-sm font-semibold tabular-nums">{row.observedPosition ? `#${row.observedPosition}` : "—"}<span className="block text-[9px] font-normal uppercase tracking-wider text-[#61706c]">observed</span></p></div>)}{!rows.length && <Empty icon={IconWorldSearch} title="No rankings observed yet" text="Add watched keywords or run the ranking observer after the first content audit."/>}</div>;
}

function MixBars({ data }: { data: Dashboard }) {
  const total = data.deviceSummary.reduce((sum, row) => sum + row.visits, 0) || 1;
  return <div className="space-y-5">{data.deviceSummary.map((row) => { const share = row.visits / total; return <div key={row.device}><div className="mb-2 flex items-center justify-between text-sm"><span>{row.device}</span><span className="tabular-nums text-[#81908c]">{pct(share)} · {row.visits}</span></div><div className="h-2 rounded-full bg-white/[.06]"><div className="h-2 rounded-full bg-[#58e0c0]" style={{ width: `${share * 100}%` }}/></div></div>})}</div>;
}

function ActivityFeed({ data, expanded }: { data: Dashboard; expanded?: boolean }) {
  const rows = expanded ? data.recentActivity : data.recentActivity.slice(0, 5);
  return <div className={expanded ? "grid gap-1 md:grid-cols-2" : "space-y-1"}>{rows.map((row, index) => <div key={`${row.createdAt}-${index}`} className="flex gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[.03]"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#58e0c0]"/><div className="min-w-0"><p className="truncate text-sm text-[#dce6e3]">{row.title || row.path}</p><p className="mt-1 truncate text-[10px] text-[#65736f]">{propertyName(data.properties, row.propertyId)} · {row.referrer ? host(row.referrer) : "Direct"} · {when(row.createdAt)}</p></div></div>)}</div>;
}

function KeywordCloud({ data }: { data: Dashboard }) {
  return <div className="flex flex-wrap gap-2">{data.keywordCandidates.map((row) => <span key={`${row.pageUrl}-${row.keyword}`} className="rounded-md border border-white/[.08] bg-white/[.035] px-3 py-2 text-sm text-[#cbd6d3] transition hover:border-[#58e0c0]/30 hover:text-[#58e0c0]">{row.keyword}<span className="ml-2 text-[10px] text-[#5f6d69]">{row.weight}</span></span>)}{!data.keywordCandidates.length && <Empty icon={IconSearch} title="No keyword themes yet" text="Run an audit to infer topics from titles, headings and copy."/>}</div>;
}

function PageAuditTable({ data }: { data: Dashboard }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left"><thead><tr className="border-b border-white/[.07] text-[10px] uppercase tracking-[.13em] text-[#65736f]"><th className="pb-3 font-semibold">Page</th><th className="pb-3 font-semibold">Status</th><th className="pb-3 text-right font-semibold">Score</th><th className="pb-3 text-right font-semibold">Words</th><th className="pb-3 text-right font-semibold">Links</th><th className="pb-3 text-right font-semibold">Load</th></tr></thead><tbody>{data.latestCrawledPages.map((row) => <tr key={`${row.propertyId}-${row.path}`} className="border-b border-white/[.055] last:border-0"><td className="max-w-[420px] py-3.5"><p className="truncate text-sm font-medium">{row.title || row.path}</p><p className="mt-1 truncate text-[10px] text-[#63716e]">{propertyName(data.properties, row.propertyId)} · {row.path}</p></td><td className="py-3.5"><span className={row.statusCode >= 400 ? "text-[#ff8178]" : "text-[#70d9b9]"}>{row.statusCode}</span></td><td className="py-3.5 text-right"><Health score={row.seoScore}/></td><td className="py-3.5 text-right text-sm tabular-nums text-[#9ba9a5]">{n(row.wordCount)}</td><td className="py-3.5 text-right text-sm tabular-nums text-[#9ba9a5]">{row.internalLinks}/{row.externalLinks}</td><td className="py-3.5 text-right text-sm tabular-nums text-[#9ba9a5]">{row.loadMs}ms</td></tr>)}</tbody></table></div>;
}

function ActionRow({ item, properties }: { item: Dashboard["actionItems"][number]; properties: Property[] }) {
  return <div className="group grid grid-cols-[8px_1fr_auto] gap-3 rounded-lg px-2 py-3 transition hover:bg-white/[.035]"><span className={`mt-1.5 size-2 rounded-full ${item.severity === "critical" ? "bg-[#ff8178]" : item.severity === "warning" ? "bg-[#efc86b]" : "bg-[#73827e]"}`}/><div className="min-w-0"><p className="text-sm font-medium text-[#dce6e3]">{item.message}</p><p className="mt-1 truncate text-[10px] uppercase tracking-[.08em] text-[#63716e]">{propertyName(properties, item.propertyId)} · {item.code.replaceAll("_", " ")}</p></div><IconChevronRight size={15} className="mt-1 text-[#4f5d59] transition group-hover:translate-x-0.5 group-hover:text-[#58e0c0]"/></div>;
}

function FindingRow({ finding, properties }: { finding: Dashboard["seoFindings"][number]; properties: Property[] }) {
  return <div className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border-b border-white/[.05] px-2 py-3 last:border-0"><span className={`mt-1 inline-flex h-5 items-center border px-1.5 text-[9px] font-semibold uppercase tracking-wider ${finding.severity === "critical" ? "border-[#ff8178]/25 text-[#ff9d96]" : finding.severity === "warning" ? "border-[#efc86b]/25 text-[#efc86b]" : "border-white/10 text-[#82908d]"}`}>{finding.severity}</span><div className="min-w-0"><p className="text-sm text-[#dce6e3]">{finding.message}</p><p className="mt-1 truncate text-[10px] text-[#61706c]">{propertyName(properties, finding.propertyId)} · {finding.code.replaceAll("_", " ")} · {finding.pageUrl}</p></div></div>;
}

function Health({ score }: { score: number }) { const tone = score >= 90 ? "text-[#70d9b9]" : score >= 70 ? "text-[#efc86b]" : "text-[#ff8178]"; return <span className={`text-sm font-semibold tabular-nums ${tone}`}>{score || "—"}</span>; }
function ScoreRing({ score }: { score: number }) { return <div className="relative grid size-40 place-items-center rounded-full" style={{ background: `conic-gradient(#58e0c0 ${score * 3.6}deg, rgba(255,255,255,.06) 0)` }}><div className="grid size-[138px] place-items-center rounded-full bg-[#0d1315]"><div className="text-center"><p className="text-5xl font-semibold tracking-[-.06em] tabular-nums">{score || 0}</p><p className="mt-1 text-[10px] uppercase tracking-[.15em] text-[#65736f]">SEO health</p></div></div></div>; }
function NavButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof IconRadar; label: string }) { return <button onClick={onClick} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58e0c0]/50 ${active ? "bg-white/[.08] text-white" : "text-[#71807c] hover:bg-white/[.04] hover:text-[#c9d3d0]"}`}><Icon size={15}/>{label}</button>; }
function Empty({ icon: Icon, title, text }: { icon: typeof IconRadar; title: string; text: string }) { return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-white/10 p-5 text-center"><div><Icon className="mx-auto text-[#54625f]" size={22}/><p className="mt-3 text-sm font-medium text-[#bdc8c5]">{title}</p><p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[#65736f]">{text}</p></div></div>; }
function LoadingState({ error, retry }: { error: string; retry: () => void }) { return <main className="grid min-h-screen place-items-center bg-[#090d0f] text-[#e7efed]"><div className="text-center">{error ? <><IconAlertTriangle className="mx-auto text-[#ff8178]"/><p className="mt-3 text-sm">{error}</p><button onClick={retry} className="za-primary-button mx-auto mt-4">Retry</button></> : <><div className="mx-auto size-8 animate-spin rounded-full border-2 border-white/10 border-t-[#58e0c0]"/><p className="mt-4 text-xs uppercase tracking-[.15em] text-[#65736f]">Reading signals</p></>}</div></main>; }
function propertyName(properties: Property[], id: string) { return properties.find((item) => item.id === id)?.name ?? id; }
function healthScore(data: Dashboard) { const seo = data.totals.averageSeoScore || 0; const tracking = data.totals.properties ? data.totals.tracked / data.totals.properties * 100 : 0; const penalty = data.totals.brokenPages * 5 + data.actionItems.filter((item) => item.severity === "critical").length * 3; return Math.max(0, Math.min(100, Math.round(seo * .7 + tracking * .3 - penalty))); }

function filterDashboard(data: Dashboard, id: string): Dashboard {
  if (id === "all") return data;
  const owns = (row: { propertyId: string }) => row.propertyId === id;
  const properties = data.properties.filter((item) => item.id === id);
  const rollups = data.propertyRollups.filter(owns);
  const propertyComparison = data.propertyComparisons.find((item) => item.propertyId === id);
  const emptyQuality: ComparisonQuality = { current: 0, previous: 0, change: null, displayPercent: false, state: "insufficient-sample", explanation: "No visits in either period." };
  const comparison = propertyComparison ? { pageviews: propertyComparison.pageviewsChange, visitors: propertyComparison.visitorsChange, previousPageviews: propertyComparison.previousPageviews, previousVisitors: propertyComparison.previousVisitors, pageviewsQuality: propertyComparison.pageviewsQuality, visitorsQuality: propertyComparison.visitorsQuality } : { pageviews: null, visitors: null, previousPageviews: 0, previousVisitors: 0, pageviewsQuality: emptyQuality, visitorsQuality: emptyQuality };
  const totals = { ...data.totals, properties: properties.length, tracked: properties.filter((item) => item.status === "tracked").length, missingTracker: properties.filter((item) => item.status === "missing-tracker").length, pageviews: rollups.reduce((sum, row) => sum + row.pageviews, 0), visitors: rollups.reduce((sum, row) => sum + row.visitors, 0), crawledPages: rollups.reduce((sum, row) => sum + row.crawledPages, 0), averageSeoScore: rollups[0]?.averageSeoScore ?? 0, brokenPages: rollups.reduce((sum, row) => sum + row.brokenPages, 0), missingTitles: rollups.reduce((sum, row) => sum + row.missingTitles, 0), missingDescriptions: rollups.reduce((sum, row) => sum + row.missingDescriptions, 0), thinPages: rollups.reduce((sum, row) => sum + row.thinPages, 0) };
  const propertyQuality = data.dataQuality.properties.filter(owns);
  const sources = { ...data.dataQuality.sources, traffic: propertyQuality[0]?.tracker ?? data.dataQuality.sources.traffic, crawler: propertyQuality[0]?.crawler ?? data.dataQuality.sources.crawler };
  const counts = { unverified: propertyQuality.filter((item) => item.tracker.state === "unverified").length, missingTraffic: propertyQuality.filter((item) => item.tracker.state === "missing").length, staleTraffic: propertyQuality.filter((item) => item.tracker.state === "stale").length, staleSources: Object.values(sources).filter((item) => item.state === "stale").length };
  return { ...data, properties, comparison, totals, dataQuality: { sources, properties: propertyQuality, counts }, propertyRollups: rollups, domainRatings: data.domainRatings.filter(owns), authorityScores: data.authorityScores.filter(owns), commonCrawlLinks: data.commonCrawlLinks.filter(owns), topPages: data.topPages.filter(owns), searchPages: data.searchPages.filter(owns), rankVisibility: data.rankVisibility.filter(owns), latestCrawledPages: data.latestCrawledPages.filter(owns), seoFindings: data.seoFindings.filter(owns), keywordCandidates: data.keywordCandidates.filter(owns), referrerDomains: data.referrerDomains.filter(owns), eventSummary: data.eventSummary.filter(owns), recentActivity: data.recentActivity.filter(owns), referrerSummary: data.referrerSummary.filter(owns), deviceSummary: data.deviceSummary.filter(owns), opportunityPages: data.opportunityPages.filter(owns), actionItems: data.actionItems.filter(owns) };
}

function filterIntelligence(data: Intelligence, id: string): Intelligence {
  if (id === "all") return data;
  const owns = (row: { propertyId: string | null }) => row.propertyId === id;
  const sessions = data.sessions.filter(owns);
  const sessionCount = sessions.length;
  return {
    ...data,
    sessions,
    sessionTotals: {
      sessions: sessionCount,
      pagesPerSession: sessionCount ? Math.round(sessions.reduce((sum, row) => sum + row.pageviews, 0) / sessionCount * 10) / 10 : 0,
      averageDurationSeconds: sessionCount ? Math.round(sessions.reduce((sum, row) => sum + row.durationSeconds, 0) / sessionCount) : 0,
      bounceRate: sessionCount ? sessions.filter((row) => row.pageviews === 1).length / sessionCount : 0,
    },
    journeys: data.journeys.filter(owns), goals: data.goals.filter(owns), vitals: data.vitals.filter(owns), errors: data.errors.filter(owns),
    changes: data.changes.filter(owns), linkGraph: data.linkGraph.filter(owns), orphanPages: data.orphanPages.filter(owns),
    campaigns: data.campaigns.filter(owns), ranks: data.ranks.filter(owns), backlinks: data.backlinks.filter(owns),
    competitors: data.competitors.filter(owns), alerts: data.alerts.filter(owns), trackerCoverage: data.trackerCoverage.filter(owns),
  };
}
