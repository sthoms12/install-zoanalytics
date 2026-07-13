import { finishCrawlRun, getProperties, getProperty, saveCrawledPage, startCrawlRun, type CrawlPageInput, type Property } from "./db";

type CrawlResult = {
  runId: string;
  propertyId: string;
  pagesSeen: number;
  pagesCrawled: number;
  status: "completed" | "failed";
  error?: string;
};

const STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "because",
  "been",
  "but",
  "can",
  "from",
  "have",
  "into",
  "its",
  "more",
  "not",
  "our",
  "that",
  "the",
  "their",
  "this",
  "with",
  "you",
  "your",
]);

export async function crawlProperty(propertyId: string, maxPages = 25): Promise<CrawlResult> {
  const property = getProperty(propertyId);
  if (!property) {
    return { runId: "", propertyId, pagesSeen: 0, pagesCrawled: 0, status: "failed", error: "Unknown property" };
  }

  if (!isCrawlableProperty(property)) {
    return { runId: "", propertyId, pagesSeen: 0, pagesCrawled: 0, status: "failed", error: "Property does not have a public HTTP URL" };
  }

  const runId = startCrawlRun(propertyId);
  const queue = await seedUrls(property.url);
  const seen = new Set<string>();
  let pagesCrawled = 0;

  try {
    while (queue.length && pagesCrawled < maxPages) {
      const next = normalizeUrl(queue.shift() ?? "", property.url);
      if (!next || seen.has(next)) continue;
      seen.add(next);

      const page = await inspectPage(property, next);
      saveCrawledPage(runId, page);
      pagesCrawled += 1;

      if (page.statusCode >= 200 && page.statusCode < 400) {
        for (const href of await extractInternalLinks(next, page.url)) {
          if (!seen.has(href) && queue.length + seen.size < maxPages * 2) queue.push(href);
        }
      }
    }

    finishCrawlRun(runId, "completed", seen.size + queue.length, pagesCrawled);
    return { runId, propertyId, pagesSeen: seen.size + queue.length, pagesCrawled, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishCrawlRun(runId, "failed", seen.size + queue.length, pagesCrawled, message);
    return { runId, propertyId, pagesSeen: seen.size + queue.length, pagesCrawled, status: "failed", error: message };
  }
}

export async function crawlAllPublicProperties(maxPages = 20) {
  const properties = getProperties().filter(isCrawlableProperty);
  const results: CrawlResult[] = [];
  for (const property of properties) {
    results.push(await crawlProperty(property.id, maxPages));
  }
  return results;
}

async function seedUrls(baseUrl: string) {
  const base = normalizeUrl(baseUrl, baseUrl);
  const urls = new Set<string>();
  if (base) urls.add(base);

  for (const sitemapUrl of [new URL("/sitemap.xml", baseUrl).toString(), new URL("/sitemap_index.xml", baseUrl).toString()]) {
    try {
      const response = await fetch(sitemapUrl, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const xml = await response.text();
      for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const url = normalizeUrl(decodeXml(match[1]), baseUrl);
        if (url && sameOrigin(url, baseUrl)) urls.add(url);
      }
    } catch {
      continue;
    }
  }

  return [...urls];
}

async function inspectPage(property: Property, url: string): Promise<CrawlPageInput> {
  const started = performance.now();
  let response: Response;
  let html = "";
  try {
    response = await fetch(url, { headers: { "User-Agent": "ZoAnalyticsCrawler/0.1" }, signal: AbortSignal.timeout(12000) });
    html = await response.text();
  } catch {
    return pageFromFailure(property.id, url, 0, Math.round(performance.now() - started));
  }

  const loadMs = Math.round(performance.now() - started);
  const text = visibleText(html);
  const title = extractTagText(html, "title");
  const description = extractMeta(html, "description");
  const h1 = extractTagText(html, "h1");
  const canonical = extractLink(html, "canonical");
  const robots = extractMeta(html, "robots");
  const ogTitle = extractMeta(html, "og:title", "property");
  const twitterTitle = extractMeta(html, "twitter:title");
  const links = extractLinks(html, url);
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const imagesMissingAlt = images.filter((img) => !/\salt\s*=\s*["'][^"']+["']/i.test(img)).length;
  const schemaTypes = extractSchemaTypes(html);
  const wordCount = countWords(text);
  const issues = evaluateIssues({
    statusCode: response.status,
    title,
    description,
    h1,
    canonical,
    robots,
    wordCount,
    imagesMissingAlt,
    loadMs,
    htmlBytes: html.length,
  });

  return {
    propertyId: property.id,
    url,
    path: new URL(url).pathname || "/",
    statusCode: response.status,
    title,
    description,
    h1,
    canonical,
    robots,
    wordCount,
    internalLinks: links.internal.length,
    externalLinks: links.external.length,
    images: images.length,
    imagesMissingAlt,
    schemaTypes,
    ogTitle,
    twitterTitle,
    htmlBytes: html.length,
    loadMs,
    seoScore: scorePage(issues),
    issues,
    keywords: inferKeywords([title, description, h1, text].filter(Boolean).join(" ")),
    internalUrls: links.internal,
    externalUrls: links.external,
  };
}

async function extractInternalLinks(crawledUrl: string, _pageUrl: string) {
  try {
    const response = await fetch(crawledUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const html = await response.text();
    return extractLinks(html, crawledUrl).internal;
  } catch {
    return [];
  }
}

function pageFromFailure(propertyId: string, url: string, statusCode: number, loadMs: number): CrawlPageInput {
  return {
    propertyId,
    url,
    path: safePath(url),
    statusCode,
    title: null,
    description: null,
    h1: null,
    canonical: null,
    robots: null,
    wordCount: 0,
    internalLinks: 0,
    externalLinks: 0,
    images: 0,
    imagesMissingAlt: 0,
    schemaTypes: [],
    ogTitle: null,
    twitterTitle: null,
    htmlBytes: 0,
    loadMs,
    seoScore: 0,
    issues: [{ severity: "critical", code: "fetch_failed", message: "Page could not be fetched by the crawler." }],
    keywords: [],
    internalUrls: [],
    externalUrls: [],
  };
}

function isCrawlableProperty(property: Property) {
  return property.url.startsWith("https://") || property.url.startsWith("http://");
}

function normalizeUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(value: string, base: string) {
  try {
    return new URL(value).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function extractLinks(html: string, base: string) {
  const internal = new Set<string>();
  const external = new Set<string>();
  const origin = new URL(base).origin;
  for (const match of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    const normalized = normalizeUrl(href, base);
    if (!normalized) continue;
    if (new URL(normalized).origin === origin) internal.add(normalized);
    else external.add(normalized);
  }
  return { internal: [...internal], external: [...external] };
}

function extractTagText(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(match?.[1]);
}

function extractMeta(html: string, name: string, attr = "name") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\b(?=[^>]*\\s${attr}\\s*=\\s*["']${escaped}["'])(?=[^>]*\\scontent\\s*=\\s*["']([^"']*)["'])[^>]*>`, "i");
  return clean(html.match(pattern)?.[1]);
}

function extractLink(html: string, rel: string) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<link\\b(?=[^>]*\\srel\\s*=\\s*["'][^"']*${escaped}[^"']*["'])(?=[^>]*\\shref\\s*=\\s*["']([^"']+)["'])[^>]*>`, "i");
  return clean(html.match(pattern)?.[1]);
}

function extractSchemaTypes(html: string) {
  const types = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      for (const type of collectSchemaTypes(parsed)) types.add(type);
    } catch {
      continue;
    }
  }
  return [...types];
}

function collectSchemaTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectSchemaTypes);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const ownType = typeof item["@type"] === "string" ? [item["@type"]] : [];
  const graph = Array.isArray(item["@graph"]) ? item["@graph"].flatMap(collectSchemaTypes) : [];
  return [...ownType, ...graph];
}

function evaluateIssues(page: {
  statusCode: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  robots: string | null;
  wordCount: number;
  imagesMissingAlt: number;
  loadMs: number;
  htmlBytes: number;
}) {
  const issues: CrawlPageInput["issues"] = [];
  if (page.statusCode >= 400 || page.statusCode === 0) issues.push({ severity: "critical", code: "bad_status", message: `HTTP status ${page.statusCode || "failed"} prevents reliable indexing.` });
  if (!page.title) issues.push({ severity: "critical", code: "missing_title", message: "Missing title tag." });
  else if (page.title.length < 20 || page.title.length > 65) issues.push({ severity: "warning", code: "title_length", message: "Title length is outside the 20-65 character target." });
  if (!page.description) issues.push({ severity: "warning", code: "missing_description", message: "Missing meta description." });
  else if (page.description.length < 50 || page.description.length > 160) issues.push({ severity: "info", code: "description_length", message: "Meta description length is outside the 50-160 character target." });
  if (!page.h1) issues.push({ severity: "warning", code: "missing_h1", message: "Missing H1." });
  if (!page.canonical) issues.push({ severity: "info", code: "missing_canonical", message: "Missing canonical link." });
  if (page.robots?.toLowerCase().includes("noindex")) issues.push({ severity: "critical", code: "noindex", message: "Page declares noindex." });
  if (page.wordCount > 0 && page.wordCount < 250) issues.push({ severity: "warning", code: "thin_content", message: "Page has fewer than 250 visible words." });
  if (page.imagesMissingAlt > 0) issues.push({ severity: "info", code: "missing_alt", message: `${page.imagesMissingAlt} images are missing alt text.` });
  if (page.loadMs > 3000) issues.push({ severity: "warning", code: "slow_response", message: `Fetch took ${page.loadMs}ms.` });
  if (page.htmlBytes > 500_000) issues.push({ severity: "info", code: "heavy_html", message: "HTML is heavier than 500KB." });
  return issues;
}

function scorePage(issues: CrawlPageInput["issues"]) {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "critical") return sum + 28;
    if (issue.severity === "warning") return sum + 13;
    return sum + 5;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function inferKeywords(text: string) {
  const words = visibleText(text)
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([keyword, weight]) => ({ keyword, weight, source: "page-copy" }));
}

function visibleText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function countWords(text: string) {
  return text.match(/\b[\w'-]+\b/g)?.length ?? 0;
}

function clean(value: string | undefined) {
  if (!value) return null;
  const cleaned = decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  return cleaned || null;
}

function decodeXml(value: string) {
  return decodeHtml(value.trim());
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function safePath(value: string) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return "/";
  }
}
