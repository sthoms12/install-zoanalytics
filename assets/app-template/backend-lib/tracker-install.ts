import { getProperty } from "./db";
import { join } from "node:path";

function snippet(propertyId: string, collectorOrigin: string) {
  return `<script defer src="${collectorOrigin.replace(/\/$/, "")}/zowa.js" data-site="${propertyId}"></script>`;
}

async function target(propertyId: string) {
  const property = getProperty(propertyId);
  if (!property) throw new Error("Property not found");
  if (!property.projectPath) throw new Error("No local project is linked to this property");
  const filePath = join(property.projectPath, "index.html");
  if (!await Bun.file(filePath).exists()) throw new Error("A safe index.html tracker target was not found");
  return { property, filePath };
}

export async function previewTrackerInstall(propertyId: string, collectorOrigin: string) {
  if (!collectorOrigin.startsWith("https://")) throw new Error("The public collector origin is not configured");
  const { property, filePath } = await target(propertyId);
  const before = await Bun.file(filePath).text();
  const tag = snippet(property.id, collectorOrigin);
  const alreadyInstalled = /zowa\.js/i.test(before) && new RegExp(`data-site(?:-id)?=["']${property.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(before);
  if (alreadyInstalled) return { propertyId, filePath, snippet: tag, before, after: before, changed: false, alreadyInstalled: true };
  const closingHead = before.match(/<\/head\s*>/i);
  if (!closingHead?.index) throw new Error("The index.html file does not contain a safe </head> insertion point");
  const after = `${before.slice(0, closingHead.index)}  ${tag}\n${before.slice(closingHead.index)}`;
  return { propertyId, filePath, snippet: tag, before, after, changed: true, alreadyInstalled: false };
}

export async function applyTrackerInstall(propertyId: string, collectorOrigin: string) {
  const preview = await previewTrackerInstall(propertyId, collectorOrigin);
  if (!preview.changed) return preview;
  await Bun.write(preview.filePath, preview.after);
  return preview;
}
