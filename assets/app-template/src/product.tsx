import { useEffect, useState } from "react";
import { IconArrowBackUp, IconBolt, IconCheck, IconChevronRight, IconCloudUpload, IconDownload, IconExternalLink, IconEye, IconFileAnalytics, IconFlag, IconGitBranch, IconHistory, IconPlus, IconRefresh, IconRoute, IconRouteAltLeft, IconShieldLock, IconTargetArrow, IconTrash } from "@tabler/icons-react";
import { SampleWarning } from "@/components/data-state";

export type SetupData = {
  appVersion: string; complete: boolean; completedSteps: number;
  steps: Array<{ id: string; label: string; complete: boolean; detail: string }>;
  properties: Array<{ id: string; name: string; status: string; projectPath: string | null }>;
  inventory: Array<{ sourceKey: string; name: string; classification: string; canonicalUrl: string | null; conflict: string | null; nextAction: string }>;
  nextActions: Array<{ propertyId: string; name: string; status: string; projectPath: string | null; action: string }>;
};

export type ActionData = {
  key: string; propertyId: string; pageUrl: string; category: string; severity: string; title: string;
  why: string; evidence: string; fix: string; impact: number; confidence: number; effort: number; priority: number;
  fixCode: string | null; freshness: string; verificationMethod: string; expectedImpact: string;
};

export type ActionCampaignData = {
  key: string; propertyId: string; category: string; severity: string; title: string; rationale: string;
  recommendedFix: string; affectedPages: number; representativeEvidence: string; priority: number; effort: number;
  fixability: "fixable" | "partially-fixable" | "manual"; fixCode: string | null; childKeys: string[]; actions: ActionData[];
  freshness: string; verificationMethod: string; expectedImpact: string; confidence: number;
};

export type SafeFix = { id: string; propertyId: string; actionKey: string | null; code: string; filePath: string; status: "applied" | "reverted"; appliedAt: string; revertedAt: string | null };

type FixPreview = { propertyId: string; code: string; filePath: string; before: string; after: string; changed: boolean; needsValue: boolean; suggestedValue: string | null };

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

type Delta = { before: number; after: number; change: number; pct: number };

export type LedgerEvent = {
  id: string; propertyId: string; propertyName: string; source: "commit" | "content" | "tracker" | "manual" | "fix" | "deployment" | "space";
  kind: string; title: string; detail: string | null; pageUrl: string | null; occurredAt: string;
  receipt: { knowledge: "observed" | "inferred"; provider?: string; sourceId?: string; revision?: string; unavailable?: string[] };
  outcome: { windowDays: number; pageviews: Delta; visitors: Delta; engagement: Delta; poorVitals: Delta; seoScore: Delta | null; sampleSize: number; coOccurring: number; confidence: "low" | "medium" | "high" };
};

