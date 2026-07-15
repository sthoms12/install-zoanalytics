import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { db, getProperty } from "./db";

export type MigrationSource = "umami" | "plausible";
type CsvRow = Record<string, string>;
export type MigrationPreview = {
  source: MigrationSource;
  propertyId: string;
  fileName: string;
  fingerprint: string;
  mode: "events" | "aggregate";
  rowsRead: number;
  validRows: number;
  skippedRows: number;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  duplicate: boolean;
};

function parseCsv(text: string): CsvRow[] {
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((value) => value.length)) records.push(row);
      row = [];
    } else field += char;
  }
  if (field.length || row.length) { row.push(field); records.push(row); }
  const headers = (records.shift() ?? []).map((value) => value.trim().toLowerCase());
  if (!headers.length) throw new Error("CSV has no header row");
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

const first = (row: CsvRow, names: string[]) => names.map((name) => row[name]).find((value) => value !== undefined && value !== "") ?? "";
const normalizeDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const normalizePath = (value: string) => {
  if (!value) return "/";
  try { return new URL(value, "https://migration.invalid").pathname || "/"; }
  catch { return value.startsWith("/") ? value : `/${value}`; }
};
const number = (value: string) => value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

function classify(source: MigrationSource, rows: CsvRow[]) {
  const headers = new Set(Object.keys(rows[0] ?? {}));
  if (source === "umami" && ["created_at", "createdat", "timestamp", "event_type", "event_name"].some((key) => headers.has(key))) return "events" as const;
  if (["date", "day", "visitors", "pageviews", "visits"].some((key) => headers.has(key))) return "aggregate" as const;
  throw new Error(`Unsupported ${source} CSV schema. Export raw Umami events or a Plausible aggregate CSV with date/day and pageviews/visitors/visits columns.`);
}

export function previewMigration(input: { source: MigrationSource; propertyId: string; fileName: string; content: string }): MigrationPreview {
  if (!getProperty(input.propertyId)) throw new Error(`Unknown property: ${input.propertyId}`);
  const fingerprint = createHash("sha256").update(input.source).update("\0").update(input.content).digest("hex");
  const duplicate = Boolean(db.query("SELECT 1 FROM import_runs WHERE source_fingerprint=?").get(fingerprint));
  const rows = parseCsv(input.content);
  const mode = classify(input.source, rows);
  let validRows = 0;
  const dates: string[] = [];
  for (const row of rows) {
    const at = normalizeDate(first(row, mode === "events" ? ["created_at", "createdat", "timestamp", "time", "date"] : ["date", "day"]));
    if (!at) continue;
    if (mode === "aggregate" && number(first(row, ["pageviews", "views", "visits", "visitors"])) === null) continue;
    validRows++; dates.push(at);
  }
  const warnings: string[] = [];
  if (mode === "aggregate") warnings.push("Aggregate rows remain aggregate history; ZoAnalytics will not fabricate sessions or individual visits.");
  if (duplicate) warnings.push("This exact source file has already been imported.");
  if (validRows !== rows.length) warnings.push(`${rows.length - validRows} rows are invalid and will be skipped.`);
  dates.sort();
  return { source: input.source, propertyId: input.propertyId, fileName: basename(input.fileName), fingerprint, mode, rowsRead: rows.length, validRows, skippedRows: rows.length - validRows, periodStart: dates[0] ?? null, periodEnd: dates.at(-1) ?? null, warnings, duplicate };
}

