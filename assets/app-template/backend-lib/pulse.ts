import { db, getProperty } from "./db";

export type PulseMetricKey = "showUrl" | "showPageviews" | "showVisitors" | "showTrend" | "showAudit" | "showVitals" | "showAuthority";

export type PulseConfig = {
  propertyId: string;
  name: string;
  url: string;
  enabled: boolean;
  displayName: string | null;
  showUrl: boolean;
  showPageviews: boolean;
  showVisitors: boolean;
  showTrend: boolean;
  showAudit: boolean;
  showVitals: boolean;
  showAuthority: boolean;
  updatedAt: string | null;
};

const booleanColumns: Record<PulseMetricKey, string> = {
  showUrl: "show_url",
  showPageviews: "show_pageviews",
  showVisitors: "show_visitors",
  showTrend: "show_trend",
  showAudit: "show_audit",
  showVitals: "show_vitals",
  showAuthority: "show_authority",
};

function bool(value: unknown) {
  return value === true || value === 1;
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function percentile(values: number[], target = .75) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * target) - 1)] * 100) / 100;
}

export function listPulseConfig(): PulseConfig[] {
  const rows = db.query(`SELECT p.id AS propertyId, p.name, p.url,
      COALESCE(c.enabled, 0) AS enabled, c.display_name AS displayName,
      COALESCE(c.show_url, 1) AS showUrl,
      COALESCE(c.show_pageviews, 1) AS showPageviews,
      COALESCE(c.show_visitors, 0) AS showVisitors,
      COALESCE(c.show_trend, 1) AS showTrend,
      COALESCE(c.show_audit, 1) AS showAudit,
      COALESCE(c.show_vitals, 1) AS showVitals,
      COALESCE(c.show_authority, 1) AS showAuthority,
      c.updated_at AS updatedAt
    FROM properties p LEFT JOIN pulse_config c ON c.property_id=p.id
    WHERE p.lifecycle='active' AND p.url LIKE 'https://%'
    ORDER BY p.name COLLATE NOCASE`).all() as Array<Record<string, any>>;
  return rows.map((row) => ({
    ...row,
    enabled: bool(row.enabled),
    showUrl: bool(row.showUrl),
    showPageviews: bool(row.showPageviews),
    showVisitors: bool(row.showVisitors),
    showTrend: bool(row.showTrend),
    showAudit: bool(row.showAudit),
    showVitals: bool(row.showVitals),
    showAuthority: bool(row.showAuthority),
  })) as PulseConfig[];
}

export function updatePulseConfig(propertyId: string, input: Record<string, unknown>) {
  const property = getProperty(propertyId);
  if (!property?.url.startsWith("https://")) throw new Error("A public HTTPS property is required");
  const current = listPulseConfig().find((item) => item.propertyId === propertyId)!;
  const next = {
    enabled: input.enabled === undefined ? current.enabled : bool(input.enabled),
    displayName: typeof input.displayName === "string" ? input.displayName.trim().slice(0, 80) || null : current.displayName,
    showUrl: input.showUrl === undefined ? current.showUrl : bool(input.showUrl),
    showPageviews: input.showPageviews === undefined ? current.showPageviews : bool(input.showPageviews),
    showVisitors: input.showVisitors === undefined ? current.showVisitors : bool(input.showVisitors),
    showTrend: input.showTrend === undefined ? current.showTrend : bool(input.showTrend),
    showAudit: input.showAudit === undefined ? current.showAudit : bool(input.showAudit),
    showVitals: input.showVitals === undefined ? current.showVitals : bool(input.showVitals),
    showAuthority: input.showAuthority === undefined ? current.showAuthority : bool(input.showAuthority),
  };
  db.prepare(`INSERT INTO pulse_config
      (property_id, enabled, display_name, show_url, show_pageviews, show_visitors, show_trend, show_audit, show_vitals, show_authority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(property_id) DO UPDATE SET enabled=excluded.enabled, display_name=excluded.display_name,
      show_url=excluded.show_url, show_pageviews=excluded.show_pageviews, show_visitors=excluded.show_visitors,
      show_trend=excluded.show_trend, show_audit=excluded.show_audit, show_vitals=excluded.show_vitals,
      show_authority=excluded.show_authority, updated_at=CURRENT_TIMESTAMP`)
    .run(propertyId, Number(next.enabled), next.displayName, Number(next.showUrl), Number(next.showPageviews), Number(next.showVisitors), Number(next.showTrend), Number(next.showAudit), Number(next.showVitals), Number(next.showAuthority));
  refreshPulseSnapshot();
  return listPulseConfig().find((item) => item.propertyId === propertyId);
}

