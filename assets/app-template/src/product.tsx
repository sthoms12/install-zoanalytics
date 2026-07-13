import { useState } from "react";
import { IconBolt, IconCheck, IconChevronRight, IconDownload, IconFileAnalytics, IconFlag, IconRoute, IconTargetArrow } from "@tabler/icons-react";

export type SetupData = {
  appVersion: string; complete: boolean; completedSteps: number;
  steps: Array<{ id: string; label: string; complete: boolean; detail: string }>;
  properties: Array<{ id: string; name: string; status: string }>;
};

export type ActionData = {
  key: string; propertyId: string; pageUrl: string; category: string; severity: string; title: string;
  why: string; evidence: string; fix: string; impact: number; confidence: number; effort: number; priority: number;
};

export type FunnelData = {
  id: string; propertyId: string; name: string; windowMinutes: number;
  steps: Array<{ type: "page" | "event"; value: string }>;
  results: Array<{ type: string; value: string; sessions: number; conversionFromPrevious: number }>;
};

export type BriefData = { id: string; periodStart: string; periodEnd: string; createdAt: string; payload: Record<string, any> };

type Property = { id: string; name: string; url: string };

async function post(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`);
  return response.json();
}

export function SetupGuide({ setup, onRefresh, onAudit }: { setup: SetupData; onRefresh: () => Promise<void>; onAudit: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  if (setup.complete) return null;
  async function run(id: string) {
    setBusy(id); setMessage("");
    try {
      if (id === "discover") await post("/api/analytics/discover");
      if (id === "verify") for (const property of setup.properties) await post(`/api/analytics/verify/${encodeURIComponent(property.id)}`);
      if (id === "audit") await onAudit();
      await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Setup step failed"); }
    finally { setBusy(""); }
  }
  return <section className="mb-6 overflow-hidden rounded-xl border border-[#58e0c0]/20 bg-[#0d1718]">
    <div className="grid gap-6 p-5 lg:grid-cols-[.75fr_1.25fr] lg:p-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#58e0c0]">Getting started · {setup.completedSteps}/{setup.steps.length}</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.04em]">Finish your analytics baseline</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#82928d]">ZoAnalytics needs a public inventory, verified tracker coverage, one crawl, and meaningful outcomes. Verification never records a fake visit.</p><p className="mt-4 text-[10px] text-[#5f706b]">Version {setup.appVersion}</p></div>
      <div className="space-y-1">{setup.steps.map((step) => <div key={step.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg px-3 py-3 hover:bg-white/[.035]"><span className={`grid size-7 place-items-center rounded-md ${step.complete ? "bg-[#58e0c0] text-[#07110e]" : "border border-white/10 text-[#65736f]"}`}>{step.complete ? <IconCheck size={15}/> : <span className="size-1.5 rounded-full bg-current"/>}</span><div><p className="text-sm font-medium">{step.label}</p><p className="mt-1 text-[10px] text-[#65736f]">{step.detail}</p></div>{!step.complete && step.id !== "goals" && <button disabled={Boolean(busy)} onClick={() => void run(step.id)} className="za-secondary-button">{busy === step.id ? "Working" : step.id === "verify" ? "Verify all" : step.id === "audit" ? "Run audit" : "Discover"}</button>}</div>)}{message && <p className="px-3 pt-2 text-xs text-[#ff9d96]">{message}</p>}</div>
    </div>
  </section>;
}

export function ActionCenter({ actions, properties, onRefresh }: { actions: ActionData[]; properties: Property[]; onRefresh: () => Promise<void> }) {
  const [expanded, setExpanded] = useState<string | null>(actions[0]?.key ?? null);
  const [busy, setBusy] = useState("");
  async function update(action: ActionData, status: "resolved" | "dismissed", snoozedUntil?: string) {
    setBusy(action.key);
    await fetch(`/api/analytics/actions/${encodeURIComponent(action.key)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, snoozedUntil }) });
    await onRefresh(); setBusy("");
  }
  return <div className="space-y-4">
    <section className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]"><div className="za-panel"><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#58e0c0]">Decision queue</p><h2 className="mt-2 text-3xl font-semibold tracking-[-.05em]">{actions.length} things worth your attention</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#71817c]">Ordered by impact, confidence, and effort. Resolve an item after you make the change; dismiss it when it does not match your intent.</p></div><div className="za-panel"><div className="space-y-1">{actions.slice(0, 20).map((action) => {
      const property = properties.find((item) => item.id === action.propertyId); const open = expanded === action.key;
      return <article key={action.key} className="border-b border-white/[.06] last:border-0"><button onClick={() => setExpanded(open ? null : action.key)} className="grid w-full grid-cols-[8px_1fr_auto] gap-3 px-2 py-3 text-left"><span className={`mt-1.5 size-2 rounded-full ${action.severity === "critical" ? "bg-[#ff8178]" : action.severity === "warning" ? "bg-[#efc86b]" : "bg-[#74837f]"}`}/><div className="min-w-0"><p className="text-sm font-medium text-[#e2ebe8]">{action.title}</p><p className="mt-1 truncate text-[10px] uppercase tracking-[.08em] text-[#61706c]">{property?.name ?? action.propertyId} · {action.category} · priority {action.priority}</p></div><IconChevronRight size={16} className={`mt-1 text-[#56645f] transition ${open ? "rotate-90 text-[#58e0c0]" : ""}`}/></button>{open && <div className="mb-4 ml-5 border-l border-[#58e0c0]/20 pl-5"><div className="grid gap-4 py-2 md:grid-cols-3"><Detail label="Why it matters" text={action.why}/><Detail label="Evidence" text={action.evidence}/><Detail label="Recommended fix" text={action.fix}/></div><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy === action.key} onClick={() => void update(action, "resolved")} className="za-primary-button">Verify resolved</button><button disabled={busy === action.key} onClick={() => void update(action, "dismissed")} className="za-secondary-button">Dismiss</button><button disabled={busy === action.key} onClick={() => void update(action, "resolved", new Date(Date.now() + 7 * 86400000).toISOString())} className="za-text-button">Snooze 7 days</button></div></div>}</article>;
    })}{!actions.length && <div className="grid min-h-56 place-items-center text-center"><div><IconCheck size={25} className="mx-auto text-[#58e0c0]"/><p className="mt-3 text-sm font-medium">Nothing urgent</p><p className="mt-1 text-xs text-[#65736f]">The next crawl or traffic change may create new actions.</p></div></div>}</div></div></section>
  </div>;
}

