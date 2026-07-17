# Release-gate design

## Goal

Provide one deterministic command that proves the installer package is sanitized, installs into an empty target, passes its tests and doctor, builds successfully, and preserves the public/private collector boundary.

## Release check

`bun scripts/release-check.ts` audits the package, installs the bundled template through the real installer entrypoint, type-checks it, runs all tests against an isolated test database, builds production assets, runs the layered doctor, and starts collector-only mode long enough to verify its HTTP contract. Temporary files and processes are cleaned up even after failure.

Run the check with Bun 1.3.0 and the current stable Bun release before publishing a release. GitHub Actions is intentionally not configured because the current repository credential cannot publish workflow files.

## Security and privacy gates

The package audit rejects runtime databases, caches, build output, credentials, personal markers, and a runnable `zosite.json` in the template. Integration tests verify unknown property rejection, bot and prefetch filtering, rate limiting, empty Pulse defaults, aggregate-only Pulse payloads, tracker automation exclusion, and collector-only blocking of private management APIs.

Cloudflare, GitHub, Ahrefs, Common Crawl, and live Zo inventory require account state or large external data and remain manual release checks.

