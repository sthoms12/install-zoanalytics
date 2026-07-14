# ZoAnalytics Agent Guide

ZoAnalytics is private analytics for public Zo web surfaces.

Version `0.6.0` adds an opt-in public Pulse view with sanitized aggregate snapshots alongside account-neutral Cloudflare production discovery, GitHub repository matching, guided setup, tracker verification, Action Center, page detail, goals, funnels, briefs, exports, Web Vitals, migrations, backup, and doctor workflows. It also adds a Change-to-Outcome Ledger that lines up commits, crawler-detected content edits, tracker installs, and applied fixes against before/after traffic and SEO outcomes; a Safe Fix Laboratory that previews, applies, and reverts title/description/canonical/noindex fixes on eligible properties; a self-contained weekly data-refresh timer with no AI or external cron involved; and normalized freshness, verification, and sample states that prevent stale or statistically weak data from looking authoritative.

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