export function commitMigration(input: { source: MigrationSource; propertyId: string; fileName: string; content: string }) {
  const preview = previewMigration(input);
  if (preview.duplicate) throw new Error("This exact source file has already been imported");
  if (!preview.validRows) throw new Error("No valid rows to import");
  const rows = parseCsv(input.content);
  const runId = randomUUID();
  let imported = 0;
  db.transaction(() => {
    if (preview.mode === "aggregate") {
      const insert = db.prepare(`INSERT INTO imported_daily_metrics
        (property_id,source,source_fingerprint,day,path,pageviews,visitors,visits,bounce_rate,visit_duration_seconds)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(property_id,source,source_fingerprint,day,path) DO UPDATE SET
          pageviews=imported_daily_metrics.pageviews+excluded.pageviews,
          visitors=COALESCE(imported_daily_metrics.visitors,0)+COALESCE(excluded.visitors,0),
          visits=COALESCE(imported_daily_metrics.visits,0)+COALESCE(excluded.visits,0),
          bounce_rate=COALESCE(excluded.bounce_rate,imported_daily_metrics.bounce_rate),
          visit_duration_seconds=COALESCE(excluded.visit_duration_seconds,imported_daily_metrics.visit_duration_seconds)`);
      for (const row of rows) {
        const at = normalizeDate(first(row, ["date", "day"]));
        if (!at) continue;
        const pageviews = number(first(row, ["pageviews", "views"])) ?? 0;
        const visits = number(first(row, ["visits"]));
        const visitors = number(first(row, ["visitors", "unique_visitors"]));
        if (!pageviews && visits === null && visitors === null) continue;
        insert.run(input.propertyId, input.source, preview.fingerprint, at.slice(0, 10), normalizePath(first(row, ["path", "page", "url"])), pageviews, visitors, visits, number(first(row, ["bounce_rate", "bounce"])), number(first(row, ["visit_duration", "visit_duration_seconds", "duration"]))); imported++;
      }
    } else {
      const page = db.prepare(`INSERT INTO pageviews (id,property_id,path,title,url,referrer,visitor_hash,session_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
      const event = db.prepare(`INSERT INTO events (id,property_id,name,path,payload,session_id,created_at) VALUES (?,?,?,?,?,?,?)`);
      for (const row of rows) {
        const at = normalizeDate(first(row, ["created_at", "createdat", "timestamp", "time", "date"]));
        if (!at) continue;
        const path = normalizePath(first(row, ["url_path", "path", "url", "page"]));
        const session = first(row, ["session_id", "sessionid", "session"]); const visitor = first(row, ["visitor_id", "visitorid", "user_id"]);
        const eventName = first(row, ["event_name", "eventname", "name"]); const eventType = first(row, ["event_type", "eventtype", "type"]);
        if (eventName && !["1", "pageview"].includes(eventType.toLowerCase())) event.run(`import:${preview.fingerprint}:${imported}`, input.propertyId, eventName, path, JSON.stringify({ importedFrom: input.source }), session || null, at);
        else page.run(`import:${preview.fingerprint}:${imported}`, input.propertyId, path, first(row, ["page_title", "title"]) || null, first(row, ["url"]) || null, first(row, ["referrer", "referrer_domain"]) || null, visitor ? `import:${input.source}:${visitor}` : null, session ? `import:${input.source}:${session}` : null, at);
        imported++;
      }
    }
    db.prepare(`INSERT INTO import_runs (id,source,source_fingerprint,property_id,file_name,mode,rows_read,rows_imported,rows_skipped,period_start,period_end) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(runId, input.source, preview.fingerprint, input.propertyId, preview.fileName, preview.mode, preview.rowsRead, imported, preview.rowsRead - imported, preview.periodStart, preview.periodEnd);
  })();
  return { ...preview, id: runId, importedRows: imported };
}

export function listMigrationRuns() {
  return db.query(`SELECT r.id,r.source,r.property_id AS propertyId,p.name AS propertyName,r.file_name AS fileName,r.mode,r.rows_read AS rowsRead,r.rows_imported AS rowsImported,r.rows_skipped AS rowsSkipped,r.period_start AS periodStart,r.period_end AS periodEnd,r.created_at AS createdAt FROM import_runs r JOIN properties p ON p.id=r.property_id ORDER BY r.created_at DESC`).all();
}
