import { db, APP_VERSION } from "../backend-lib/db";
import { getSetupStatus } from "../backend-lib/product";

const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
const privateRows = db.query(`SELECT id, url FROM properties WHERE lifecycle='active' AND (
  url NOT LIKE 'https://%' OR url LIKE '%.zo.computer%' OR url LIKE '%localhost%' OR url LIKE '%127.0.0.1%')`).all();
const setup = getSetupStatus();
const checks = [
  { id: "database", ok: integrity.integrity_check === "ok", detail: integrity.integrity_check },
  { id: "public-only", ok: privateRows.length === 0, detail: privateRows.length ? `${privateRows.length} private or invalid active properties` : "All active properties are public HTTPS surfaces" },
  { id: "discovery", ok: setup.steps.find((step) => step.id === "discover")?.complete ?? false, detail: setup.steps.find((step) => step.id === "discover")?.detail ?? "Not run" },
  { id: "tracker", ok: setup.steps.find((step) => step.id === "verify")?.complete ?? false, detail: setup.steps.find((step) => step.id === "verify")?.detail ?? "Not run" },
];
console.log(JSON.stringify({ ok: checks.every((check) => check.ok), version: APP_VERSION, checks }, null, 2));
if (!checks[0].ok || !checks[1].ok) process.exit(1);
