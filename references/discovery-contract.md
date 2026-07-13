# Public discovery contract

The scheduled Zo agent writes `data/discovery-manifest.json` inside the installed app, then runs `bun run discover`.

```json
{
  "generatedAt": "2026-07-13T00:00:00.000Z",
  "surfaces": [
    {
      "id": "optional-stable-id",
      "name": "Public site name",
      "kind": "space",
      "url": "https://handle.zo.space/public-route",
      "public": true,
      "mode": "http",
      "source": "zo-space"
    }
  ]
}
```

Allowed `kind` values are `space`, `site`, and `service`. The `public` field must be exactly `true`. The optional `mode` must be `http` when present.

Collect inventory from Zo's native Space, Sites, and Services tools. Include only:

- Public Zo Space page routes.
- Published public Zo Sites.
- Public HTTP services with a browser-facing HTTPS URL.
- Custom domains attached to those public Zo surfaces.

Exclude private routes and sites, `*.zo.computer` owner-only URLs, TCP services, process services, unpublished development previews, localhost/private network URLs, and the ZoAnalytics collector itself.

The importer enforces HTTPS, rejects known private hosts and networks, and makes an unauthenticated request. It stores a surface only when that request returns a 2xx or 3xx response.
