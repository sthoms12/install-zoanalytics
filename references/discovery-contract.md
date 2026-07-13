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

Allowed `kind` values are `space`, `site`, `service`, and `external`. The `public` field must be exactly `true`. The optional `mode` must be `http` when present.

Collect inventory from Zo's native Space, Sites, and Services tools. Include only:

- Public Zo Space page routes.
- Published public Zo Sites.
- Public HTTP services with a browser-facing HTTPS URL.
- Custom domains attached to those public Zo surfaces.
- Enabled production Cloudflare Pages and Workers domains when the account owner has connected Cloudflare.
- Manually approved external HTTPS sites that are reachable without authentication.

Exclude private routes and sites, `*.zo.computer` owner-only URLs, TCP services, process services, unpublished development previews, localhost/private network URLs, and the ZoAnalytics collector itself.

The importer enforces HTTPS, rejects known private hosts and networks, and makes an unauthenticated request. It stores a surface only when that request returns a 2xx or 3xx response.

External entries may include `provider`, `providerId`, `repository`, `repositoryUrl`, `aliases`, and non-secret `metadata`. Store Cloudflare deployment IDs and GitHub repository names only after reading them from the current user's connected accounts. Never store API keys, access tokens, or provider account IDs.
