import { getProperties, getPropertySources } from "./db";
import { importDiscoveryManifest, publicUrl, reachableWithoutAuth, type DiscoverySurface } from "./intelligence";

const CLOUDFLARE_CLIENT = "/etc/zo/mcpo/clients/cloudflare.ts";

type GitHubRepo = {
  name: string;
  nameWithOwner: string;
  url: string;
  homepageUrl: string;
  isPrivate: boolean;
  defaultBranchRef?: { name?: string } | null;
};

function title(value: string) {
  return value.replace(/^www\./, "").split(/[.-]/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function publicSiteName(url: string, fallback: string) {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "ZoAnalytics external discovery" } });
    const html = await response.text();
    const raw = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/&amp;/gi, "&").trim();
    return raw?.split(/\s+[|–—]\s+/)[0]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function githubRepos() {
  try {
    const user = Bun.spawnSync(["gh", "api", "user", "--jq", ".login"], { stdout: "pipe", stderr: "pipe" });
    if (user.exitCode !== 0) return [];
    const owner = user.stdout.toString().trim();
    const result = Bun.spawnSync(["gh", "repo", "list", owner, "--limit", "500", "--json", "name,nameWithOwner,url,homepageUrl,isPrivate,defaultBranchRef"], { stdout: "pipe", stderr: "pipe" });
    return result.exitCode === 0 ? JSON.parse(result.stdout.toString()) as GitHubRepo[] : [];
  } catch {
    return [];
  }
}

function findRepository(repos: GitHubRepo[], service: string, hostname: string) {
  const serviceKey = normalized(service);
  return repos.find((repo) => repo.name.toLowerCase() === service.toLowerCase())
    ?? repos.find((repo) => normalized(repo.name) === serviceKey)
    ?? repos.find((repo) => {
      try { return repo.homepageUrl && new URL(repo.homepageUrl).hostname.replace(/^www\./, "") === hostname.replace(/^www\./, ""); }
      catch { return false; }
    })
    ?? null;
}

async function cloudflareInventory() {
  const cloudflare = await import(CLOUDFLARE_CLIENT) as { tool_execute_post: (args: Record<string, unknown>) => Promise<any> };
  return cloudflare.tool_execute_post({ code: `async () => {
    const [pages, workers] = await Promise.all([
      cloudflare.request({ method: "GET", path: \`/accounts/\${accountId}/pages/projects\` }),
      cloudflare.request({ method: "GET", path: \`/accounts/\${accountId}/workers/domains\` })
    ]);
    const projects = Array.isArray(pages.result) ? await Promise.all(pages.result.map(async (project) => {
      const domains = await cloudflare.request({ method: "GET", path: \`/accounts/\${accountId}/pages/projects/\${project.name}/domains\` });
      return { ...project, custom_domains: Array.isArray(domains.result) ? domains.result : [] };
    })) : [];
    return { pages: projects, workers: Array.isArray(workers.result) ? workers.result : [] };
  }` });
}

export async function discoverExternalProperties() {
  const repos = await githubRepos();
  let inventory: any;
  try {
    inventory = await cloudflareInventory();
  } catch (error) {
    return { discovered: [], skipped: [], total: getProperties().length, provider: "cloudflare", available: false, error: error instanceof Error ? error.message : "Cloudflare discovery is unavailable" };
  }

  const surfaces: DiscoverySurface[] = [];
  for (const worker of inventory.workers ?? []) {
    if (!worker?.enabled || worker.environment !== "production" || !worker.hostname || !worker.service) continue;
    const repository = findRepository(repos, worker.service, worker.hostname);
    const url = `https://${worker.hostname}`;
    surfaces.push({
      id: `cloudflare-${worker.service}`,
      name: await publicSiteName(url, title(worker.hostname)),
      kind: "external",
      url,
      public: true,
      mode: "http",
      source: "cloudflare-worker",
      provider: "cloudflare",
      providerId: worker.id || worker.service,
      repository: repository?.nameWithOwner ?? null,
      repositoryUrl: repository?.url ?? null,
      metadata: { product: "workers", service: worker.service, environment: worker.environment, zone: worker.zone_name, repositoryPrivate: repository?.isPrivate ?? null, defaultBranch: repository?.defaultBranchRef?.name ?? null },
    });
  }

  for (const project of inventory.pages ?? []) {
    const production = project.canonical_deployment ?? project.latest_deployment;
    if (production?.environment && production.environment !== "production") continue;
    const sourceRepo = project.source?.config?.repo_name;
    const sourceOwner = project.source?.config?.owner;
    const repository = repos.find((repo) => repo.nameWithOwner.toLowerCase() === `${sourceOwner}/${sourceRepo}`.toLowerCase()) ?? findRepository(repos, sourceRepo || project.name, project.subdomain || "");
    const customDomains = (project.custom_domains ?? []).filter((domain: any) => domain?.status === "active" && domain?.name).map((domain: any) => `https://${domain.name}`);
    const primary = customDomains[0] ?? (project.subdomain ? `https://${project.subdomain}` : null);
    if (!primary) continue;
    surfaces.push({
      id: `cloudflare-${project.name}`,
      name: await publicSiteName(primary, title(new URL(primary).hostname)),
      kind: "external",
      url: primary,
      public: true,
      mode: "http",
      source: "cloudflare-pages",
      provider: "cloudflare",
      providerId: project.id || project.name,
      repository: repository?.nameWithOwner ?? (sourceOwner && sourceRepo ? `${sourceOwner}/${sourceRepo}` : null),
      repositoryUrl: repository?.url ?? (sourceOwner && sourceRepo ? `https://github.com/${sourceOwner}/${sourceRepo}` : null),
      aliases: [project.subdomain ? `https://${project.subdomain}` : "", ...customDomains].filter(Boolean),
      metadata: { product: "pages", project: project.name, productionBranch: project.production_branch, repositoryPrivate: repository?.isPrivate ?? null, defaultBranch: repository?.defaultBranchRef?.name ?? null },
    });
  }

  const result = await importDiscoveryManifest(surfaces);
  return { ...result, provider: "cloudflare", available: true, repositoriesMatched: surfaces.filter((surface) => surface.repository).length };
}

export async function addExternalProperty(input: { name?: string; url?: string; repository?: string }) {
  if (!input.url) throw new Error("A public HTTPS URL is required");
  const url = publicUrl(input.url);
  if (!url) throw new Error("The URL must be public HTTPS and cannot be a private or preview Zo address");
  if (!await reachableWithoutAuth(url)) throw new Error("The site is not anonymously reachable");
  const hostname = url.hostname.toLowerCase();
  const repo = input.repository?.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") || null;
  return importDiscoveryManifest([{
    id: `external-${hostname}`,
    name: input.name?.trim() || title(hostname),
    kind: "external",
    url: url.toString().replace(/\/$/, ""),
    public: true,
    mode: "http",
    source: "manual-external",
    provider: repo ? "github" : "manual",
    providerId: repo || hostname,
    repository: repo,
    repositoryUrl: repo ? `https://github.com/${repo}` : null,
    metadata: { product: "external" },
  }]);
}

export function getExternalSources() {
  return getPropertySources();
}
