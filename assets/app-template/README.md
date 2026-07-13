# ZoAnalytics

ZoAnalytics is a private analytics command center for public Zo Space routes, published Zo Sites, public HTTP services, and external sites deployed through Cloudflare and GitHub.

It starts with an empty SQLite database. No domains, traffic, identifiers, or account-specific data are bundled.

## Independent data sources

- Cookie-free first-party pageviews, sessions, campaigns, goals, events, Web Vitals, and client errors.
- A local crawler for technical SEO, content inventory, internal links, page changes, and keyword inference.
- Public search-result observations for rank monitoring.
- Referrer-observed links and public web discovery.
- Common Crawl's public host graph and a transparent Zo Authority score.

No paid analytics or SEO API is required.

## Product workflow

- Guided setup discovers public surfaces, verifies tracker HTML without generating synthetic visits, runs a baseline crawl, and confirms goals.
- The Action Center orders evidence-backed recommendations by impact, confidence, and effort.
- Unified page detail combines traffic, events, p75 field performance, technical findings, observed rankings, links, changes, and errors.
- Goals, ordered funnels, stored weekly briefs, and CSV exports are managed from the private dashboard.

## Public-only discovery

Run `bun run discover` after a Zo agent writes `data/discovery-manifest.json`. The importer requires `public: true`, HTTPS, HTTP mode, and an unauthenticated 2xx/3xx response. It rejects private Zo URLs, local networks, TCP/process services, private routes, and unpublished previews.

The local fallback scanner can discover public published Sites when `ZO_OWNER_HANDLE` is configured.

When Cloudflare and GitHub are connected, `bun run external-discovery` imports enabled production Cloudflare Pages/Workers domains, confirms anonymous reachability, and matches source repositories without modifying them. Any public HTTPS site can also be added manually from the dashboard.

## Commands

```bash
bun run build
bun run dev
bun run discover
bun run external-discovery
bun run crawl -- --max-pages 20
bun run intelligence all
bun run common-crawl-sync --metadata-only
bun run doctor
bun run backup
```

The installer update workflow runs a backup before replacing application source and preserves `data/`, `.env`, and `zosite.json`.

## Tracker

The public collector serves `/zowa.js` and `/api/analytics/collect`.

```html
<script defer src="https://YOUR-COLLECTOR/zowa.js" data-site="YOUR-PROPERTY-ID"></script>
```

The tracker uses no cookies and does not collect raw IP addresses, email addresses, form contents, or user-entered text.

## Deployment shape

- Keep the dashboard private.
- Publish a separate public collector with `ZOANALYTICS_COLLECTOR_ONLY=true`.
- Set `ZOANALYTICS_PUBLIC_ORIGIN` on the private dashboard so it generates correct snippets.
- Keep `data/` outside source control.