function Detail({ label, text }: { label: string; text: string }) { return <div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#61706c]">{label}</p><p className="mt-2 text-xs leading-5 text-[#a8b6b1]">{text}</p></div>; }

export function PageExplorer({ pages, properties }: { pages: Array<{ propertyId: string; path: string; title: string | null; seoScore: number; statusCode: number }>; properties: Property[] }) {
  const [selected, setSelected] = useState<{ propertyId: string; path: string } | null>(pages[0] ?? null);
  const [detail, setDetail] = useState<any>(null); const [busy, setBusy] = useState(false);
  async function open(propertyId: string, path: string) { setSelected({ propertyId, path }); setBusy(true); const response = await fetch(`/api/analytics/pages/${encodeURIComponent(propertyId)}?path=${encodeURIComponent(path)}`); setDetail(await response.json()); setBusy(false); }
  return <section className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]"><div className="za-panel"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#65736f]">Page inventory</p><div className="mt-4 space-y-1">{pages.map((page) => <button key={`${page.propertyId}:${page.path}`} onClick={() => void open(page.propertyId, page.path)} className={`grid w-full grid-cols-[1fr_auto] gap-3 rounded-lg px-3 py-3 text-left transition ${selected?.propertyId === page.propertyId && selected.path === page.path ? "bg-white/[.07]" : "hover:bg-white/[.035]"}`}><div className="min-w-0"><p className="truncate text-sm">{page.title || page.path}</p><p className="mt-1 truncate text-[10px] text-[#61706c]">{properties.find((item) => item.id === page.propertyId)?.name} · {page.path}</p></div><span className={page.seoScore >= 85 ? "text-[#70d9b9]" : page.seoScore >= 65 ? "text-[#efc86b]" : "text-[#ff8178]"}>{page.seoScore}</span></button>)}</div></div><div className="za-panel">{busy ? <p className="text-sm text-[#71817c]">Reading page signals…</p> : detail ? <PageDetail detail={detail}/> : <div className="grid min-h-72 place-items-center text-center"><div><IconFileAnalytics className="mx-auto text-[#55635f]"/><p className="mt-3 text-sm">Select a page</p><p className="mt-1 text-xs text-[#65736f]">Traffic, search, performance, links, errors, and changes appear together.</p></div></div>}</div></section>;
}

