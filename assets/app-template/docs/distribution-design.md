# Distribution design

ZoAnalytics is distributed as a clean app template inside the `install-zoanalytics` skill. Each installation creates a new database and discovers only public web surfaces belonging to the destination Zo account.

Discovery is split into two layers. A scheduled Zo Agent has account-aware access to Space, Sites, and Services inventory and writes a small manifest. A deterministic importer then enforces HTTPS, HTTP mode, explicit public visibility, private-host rejection, and anonymous reachability. This separation avoids hardcoded handles and prevents URL guessing from becoming an authorization decision.

The dashboard remains private. The published service runs in collector-only mode and exposes only the tracker, ingest endpoint, and health metadata. Analytics, crawls, reports, and discovery receipts stay local to the destination Zo.
