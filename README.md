# ZoAnalytics

The analytics and website-intelligence system built for [Zo Computer](https://zo.computer). ZoAnalytics discovers what you run, measures what visitors experience, identifies what needs attention, helps you apply safe fixes, verifies the result, and learns from the outcome. Your data stays on your Zo.

**Live example:** [zoanalytics-thomstech.zocomputer.io/pulse](https://zoanalytics-thomstech.zocomputer.io/pulse) — the public, opt-in snapshot view of a real running instance. It shows only aggregated metrics an owner chooses to publish (pageviews, visitors, trend, audit score); the private dashboard behind it stays authenticated and off-limits.

## What you get

- A private dashboard (yours alone, sign-in required) with traffic, SEO audits, Core Web Vitals, and an action center for fixes
- A lightweight first-party tracker (`zowa.js`) you drop into any site you own
- An optional public **Pulse** page for showing off aggregate stats without exposing the dashboard
- Automatic weekly crawl, Common Crawl sync, Ahrefs sync (if connected), and intelligence refresh — no external cron needed
- Discovery that only ever includes surfaces Zo confirms are public; private routes and services are never touched
- A closed Zo-native loop: **Discover → Measure → Diagnose → Fix → Verify → Learn**
- Evidence-backed weekly owner briefs with the top three priorities, no LLM required

## Install (on your own Zo)

This repo is packaged as a Zo Skill. On your own Zo Computer:

```bash
git clone https://github.com/sthoms12/install-zoanalytics.git Skills/install-zoanalytics
```

Then just tell your Zo assistant something like *"install ZoAnalytics"* — it will read `SKILL.md` and walk through installing a clean instance into `/home/workspace/zoanalytics`, choosing a port, and publishing the public collector.

### Manual install

If you'd rather run it yourself from the Zo terminal:

```bash
cd Skills/install-zoanalytics
bun run scripts/install.ts \
  --target /home/workspace/zoanalytics \
  --port 57681 \
  --label zoanalytics \
  --owner-handle YOUR_ZO_HANDLE
```

Then, inside the installed app:

```bash
bun run build
```

Publish it as a Zo Site with `ZOANALYTICS_COLLECTOR_ONLY=true` for the public collector + Pulse surfaces, and keep the dashboard itself in a private Zo Site preview (or a separate authenticated deployment if you want one).

Every install starts with zero properties and an empty database — nothing is copied from the source instance. Full guardrails, discovery, update, and verification steps live in [`SKILL.md`](./SKILL.md).

On first run, owners can start fresh or optionally migrate an Umami/Plausible CSV. Migration is dry-run-first, additive, source-attributed, fingerprinted, and duplicate-protected. Aggregate reports remain aggregate instead of being expanded into synthetic visitor activity.

## Updating

```bash
bun run scripts/update.ts --target /home/workspace/zoanalytics
```

Runs preflight, backs up the database and prior source, preserves your database, Pulse choices, `.env`, and `zosite.json`, then builds and runs the doctor. Failed updates restore the previous application source automatically.