function traffic(propertyId: string) {
  return db.query(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
    FROM pageviews WHERE property_id=? AND created_at>=datetime('now','-30 days')`).get(propertyId) as { pageviews: number; visitors: number };
}

function trend(propertyId: string) {
  return db.query(`WITH RECURSIVE dates(day) AS (
      SELECT date('now','-29 days') UNION ALL SELECT date(day,'+1 day') FROM dates WHERE day<date('now')
    ), counts AS (
      SELECT date(created_at) AS day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
      FROM pageviews WHERE property_id=? AND created_at>=datetime('now','-30 days') GROUP BY date(created_at)
    ) SELECT dates.day, COALESCE(counts.pageviews,0) AS pageviews, COALESCE(counts.visitors,0) AS visitors
    FROM dates LEFT JOIN counts ON counts.day=dates.day ORDER BY dates.day`).all(propertyId);
}

function audit(propertyId: string) {
  return db.query(`SELECT ROUND(AVG(seo_score)) AS score, COUNT(*) AS pages
    FROM crawled_pages WHERE property_id=? AND captured_at=(SELECT MAX(captured_at) FROM crawled_pages WHERE property_id=?)`).get(propertyId, propertyId) as { score: number | null; pages: number };
}

function vitals(propertyId: string) {
  const rows = db.query(`SELECT metric, value FROM performance_metrics
    WHERE property_id=? AND metric IN ('LCP','INP','CLS') AND created_at>=datetime('now','-30 days')
    ORDER BY metric, value`).all(propertyId) as Array<{ metric: string; value: number }>;
  return ["LCP", "INP", "CLS"].flatMap((metric) => {
    const values = rows.filter((row) => row.metric === metric).map((row) => row.value);
    return values.length >= 5 ? [{ metric, p75: percentile(values), samples: values.length }] : [];
  });
}

function authority(propertyId: string) {
  return db.query(`SELECT authority_score AS score, referring_hosts AS referringHosts, indexed_hosts AS indexedHosts
    FROM common_crawl_snapshots WHERE property_id=? ORDER BY captured_at DESC LIMIT 1`).get(propertyId) as { score: number; referringHosts: number; indexedHosts: number } | null;
}

export function refreshPulseSnapshot() {
  const properties = listPulseConfig().filter((item) => item.enabled).map((config) => {
    const metrics: Record<string, unknown> = {};
    const trafficData = config.showPageviews || config.showVisitors || config.showTrend ? traffic(config.propertyId) : null;
    if (config.showPageviews) metrics.pageviews = trafficData?.pageviews ?? 0;
    if (config.showVisitors) metrics.visitors = trafficData?.visitors ?? 0;
    if (config.showTrend) metrics.trend = trend(config.propertyId).map((row: any) => ({ day: row.day, ...(config.showPageviews ? { pageviews: row.pageviews } : {}), ...(config.showVisitors ? { visitors: row.visitors } : {}) }));
    if (config.showAudit) {
      const value = audit(config.propertyId);
      metrics.audit = value.pages ? value : null;
    }
    if (config.showVitals) metrics.vitals = vitals(config.propertyId);
    if (config.showAuthority) {
      const value = authority(config.propertyId);
      metrics.authority = value?.indexedHosts ? value : null;
    }
    return {
      id: config.propertyId,
      name: config.displayName || config.name,
      ...(config.showUrl ? { url: config.url } : {}),
      metrics,
    };
  });
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    periodDays: 30,
    properties,
    disclosure: "Aggregated, owner-selected metrics. No visitor-level data is published.",
  };
  db.prepare("INSERT INTO pulse_snapshots (id, generated_at, payload) VALUES (?, ?, ?)").run(id("pulse"), generatedAt, JSON.stringify(payload));
  db.prepare("DELETE FROM pulse_snapshots WHERE id NOT IN (SELECT id FROM pulse_snapshots ORDER BY generated_at DESC LIMIT 90)").run();
  return payload;
}

export function getPublicPulse() {
  const row = db.query("SELECT payload FROM pulse_snapshots ORDER BY generated_at DESC LIMIT 1").get() as { payload: string } | null;
  return row ? JSON.parse(row.payload) : { generatedAt: null, periodDays: 30, properties: [], disclosure: "No metrics have been published." };
}

export function pulsePageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#07090a">
  <meta name="description" content="ZoAnalytics is the analytics and website-intelligence system built for Zo Computer. Discover, measure, diagnose, fix, verify, and learn on your own Zo.">
  <meta property="og:title" content="ZoAnalytics — Website intelligence built for Zo">
  <meta property="og:description" content="Discover what you run, measure what visitors experience, identify what needs attention, and verify whether your changes worked.">
  <meta property="og:type" content="website">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2307090a'/%3E%3Ctext x='16' y='22' font-family='ui-monospace,monospace' font-size='17' font-weight='700' fill='%2339e08a' text-anchor='middle'%3EZ%3C/text%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <title>ZoAnalytics Pulse</title>
  <style>
    :root{
      color-scheme:dark;
      --bg:#07090a;--bg-elevated:#0b0f0e;--panel:#0c1110;--line:#1c2523;
      --ink:#e8f3ed;--muted:#6d7d76;--accent:#39e08a;--accent-ink:#03170e;--soft:#0f2118;
      --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      --sans:'Space Grotesk',ui-sans-serif,-apple-system,BlinkMacSystemFont,sans-serif;
      font-family:var(--mono)
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);min-height:100dvh;scroll-behavior:smooth}
    a{color:inherit}
    a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
    .grid-overlay{position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.6;background-image:linear-gradient(rgba(57,224,138,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(57,224,138,.05) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse 80% 55% at 50% 0%,#000 35%,transparent 100%)}
    .grain{position:fixed;inset:0;pointer-events:none;z-index:1;opacity:.035;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
    main{position:relative;z-index:2;width:min(1180px,calc(100% - 32px));margin:0 auto;padding:24px 0 80px}
    .nav{display:flex;align-items:center;justify-content:space-between;padding:8px 0 48px}
    .brand{display:flex;align-items:center;gap:10px;font-family:var(--sans);font-size:14px;font-weight:700;letter-spacing:-.01em}
    .brand-sep{margin:0 2px;color:var(--muted);font-weight:400}
    .mark{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-family:var(--mono);font-weight:700;font-size:14px}
    .private{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--muted);text-decoration:none;text-transform:uppercase;letter-spacing:.12em}
    .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
    @media(prefers-reduced-motion:no-preference){.dot{animation:pulse-dot 2.2s ease-in-out infinite}}
    @keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.3}}
    .hero{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(250px,.6fr);gap:56px;align-items:end;padding:18px 0 56px}
    .eyebrow{color:var(--accent);font-size:11px;font-weight:500;letter-spacing:.1em}
    .hero h1{font-family:var(--sans);max-width:760px;margin:12px 0 0;font-size:clamp(40px,6.5vw,76px);line-height:.98;letter-spacing:-.045em;font-weight:700;text-wrap:balance}
    .hero p{margin:0;color:var(--muted);font-size:13px;line-height:1.75;max-width:42ch}
    .hero-copy{display:grid;gap:20px;align-content:end}
    .actions{display:flex;flex-wrap:wrap;gap:10px}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 15px;border:1px solid var(--accent);border-radius:7px;background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:700;letter-spacing:.04em;text-decoration:none;transition:transform .2s ease,box-shadow .2s ease,background .2s ease}
    .button:hover{transform:translateY(-1px);box-shadow:0 10px 28px -14px rgba(57,224,138,.7)}
    .button.secondary{background:transparent;color:var(--accent);border-color:var(--line)}
    .button.secondary:hover{border-color:var(--accent);box-shadow:none}
    .proof{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:0 0 24px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--line)}
    .proof article{background:var(--panel);padding:20px}
    .proof strong{display:block;font-family:var(--sans);font-size:15px;letter-spacing:-.01em}
    .proof p{margin:8px 0 0;color:var(--muted);font-size:11px;line-height:1.65}
    .proof-code{display:block;margin-bottom:12px;color:var(--accent);font-size:10px;letter-spacing:.1em}
    .product-detail{display:grid;grid-template-columns:minmax(190px,.55fr) minmax(0,1.45fr);gap:36px;margin:48px 0 30px;padding:34px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .product-detail-label{color:var(--accent);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
    .product-detail h2{font-family:var(--sans);margin:10px 0 0;font-size:clamp(24px,3vw,36px);line-height:1.05;letter-spacing:-.03em;text-wrap:balance}
    .detail-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
    .detail-item{padding-left:16px;border-left:1px solid var(--line)}
    .detail-item span{display:block;margin-bottom:9px;color:var(--accent);font-size:10px;letter-spacing:.08em}
    .detail-item strong{display:block;font-family:var(--sans);font-size:14px;letter-spacing:-.01em}
    .detail-item p{margin:7px 0 0;color:var(--muted);font-size:10px;line-height:1.65}
    .live-intro{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 0 16px}
    .live-intro p{margin:0;color:var(--muted);font-size:11px;line-height:1.6}
    .live-intro strong{color:var(--ink);font-weight:500}
    .live-tag{flex:0 0 auto;color:var(--accent);font-size:10px;letter-spacing:.1em;text-transform:uppercase}
    .pitch{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr);gap:56px;margin-top:52px;padding:44px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .pitch-label{color:var(--accent);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
    .pitch h2{font-family:var(--sans);margin:12px 0 0;font-size:clamp(28px,4vw,44px);line-height:1.02;letter-spacing:-.035em}
    .capabilities{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}
    .capability{background:var(--bg);padding:18px}
    .capability strong{display:block;font-family:var(--sans);font-size:14px}
    .capability span{display:block;margin-top:7px;color:var(--muted);font-size:10px;line-height:1.6}
    .install{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center;margin-top:24px;padding:24px;border:1px solid rgba(57,224,138,.3);border-radius:10px;background:var(--soft)}
    .install h3{font-family:var(--sans);margin:0;font-size:20px;letter-spacing:-.02em}
    .install p{margin:7px 0 0;color:var(--muted);font-size:11px;line-height:1.6}
    .meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:24px;background:var(--panel)}
    .meta div{padding:16px 18px}
    .meta div+div{border-left:1px solid var(--line)}
    .meta strong{display:block;font-size:22px;font-variant-numeric:tabular-nums;font-weight:600}
    .meta span{display:block;margin-top:5px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}
    .list{display:grid;gap:12px}
    .property{border:1px solid var(--line);border-radius:10px;background:linear-gradient(180deg,var(--panel),var(--bg-elevated));padding:22px;transition:border-color .25s ease,transform .25s ease,box-shadow .25s ease}
    .property:hover{border-color:rgba(57,224,138,.4);box-shadow:0 0 0 1px rgba(57,224,138,.12),0 18px 40px -22px rgba(0,0,0,.7);transform:translateY(-2px)}
    .property-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
    .property-id{display:block;color:var(--muted);font-size:10px;letter-spacing:.1em;margin-bottom:6px}
    .property h2{font-family:var(--sans);margin:0;font-size:19px;letter-spacing:-.02em;font-weight:700}
    .property-url{display:inline-flex;align-items:center;gap:5px;margin-top:8px;color:var(--muted);font-size:12px;text-decoration:none;transition:color .2s ease}
    .property-url:hover{color:var(--accent)}
    .property-url .prompt{color:var(--accent)}
    .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;margin-top:22px;background:var(--line);border-radius:8px;overflow:hidden}
    .metric{background:var(--bg);padding:15px}
    .metric strong{display:block;font-family:var(--mono);font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
    .metric span{display:block;margin-top:5px;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.1em}
    .trend{margin-top:18px;height:76px;color:var(--accent)}
    .trend svg{display:block;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 6px rgba(57,224,138,.35))}
    .empty,.error,.loading{min-height:280px;display:grid;place-items:center;border:1px dashed var(--line);border-radius:12px;text-align:center;color:var(--muted);padding:30px}
    .empty strong,.error strong{display:block;color:var(--ink);font-family:var(--sans);font-size:18px;margin-bottom:8px}
    footer{display:flex;justify-content:space-between;gap:24px;margin-top:36px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.6}
    .status{color:var(--accent);font-weight:600;text-decoration:none;transition:opacity .2s ease}
    .status:hover{opacity:.75}
    .skeleton{width:100%;height:140px;border-radius:12px;background:var(--soft)}
    @media(max-width:760px){main{width:min(100% - 24px,1180px)}.nav{padding-bottom:32px}.private{display:none}.hero{grid-template-columns:1fr;gap:24px;padding-bottom:38px}.hero h1{font-size:clamp(38px,13vw,58px)}.proof{grid-template-columns:1fr}.product-detail{grid-template-columns:1fr;gap:24px}.detail-list{grid-template-columns:1fr;gap:18px}.live-intro{display:block}.live-tag{margin-top:8px}.pitch{grid-template-columns:1fr;gap:28px}.capabilities{grid-template-columns:1fr}.install{grid-template-columns:1fr}.property{padding:18px}.property-head{display:block}.meta{grid-template-columns:1fr}.meta div+div{border-left:0;border-top:1px solid var(--line)}footer{display:block}footer p+ p{margin-top:12px}}
    @media(prefers-reduced-motion:no-preference){.property{animation:enter .45s cubic-bezier(.16,1,.3,1) both;animation-delay:calc(var(--i)*45ms)}@keyframes enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}
  </style>
</head>
<body>
  <div class="grid-overlay" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>
  <main>
    <nav class="nav"><div class="brand"><span class="mark">Z</span><span>ZoAnalytics<span class="brand-sep">/</span>Pulse</span></div><span class="private"><span class="dot" aria-hidden="true"></span>Public aggregate view</span></nav>
    <header class="hero"><div><div class="eyebrow">// website intelligence built for Zo</div><h1>Stop operating your Zo sites blind.</h1></div><div class="hero-copy"><p>ZoAnalytics discovers what you run, measures what visitors experience, identifies what needs attention, helps you apply safe fixes, and verifies whether the result improved. Your tracker, dashboard, and data stay on your own Zo.</p><div class="actions"><a href="https://github.com/search?q=ZoAnalytics&type=repositories" target="_blank" rel="noreferrer" class="button">Install ZoAnalytics &rarr;</a><a href="#live-proof" class="button secondary">See live proof</a></div></div></header>
    <section class="proof" aria-label="Why run ZoAnalytics"><article><span class="proof-code">01 / OWNERSHIP</span><strong>Your data stays on your Zo.</strong><p>The database, dashboard, crawler, and tracker are yours—not a tenant inside somebody else's cloud.</p></article><article><span class="proof-code">02 / COST</span><strong>No analytics subscription.</strong><p>Install the open project on Zo and operate it alongside the sites and services you already own.</p></article><article><span class="proof-code">03 / SCOPE</span><strong>More than a pageview counter.</strong><p>Combine first-party analytics with Web Vitals, site audits, goals, funnels, and change-to-outcome tracking.</p></article></section>
    <section class="product-detail" aria-labelledby="product-detail-title"><div><div class="product-detail-label">Inside every installation</div><h2 id="product-detail-title">One system. Two deliberate boundaries.</h2></div><div class="detail-list"><article class="detail-item"><span>01</span><strong>Private command center</strong><p>Traffic, SEO health, Core Web Vitals, goals, funnels, action campaigns, and measured outcomes stay private on your Zo.</p></article><article class="detail-item"><span>02</span><strong>Zo-native operating loop</strong><p>Discover Spaces, Sites, services, and domains—then measure, diagnose, fix, verify, and learn from every change.</p></article><article class="detail-item"><span>03</span><strong>Optional public proof</strong><p>Pulse publishes only the properties and aggregate metrics you explicitly select. Visitor-level data and management tools stay private.</p></article></div></section>
    <div id="live-proof" class="live-intro"><p><strong>This is a real Pulse snapshot from an active ZoAnalytics installation.</strong> The figures below are live aggregate data, not sample content.</p><span class="live-tag">// live product proof</span></div>
    <section id="meta" class="meta" hidden></section>
    <section id="content" class="list"><div class="loading"><div class="skeleton" aria-label="Loading public metrics"></div></div></section>
    <section class="pitch"><div><div class="pitch-label">The complete Zo operating loop</div><h2>Discover → Measure → Diagnose → Fix → Verify → Learn.</h2></div><div><div class="capabilities"><div class="capability"><strong>Zo-aware discovery</strong><span>Inventory public Space routes, Sites, services, custom domains, and connected deployments without counting private tools.</span></div><div class="capability"><strong>Evidence-backed action</strong><span>Turn traffic, performance, SEO, and reliability signals into ranked campaigns with safe completion paths.</span></div><div class="capability"><strong>Closed-loop outcomes</strong><span>Verify completed work, respect sample thresholds, and reopen changes that did not produce the expected result.</span></div><div class="capability"><strong>Weekly owner brief</strong><span>See the top three priorities, verified movement, follow-ups, and missing evidence without requiring an LLM.</span></div></div><div class="install"><div><h3>Run your own instance.</h3><p>Install through the Zo Skill, keep the full dashboard private, and choose exactly which aggregate metrics—if any—to publish through Pulse.</p></div><a href="https://github.com/search?q=ZoAnalytics&type=repositories" target="_blank" rel="noreferrer" class="button">View install guide &rarr;</a></div></div></section>
    <footer><p id="disclosure">Aggregated metrics only.</p><p>ZoAnalytics is free and self-hosted on Zo.<br><a href="https://github.com/search?q=ZoAnalytics&type=repositories" target="_blank" rel="noreferrer" class="status">$ install your own &rarr;</a></p></footer>
  </main>
  <script>
    const content=document.querySelector('#content'),meta=document.querySelector('#meta'),disclosure=document.querySelector('#disclosure');
    const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const number=(value)=>new Intl.NumberFormat('en-US',{notation:Number(value)>9999?'compact':'standard',maximumFractionDigits:1}).format(Number(value)||0);
    const date=(value)=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)):'Not generated';
    function chart(rows,key){const values=rows.map(row=>Number(row[key]||0)),max=Math.max(1,...values),points=values.map((value,index)=>[index/(Math.max(1,values.length-1))*100,70-value/max*64]);const path=points.map((point,index)=>(index?'L':'M')+point[0].toFixed(2)+' '+point[1].toFixed(2)).join(' ');return '<div class="trend" aria-label="30 day '+esc(key)+' trend"><svg viewBox="0 0 100 76" preserveAspectRatio="none" role="img"><path d="'+path+'" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>'}
    function metric(value,label){return '<div class="metric"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>'}
    function propertyCard(item,index){const m=item.metrics||{},bits=[];if('pageviews'in m)bits.push(metric(number(m.pageviews),'Pageviews / 30 days'));if('visitors'in m)bits.push(metric(number(m.visitors),'Visitors / 30 days'));if(m.audit)bits.push(metric(m.audit.score??'Unavailable','Audit score'),metric(number(m.audit.pages),'Pages audited'));if(m.authority)bits.push(metric(m.authority.score,'Zo Authority'),metric(number(m.authority.referringHosts),'Referring hosts'));for(const vital of m.vitals||[])bits.push(metric(vital.p75,vital.metric+' p75'));const trendKey='pageviews'in m?'pageviews':'visitors'in m?'visitors':null;const idTag=String(index+1).padStart(2,'0');return '<article class="property" style="--i:'+index+'"><div class="property-head"><div><span class="property-id">P&middot;'+idTag+'</span><h2>'+esc(item.name)+'</h2>'+(item.url?'<a class="property-url" href="'+esc(item.url)+'" rel="noreferrer"><span class="prompt">&gt;</span>'+esc(new URL(item.url).hostname)+'</a>':'')+'</div></div>'+(bits.length?'<div class="metrics">'+bits.join('')+'</div>':'')+(trendKey&&Array.isArray(m.trend)?chart(m.trend,trendKey):'')+'</article>'}
    fetch('/api/pulse',{headers:{Accept:'application/json'}}).then(response=>{if(!response.ok)throw new Error('Public metrics are temporarily unavailable');return response.json()}).then(data=>{const items=Array.isArray(data.properties)?data.properties:[];meta.hidden=false;meta.innerHTML='<div><strong>'+number(items.length)+'</strong><span>Published properties</span></div><div><strong>'+esc(date(data.generatedAt))+'</strong><span>Snapshot generated</span></div>';disclosure.textContent=data.disclosure||'Aggregated metrics only.';content.innerHTML=items.length?items.map(propertyCard).join(''):'<div class="empty"><div><strong>No public metrics yet</strong>The owner has not enabled a Pulse property.</div></div>'}).catch(error=>{content.innerHTML='<div class="error"><div><strong>Pulse is unavailable</strong>'+esc(error.message)+'</div></div>'});
  </script>
</body>
</html>`;
}
