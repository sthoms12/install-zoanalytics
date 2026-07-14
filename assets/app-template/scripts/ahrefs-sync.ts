// Syncs real Ahrefs data into ZoAnalytics via the connected Ahrefs MCP.
// The current Ahrefs plan only allows the free domain-rating endpoint;
// paid Site Explorer ops return "Insufficient plan" and are skipped.
// Run: bun scripts/ahrefs-sync.ts
import { db, getProperties } from "../backend-lib/db";

const CLIENT_PATH = "/etc/zo/mcpo/clients/ahrefs";

async function main() {
  let ahrefs: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  try {
    ahrefs = await import(CLIENT_PATH);
  } catch {
    console.error("Ahrefs MCP client not available at", CLIENT_PATH);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const properties = getProperties().filter((p) => p.url.startsWith("http"));
  const upsert = db.prepare(`
    INSERT INTO ahrefs_metrics (property_id, captured_at, domain_rating)
    VALUES (?, ?, ?)
    ON CONFLICT(property_id, captured_at) DO UPDATE SET domain_rating = excluded.domain_rating
  `);

  const results: Array<{ propertyId: string; target: string; domainRating: number | null }> = [];
  for (const property of properties) {
    const target = property.ahrefsTarget || new URL(property.url).hostname;
    try {
      const response = await ahrefs.tool_public_domain_rating_free_post({ target, date: today }) as unknown[];
      const record = response?.find((item) => typeof item === "object" && item !== null && "domain_rating" in (item as object)) as { domain_rating?: { domain_rating?: number } } | undefined;
      const rating = record?.domain_rating?.domain_rating ?? null;
      if (rating !== null) upsert.run(property.id, today, rating);
      results.push({ propertyId: property.id, target, domainRating: rating });
    } catch (error) {
      results.push({ propertyId: property.id, target, domainRating: null });
      console.error(`  ${property.id}: ${String(error).slice(0, 160)}`);
    }
    await Bun.sleep(400);
  }

  for (const row of results) console.log(`${row.propertyId} (${row.target}): DR ${row.domainRating ?? "unavailable"}`);
}

await main();
