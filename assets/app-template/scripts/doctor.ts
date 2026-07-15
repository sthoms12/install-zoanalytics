import { db, APP_VERSION } from "../backend-lib/db";
import { getSetupStatus } from "../backend-lib/product";

const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
const privateRows = db.query(`SELECT id, url FROM properties WHERE lifecycle='active' AND (
  url NOT LIKE 'https://%' OR url LIKE '%.zo.computer%' OR url LIKE '%localhost%' OR url LIKE '%127.0.0.1%')`).all();
const setup = getSetupStatus();
const configuredProperties = setup.properties.length;
const checks = [
  { layer: "application", id: "version", ok: true, status: "healthy", detail: `ZoAnalytics ${APP_VERSION}` },
  { layer: "database", id: "integrity", ok: integrity.integrity_check === "ok", status: integrity.integrity_check === "ok" ? "healthy" : "failed", detail: integrity.integrity_check },
  { layer: "privacy", id: "public-only", ok: privateRows.length === 0, status: privateRows.length ? "failed" : "healthy", detail: privateRows.length ? `${privateRows.length} private or invalid active properties` : "All active properties are public HTTPS surfaces" },
  { layer: "discovery", id: "inventory", ok: configuredProperties === 0 || (setup.steps.find((step) => step.id === "discover")?.complete ?? false), status: configuredProperties === 0 ? "not-configured" : setup.steps.find((step) => step.id === "discover")?.complete ? "healthy" : "needs-attention", detail: configuredProperties === 0 ? "Fresh install: no public properties configured yet" : setup.steps.find((step) => step.id === "discover")?.detail ?? "Discovery has not run" },
  { layer: "tracker", id: "coverage", ok: configuredProperties === 0 || (setup.steps.find((step) => step.id === "verify")?.complete ?? false), status: configuredProperties === 0 ? "not-configured" : setup.steps.find((step) => step.id === "verify")?.complete ? "healthy" : "needs-attention", detail: configuredProperties === 0 ? "Fresh install: tracker coverage begins after discovery" : setup.steps.find((step) => step.id === "verify")?.detail ?? "Tracker verification has not run" },
];
console.log(JSON.stringify({ ok: checks.every((check) => check.ok), version: APP_VERSION, checks }, null, 2));
if (checks.some((check) => !check.ok)) process.exit(1);
