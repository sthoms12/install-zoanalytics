function value(flag: string) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; }
const privateOrigin = value("--private-origin")?.replace(/\/$/, "");
const publicOrigin = value("--public-origin")?.replace(/\/$/, "");
if (!privateOrigin || !publicOrigin) throw new Error("--private-origin and --public-origin are required");

async function check(id: string, url: string, expected: number, contains?: string) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json,text/html" } });
    const body = await response.text();
    const ok = response.status === expected && (!contains || body.includes(contains));
    return { id, ok, status: response.status, detail: ok ? "verified" : `Expected ${expected}${contains ? ` containing ${contains}` : ""}` };
  } catch (error) { return { id, ok: false, status: null, detail: error instanceof Error ? error.message : String(error) }; }
}

const checks = await Promise.all([
  check("private-dashboard-health", `${privateOrigin}/api/health`, 200, "ZoAnalytics"),
  check("private-management-api", `${privateOrigin}/api/analytics/setup`, 200, "appVersion"),
  check("public-collector-health", `${publicOrigin}/api/health`, 200, "ZoAnalytics"),
  check("public-pulse", `${publicOrigin}/api/pulse`, 200),
  check("public-management-boundary", `${publicOrigin}/api/analytics/setup`, 404, "unavailable"),
]);
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), privateOrigin, publicOrigin, checks }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);
