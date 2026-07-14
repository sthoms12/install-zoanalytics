---
name: install-zoanalytics
description: Install, configure, update, or audit a fresh ZoAnalytics instance for a Zo Computer account. Use when a user wants private first-party analytics and independent SEO intelligence for public Zo Space routes, published Zo Sites, public HTTP services, or external Cloudflare/GitHub sites, including recurring public-surface discovery. Never copy another user's data or include private surfaces.
---

# Install ZoAnalytics

Install the bundled app template into a new workspace folder and configure public-only discovery.

## Location boundary

- This repository is an installer package, not a runnable Zo Site.
- `assets/app-template/` must contain `zosite.template.json`, never `zosite.json`. The install script renames it in the destination so Zo does not host the bundled template in place.
- A user's installed app, runtime database, backups, caches, and publication choices belong only in that user's destination directory.

## Guardrails

- Never copy an existing `data/` directory, SQLite database, `.env`, credentials, domains, handles, traffic, or cached crawl data.
- Never overwrite a non-empty target directory.
- Include only public Space page routes, published public Sites, public HTTP services, and anonymously reachable production external sites.
- Exclude private routes/sites/services, `*.zo.computer`, TCP/process services, unpublished previews, localhost/private networks, and ZoAnalytics itself.
- Keep the dashboard private. Publish only the collector, tracker, and opt-in Pulse surfaces unless the user explicitly chooses another authenticated deployment.

## Install

1. Inspect the workspace index and choose an unused local port and service label.
2. Determine the current Zo handle from account context. Do not infer another user's handle from bundled files.
3. Run:

```bash
bun run scripts/install.ts \
  --target /home/workspace/zoanalytics \
  --port PORT \
  --label zoanalytics \
  --owner-handle HANDLE
```

4. Run `bun run build` in the installed app.
5. Confirm the first launch reports zero properties and creates a new ignored `data/zoanalytics.db`.
6. Publish the Zo Site as the public collector with `ZOANALYTICS_COLLECTOR_ONLY=true`. Keep the dashboard in its private Zo Site preview unless a separate authenticated deployment is deliberately configured.
7. Set `ZOANALYTICS_PUBLIC_ORIGIN` for the private dashboard to the collector's final HTTPS origin.

The installed dashboard includes a **Public Pulse** view. Every property starts disabled. Enable only the properties and aggregate metrics the user deliberately chooses to publish. Pulse snapshots must never contain raw visitor, session, path, referrer, campaign, event, error, or repository data.

## Discover public surfaces

Read `references/discovery-contract.md`. Use Zo's native Space, Sites, and Services inventory tools to build `data/discovery-manifest.json` in the installed app. Do not discover from names alone; use the explicit public/private and service-mode fields returned by Zo.

Run:

```bash
bun run discover
```

Review both `discovered` and `skipped` in `data/discovery-status.json`. Treat `not-publicly-reachable` as excluded, not as an error to bypass.

If Cloudflare and GitHub are connected, run `bun run external-discovery`. This imports enabled production Cloudflare Pages/Workers domains and attaches a matching GitHub repository when one can be identified. A missing connector must remain a clean optional state. Never bundle or infer another account's Cloudflare account ID or GitHub owner.

For each accepted surface, install the generated tracker snippet only when the source can be edited safely. Otherwise show the snippet to the user. Never alter private surfaces.

## Schedule

The installed app refreshes its own data automatically: `backend-lib/scheduler.ts` starts an in-process timer from `server.ts` (skipped in collector-only mode) that runs `crawl --all`, `common-crawl-sync`, `ahrefs-sync`, and `intelligence all` every Monday in the account owner's timezone, with no AI or external cron involved. No separate setup step is needed for this.

Discovering new public surfaces still needs a Zo Agent, since it requires Zo's native Space/Sites/Services inventory tools, which are not reachable from a plain subprocess. Create one daily Zo Agent automation for discovery only, using the exact workflow in `references/automation-prompt.md`.

## Verify

Run:

```bash
bun run build
bun run discover
bun run external-discovery
bun run crawl -- --max-pages 5
```

Confirm:

- No personal identifier from the source repository appears in the installed tree.
- No private surface appears in the property list.
- Unknown property IDs are rejected by the collector.
- The dashboard API is unavailable in collector-only mode.
- `/pulse` and `/api/pulse` are available in collector-only mode, while Pulse configuration remains private.
- A fresh install publishes zero Pulse properties.
- A browser event for an accepted property is stored while bots and automated browsers are dropped.

Run `/root/.codex/skills/.system/skill-creator/scripts/quick_validate.py` against this skill when modifying its packaging.
Run `bun scripts/package-audit.ts` to reject generated artifacts, an accidentally runnable template, and known personal markers.

## Update

Run:

```bash
bun run scripts/update.ts --target /home/workspace/zoanalytics
```

The updater requires an existing database, runs the installed app's backup command first, replaces application source from the bundled release, preserves `data/`, `.env`, and `zosite.json`, installs the locked dependencies, and requires a successful production build before completion. Run `bun run doctor` in the installed app after updating.
