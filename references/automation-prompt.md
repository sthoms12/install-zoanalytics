# Daily discovery automation

Use this prompt for a daily Zo Agent automation, scheduled in the account owner's timezone:

```text
Refresh ZoAnalytics public-surface discovery.

Work in /home/workspace/zoanalytics. Read AGENTS.md first.

Use Zo's native inventory tools to list:
1. Zo Space page routes and their visibility.
2. Zo Sites and their publication visibility and final URLs.
3. User services and their mode, visibility, status, and final HTTP URLs.

Write data/discovery-manifest.json using the discovery contract. Include only explicitly public Space page routes, published public Sites, and public HTTP services. Include active custom domains for those public surfaces. Exclude private routes/sites/services, *.zo.computer owner-only URLs, TCP services, process services, unpublished development previews, localhost/private-network URLs, deprecated surfaces, and ZoAnalytics itself. Never include a surface merely because its URL looks public.

Run bun run discover. If Cloudflare is connected, run bun run external-discovery to reconcile enabled production Pages/Workers domains and GitHub source matches. Treat an unavailable optional connector as skipped, not as a discovery failure. Then run bun run crawl -- --max-pages 25 and bun run intelligence all. The intelligence workflow refreshes the sanitized Pulse snapshot after maintenance; it must not enable properties or metrics.

If discovery or maintenance fails, report one concise error with the failing stage. Otherwise report only counts for accepted, skipped, tracked, and missing-tracker surfaces. Do not expose visitor data in the automation summary.
```

Recommended cadence: daily at 3:15 AM local time. Schedule `bun run common-crawl-sync` weekly at a low-traffic time.
