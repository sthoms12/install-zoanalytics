# Pilot architecture

The GitHub package is a skill with a bundled, versioned app template. Installation copies source only; runtime state is created fresh on the destination Zo.

Data flow:

1. A daily Zo Agent reads native Space, Sites, and Services inventory.
2. It writes a manifest containing explicit public visibility, HTTP mode, and final URLs.
3. The deterministic importer rejects private URL classes and verifies anonymous reachability.
4. Accepted surfaces become properties in a fresh local SQLite database.
5. The public collector receives cookie-free telemetry only for known property IDs.
6. The private dashboard reads the same local database.
7. Local crawling, public rank observations, observed referrers, and Common Crawl provide independent intelligence.
8. The optional public Pulse reads only a generated aggregate snapshot. Property and metric publication remain off until explicitly enabled in the private dashboard.

The app never depends on a bundled account identity or paid analytics provider. Runtime `data/`, `.env`, crawl caches, and build output are ignored by Git.