const ledgerWhen = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`));

const sourceMeta: Record<LedgerEvent["source"], { label: string; icon: typeof IconGitBranch; color: string }> = {
  commit: { label: "Code change", icon: IconGitBranch, color: "#7aa2ff" },
  content: { label: "Content edit", icon: IconFileAnalytics, color: "#efc86b" },
  tracker: { label: "Tracking", icon: IconShieldLock, color: "#58e0c0" },
  manual: { label: "Manual note", icon: IconFlag, color: "#c992ff" },
  fix: { label: "Safe fix", icon: IconBolt, color: "#70d9b9" },
  deployment: { label: "Zo deployment", icon: IconCloudUpload, color: "#ff9f6e" },
  space: { label: "Space revision", icon: IconRouteAltLeft, color: "#66d2ff" },
};

const confidenceColor: Record<string, string> = { low: "text-[#ff8178]", medium: "text-[#efc86b]", high: "text-[#70d9b9]" };

function DeltaChip({ label, delta, reliable = true }: { label: string; delta: Delta | null; reliable?: boolean }) {
  if (!delta) return null;
  const tone = delta.pct === 0 ? "text-[#a8b6b1]" : delta.pct > 0 ? "text-[#70d9b9]" : "text-[#ff8178]";
  return <div className="rounded-lg bg-white/[.025] px-3 py-2">
    <p className="text-[9px] uppercase tracking-wider text-[#61706c]">{label}</p>
    <p className={`mt-1 text-sm font-semibold tabular-nums ${reliable ? tone : "text-[#71807c]"}`}>{reliable ? `${delta.pct > 0 ? "+" : ""}${delta.pct}%` : "Trend pending"}</p>
    <p className="text-[10px] text-[#61706c]">{delta.before} → {delta.after}</p>
  </div>;
}

export function Ledger({ events, properties, onRefresh }: { events: LedgerEvent[]; properties: Property[]; onRefresh: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setBusy(true); setMessage("");
    try { await post("/api/analytics/ledger", { propertyId, title, detail: detail || undefined }); setTitle(""); setDetail(""); await onRefresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not log this change"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try { await fetch(`/api/analytics/ledger/${encodeURIComponent(id)}`, { method: "DELETE" }); await onRefresh(); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <div className="za-panel">
      <div className="flex items-center gap-2 text-[#58e0c0]"><IconHistory size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Log a change</p></div>
      <p className="mt-2 max-w-2xl text-sm text-[#8b9995]">Zo publications, service restarts, Space revisions, commits, content edits, tracker installs, and your own notes are lined up against pageviews, visitors, engagement, Core Web Vitals, and SEO score in the surrounding week.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="za-input">{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What changed? e.g. Relaunched the pricing page" className="za-input"/>
        <button disabled={busy || !propertyId || !title.trim()} onClick={() => void submit()} className="za-primary-button"><IconPlus size={16}/><span>Log change</span></button>
      </div>
      <textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Optional detail" className="za-input mt-2 w-full" rows={2} />
      {message && <p className="mt-2 text-xs text-[#ff8178]">{message}</p>}
    </div>
    <div className="za-panel">
      {!events.length ? <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-white/10 p-5 text-center"><div><IconHistory className="mx-auto text-[#54625f]" size={22}/><p className="mt-3 text-sm font-medium text-[#bdc8c5]">No changes recorded yet</p><p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[#65736f]">Commits, content edits, and tracker installs will appear here automatically as they happen.</p></div></div> : <div className="space-y-1">
        {events.map((event) => {
          const meta = sourceMeta[event.source] ?? sourceMeta.manual; const Icon = meta.icon;
          const reliable = event.outcome.sampleSize >= 20 && event.outcome.confidence !== "low";
          return <article key={event.id} className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-white/[.06] px-2 py-4 last:border-0">
            <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}><Icon size={15} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-[#e2ebe8]">{event.title}</p><span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#8b9995]">{meta.label}</span></div>
              <p className="mt-1 truncate text-[10px] uppercase tracking-[.08em] text-[#61706c]">{event.propertyName} · {ledgerWhen(event.occurredAt)}{event.pageUrl ? ` · ${event.pageUrl}` : ""}</p>
              {event.detail && <p className="mt-2 text-xs leading-5 text-[#a8b6b1]">{event.detail}</p>}
              {(event.receipt.revision || event.receipt.unavailable?.length) && <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#71807c]"><span className="rounded bg-white/[.04] px-2 py-1 uppercase tracking-wider">{event.receipt.knowledge}</span>{event.receipt.revision && <span className="rounded bg-white/[.04] px-2 py-1 font-mono">rev {event.receipt.revision}</span>}{event.receipt.unavailable?.length ? <span>Unavailable: {event.receipt.unavailable.join(", ")}</span> : null}</div>}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DeltaChip label="Pageviews" delta={event.outcome.pageviews} reliable={reliable} />
                <DeltaChip label="Visitors" delta={event.outcome.visitors} reliable={reliable} />
                <DeltaChip label="Engagement" delta={event.outcome.engagement} reliable={reliable} />
                {event.outcome.seoScore && <DeltaChip label="SEO score" delta={event.outcome.seoScore} reliable={reliable} />}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#61706c]"><span className={`font-semibold uppercase ${confidenceColor[event.outcome.confidence]}`}>{event.outcome.confidence} confidence</span><SampleWarning sample={event.outcome.sampleSize} minimum={20} subject="Ledger outcome" /><span>· sampled over {event.outcome.windowDays}-day windows{event.outcome.coOccurring > 0 ? ` · ${event.outcome.coOccurring} other change${event.outcome.coOccurring === 1 ? "" : "s"} nearby` : ""}</span></div>
            </div>
            {event.source === "manual" ? <button onClick={() => void remove(event.id)} disabled={busy} className="za-icon-button self-start" aria-label="Delete note"><IconTrash size={15} /></button> : <span />}
          </article>;
        })}
      </div>}
    </div>
  </div>;
}

export function SetupGuide({ setup, onRefresh, onAudit }: { setup: SetupData; onRefresh: () => Promise<void>; onAudit: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [trackerPreview, setTrackerPreview] = useState<{ propertyId: string; filePath: string; snippet: string; changed: boolean; alreadyInstalled: boolean } | null>(null);
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
  async function previewTracker(propertyId: string) {
    setBusy(`preview:${propertyId}`); setMessage(""); setTrackerPreview(null);
    try { setTrackerPreview(await post(`/api/analytics/tracker/${encodeURIComponent(propertyId)}/preview`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not preview tracker installation"); }
    finally { setBusy(""); }
  }
  async function applyTracker(propertyId: string) {
    setBusy(`apply:${propertyId}`); setMessage("");
    try {
      await post(`/api/analytics/tracker/${encodeURIComponent(propertyId)}/apply`);
      setMessage("Tracker added to the local source. Republish the Zo Site, then run Verify all.");
      setTrackerPreview(null); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not apply tracker installation"); }
    finally { setBusy(""); }
  }
  const pending = setup.nextActions.filter((item) => item.status !== "tracked");
  return <section className="mb-6 overflow-hidden rounded-xl border border-[#58e0c0]/20 bg-[#0d1718]">
    <div className="grid gap-6 p-5 lg:grid-cols-[.75fr_1.25fr] lg:p-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#58e0c0]">Getting started · {setup.completedSteps}/{setup.steps.length}</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.04em]">Finish your analytics baseline</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#82928d]">ZoAnalytics needs a public inventory, verified tracker coverage, one crawl, and meaningful outcomes. Verification never records a fake visit.</p><p className="mt-4 text-[10px] text-[#5f706b]">Version {setup.appVersion}</p></div>
      <div className="space-y-1">{setup.steps.map((step) => <div key={step.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg px-3 py-3 hover:bg-white/[.035]"><span className={`grid size-7 place-items-center rounded-md ${step.complete ? "bg-[#58e0c0] text-[#07110e]" : "border border-white/10 text-[#65736f]"}`}>{step.complete ? <IconCheck size={15}/> : <span className="size-1.5 rounded-full bg-current"/>}</span><div><p className="text-sm font-medium">{step.label}</p><p className="mt-1 text-[10px] text-[#65736f]">{step.detail}</p></div>{!step.complete && step.id !== "goals" && <button disabled={Boolean(busy)} onClick={() => void run(step.id)} className="za-secondary-button">{busy === step.id ? "Working" : step.id === "verify" ? "Verify all" : step.id === "audit" ? "Run audit" : "Discover"}</button>}</div>)}</div>
    </div>
    {pending.length > 0 && <div className="border-t border-white/[.07] px-5 py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-[#dfe9e6]">Tracker coverage</h3><p className="mt-1 text-[10px] text-[#65736f]">Each public property has one explicit next action.</p></div><span className="text-[10px] font-semibold uppercase tracking-wider text-[#efc86b]">{pending.length} pending</span></div>
      <div className="divide-y divide-white/[.06]">{pending.map((item) => <div key={item.propertyId} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-sm font-medium text-[#d7e1de]">{item.name}</p><p className="mt-1 text-[10px] leading-4 text-[#71807c]">{item.action}</p></div>{item.projectPath && <button disabled={Boolean(busy)} onClick={() => void previewTracker(item.propertyId)} className="za-secondary-button shrink-0">{busy === `preview:${item.propertyId}` ? "Checking" : "Preview install"}</button>}</div>)}</div>
      {trackerPreview && <div className="mt-3 rounded-lg border border-[#58e0c0]/20 bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#58e0c0]">Safe tracker preview</p><p className="mt-1 text-xs text-[#8b9995]">{trackerPreview.filePath}</p></div>{trackerPreview.changed && <button disabled={Boolean(busy)} onClick={() => void applyTracker(trackerPreview.propertyId)} className="za-primary-button">{busy === `apply:${trackerPreview.propertyId}` ? "Applying" : "Apply to source"}</button>}</div><pre className="mt-3 overflow-x-auto rounded-md bg-black/30 p-3 text-[10px] leading-5 text-[#a9c4bc]">{trackerPreview.snippet}</pre>{trackerPreview.alreadyInstalled && <p className="mt-2 text-xs text-[#70d9b9]">The source already contains this tracker. Republish if the public page has not picked it up.</p>}</div>}
      {message && <p className={`mt-3 text-xs ${message.includes("added") ? "text-[#70d9b9]" : "text-[#ff9d96]"}`}>{message}</p>}
    </div>}
  </section>;
}

const fixCodeLabel: Record<string, string> = {
  missing_title: "Add a page title", missing_description: "Add a meta description",
  missing_canonical: "Add a canonical link", noindex: "Remove noindex",
};

function FixLab({ action, onApplied }: { action: ActionData; onApplied: () => Promise<void> }) {
  const [capability, setCapability] = useState<{ supported: boolean; reason: string | null } | null>(null);
  const [preview, setPreview] = useState<FixPreview | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPreview(null); setMessage(""); setValue(""); setCapability(null);
    if (!action.fixCode) return;
    fetch(`/api/analytics/fixes/capability/${encodeURIComponent(action.propertyId)}`, { headers: { Accept: "application/json" } })
      .then((response) => response.json()).then(setCapability)
      .catch(() => setCapability({ supported: false, reason: "Could not check fix eligibility" }));
  }, [action.key, action.fixCode, action.propertyId]);

  if (!action.fixCode) return null;
  if (!capability) return <p className="mt-3 text-[10px] text-[#61706c]">Checking whether this can be safely fixed…</p>;
  if (!capability.supported) return <p className="mt-3 text-[10px] text-[#61706c]">Safe Fix Lab: {capability.reason}</p>;

  async function runPreview() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/analytics/fixes/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: action.propertyId, code: action.fixCode, value: value || undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not preview this fix");
      setPreview(data);
      if (data.needsValue && data.suggestedValue && !value) setValue(data.suggestedValue);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not preview this fix"); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/analytics/fixes/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: action.propertyId, code: action.fixCode, value: value || undefined, actionKey: action.key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not apply this fix");
      setMessage("Fix applied and logged to the ledger."); setPreview(null);
      await onApplied();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not apply this fix"); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 rounded-lg border border-[#58e0c0]/20 bg-[#58e0c0]/[.04] p-4">
    <div className="flex items-center gap-2 text-[#58e0c0]"><IconBolt size={15}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Safe Fix Lab · {fixCodeLabel[action.fixCode] ?? action.fixCode}</p></div>
    <p className="mt-2 text-[10px] leading-4 text-[#61706c]">Edits the property's index.html shell directly. Every change is previewed first and can be reverted from Applied fixes below.</p>
    {(action.fixCode === "missing_title" || action.fixCode === "missing_description") && <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={action.fixCode === "missing_title" ? "Page title" : "Meta description"} className="za-input mt-3 w-full"/>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => void runPreview()} className="za-secondary-button">Preview change</button>
      {preview?.changed && <button disabled={busy} onClick={() => void apply()} className="za-primary-button">Apply fix</button>}
    </div>
    {preview && (preview.changed ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <div><p className="text-[9px] uppercase tracking-wider text-[#61706c]">Current file</p><pre className="mt-1 max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[10px] leading-4 text-[#a8b6b1]">{preview.before}</pre></div>
      <div><p className="text-[9px] uppercase tracking-wider text-[#61706c]">Proposed file</p><pre className="mt-1 max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[10px] leading-4 text-[#70d9b9]">{preview.after}</pre></div>
    </div> : <p className="mt-2 text-[10px] text-[#efc86b]">{preview.needsValue ? "Enter a value above, then preview again." : "No change needed — this may already be fixed."}</p>)}
    {message && <p className={`mt-2 text-xs ${message.includes("applied") ? "text-[#70d9b9]" : "text-[#ff8178]"}`}>{message}</p>}
  </div>;
}

function AppliedFixes({ fixes, properties, busyId, onRevert }: { fixes: SafeFix[]; properties: Property[]; busyId: string; onRevert: (id: string) => void }) {
  if (!fixes.length) return null;
  return <div className="za-panel">
    <div className="flex items-center gap-2 text-[#58e0c0]"><IconBolt size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Applied fixes</p></div>
    <div className="mt-3 space-y-1">{fixes.map((fix) => <div key={fix.id} className="flex items-center justify-between gap-3 border-b border-white/[.06] py-3 last:border-0">
      <div className="min-w-0"><p className="text-sm text-[#e2ebe8]">{fixCodeLabel[fix.code] ?? fix.code}</p><p className="mt-1 truncate text-[10px] uppercase tracking-[.08em] text-[#61706c]">{properties.find((item) => item.id === fix.propertyId)?.name ?? fix.propertyId} · {new Date(fix.appliedAt.endsWith("Z") ? fix.appliedAt : `${fix.appliedAt}Z`).toLocaleString()}{fix.status === "reverted" ? " · reverted" : ""}</p></div>
      {fix.status === "applied" && <button disabled={busyId === fix.id} onClick={() => onRevert(fix.id)} className="za-secondary-button shrink-0"><IconArrowBackUp size={14}/>Revert</button>}
    </div>)}</div>
  </div>;
}

export function ActionCenter({ campaigns, properties, onRefresh }: { campaigns: ActionCampaignData[]; properties: Property[]; onRefresh: () => Promise<void> }) {
  const [expanded, setExpanded] = useState<string | null>(campaigns[0]?.key ?? null);
  const [busy, setBusy] = useState("");
  const [fixes, setFixes] = useState<SafeFix[]>([]);
  const [revertBusy, setRevertBusy] = useState("");
  const [category, setCategory] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [fixability, setFixability] = useState("all");
  const [message, setMessage] = useState("");

  async function loadFixes() {
    const response = await fetch("/api/analytics/fixes", { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({ fixes: [] }));
    setFixes(data.fixes ?? []);
  }
  useEffect(() => { void loadFixes(); }, []);

  async function updateCampaign(campaign: ActionCampaignData, status: "resolved" | "dismissed", snoozedUntil?: string) {
    setBusy(campaign.key); setMessage("");
    try {
      const response = await fetch(`/api/analytics/action-campaigns/${encodeURIComponent(campaign.key)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, snoozedUntil }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not update campaign");
      setMessage(snoozedUntil ? "Campaign snoozed for seven days." : `Campaign marked ${status}.`); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update campaign"); }
    finally { setBusy(""); }
  }
  async function updateAction(action: ActionData, status: "resolved" | "dismissed", snoozedUntil?: string) {
    setBusy(action.key); setMessage("");
    try {
      const response = await fetch(`/api/analytics/actions/${encodeURIComponent(action.key)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, snoozedUntil }) });
      if (!response.ok) throw new Error("Could not update page action");
      setMessage(`Page action marked ${status}.`); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update page action"); }
    finally { setBusy(""); }
  }
  async function verifyCampaign(campaign: ActionCampaignData) {
    setBusy(campaign.key); setMessage("");
    try {
      const response = await fetch(`/api/analytics/action-campaigns/${encodeURIComponent(campaign.key)}/verify`, { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not verify campaign");
      setMessage("Source verification completed."); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not verify campaign");
    } finally { setBusy(""); }
  }
  async function revert(id: string) {
    setRevertBusy(id);
    try { await fetch(`/api/analytics/fixes/${encodeURIComponent(id)}/revert`, { method: "POST" }); await loadFixes(); }
    finally { setRevertBusy(""); }
  }
  const visible = campaigns.filter((item) => (category === "all" || item.category === category) && (severity === "all" || item.severity === severity) && (fixability === "all" || item.fixability === fixability));
  const categories = [...new Set(campaigns.map((item) => item.category))];
  return <div className="space-y-4">
    <div className="sr-only" role="status" aria-live="polite">{message}</div>
    <section className="grid gap-3 md:grid-cols-3">{campaigns.slice(0, 3).map((campaign, index) => <button key={campaign.key} onClick={() => setExpanded(campaign.key)} className="za-panel text-left"><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#58e0c0]">Priority {index + 1}</p><p className="mt-2 text-sm font-medium text-[#e2ebe8]">{campaign.title}</p><p className="mt-2 text-[10px] leading-4 text-[#71817c]">{campaign.expectedImpact}</p></button>)}</section>
    <section className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]"><div className="za-panel"><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#58e0c0]">Work campaigns</p><h2 className="mt-2 text-3xl font-semibold tracking-[-.05em]">{campaigns.length} pieces of work</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#71817c]">Repeated findings are grouped by property and recommended fix. Expand a campaign to inspect every affected page before acting.</p><div className="mt-5 grid gap-2 sm:grid-cols-3 xl:grid-cols-1"><select value={category} onChange={(event) => setCategory(event.target.value)} className="za-input"><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={severity} onChange={(event) => setSeverity(event.target.value)} className="za-input"><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select><select value={fixability} onChange={(event) => setFixability(event.target.value)} className="za-input"><option value="all">All fixability</option><option value="fixable">Safe Fix ready</option><option value="partially-fixable">Partly fixable</option><option value="manual">Manual</option></select></div></div><div className="za-panel"><div className="space-y-1">{visible.map((campaign) => {
      const property = properties.find((item) => item.id === campaign.propertyId); const open = expanded === campaign.key;
      return <article key={campaign.key} className="border-b border-white/[.06] last:border-0"><button onClick={() => setExpanded(open ? null : campaign.key)} className="grid w-full grid-cols-[8px_1fr_auto] gap-3 px-2 py-4 text-left"><span className={`mt-1.5 size-2 rounded-full ${campaign.severity === "critical" ? "bg-[#ff8178]" : campaign.severity === "warning" ? "bg-[#efc86b]" : "bg-[#74837f]"}`}/><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-[#e2ebe8]">{campaign.title}</p><span className="rounded bg-white/[.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[.08em] text-[#82918d]">{campaign.fixability === "fixable" ? "Safe Fix ready" : campaign.fixability}</span></div><p className="mt-1 truncate text-[10px] uppercase tracking-[.08em] text-[#61706c]">{property?.name ?? campaign.propertyId} · {campaign.category} · {campaign.affectedPages} affected · priority {campaign.priority}</p></div><IconChevronRight size={16} className={`mt-1 text-[#56645f] transition ${open ? "rotate-90 text-[#58e0c0]" : ""}`}/></button>{open && <div className="mb-5 ml-5 border-l border-[#58e0c0]/20 pl-5"><div className="grid gap-4 py-2 md:grid-cols-3"><Detail label="Why it matters" text={campaign.rationale}/><Detail label="Evidence" text={campaign.representativeEvidence}/><Detail label="Recommended fix" text={campaign.recommendedFix}/></div><div className="mt-3 flex flex-wrap gap-2">{(campaign.category === "tracking" || campaign.category === "site audit") && <button disabled={busy === campaign.key} onClick={() => void verifyCampaign(campaign)} className="za-primary-button">Verify in source</button>}<button disabled={busy === campaign.key} onClick={() => void updateCampaign(campaign, "resolved")} className="za-secondary-button">Mark resolved</button><button disabled={busy === campaign.key} onClick={() => void updateCampaign(campaign, "dismissed")} className="za-secondary-button">Dismiss campaign</button><button disabled={busy === campaign.key} onClick={() => void updateCampaign(campaign, "resolved", new Date(Date.now() + 7 * 86400000).toISOString())} className="za-text-button">Snooze all 7 days</button></div><p className="mt-2 text-[10px] leading-4 text-[#61706c]">Verify in source reruns tracking or the audit. Mark resolved records your decision without changing the source.</p><div className="mt-4 overflow-hidden rounded-lg border border-white/[.07]"><p className="border-b border-white/[.06] bg-white/[.025] px-3 py-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#65736f]">Affected pages · {campaign.actions.length}</p>{campaign.actions.map((action) => <div key={action.key} className="border-b border-white/[.05] p-3 last:border-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-[#cbd7d3]">{action.title}</p><p className="mt-1 truncate text-[10px] text-[#61706c]">{action.pageUrl}</p></div><div className="flex shrink-0 gap-1"><button disabled={busy === action.key} onClick={() => void updateAction(action, "resolved")} className="za-text-button">Resolve</button><button disabled={busy === action.key} onClick={() => void updateAction(action, "dismissed")} className="za-text-button">Dismiss</button></div></div><FixLab action={action} onApplied={async () => { await loadFixes(); await onRefresh(); }} /></div>)}</div></div>}</article>;
    })}{!visible.length && <div className="grid min-h-56 place-items-center text-center"><div><IconCheck size={25} className="mx-auto text-[#58e0c0]"/><p className="mt-3 text-sm font-medium">No campaigns match</p><p className="mt-1 text-xs text-[#65736f]">Adjust the filters or run another audit.</p></div></div>}</div></div></section>
    <AppliedFixes fixes={fixes} properties={properties} busyId={revertBusy} onRevert={(id) => void revert(id)} />
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

type PulseProperty = {
  propertyId: string; name: string; url: string; enabled: boolean; displayName: string | null;
  showUrl: boolean; showPageviews: boolean; showVisitors: boolean; showTrend: boolean;
  showAudit: boolean; showVitals: boolean; showAuthority: boolean; updatedAt: string | null;
};

const pulseMetrics: Array<{ key: keyof PulseProperty; label: string; detail: string }> = [
  { key: "showUrl", label: "Public URL", detail: "Link to the live property" },
  { key: "showPageviews", label: "Pageviews", detail: "30-day aggregate" },
  { key: "showVisitors", label: "Visitors", detail: "30-day anonymous estimate" },
  { key: "showTrend", label: "Trend", detail: "30 daily aggregate points" },
  { key: "showAudit", label: "Audit", detail: "Latest score and page count" },
  { key: "showVitals", label: "Web Vitals", detail: "p75 with at least 5 samples" },
  { key: "showAuthority", label: "Zo Authority", detail: "Common Crawl public graph" },
];

export function PulseSettings() {
  const [properties, setProperties] = useState<PulseProperty[]>([]);
  const [publicUrl, setPublicUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/analytics/pulse/config", { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read Pulse settings");
      setProperties(data.properties ?? []); setPublicUrl(data.publicUrl ?? "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read Pulse settings"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  function change(propertyId: string, key: keyof PulseProperty, value: string | boolean) {
    setProperties((items) => items.map((item) => item.propertyId === propertyId ? { ...item, [key]: value } : item));
  }
  async function toggleEnabled(property: PulseProperty) {
    const next = !property.enabled;
    change(property.propertyId, "enabled", next);
    setBusy(property.propertyId); setMessage("");
    try {
      const response = await fetch(`/api/analytics/pulse/config/${encodeURIComponent(property.propertyId)}`, { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ enabled: next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update Pulse settings");
      setProperties((items) => items.map((item) => item.propertyId === property.propertyId ? data.property : item));
      setMessage(next ? `${property.name} is now visible on Pulse.` : `${property.name} was removed from Pulse.`);
    } catch (error) {
      change(property.propertyId, "enabled", !next);
      setMessage(error instanceof Error ? error.message : "Could not update Pulse settings");
    } finally { setBusy(""); }
  }
  async function save(property: PulseProperty) {
    setBusy(property.propertyId); setMessage("");
    try {
      const response = await fetch(`/api/analytics/pulse/config/${encodeURIComponent(property.propertyId)}`, { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(property) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save Pulse settings");
      setProperties((items) => items.map((item) => item.propertyId === property.propertyId ? data.property : item));
      setMessage(`${property.name} Pulse settings saved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save Pulse settings"); }
    finally { setBusy(""); }
  }
  async function refresh() {
    setBusy("refresh"); setMessage("");
    try { await post("/api/analytics/pulse/refresh"); setMessage("Public Pulse snapshot refreshed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not refresh Pulse"); }
    finally { setBusy(""); }
  }

  const enabled = properties.filter((item) => item.enabled).length;
  return <div className="space-y-4">
    <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <div className="za-panel">
        <div className="flex items-center gap-2 text-[#58e0c0]"><IconEye size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Publishing controls</p></div>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#82928d]">Every property and metric is opt-in. Pulse publishes a sanitized 30-day snapshot and never exposes visitor hashes, sessions, paths, referrers, campaigns, events, errors, or repository details.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button onClick={() => void refresh()} disabled={Boolean(busy)} className="za-primary-button"><IconRefresh size={15} className={busy === "refresh" ? "animate-spin" : ""}/>Refresh snapshot</button>
          {publicUrl && <a href={publicUrl} target="_blank" rel="noreferrer" className="za-secondary-button"><IconExternalLink size={15}/>Open public view</a>}
        </div>
      </div>
      <div className="za-panel">
        <div className="flex items-center gap-2 text-[#58e0c0]"><IconShieldLock size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Publication boundary</p></div>
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/[.07]"><Metric label="Enabled properties" value={enabled}/><Metric label="Available properties" value={properties.length}/></div>
        <div className="mt-5 space-y-2 text-xs leading-5 text-[#82928d]"><p>Nothing is public until you flip a property's switch below. That takes effect immediately.</p><p>The public service reads only the latest generated snapshot, never the live analytics tables.</p><p>Web Vitals stay hidden until a metric has at least five samples.</p></div>
      </div>
    </section>
    {loading ? <div className="za-panel text-sm text-[#71817c]">Reading Pulse settings...</div> : <section className="space-y-3">{properties.map((property) => <article key={property.propertyId} className={`za-panel transition ${property.enabled ? "border-[#58e0c0]/25" : ""}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0"><div className="flex items-center gap-3"><button type="button" role="switch" aria-checked={property.enabled} aria-label={`Publish ${property.name} in Pulse`} onClick={() => void toggleEnabled(property)} disabled={Boolean(busy)} className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${property.enabled ? "border-[#58e0c0] bg-[#58e0c0]" : "border-white/15 bg-white/[.05]"}`}><span className={`ml-0.5 block size-4 shrink-0 rounded-full bg-[#07110e] transition-transform ${property.enabled ? "translate-x-5" : "translate-x-0"}`}/></button><div><h3 className="text-base font-semibold tracking-[-.025em]">{property.name}</h3><p className="mt-1 truncate text-[10px] text-[#61706c]">{property.url}</p></div></div></div>
        <button onClick={() => void save(property)} disabled={Boolean(busy)} className="za-primary-button self-start">{busy === property.propertyId ? "Saving" : "Save details"}</button>
      </div>
      <p className="mt-3 text-[10px] text-[#61706c]">The switch above publishes or unpublishes {property.name} immediately. Use save to apply the display name and metric choices below.</p>
      <div className={`mt-5 space-y-4 ${property.enabled ? "" : "opacity-55"}`}>
        <label className="block"><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#65736f]">Public display name</span><input value={property.displayName ?? ""} onChange={(event) => change(property.propertyId, "displayName", event.target.value)} placeholder={property.name} className="za-input mt-2 w-full max-w-md"/></label>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{pulseMetrics.map((metric) => <label key={metric.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[.07] bg-white/[.025] p-3 hover:border-white/[.13]"><input type="checkbox" checked={Boolean(property[metric.key])} onChange={(event) => change(property.propertyId, metric.key, event.target.checked)} className="mt-0.5 size-4 accent-[#58e0c0]"/><span><span className="block text-xs font-medium text-[#dce7e4]">{metric.label}</span><span className="mt-1 block text-[10px] leading-4 text-[#61706c]">{metric.detail}</span></span></label>)}</div>
      </div>
    </article>)}{!properties.length && <div className="za-panel text-sm text-[#71817c]">No active public HTTPS properties are available.</div>}</section>}
    {message && <p className={`text-xs ${message.includes("saved") || message.includes("refreshed") ? "text-[#70d9b9]" : "text-[#ff9d96]"}`}>{message}</p>}
  </div>;
}

export function Outcomes({ properties, goals, funnels, briefs, onRefresh }: { properties: Property[]; goals: Array<any>; funnels: FunnelData[]; briefs: BriefData[]; onRefresh: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [goalName, setGoalName] = useState(""); const [eventName, setEventName] = useState("outbound-click");
  const [funnelName, setFunnelName] = useState(""); const [start, setStart] = useState("/"); const [end, setEnd] = useState("outbound-click"); const [message, setMessage] = useState("");
  async function addGoal() { try { await post("/api/analytics/goals", { propertyId, name: goalName, eventName }); setGoalName(""); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add goal"); } }
  async function addFunnel() { try { await post("/api/analytics/funnels", { propertyId, name: funnelName, steps: [{ type: "page", value: start }, { type: "event", value: end }] }); setFunnelName(""); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add funnel"); } }
  const latest = briefs[0];
  return <div className="space-y-4"><section className="grid gap-4 xl:grid-cols-[1fr_1fr]"><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconTargetArrow size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Goals</p></div><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">Define what success means</h2><div className="mt-5 grid gap-2 sm:grid-cols-3"><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="za-input">{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select><input value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="Goal name" className="za-input"/><select value={eventName} onChange={(event) => setEventName(event.target.value)} className="za-input"><option value="outbound-click">Outbound click</option><option value="download">Download</option><option value="signup">Signup</option><option value="contact">Contact</option></select></div><button disabled={!propertyId || !goalName} onClick={() => void addGoal()} className="za-primary-button mt-3">Add goal</button><div className="mt-5 space-y-1">{goals.map((goal) => <div key={goal.id} className="flex items-center justify-between rounded-lg px-2 py-3 hover:bg-white/[.03]"><div><p className="text-sm">{goal.name}</p><p className="mt-1 text-[10px] text-[#61706c]">{properties.find((item) => item.id === goal.propertyId)?.name} · {goal.eventName}</p></div><p className="text-sm font-semibold tabular-nums">{goal.conversions} <span className="text-[10px] font-normal text-[#61706c]">conversions</span></p></div>)}</div></div><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconRoute size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Funnels</p></div><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">See where intent drops</h2><div className="mt-5 grid gap-2 sm:grid-cols-3"><input value={funnelName} onChange={(event) => setFunnelName(event.target.value)} placeholder="Funnel name" className="za-input"/><input value={start} onChange={(event) => setStart(event.target.value)} placeholder="Start path" className="za-input"/><input value={end} onChange={(event) => setEnd(event.target.value)} placeholder="End event" className="za-input"/></div><button disabled={!propertyId || !funnelName} onClick={() => void addFunnel()} className="za-primary-button mt-3">Create funnel</button><div className="mt-5 space-y-3">{funnels.map((funnel) => <div key={funnel.id} className="rounded-lg bg-white/[.025] p-3"><p className="text-sm font-medium">{funnel.name}</p><div className="mt-3 grid gap-px overflow-hidden rounded-md bg-white/[.07]" style={{ gridTemplateColumns: `repeat(${funnel.results.length}, minmax(0,1fr))` }}>{funnel.results.map((step) => <div key={`${step.type}:${step.value}`} className="bg-[#0b1113] p-3"><p className="truncate text-xs">{step.value}</p><p className="mt-2 text-xl font-semibold tabular-nums">{step.sessions}</p><p className="text-[9px] text-[#61706c]">{Math.round(step.conversionFromPrevious * 100)}% continue</p></div>)}</div></div>)}</div></div></section>
    <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]"><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconFlag size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Latest brief</p></div>{latest ? <><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">Since the previous week</h2><p className="mt-3 text-sm leading-6 text-[#9dacA7]">{latest.payload.summary}</p><div className="mt-5 space-y-2">{(latest.payload.actions ?? []).slice(0, 3).map((action: any) => <div key={action.key} className="rounded-lg bg-white/[.025] px-3 py-3"><p className="text-sm font-medium">{action.title}</p><p className="mt-1 text-xs text-[#71817c]">{action.fix}</p></div>)}</div></> : <><h2 className="mt-2 text-2xl font-semibold">No brief generated yet</h2><button onClick={() => void post("/api/analytics/reports/weekly").then(onRefresh)} className="za-primary-button mt-5">Generate first brief</button></>}</div><div className="za-panel"><div className="flex items-center gap-2 text-[#58e0c0]"><IconDownload size={18}/><p className="text-[10px] font-semibold uppercase tracking-[.14em]">Own your data</p></div><h2 className="mt-2 text-xl font-semibold">CSV exports</h2><div className="mt-4 grid grid-cols-2 gap-2">{["properties", "pageviews", "events", "pages", "findings", "backlinks"].map((dataset) => <a key={dataset} href={`/api/analytics/export/${dataset}.csv`} className="za-secondary-button capitalize">{dataset}</a>)}</div></div></section>{message && <p className="text-xs text-[#ff9d96]">{message}</p>}</div>;
}
