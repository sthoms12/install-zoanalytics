# ZoAnalytics Agent Guide

ZoAnalytics is private analytics for public Zo web surfaces.

Version `0.3.0` adds account-neutral Cloudflare production discovery, GitHub repository matching, and manual external-site onboarding alongside the existing guided setup, tracker verification, Action Center, page detail, goals, funnels, briefs, exports, Web Vitals, migrations, backup, and doctor workflows.

## Invariants

- Start with an empty database. Never seed account names, domains, properties, traffic, or credentials.
- Discover only public Zo Space page routes, published public Sites, public HTTP services, and anonymously reachable production external sites.
- Reject private routes and services, `*.zo.computer`, TCP/process services, unpublished previews, localhost, and private networks.
- Confirm reachability without authentication before storing a discovered surface.
- Keep the dashboard private and expose only the collector routes publicly.
- Never collect raw IP addresses, emails, form contents, user-entered text, or persistent cross-site identifiers.
- Do not require paid analytics or SEO APIs.

## Commands

```bash
bun run build
bun run discover
bun run external-discovery
bun run crawl -- --max-pages 20
bun run intelligence all
bun run common-crawl-sync
bun run doctor
bun run backup
```

Discovery reads `data/discovery-manifest.json` and writes `data/discovery-status.json`. The manifest is produced by the scheduled Zo agent from native Space, Sites, and Services inventory.
