import { serveStatic } from "hono/bun";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import config from "./zosite.json";
import { Hono } from "hono";
import { getDashboard, getProperties, recordHit, type CollectPayload } from "./backend-lib/db";
import { crawlAllPublicProperties, crawlProperty } from "./backend-lib/crawler";
import { addCompetitor, addRankKeyword, createGoal, discoverProperties, discoverWebBacklinks, getIntelligence, recordRank, runRankChecks } from "./backend-lib/intelligence";
import { createFunnel, exportRows, getActionCampaigns, getActionCenter, getBriefs, getPageDetail, getSetupStatus, listFunnels, rowsToCsv, setActionCampaignState, setActionState, verifyTracker } from "./backend-lib/product";
import { addExternalProperty, discoverExternalProperties, getExternalSources } from "./backend-lib/external";
import { getPublicPulse, listPulseConfig, pulsePageHtml, refreshPulseSnapshot, updatePulseConfig } from "./backend-lib/pulse";
import { deleteChangeEvent, getLedger, logManualChangeEvent } from "./backend-lib/ledger";
import { getOverviewBrief } from "./backend-lib/overview";
import { applyFix, getFixCapability, listFixes, previewFix, revertFix } from "./backend-lib/fixes";
import { startWeeklyRefreshScheduler } from "./backend-lib/scheduler";
import { getPropertyWorkspace } from "./backend-lib/workspace";
import { listSurfaceInventory, persistSurfaceInventory } from "./backend-lib/surfaces";
import { applyTrackerInstall, previewTrackerInstall } from "./backend-lib/tracker-install";
import { listCampaignOutcomes, recordCampaignVerification, reopenCampaignOutcome } from "./backend-lib/campaign-outcomes";
import { createWeeklyOwnerBrief } from "./backend-lib/weekly-brief";
import { listMigrationRuns } from "./backend-lib/migration-import";

type Mode = "development" | "production";
const app = new Hono();
const collectorOnly = process.env.ZOANALYTICS_COLLECTOR_ONLY === "1" || process.env.ZOANALYTICS_COLLECTOR_ONLY === "true";

const mode: Mode =
  process.env.NODE_ENV === "production" ? "production" : "development";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

app.get("/api/health", (c) => c.json({ ok: true, app: "ZoAnalytics", version: getSetupStatus().appVersion }));
app.get("/api/pulse", (c) => c.json(getPublicPulse(), 200, {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
}));
app.get("/pulse", (c) => new Response(pulsePageHtml(), {
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  },
}));
if (collectorOnly) app.get("/", (c) => c.redirect("/pulse", 302));
app.use("/api/analytics/*", async (c, next) => {
  if (!collectorOnly) return next();
  if (c.req.path === "/api/analytics/collect") return next();
  return c.json({ error: "Private analytics APIs are unavailable on the public collector" }, 404, corsHeaders);
});
app.get("/api/analytics/properties", (c) => c.json({ properties: getProperties() }));
app.get("/api/analytics/properties/:propertyId/workspace", async (c) => {
  const days = Number.parseInt(c.req.query("days") ?? "30", 10);
  const workspace = await getPropertyWorkspace(c.req.param("propertyId"), days);
  return workspace ? c.json(workspace) : c.json({ error: "Property not found" }, 404);
});
app.get("/api/analytics/summary", (c) => {
  const days = Number.parseInt(c.req.query("days") ?? "30", 10);
  return c.json(getDashboard(days));
});
app.get("/api/analytics/overview", async (c) => c.json(await getOverviewBrief(Number(c.req.query("days") || 30))));
const inferredOwnerHandle = getProperties().map((item) => item.url.match(/^[a-z]+:\/\/[^/]+-([a-z0-9-]+)\.zocomputer\.io/i)?.[1]).find(Boolean);
const ownerHandle = process.env.ZO_OWNER_HANDLE?.trim() || inferredOwnerHandle;
const collectorOrigin = process.env.ZOANALYTICS_PUBLIC_ORIGIN
  ?? (config.publish?.label && ownerHandle ? `https://${config.publish.label}-${ownerHandle}.zocomputer.io` : "");
