import { db, getProperties, upsertDiscoveredProperty, upsertPropertySource, upsertSurfaceAlias } from "./db";

export type SurfaceClassification = "public-reachable" | "private" | "development-only" | "published-unreachable" | "redirected-alias" | "retired";

export type SurfaceObservation = {
  sourceKey: string;
  provider: "zo-space" | "zo-site" | "zo-service" | "external";
  sourceId: string;
  name: string;
  kind: "space" | "site" | "service" | "external";
  url?: string | null;
  projectPath?: string | null;
  public?: boolean;
  published?: boolean;
  mode?: string | null;
  reachable?: boolean | null;
  finalUrl?: string | null;
  retired?: boolean;
  trackable?: boolean;
  aliasOfPropertyId?: string;
  metadata?: Record<string, unknown>;
};

export type ReconciledSurface = SurfaceObservation & {
  classification: SurfaceClassification;
  canonicalUrl: string | null;
  propertyId: string | null;
  conflict: string | null;
  nextAction: string;
};

export type SurfaceInventoryItem = ReconciledSurface & {
  lastSeenAt: string;
  retiredAt: string | null;
};

function normalizedUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function classifySurface(surface: SurfaceObservation): SurfaceClassification {
  if (surface.retired) return "retired";
  if (!surface.published || (surface.mode && surface.mode !== "http") || !surface.url) return "development-only";
  if (surface.public === false) return "private";
  if (surface.reachable === false) return "published-unreachable";
  const url = normalizedUrl(surface.url);
  const finalUrl = normalizedUrl(surface.finalUrl);
  if (url && finalUrl && url !== finalUrl) return "redirected-alias";
  return "public-reachable";
}

function nextAction(classification: SurfaceClassification, tracked: boolean, conflict: string | null) {
  if (conflict) return "Resolve the inventory conflict before tracking this surface.";
  if (classification === "private") return "Keep excluded from public analytics unless you intentionally publish it.";
  if (classification === "development-only") return "Publish the surface when it is ready for public traffic.";
  if (classification === "published-unreachable") return "Restore anonymous public access or retire the deployment.";
  if (classification === "retired") return "No action required; historical analytics remain preserved.";
  if (classification === "redirected-alias") return tracked ? "No action required; traffic is consolidated under the canonical property." : "Install the tracker on the canonical destination.";
  return tracked ? "Tracker verified; no action required." : "Install and verify the ZoAnalytics tracker.";
}

export function reconcileSurfaces(observations: SurfaceObservation[]): ReconciledSurface[] {
  const urlOwners = new Map<string, SurfaceObservation[]>();
  for (const item of observations) {
    const canonical = normalizedUrl(item.finalUrl) ?? normalizedUrl(item.url);
    if (!canonical) continue;
    const owners = urlOwners.get(canonical) ?? [];
    owners.push(item);
    urlOwners.set(canonical, owners);
  }
  const properties = getProperties();
  return observations.map((item) => {
    const classification = classifySurface(item);
    const canonicalUrl = normalizedUrl(item.finalUrl) ?? normalizedUrl(item.url);
    const owners = canonicalUrl ? urlOwners.get(canonicalUrl) : null;
    const ownerPaths = new Set((owners ?? []).map((owner) => owner.projectPath).filter(Boolean));
    const conflict = owners && owners.length > 1 && (ownerPaths.size > 1 || ownerPaths.size === 0)
      ? `Multiple unrelated inventory records claim ${canonicalUrl}` : null;
    const matched = canonicalUrl ? properties.find((property) => normalizedUrl(property.url) === canonicalUrl) : null;
    const propertyId = item.aliasOfPropertyId ?? (item.trackable === false ? null : matched?.id ?? ((classification === "public-reachable" || classification === "redirected-alias") && !conflict
      ? slug(item.sourceId || `${item.kind}-${canonicalUrl}`)
      : null));
    const action = item.trackable === false ? "No action required; this infrastructure surface is excluded from tracking." : nextAction(classification, matched?.status === "tracked", conflict);
    return { ...item, classification, canonicalUrl, propertyId, conflict, nextAction: action };
  });
}

