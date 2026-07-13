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
  <meta name="description" content="A privacy-safe public snapshot of selected ZoAnalytics metrics.">
  <title>ZoAnalytics Pulse</title>
  <style>
    :root{color-scheme:light dark;--bg:#f3f6f4;--ink:#101615;--muted:#65726e;--line:#d8dfdc;--panel:#edf1ef;--accent:#157d69;--accent-ink:#f4fffc;--soft:#dcece7;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    @media(prefers-color-scheme:dark){:root{--bg:#090d0f;--ink:#edf5f2;--muted:#788783;--line:#202a28;--panel:#0e1415;--accent:#58e0c0;--accent-ink:#07110e;--soft:#10231f}}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);min-height:100dvh}a{color:inherit}main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:24px 0 80px}.nav{display:flex;align-items:center;justify-content:space-between;padding:8px 0 48px}.brand{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;letter-spacing:-.02em}.mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:14px}.private{font-size:11px;color:var(--muted);text-decoration:none}.hero{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(250px,.6fr);gap:56px;align-items:end;padding:18px 0 56px}.eyebrow{color:var(--accent);font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:760px;margin:12px 0 0;font-size:clamp(42px,7vw,84px);line-height:.98;letter-spacing:-.065em}.hero p{margin:0;color:var(--muted);font-size:15px;line-height:1.7;max-width:42ch}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:24px}.meta div{padding:16px 18px}.meta div+div{border-left:1px solid var(--line)}.meta strong{display:block;font-size:22px;font-variant-numeric:tabular-nums}.meta span{display:block;margin-top:5px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}.list{display:grid;gap:12px}.property{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:22px}.property-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.property h2{margin:0;font-size:20px;letter-spacing:-.035em}.property-url{display:inline-block;margin-top:7px;color:var(--muted);font-size:12px;text-decoration:none}.property-url:hover{color:var(--accent)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;margin-top:22px;background:var(--line);border-radius:10px;overflow:hidden}.metric{background:var(--bg);padding:15px}.metric strong{display:block;font-size:26px;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.metric span{display:block;margin-top:5px;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.1em}.trend{margin-top:18px;height:76px;color:var(--accent)}.trend svg{display:block;width:100%;height:100%;overflow:visible}.empty,.error,.loading{min-height:280px;display:grid;place-items:center;border:1px dashed var(--line);border-radius:16px;text-align:center;color:var(--muted);padding:30px}.empty strong,.error strong{display:block;color:var(--ink);font-size:20px;margin-bottom:8px}footer{display:flex;justify-content:space-between;gap:24px;margin-top:36px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.6}.status{color:var(--accent);font-weight:700}.skeleton{width:100%;height:140px;border-radius:16px;background:var(--soft)}
    @media(max-width:760px){main{width:min(100% - 24px,1180px)}.nav{padding-bottom:32px}.private{display:none}.hero{grid-template-columns:1fr;gap:24px;padding-bottom:38px}.hero h1{font-size:clamp(40px,14vw,62px)}.property{padding:18px}.property-head{display:block}.meta{grid-template-columns:1fr}.meta div+div{border-left:0;border-top:1px solid var(--line)}footer{display:block}footer p+ p{margin-top:12px}}
    @media(prefers-reduced-motion:no-preference){.property{animation:enter .45s cubic-bezier(.16,1,.3,1) both;animation-delay:calc(var(--i)*45ms)}@keyframes enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}
  </style>
</head>
<body>
  <main>
    <nav class="nav"><div class="brand"><span class="mark">Z</span><span>ZoAnalytics Pulse</span></div><span class="private">Public aggregate view</span></nav>
    <header class="hero"><div><div class="eyebrow">Selected portfolio signals</div><h1>What the public work is earning.</h1></div><p>Owner-selected, privacy-safe analytics from public sites. No visitor journeys, raw referrers, or personal data appear here.</p></header>
    <section id="meta" class="meta" hidden></section>
    <section id="content" class="list"><div class="loading"><div class="skeleton" aria-label="Loading public metrics"></div></div></section>
    <footer><p id="disclosure">Aggregated metrics only.</p><p><span class="status">Privacy first</span><br>No cookies on this page.</p></footer>
  </main>
  <script>
    const content=document.querySelector('#content'),meta=document.querySelector('#meta'),disclosure=document.querySelector('#disclosure');
    const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const number=(value)=>new Intl.NumberFormat('en-US',{notation:Number(value)>9999?'compact':'standard',maximumFractionDigits:1}).format(Number(value)||0);
    const date=(value)=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)):'Not generated';
    function chart(rows,key){const values=rows.map(row=>Number(row[key]||0)),max=Math.max(1,...values),points=values.map((value,index)=>[index/(Math.max(1,values.length-1))*100,70-value/max*64]);const path=points.map((point,index)=>(index?'L':'M')+point[0].toFixed(2)+' '+point[1].toFixed(2)).join(' ');return '<div class="trend" aria-label="30 day '+esc(key)+' trend"><svg viewBox="0 0 100 76" preserveAspectRatio="none" role="img"><path d="'+path+'" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>'}
    function metric(value,label){return '<div class="metric"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>'}
    function propertyCard(item,index){const m=item.metrics||{},bits=[];if('pageviews'in m)bits.push(metric(number(m.pageviews),'Pageviews / 30 days'));if('visitors'in m)bits.push(metric(number(m.visitors),'Visitors / 30 days'));if(m.audit)bits.push(metric(m.audit.score??'Unavailable','Audit score'),metric(number(m.audit.pages),'Pages audited'));if(m.authority)bits.push(metric(m.authority.score,'Zo Authority'),metric(number(m.authority.referringHosts),'Referring hosts'));for(const vital of m.vitals||[])bits.push(metric(vital.p75,vital.metric+' p75'));const trendKey='pageviews'in m?'pageviews':'visitors'in m?'visitors':null;return '<article class="property" style="--i:'+index+'"><div class="property-head"><div><h2>'+esc(item.name)+'</h2>'+(item.url?'<a class="property-url" href="'+esc(item.url)+'" rel="noreferrer">'+esc(new URL(item.url).hostname)+'</a>':'')+'</div></div>'+(bits.length?'<div class="metrics">'+bits.join('')+'</div>':'')+(trendKey&&Array.isArray(m.trend)?chart(m.trend,trendKey):'')+'</article>'}
    fetch('/api/pulse',{headers:{Accept:'application/json'}}).then(response=>{if(!response.ok)throw new Error('Public metrics are temporarily unavailable');return response.json()}).then(data=>{const items=Array.isArray(data.properties)?data.properties:[];meta.hidden=false;meta.innerHTML='<div><strong>'+number(items.length)+'</strong><span>Published properties</span></div><div><strong>'+esc(date(data.generatedAt))+'</strong><span>Snapshot generated</span></div>';disclosure.textContent=data.disclosure||'Aggregated metrics only.';content.innerHTML=items.length?items.map(propertyCard).join(''):'<div class="empty"><div><strong>No public metrics yet</strong>The owner has not enabled a Pulse property.</div></div>'}).catch(error=>{content.innerHTML='<div class="error"><div><strong>Pulse is unavailable</strong>'+esc(error.message)+'</div></div>'});
  </script>
</body>
</html>`;
}