app.get("/api/analytics/intelligence", (c) => c.json({ ...getIntelligence(), collectorOrigin, externalSources: getExternalSources(), surfaceInventory: listSurfaceInventory() }));
app.get("/api/analytics/setup", (c) => c.json(getSetupStatus()));
app.get("/api/analytics/migrations", (c) => c.json({ runs: listMigrationRuns(), supported: ["umami", "plausible"] }));
app.get("/api/analytics/surfaces", (c) => c.json({ surfaces: listSurfaceInventory() }));
app.get("/api/analytics/pulse/config", (c) => c.json({ properties: listPulseConfig(), publicUrl: collectorOrigin ? `${collectorOrigin}/pulse` : "" }));
app.patch("/api/analytics/pulse/config/:propertyId", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json({ property: updatePulseConfig(c.req.param("propertyId"), body), snapshot: getPublicPulse() }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not update Pulse settings" }, 400); }
});
app.post("/api/analytics/pulse/refresh", (c) => c.json({ snapshot: refreshPulseSnapshot() }));
app.get("/api/analytics/actions", (c) => c.json({ actions: getActionCenter() }));
app.get("/api/analytics/action-campaigns", (c) => c.json({ campaigns: getActionCampaigns() }));
app.get("/api/analytics/campaign-outcomes", (c) => c.json({ outcomes: listCampaignOutcomes(c.req.query("propertyId")) }));
app.post("/api/analytics/campaign-outcomes/:id/reopen", (c) => {
  try { return c.json(reopenCampaignOutcome(c.req.param("id"))); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not reopen campaign" }, 404); }
});
app.patch("/api/analytics/action-campaigns/:key", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!["open", "dismissed", "resolved"].includes(body.status)) return c.json({ error: "Valid status is required" }, 400);
  try { return c.json(setActionCampaignState(c.req.param("key"), body.status, body.snoozedUntil, body.note)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not update campaign" }, 404); }
});
app.post("/api/analytics/action-campaigns/:key/verify", async (c) => {
  const campaign = getActionCampaigns().find((item) => item.key === c.req.param("key"));
  if (!campaign) return c.json({ error: "Action campaign not found" }, 404);
  if (campaign.category === "tracking") {
    const results = await Promise.all([...new Set(campaign.actions.map((item) => item.propertyId))].map((propertyId) => verifyTracker(propertyId, collectorOrigin)));
    recordCampaignVerification(campaign, results.every((item) => item.ok), results.every((item) => item.ok) ? "Tracker delivery was verified on the public surface." : "Tracker verification failed; the campaign was reopened.");
    return c.json({ verified: results.every((item) => item.ok), results, campaign: getActionCampaigns().find((item) => item.key === campaign.key) ?? null });
  }
  if (campaign.category === "site audit" || campaign.category === "data health") {
    await crawlProperty(campaign.propertyId, 20);
    const verified = !getActionCampaigns().some((item) => item.key === campaign.key);
    recordCampaignVerification(campaign, verified, verified ? "The originating crawl finding is no longer present." : "The originating finding remains after verification; the campaign was reopened.");
    return c.json({ verified, campaign: getActionCampaigns().find((item) => item.key === campaign.key) ?? null });
  }
  return c.json({ error: "This campaign needs manual verification" }, 400);
});
app.patch("/api/analytics/actions/:key", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!["open", "dismissed", "resolved"].includes(body.status)) return c.json({ error: "Valid status is required" }, 400);
  return c.json(setActionState(c.req.param("key"), body.status, body.snoozedUntil, body.note));
});
app.get("/api/analytics/pages/:propertyId", (c) => {
  const detail = getPageDetail(c.req.param("propertyId"), c.req.query("path") ?? "/");
  return detail ? c.json(detail) : c.json({ error: "Page or property not found" }, 404);
});
app.get("/api/analytics/funnels", (c) => c.json({ funnels: listFunnels() }));
app.post("/api/analytics/funnels", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json(createFunnel(body), 201); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Invalid funnel" }, 400); }
});
app.get("/api/analytics/briefs", (c) => c.json({ briefs: getBriefs() }));
app.get("/api/analytics/ledger", async (c) => c.json({ events: await getLedger() }));
app.post("/api/analytics/ledger", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json(logManualChangeEvent(body), 201); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not log change" }, 400); }
});
app.delete("/api/analytics/ledger/:id", (c) => c.json(deleteChangeEvent(c.req.param("id"))));
app.get("/api/analytics/fixes", (c) => c.json({ fixes: listFixes(c.req.query("propertyId") ?? undefined) }));
app.get("/api/analytics/fixes/capability/:propertyId", async (c) => c.json(await getFixCapability(c.req.param("propertyId"))));
app.post("/api/analytics/fixes/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json(await previewFix(body.propertyId, body.code, body.value)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not preview this fix" }, 400); }
});
app.post("/api/analytics/fixes/apply", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json(await applyFix(body.propertyId, body.code, body.value, body.actionKey), 201); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not apply this fix" }, 400); }
});
app.post("/api/analytics/fixes/:id/revert", async (c) => {
  try { return c.json(await revertFix(c.req.param("id"))); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not revert this fix" }, 400); }
});
app.get("/api/analytics/export/:dataset", (c) => {
  const dataset = c.req.param("dataset").replace(/\.csv$/i, ""); const rows = exportRows(dataset);
  if (!rows) return c.json({ error: "Unknown export dataset" }, 404);
  return new Response(rowsToCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="zoanalytics-${dataset}.csv"` } });
});
app.post("/api/analytics/discover", async (c) => c.json(await discoverProperties()));
app.post("/api/analytics/discover/inventory", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.surfaces)) return c.json({ error: "surfaces must be an array" }, 400);
  try { return c.json({ surfaces: persistSurfaceInventory(body.surfaces) }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not reconcile inventory" }, 400); }
});
app.post("/api/analytics/discover/external", async (c) => c.json(await discoverExternalProperties()));
app.post("/api/analytics/properties/external", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json(await addExternalProperty(body), 201); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not add external site" }, 400); }
});
app.post("/api/analytics/verify/:propertyId", async (c) => c.json(await verifyTracker(c.req.param("propertyId"), collectorOrigin)));
app.post("/api/analytics/tracker/:propertyId/preview", async (c) => {
  try { return c.json(await previewTrackerInstall(c.req.param("propertyId"), collectorOrigin)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not preview tracker installation" }, 400); }
});
app.post("/api/analytics/tracker/:propertyId/apply", async (c) => {
  try { return c.json(await applyTrackerInstall(c.req.param("propertyId"), collectorOrigin)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not apply tracker installation" }, 400); }
});
app.post("/api/analytics/goals", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.propertyId !== "string" || typeof body.name !== "string" || typeof body.eventName !== "string") return c.json({ error: "propertyId, name, and eventName are required" }, 400);
  return c.json(createGoal(body), 201);
});
app.post("/api/analytics/rank-watchlist", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.propertyId !== "string" || typeof body.keyword !== "string") return c.json({ error: "propertyId and keyword are required" }, 400);
  return c.json(addRankKeyword(body), 201);
});
app.post("/api/analytics/rank-observations", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.propertyId !== "string" || typeof body.keyword !== "string" || typeof body.targetUrl !== "string") return c.json({ error: "propertyId, keyword, and targetUrl are required" }, 400);
  return c.json(recordRank(body), 201);
});
app.post("/api/analytics/competitors", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.propertyId !== "string" || typeof body.name !== "string" || typeof body.domain !== "string") return c.json({ error: "propertyId, name, and domain are required" }, 400);
  return c.json(addCompetitor(body), 201);
});
app.post("/api/analytics/reports/weekly", async (c) => c.json(await createWeeklyOwnerBrief(), 201));
app.post("/api/analytics/maintenance/ranks", async (c) => c.json({ results: await runRankChecks() }));
app.post("/api/analytics/maintenance/backlinks", async (c) => c.json({ results: await discoverWebBacklinks() }));
app.post("/api/analytics/crawl", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const propertyId = typeof body.propertyId === "string" ? body.propertyId : null;
  const maxPages = typeof body.maxPages === "number" ? Math.max(1, Math.min(100, Math.floor(body.maxPages))) : 25;
  const result = propertyId ? await crawlProperty(propertyId, maxPages) : await crawlAllPublicProperties(maxPages);
  return c.json({ result });
});

app.options("/api/analytics/collect", (c) => new Response(null, { status: 204, headers: corsHeaders }));
app.post("/api/analytics/collect", async (c) => {
  let payload: CollectPayload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400, corsHeaders);
  }

  const result = recordHit(payload, c.req.raw);
  if (!result.ok) return c.json({ error: result.error }, result.status as 404, corsHeaders);
  return c.json({ ok: true }, 202, corsHeaders);
});

app.get("/zowa.js", (c) => {
  const script = `(() => {
  const currentScript = document.currentScript;
  const siteId = currentScript?.getAttribute("data-site") || currentScript?.getAttribute("data-site-id");
  const endpoint = currentScript?.getAttribute("data-endpoint") || new URL("/api/analytics/collect", currentScript?.src || window.location.href).toString();
  if (!siteId || !endpoint || window.__zoanalyticsLoaded) return;
  if (navigator.webdriver) return;
  window.__zoanalyticsLoaded = true;

  const SESSION_KEY = "zoanalytics_session";
  const SESSION_TTL = 30 * 60 * 1000;
  function session() {
    const now = Date.now();
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (saved && saved.id && now - saved.touched < SESSION_TTL) {
        saved.touched = now; sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved)); return saved.id;
      }
      const value = { id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2), touched: now };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); return value.id;
    } catch { return null; }
  }

  const sessionId = session();
  const params = new URLSearchParams(location.search);
  const campaign = {
    source: params.get("utm_source") || null, medium: params.get("utm_medium") || null,
    campaign: params.get("utm_campaign") || null, content: params.get("utm_content") || null,
    term: params.get("utm_term") || null,
  };

  function payload(extra) {
    return {
      siteId,
      path: window.location.pathname + window.location.search,
      title: document.title,
      url: window.location.href,
      referrer: document.referrer || null,
      screen: window.screen ? window.screen.width + "x" + window.screen.height : null,
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      sessionId,
      campaign,
      ...extra,
    };
  }

  function send(extra = {}) {
    const body = JSON.stringify(payload(extra));
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }

  let lastPath = "";
  function pageview() {
    const nextPath = window.location.pathname + window.location.search;
    if (nextPath === lastPath) return;
    lastPath = nextPath;
    send();
  }

  const pushState = history.pushState;
  const replaceState = history.replaceState;
  history.pushState = function () { pushState.apply(this, arguments); queueMicrotask(pageview); };
  history.replaceState = function () { replaceState.apply(this, arguments); queueMicrotask(pageview); };
  window.addEventListener("popstate", pageview);
  window.zoanalytics = { track: (event, data) => send({ event, data }) };
  pageview();

  let cls = 0;
  let inp = 0;
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value; })
      .observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => { const entries = list.getEntries(); const last = entries[entries.length - 1]; if (last) send({ event: "web-vital", data: { metric: "LCP", value: Math.round(last.startTime), rating: last.startTime <= 2500 ? "good" : last.startTime <= 4000 ? "needs-improvement" : "poor" } }); })
      .observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.interactionId && entry.duration > inp) inp = entry.duration; })
      .observe({ type: "event", buffered: true, durationThreshold: 40 });
  } catch {}
  addEventListener("load", () => setTimeout(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav) send({ event: "web-vital", data: { metric: "TTFB", value: Math.round(nav.responseStart), rating: nav.responseStart <= 800 ? "good" : nav.responseStart <= 1800 ? "needs-improvement" : "poor" } });
  }, 0), { once: true });
  addEventListener("pagehide", () => {
    send({ event: "web-vital", data: { metric: "CLS", value: Math.round(cls * 1000) / 1000, rating: cls <= .1 ? "good" : cls <= .25 ? "needs-improvement" : "poor" } });
    if (inp > 0) send({ event: "web-vital", data: { metric: "INP", value: Math.round(inp), rating: inp <= 200 ? "good" : inp <= 500 ? "needs-improvement" : "poor" } });
  }, { once: true });
  addEventListener("error", (event) => {
    const target = event.target;
    if (target && target !== window) send({ event: "resource-error", data: { message: "Resource failed to load", source: target.src || target.href || target.tagName } });
    else send({ event: "client-error", data: { message: event.message || "Uncaught error", source: event.filename || null } });
  }, true);
  addEventListener("unhandledrejection", (event) => send({ event: "client-error", data: { message: String(event.reason?.message || event.reason || "Unhandled promise rejection"), source: "promise" } }));
  addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) send({ event: "outbound-click", data: { destination: url.href } });
    if (/\.(pdf|zip|csv|docx?|xlsx?|pptx?)$/i.test(url.pathname)) send({ event: "download", data: { file: url.pathname } });
  }, true);
})();`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
    },
  });
});

if (collectorOnly) {
  app.get("*", (c) => c.json({ ok: true, app: "ZoAnalytics collector", endpoints: ["/pulse", "/api/pulse", "/zowa.js", "/api/analytics/collect"] }));
} else if (mode === "production") {
  configureProduction(app);
} else {
  await configureDevelopment(app);
}

if (!collectorOnly) startWeeklyRefreshScheduler();

const port = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : mode === "production"
    ? (config.publish?.published_port ?? config.local_port)
    : config.local_port;

export default { fetch: app.fetch, port, idleTimeout: 255 };

function configureProduction(app: Hono) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.use(async (c, next) => {
    if (c.req.method !== "GET") return next();

    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/") || path === "/zowa.js") return next();

    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) return new Response(file);
    }

    return serveStatic({ path: "./dist/index.html" })(c, next);
  });
}

async function configureDevelopment(app: Hono): Promise<ViteDevServer> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });

  const stripViteClient = (html: string) =>
    html.replace(/\s*<script type="module" src="\/@vite\/client"><\/script>\s*/g, "\n");

  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/") || c.req.path === "/zowa.js") return next();
    if (c.req.path === "/favicon.ico") return c.redirect("/favicon.svg", 302);

    const url = c.req.path;
    try {
      if (url === "/" || url === "/index.html") {
        let template = await Bun.file("./index.html").text();
        template = stripViteClient(await vite.transformIndexHtml(url, template));
        return c.html(template, { headers: { "Cache-Control": "no-store, must-revalidate" } });
      }

      const publicFile = Bun.file(`./public${url}`);
      if (await publicFile.exists()) {
        const stat = await publicFile.stat();
        if (stat && !stat.isDirectory()) {
          return new Response(publicFile, { headers: { "Cache-Control": "no-store, must-revalidate" } });
        }
      }

      let result;
      try {
        result = await vite.transformRequest(url);
      } catch {
        result = null;
      }

      if (result) {
        return new Response(result.code, {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-store, must-revalidate",
          },
        });
      }

      let template = await Bun.file("./index.html").text();
      template = stripViteClient(await vite.transformIndexHtml("/", template));
      return c.html(template, { headers: { "Cache-Control": "no-store, must-revalidate" } });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error(error);
      return c.text("Internal Server Error", 500);
    }
  });

  return vite;
}