export function persistSurfaceInventory(observations: SurfaceObservation[], retireProviders: SurfaceObservation["provider"][] = []) {
  const reconciled = reconcileSurfaces(observations);
  const seen = new Set(reconciled.map((item) => item.sourceKey));
  const upsert = db.prepare(`INSERT INTO surface_inventory
      (source_key, provider, source_id, name, kind, url, canonical_url, project_path, classification, property_id, conflict, next_action, metadata, last_seen_at, retired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CASE WHEN ?='retired' THEN CURRENT_TIMESTAMP ELSE NULL END)
    ON CONFLICT(source_key) DO UPDATE SET provider=excluded.provider, source_id=excluded.source_id, name=excluded.name,
      kind=excluded.kind, url=excluded.url, canonical_url=excluded.canonical_url, project_path=excluded.project_path,
      classification=excluded.classification, property_id=excluded.property_id, conflict=excluded.conflict,
      next_action=excluded.next_action, metadata=excluded.metadata, last_seen_at=CURRENT_TIMESTAMP,
      retired_at=CASE WHEN excluded.classification='retired' THEN COALESCE(surface_inventory.retired_at, CURRENT_TIMESTAMP) ELSE NULL END`);

  db.transaction(() => {
    for (const item of reconciled) {
      if (item.aliasOfPropertyId && item.canonicalUrl && (item.classification === "public-reachable" || item.classification === "redirected-alias")) {
        upsertSurfaceAlias(item.aliasOfPropertyId, item.canonicalUrl);
      } else if ((item.classification === "public-reachable" || item.classification === "redirected-alias") && !item.conflict && item.canonicalUrl && item.propertyId) {
        const property = upsertDiscoveredProperty({ id: item.propertyId, name: item.name, kind: item.kind, url: item.canonicalUrl, projectPath: item.projectPath, source: item.provider });
        upsertPropertySource({ propertyId: item.propertyId, provider: item.provider, sourceId: item.sourceId, metadata: item.metadata });
        if (item.classification === "redirected-alias" && item.url) upsertSurfaceAlias(item.propertyId, item.url);
        item.nextAction = nextAction(item.classification, property?.status === "tracked", null);
      }
      upsert.run(item.sourceKey, item.provider, item.sourceId, item.name, item.kind, item.url ?? null, item.canonicalUrl,
        item.projectPath ?? null, item.classification, item.propertyId, item.conflict, item.nextAction,
        JSON.stringify(item.metadata ?? {}), item.classification);
      if (item.provider === "zo-service" && item.projectPath && item.mode === "http") {
        db.prepare(`UPDATE surface_inventory SET classification=?, canonical_url=COALESCE(?, canonical_url),
          property_id=?, conflict=NULL, next_action=?, last_seen_at=CURRENT_TIMESTAMP
          WHERE provider='zo-site' AND project_path=?`)
          .run(item.classification, item.canonicalUrl, item.propertyId, item.nextAction, item.projectPath);
      }
    }
    const providers = retireProviders.length ? retireProviders : [...new Set(observations.map((item) => item.provider))];
    const placeholders = providers.map(() => "?").join(",");
    const rows = providers.length ? db.query(`SELECT source_key AS sourceKey FROM surface_inventory WHERE provider IN (${placeholders})`).all(...providers) as Array<{ sourceKey: string }> : [];
    for (const row of rows) if (!seen.has(row.sourceKey)) db.prepare(`UPDATE surface_inventory SET classification='retired', next_action='No action required; historical analytics remain preserved.', retired_at=COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE source_key=?`).run(row.sourceKey);
    db.exec(`UPDATE properties SET lifecycle='retired', retired_at=COALESCE(retired_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
      WHERE id IN (SELECT property_id FROM surface_inventory WHERE property_id IS NOT NULL)
        AND id NOT IN (SELECT property_id FROM surface_inventory WHERE property_id IS NOT NULL AND classification IN ('public-reachable','redirected-alias'))`);
  })();
  return listSurfaceInventory();
}

export function listSurfaceInventory() {
  const rows = db.query(`SELECT source_key AS sourceKey, provider, source_id AS sourceId, name, kind, url,
      canonical_url AS canonicalUrl, project_path AS projectPath, classification, property_id AS propertyId,
      conflict, next_action AS nextAction, metadata, last_seen_at AS lastSeenAt, retired_at AS retiredAt
    FROM surface_inventory ORDER BY CASE classification WHEN 'public-reachable' THEN 0 WHEN 'redirected-alias' THEN 1
      WHEN 'published-unreachable' THEN 2 WHEN 'private' THEN 3 WHEN 'development-only' THEN 4 ELSE 5 END, name COLLATE NOCASE`).all() as Array<Omit<SurfaceInventoryItem, "metadata"> & { metadata: string }>;
  return rows.map((item) => ({ ...item, metadata: JSON.parse(item.metadata || "{}") })) as SurfaceInventoryItem[];
}