function PageDetail({ detail }: { detail: any }) {
  const traffic = detail.traffic ?? {};
  return <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#58e0c0]">Unified page detail</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">{detail.page?.title || detail.path}</h2><p className="mt-1 break-all text-xs text-[#61706c]">{detail.page?.url || detail.path}</p><div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/[.07] md:grid-cols-4"><Metric label="Views" value={traffic.pageviews ?? 0}/><Metric label="Visitors" value={traffic.visitors ?? 0}/><Metric label="SEO" value={detail.page?.seoScore ?? "—"}/><Metric label="Issues" value={detail.findings?.length ?? 0}/></div><div className="mt-5 grid gap-4 md:grid-cols-2"><SignalList title="Conversions and events" rows={(detail.events ?? []).map((item: any) => `${item.name} · ${item.count}`)}/><SignalList title="Field performance · p75" rows={(detail.vitals ?? []).map((item: any) => `${item.metric} · ${item.p75} · ${item.samples} samples`)}/><SignalList title="Technical findings" rows={(detail.findings ?? []).map((item: any) => item.message)}/><SignalList title="Recent changes" rows={(detail.changes ?? []).map((item: any) => `${item.field} changed`)}/><SignalList title="Observed rankings" rows={(detail.ranks ?? []).map((item: any) => `${item.keyword} · ${item.observedPosition ? `position ${item.observedPosition}` : "not observed"}`)}/><SignalList title="Errors" rows={(detail.errors ?? []).map((item: any) => `${item.message} · ${item.occurrences}`)}/></div></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="bg-[#0b1113] p-3"><p className="text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-[#61706c]">{label}</p></div>; }
function SignalList({ title, rows }: { title: string; rows: string[] }) { return <div><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#65736f]">{title}</p><div className="mt-2 space-y-1">{rows.slice(0, 5).map((row, index) => <p key={`${row}:${index}`} className="rounded-md bg-white/[.025] px-3 py-2 text-xs text-[#a8b6b1]">{row}</p>)}{!rows.length && <p className="text-xs text-[#53615d]">No observed data yet.</p>}</div></div>; }

export function Outcomes({ properties, goals, funnels, briefs, onRefresh }: { properties: Property[]; goals: Array<any>; funnels: FunnelData[]; briefs: BriefData[]; onRefresh: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [goalName, setGoalName] = useState(""); const [eventName, setEventName] = useState("outbound-click");
  const [funnelName, setFunnelName] = useState(""); const [start, setStart] = useState("/"); const [end, setEnd] = useState("outbound-click"); const [message, setMessage] = useState("");
  async function addGoal() { try { await post("/api/analytics/goals", { propertyId, name: goalName, eventName }); setGoalName(""); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add goal"); } }
  async function addFunnel() { try { await post("/api/analytics/funnels", { propertyId, name: funnelName, steps: [{ type: "page", value: start }, { type: "event", value: end }] }); setFunnelName(""); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add funnel"); } }
  const latest = briefs[0];
  return <div className="space-y-4"><section className="grid gap-4 xl:grid-cols-[1fr_1fr]"><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconTargetArrow size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Goals</p></div><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">Define what success means</h2><div className="mt-5 grid gap-2 sm:grid-cols-3"><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="za-input">{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select><input value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="Goal name" className="za-input"/><select value={eventName} onChange={(event) => setEventName(event.target.value)} className="za-input"><option value="outbound-click">Outbound click</option><option value="download">Download</option><option value="signup">Signup</option><option value="contact">Contact</option></select></div><button disabled={!propertyId || !goalName} onClick={() => void addGoal()} className="za-primary-button mt-3">Add goal</button><div className="mt-5 space-y-1">{goals.map((goal) => <div key={goal.id} className="flex items-center justify-between rounded-lg px-2 py-3 hover:bg-white/[.03]"><div><p className="text-sm">{goal.name}</p><p className="mt-1 text-[10px] text-[#61706c]">{properties.find((item) => item.id === goal.propertyId)?.name} · {goal.eventName}</p></div><p className="text-sm font-semibold tabular-nums">{goal.conversions} <span className="text-[10px] font-normal text-[#61706c]">conversions</span></p></div>)}</div></div><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconRoute size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Funnels</p></div><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">See where intent drops</h2><div className="mt-5 grid gap-2 sm:grid-cols-3"><input value={funnelName} onChange={(event) => setFunnelName(event.target.value)} placeholder="Funnel name" className="za-input"/><input value={start} onChange={(event) => setStart(event.target.value)} placeholder="Start path" className="za-input"/><input value={end} onChange={(event) => setEnd(event.target.value)} placeholder="End event" className="za-input"/></div><button disabled={!propertyId || !funnelName} onClick={() => void addFunnel()} className="za-primary-button mt-3">Create funnel</button><div className="mt-5 space-y-3">{funnels.map((funnel) => <div key={funnel.id} className="rounded-lg bg-white/[.025] p-3"><p className="text-sm font-medium">{funnel.name}</p><div className="mt-3 grid gap-px overflow-hidden rounded-md bg-white/[.07]" style={{ gridTemplateColumns: `repeat(${funnel.results.length}, minmax(0,1fr))` }}>{funnel.results.map((step) => <div key={`${step.type}:${step.value}`} className="bg-[#0b1113] p-3"><p className="truncate text-xs">{step.value}</p><p className="mt-2 text-xl font-semibold tabular-nums">{step.sessions}</p><p className="text-[9px] text-[#61706c]">{Math.round(step.conversionFromPrevious * 100)}% continue</p></div>)}</div></div>)}</div></div></section>
    <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]"><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconFlag size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Latest brief</p></div>{latest ? <><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">Since the previous week</h2><p className="mt-3 text-sm leading-6 text-[#9dacA7]">{latest.payload.summary}</p><div className="mt-5 space-y-2">{(latest.payload.actions ?? []).slice(0, 3).map((action: any) => <div key={action.key} className="rounded-lg bg-white/[.025] px-3 py-3"><p className="text-sm font-medium">{action.title}</p><p className="mt-1 text-xs text-[#71817c]">{action.fix}</p></div>)}</div></> : <><h2 className="mt-2 text-2xl font-semibold">No brief generated yet</h2><button onClick={() => void post("/api/analytics/reports/weekly").then(onRefresh)} className="za-primary-button mt-5">Generate first brief</button></>}</div><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconDownload size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Own your data</p></div><h2 className="mt-2 text-xl font-semibold">CSV exports</h2><div className="mt-4 grid grid-cols-2 gap-2">{["properties", "pageviews", "events", "pages", "findings", "backlinks"].map((dataset) => <a key={dataset} href={`/api/analytics/export/${dataset}.csv`} className="za-secondary-button capitalize">{dataset}</a>)}</div></div></section>{message && <p className="text-xs text-[#ff9d96]">{message}</p>}</div>;
}
