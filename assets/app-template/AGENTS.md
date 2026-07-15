# ZoAnalytics Agent Guide

ZoAnalytics is private analytics for public Zo web surfaces.

Version `0.8.0` adds Zo-first surface reconciliation and guided tracker installation alongside the opt-in public Pulse view, account-neutral Cloudflare production discovery, GitHub repository matching, tracker verification, Action Center, page detail, goals, funnels, briefs, exports, Web Vitals, migrations, backup, and doctor workflows. It also includes the Change-to-Outcome Ledger, Safe Fix Laboratory, deterministic weekly refresh timer, normalized trust states, and section-aware dashboard loading.

## Invariants

- Start with an empty database. Never seed account names, domains, properties, traffic, or credentials.
- Discover only public Zo Space page routes, published public Sites, public HTTP services, and anonymously reachable production external sites.
- Reject private routes and services, `*.zo.computer`, TCP/process services, unpublished previews, localhost, and private networks.
- Confirm reachability without authentication before storing a discovered surface.
- Keep the dashboard private. Collector-only mode exposes `/pulse`, `/api/pulse`, `/zowa.js`, and `/api/analytics/collect`.
- Keep every Pulse property disabled on a fresh install. Publish only owner-selected properties and metrics.
- Never add raw paths, visitor hashes, sessions, journeys, referrers, campaigns, events, goals, funnels, errors, findings, query strings, or repository metadata to Pulse snapshots.
- Never collect raw IP addresses, emails, form contents, user-entered text, or persistent cross-site identifiers.
- Do not require paid analytics or SEO APIs.

## Commands

```bash
bun run build
bun run discover
bun run external-discovery
bun run crawl -- --max-pages 20
bun run intelligence all
bun run pulse-refresh
bun run common-crawl-sync
bun run ahrefs-sync
bun run doctor
bun run backup
```

Discovery reads `data/discovery-manifest.json` and writes `data/discovery-status.json`. The manifest is produced by the scheduled Zo agent from native Space, Sites, and Services inventory.

`backend-lib/scheduler.ts` starts automatically from `server.ts` (outside collector-only mode) and re-runs `crawl`, `common-crawl-sync`, `ahrefs-sync`, and `intelligence all` every Monday in the account owner's timezone. It needs no scheduled automation of its own. `ahrefs-sync` is a no-op failure when the account has no Ahrefs MCP connector; the other steps still run.

`backend-lib/confidence.ts` owns data-state interpretation. Traffic is live for 15 minutes and current for 48 hours; crawler, rankings, backlinks, authority, and Pulse snapshots are current for eight days; Ledger outcomes use a 30-day freshness window. A zero previous baseline never produces a percentage, and Core Web Vitals remain insufficient until five observations exist. Keep these rules consistent across the API and dashboard.

`backend-lib/workspace.ts` owns the property-centered aggregate. Keep Summary, Audience, Visibility, Improve, and Outcomes independently readable with section-level status/error metadata, and preserve property plus section in the dashboard URL.

`backend-lib/overview.ts` owns `/api/analytics/overview`. Only Ledger events with at least 20 observations and non-low confidence may appear as wins or regressions; keep all weaker evidence pending and use associative, never causal, language.

Keep the five-area dashboard navigation and its nested tabs aligned with URL state (`area`, `tab`, `days`, `property`, `section`). Preserve legacy `view` bookmarks, browser back/forward restoration, keyboard focus movement, and the secondary Publish & data menu.

Dashboard data loading is section-aware: `/api/analytics/summary` provides the portfolio shell and supporting APIs load only for the active workflow. Preserve AbortController cancellation when period or section changes supersede an in-flight request. Production chunks are split in `vite.config.ts`.

Workspace Site discovery must anonymously verify the derived `*.zocomputer.io` URL before creating or reactivating a property. A publish block in `zosite.json` does not prove the service is public or currently deployed; unreachable workspace-site rows are retired so private `*.zo.computer` dashboards never become tracker gaps.
`backend-lib/surfaces.ts` owns the six-state Zo surface inventory, project-path deduplication, conflict reporting, and public-only activation rule. `backend-lib/tracker-install.ts` keeps preview, explicit source apply, republish, and public verification as separate stages.

`getActionCenter()` remains the atomic action source. `getActionCampaigns()` groups open actions into work campaigns, and `setActionCampaignState()` updates every child in one SQLite transaction. Keep source verification distinct from manually marking a campaign resolved.
