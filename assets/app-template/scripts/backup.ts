import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../backend-lib/db";

const source = join(process.cwd(), "data", "zoanalytics.db");
const directory = join(process.cwd(), "data", "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(directory, `zoanalytics-${stamp}.db`);

mkdirSync(directory, { recursive: true });
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
copyFileSync(source, destination);
console.log(JSON.stringify({ ok: true, backup: destination }, null, 2));
