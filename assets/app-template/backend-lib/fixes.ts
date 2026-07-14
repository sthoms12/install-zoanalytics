import { existsSync } from "node:fs";
import { db, getProperty, type Property } from "./db";
import { logFixEvent } from "./ledger";

export const FIXABLE_CODES = ["missing_title", "missing_description", "missing_canonical", "noindex"] as const;
export type FixableCode = typeof FIXABLE_CODES[number];

function isFixableCode(value: string): value is FixableCode {
  return (FIXABLE_CODES as readonly string[]).includes(value);
}

const CUSTOM_SSR_SIGNATURE = /renderSeoDocument|injectSeo\w*\s*\(|\bSeoHead\b|["']<\/head>["']/;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type FixCapability = { supported: boolean; reason: string | null; filePath: string | null };

export async function getFixCapability(propertyId: string): Promise<FixCapability> {
  const property = getProperty(propertyId);
  if (!property) return { supported: false, reason: "Unknown property.", filePath: null };
  if (!property.projectPath) return { supported: false, reason: "No local source path is linked to this property.", filePath: null };
  const filePath = `${property.projectPath}/index.html`;
  if (!existsSync(filePath)) return { supported: false, reason: "No index.html shell found at the linked source path.", filePath: null };
  const serverPath = `${property.projectPath}/server.ts`;
  if (existsSync(serverPath)) {
    const serverSource = await Bun.file(serverPath).text();
    if (CUSTOM_SSR_SIGNATURE.test(serverSource)) {
      return { supported: false, reason: "This property renders per-route SEO tags in server.ts, so automatic shell edits are disabled to avoid conflicting with that logic.", filePath: null };
    }
  }
  return { supported: true, reason: null, filePath };
}

function currentRobotsTag(html: string) {
  const match = html.match(/<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])[^>]*>/i);
  return match ? { tag: match[0], content: match[1] } : null;
}

function transform(html: string, code: FixableCode, property: Property, value?: string) {
  if (code === "missing_title") {
    const suggestedValue = property.name;
    const finalValue = value?.trim() || suggestedValue;
    const titleTag = `<title>${escapeHtml(finalValue)}</title>`;
    const after = /<title>[\s\S]*?<\/title>/i.test(html)
      ? html.replace(/<title>[\s\S]*?<\/title>/i, titleTag)
      : html.replace(/<\/head>/i, `    ${titleTag}\n  </head>`);
    return { after, suggestedValue, requiresValue: true };
  }
  if (code === "missing_description") {
    const ogDescription = html.match(/<meta\b(?=[^>]*\bproperty\s*=\s*["']og:description["'])(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])[^>]*>/i)?.[1] ?? null;
    const finalValue = value?.trim() || ogDescription;
    if (!finalValue) return { after: html, suggestedValue: ogDescription, requiresValue: true };
    const metaTag = `<meta name="description" content="${escapeHtml(finalValue)}" />`;
    const after = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i.test(html)
      ? html.replace(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i, metaTag)
      : html.replace(/<\/head>/i, `    ${metaTag}\n  </head>`);
    return { after, suggestedValue: ogDescription, requiresValue: true };
  }
  if (code === "missing_canonical") {
    const linkTag = `<link rel="canonical" href="${escapeHtml(property.url)}" />`;
    const after = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i.test(html)
      ? html.replace(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i, linkTag)
      : html.replace(/<\/head>/i, `    ${linkTag}\n  </head>`);
    return { after, suggestedValue: null, requiresValue: false };
  }
  const robots = currentRobotsTag(html);
  if (!robots) return { after: html, suggestedValue: null, requiresValue: false };
  const tokens = robots.content.split(",").map((token) => token.trim().toLowerCase()).filter((token) => token && token !== "noindex" && token !== "none");
  const nextContent = tokens.length ? tokens.join(", ") : "index, follow";
  const nextTag = robots.tag.replace(/content\s*=\s*["'][^"']*["']/i, `content="${escapeHtml(nextContent)}"`);
  return { after: html.replace(robots.tag, nextTag), suggestedValue: null, requiresValue: false };
}

export async function previewFix(propertyId: string, code: string, value?: string) {
  if (!isFixableCode(code)) throw new Error("Unsupported fix code.");
  const capability = await getFixCapability(propertyId);
  if (!capability.supported || !capability.filePath) throw new Error(capability.reason ?? "This property is not eligible for automatic fixes.");
  const property = getProperty(propertyId)!;
  const before = await Bun.file(capability.filePath).text();
  const result = transform(before, code, property, value);
  const changed = result.after !== before;
  return {
    propertyId, code, filePath: capability.filePath, before,
    after: changed ? result.after : before,
    changed, needsValue: !changed && result.requiresValue && !value?.trim(),
    suggestedValue: result.suggestedValue,
  };
}

export async function applyFix(propertyId: string, code: string, value: string | undefined, actionKey: string | undefined) {
  const preview = await previewFix(propertyId, code, value);
  if (!preview.changed) throw new Error(preview.needsValue ? "Provide a value for this fix before applying." : "This fix would not change the current file — it may already be applied.");
  await Bun.write(preview.filePath, preview.after);
  const fixId = `fix_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO safe_fixes (id, property_id, action_key, code, file_path, before_content, after_content, status, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', CURRENT_TIMESTAMP)`).run(fixId, propertyId, actionKey ?? null, code, preview.filePath, preview.before, preview.after);
  logFixEvent({ propertyId, kind: code, title: `Applied safe fix: ${code.replaceAll("_", " ")}`, detail: `${preview.filePath} was updated by the Safe Fix Laboratory.`, externalRef: fixId });
  return { id: fixId, filePath: preview.filePath };
}

export async function revertFix(fixId: string) {
  const row = db.query("SELECT id, property_id AS propertyId, code, file_path AS filePath, before_content AS beforeContent, status FROM safe_fixes WHERE id=?")
    .get(fixId) as { id: string; propertyId: string; code: string; filePath: string; beforeContent: string; status: string } | null;
  if (!row) throw new Error("Unknown fix.");
  if (row.status !== "applied") throw new Error("This fix has already been reverted.");
  await Bun.write(row.filePath, row.beforeContent);
  db.prepare("UPDATE safe_fixes SET status='reverted', reverted_at=CURRENT_TIMESTAMP WHERE id=?").run(fixId);
  logFixEvent({ propertyId: row.propertyId, kind: row.code, title: `Reverted safe fix: ${row.code.replaceAll("_", " ")}`, detail: `${row.filePath} was restored to its prior content.`, externalRef: `${fixId}-revert` });
  return { ok: true };
}

export function listFixes(propertyId?: string) {
  const rows = propertyId
    ? db.query(`SELECT id, property_id AS propertyId, action_key AS actionKey, code, file_path AS filePath, status, applied_at AS appliedAt, reverted_at AS revertedAt
        FROM safe_fixes WHERE property_id=? ORDER BY applied_at DESC`).all(propertyId)
    : db.query(`SELECT id, property_id AS propertyId, action_key AS actionKey, code, file_path AS filePath, status, applied_at AS appliedAt, reverted_at AS revertedAt
        FROM safe_fixes ORDER BY applied_at DESC LIMIT 200`).all();
  return rows;
}
