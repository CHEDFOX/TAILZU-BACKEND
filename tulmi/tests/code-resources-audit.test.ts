/**
 * THE DEPENDENCY AUDIT (src/code/resources/audit.ts, lockfiles.ts, osv.ts): which of the project's packages have known
 * vulnerabilities, how bad, and what fixes them.
 *
 * Lockfile parsers against fixtures in the shape each tool writes; the audit against a brain whose structure names
 * the lockfiles, a fake `fetchManifest`, and a fake OSV. What these hold down:
 *   - each parser: npm lockfile versions 1 and 3, pnpm v5/v6/v9, yarn v1 and berry, poetry, Pipfile.lock, requirements;
 *   - the audit reads the lockfiles the brain knows through fetchManifest, sends the packages to OSV's querybatch, fetches
 *     the advisories for their severity and fix, and answers worst first; with no lockfile it takes the manifests at
 *     their minimum versions and says the answer is approximate;
 *   - CVSS v3 scores, OSV's words, and the lowest version that fixes everything;
 *   - OSV being unreachable is "not checked", never "nothing wrong".
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

noNetwork();

const { fakeWorld, fixtureBrain, osvRecord } = await import("./work-fixtures.js");
const { auditDeps } = await import("../src/code/resources/audit.js");
const { parsePackageLock, parsePnpmLock, parseYarnLock, parsePoetryLock, parsePipfileLock, parseRequirements, parseLockfile } = await import("../src/code/resources/lockfiles.js");
const { cvss3Score, severityOfScore, queryOsv, queryBatch, fetchRecord, vulnOf } = await import("../src/code/resources/osv.js");
const { postJson } = await import("../src/code/resources/net.js");

// ---------------------------------------------------------------- the parsers

describe("lockfile parsers", () => {
  it("package-lock.json v3: every installed copy, nested ones too, dev flagged, links and the root left out", () => {
    const text = JSON.stringify({
      name: "app", lockfileVersion: 3,
      packages: {
        "": { name: "app", dependencies: { lodash: "^4" } },
        "node_modules/lodash": { version: "4.17.15" },
        "node_modules/a/node_modules/lodash": { version: "3.0.0", dev: true },
        "node_modules/@scope/pkg": { version: "1.2.3" },
        "node_modules/linked": { link: true, resolved: "../x" },
        "packages/app": { version: "0.0.0" },
      },
    });
    expect(parsePackageLock(text)).toEqual([
      { name: "lodash", version: "4.17.15", ecosystem: "npm" },
      { name: "lodash", version: "3.0.0", ecosystem: "npm", dev: true },
      { name: "@scope/pkg", version: "1.2.3", ecosystem: "npm" },
    ]);
  });

  it("package-lock.json v1: the nested dependencies tree", () => {
    const text = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: "1.0.0", dependencies: { b: { version: "2.0.0", dev: true } } }, c: { version: "git+https://x/y.git" } } });
    expect(parsePackageLock(text)).toEqual([{ name: "a", version: "1.0.0", ecosystem: "npm" }, { name: "b", version: "2.0.0", ecosystem: "npm", dev: true }]);
  });

  it("a package-lock that is not JSON is nothing", () => {
    expect(parsePackageLock("{not json")).toEqual([]);
  });

  it("pnpm-lock.yaml v9, v6 and v5: the packages section, peers cut off, scoped names whole", () => {
    const v9 = ["lockfileVersion: '9.0'", "", "importers:", "  .:", "    dependencies:", "      lodash:", "        specifier: ^4", "        version: 4.17.15", "", "packages:", "",
      "  lodash@4.17.15:", "    resolution: {integrity: sha512-x}", "", "  '@babel/core@7.24.0':", "    resolution: {integrity: sha512-y}", "", "snapshots:", "", "  lodash@4.17.15: {}", "  ignored@9.9.9: {}", ""].join("\n");
    expect(parsePnpmLock(v9)).toEqual([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }, { name: "@babel/core", version: "7.24.0", ecosystem: "npm" }]);
    const v6 = ["lockfileVersion: '6.0'", "packages:", "", "  /lodash@4.17.15:", "    resolution: {integrity: x}", "    dev: false", "", "  /@babel/core@7.0.0(@types/node@18.0.0):", "    dev: true", ""].join("\n");
    expect(parsePnpmLock(v6)).toEqual([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }, { name: "@babel/core", version: "7.0.0", ecosystem: "npm", dev: true }]);
    const v5 = ["lockfileVersion: 5.4", "packages:", "", "  /lodash/4.17.15:", "    dev: false", "", "  /@babel/core/7.0.0_react@18.0.0:", "    dev: true", "", "  /core_js/3.0.0:", "    dev: false", ""].join("\n");
    expect(parsePnpmLock(v5)).toEqual([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }, { name: "@babel/core", version: "7.0.0", ecosystem: "npm", dev: true }, { name: "core_js", version: "3.0.0", ecosystem: "npm" }]);
  });

  it("yarn.lock v1 and berry: every name a block answers to, with its version", () => {
    const v1 = ["# yarn lockfile v1", "", '"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":', '  version "7.12.13"', '  resolved "https://x"', "", "lodash@^4.17.15, lodash@^4.17.20:", '  version "4.17.21"', ""].join("\n");
    expect(parseYarnLock(v1)).toEqual([{ name: "@babel/code-frame", version: "7.12.13", ecosystem: "npm" }, { name: "lodash", version: "4.17.21", ecosystem: "npm" }]);
    const berry = ["__metadata:", "  version: 6", "", '"lodash@npm:^4.17.21":', "  version: 4.17.21", '  resolution: "lodash@npm:4.17.21"', ""].join("\n");
    expect(parseYarnLock(berry)).toEqual([{ name: "lodash", version: "4.17.21", ecosystem: "npm" }]);
  });

  it("poetry.lock, Pipfile.lock and the pinned lines of a requirements file", () => {
    const poetry = ["[[package]]", 'name = "requests"', 'version = "2.31.0"', "", "[[package]]", 'name = "pytest"', 'version = "8.0.0"', 'category = "dev"', ""].join("\n");
    expect(parsePoetryLock(poetry)).toEqual([{ name: "requests", version: "2.31.0", ecosystem: "PyPI" }, { name: "pytest", version: "8.0.0", ecosystem: "PyPI", dev: true }]);
    const pipfile = JSON.stringify({ default: { flask: { version: "==3.0.0" }, loose: { version: "*" } }, develop: { black: { version: "==24.1.0" } } });
    expect(parsePipfileLock(pipfile)).toEqual([{ name: "flask", version: "3.0.0", ecosystem: "PyPI" }, { name: "black", version: "24.1.0", ecosystem: "PyPI", dev: true }]);
    expect(parseRequirements(["# pins", "fastapi==0.110.0  # the api", "uvicorn[standard]===0.29.0", "requests>=2.0", "pytest", "-r other.txt", ""].join("\n"))).toEqual([
      { name: "fastapi", version: "0.110.0", ecosystem: "PyPI" }, { name: "uvicorn", version: "0.29.0", ecosystem: "PyPI" },
    ]);
  });

  it("parseLockfile picks the parser by the file's name, and ignores what it does not read", () => {
    expect(parseLockfile("web/package-lock.json", JSON.stringify({ packages: { "node_modules/a": { version: "1.0.0" } } }))).toHaveLength(1);
    expect(parseLockfile("requirements-dev.txt", "x==1.0.0")).toHaveLength(1);
    expect(parseLockfile("Cargo.lock", "[[package]]")).toBeNull();
    expect(parseLockfile("go.sum", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------- OSV

describe("OSV", () => {
  it("scores a CVSS v3 vector", () => {
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H")).toBe(7.5);
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N")).toBe(6.1);
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N")).toBe(5.3);
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H")).toBe(9.9);
    expect(cvss3Score("CVSS:3.0/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N")).toBe(1.8);
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
    expect(cvss3Score("CVSS:2.0/AV:N")).toBeNull();
    expect(cvss3Score("garbage")).toBeNull();
    expect(cvss3Score("CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNull();
  });

  it("names a score", () => {
    expect([9.8, 9, 8.1, 7, 6.9, 4, 3.9, 0.1, 0].map(severityOfScore)).toEqual(["critical", "critical", "high", "high", "medium", "medium", "low", "low", "unknown"]);
  });

  it("a record's severity is its vector's, else the database's word, else unknown; its fix is the lowest above the version asked about", () => {
    const rec = osvRecord({ id: "GHSA-1", pkg: "lodash", ecosystem: "npm", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", fixed: ["4.17.21", "3.10.1", "4.17.12"] });
    expect(vulnOf(rec, "lodash", "4.17.15")).toMatchObject({ id: "GHSA-1", severity: "critical", score: 9.8, fixed: "4.17.21" });
    expect(vulnOf(rec, "lodash", "4.17.3")).toMatchObject({ fixed: "4.17.12" });
    expect(vulnOf(osvRecord({ id: "X", pkg: "a", ecosystem: "npm", severity: "MODERATE" }), "a", "1.0.0")).toMatchObject({ severity: "medium" });
    expect(vulnOf(osvRecord({ id: "Y", pkg: "a", ecosystem: "npm" }), "a", "1.0.0")).toMatchObject({ severity: "unknown" });
    expect(vulnOf({}, "a", "1")).toBeNull();
    expect(vulnOf(rec, "lodash", "9.9.9")!.fixed).toBeUndefined();
  });

  it("POSTs the query in OSV's own shape, and reads the answer", async () => {
    const w = fakeWorld();
    w.osv.set("npm:lodash@4.17.15", [osvRecord({ id: "GHSA-1", pkg: "lodash", ecosystem: "npm", severity: "HIGH", fixed: ["4.17.21"] })]);
    const v = await queryOsv("lodash", "npm", "4.17.15", { fetchFn: w.fetch as never });
    expect(v).toEqual([{ id: "GHSA-1", summary: "Problem GHSA-1", severity: "high", fixed: "4.17.21" }]);
    expect(w.calls[0]).toMatchObject({ method: "POST", url: "https://api.osv.dev/v1/query", body: { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.15" } });
    expect(await queryOsv("clean", "npm", "1.0.0", { fetchFn: w.fetch as never })).toEqual([]);
  });

  it("querybatch sends a thousand at a time and answers in order; fetchRecord is null for an unknown advisory", async () => {
    const w = fakeWorld();
    w.osv.set("npm:a@1.0.0", [osvRecord({ id: "GHSA-A", pkg: "a", ecosystem: "npm" })]);
    const qs = Array.from({ length: 2500 }, (_, i) => ({ name: i === 7 ? "a" : `p${i}`, ecosystem: "npm" as const, version: "1.0.0" }));
    const ids = await queryBatch(qs, { fetchFn: w.fetch as never });
    expect(ids).toHaveLength(2500);
    expect(ids[7]).toEqual(["GHSA-A"]);
    expect(ids.filter((x) => x.length).length).toBe(1);
    expect(w.calls.filter((c) => c.url.endsWith("/querybatch")).map((c) => c.body.queries.length)).toEqual([1000, 1000, 500]);
    expect(await fetchRecord("GHSA-A", { fetchFn: w.fetch as never })).toMatchObject({ id: "GHSA-A" });
    expect(await fetchRecord("GHSA-NOPE", { fetchFn: w.fetch as never })).toBeNull();
  });

  it("postJson: a status outside 2xx is http_<status>, a body that is not JSON is unsupported, a dead network is bad_url, and a slow one times out", async () => {
    const f = (r: () => Promise<Response>) => ({ fetchFn: (async () => r()) as never });
    await expect(postJson("https://x.test/a", {}, f(async () => new Response("no", { status: 429 })))).rejects.toMatchObject({ code: "http_429" });
    await expect(postJson("https://x.test/a", {}, f(async () => new Response("<html>", { status: 200 })))).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(postJson("https://x.test/a", {}, f(async () => { throw new Error("ECONNRESET"); }))).rejects.toMatchObject({ code: "bad_url" });
    await expect(postJson("https://x.test/a", {}, { maxBytes: 5, fetchFn: (async () => new Response("{\"a\":\"much too long\"}")) as never })).rejects.toMatchObject({ code: "too_large" });
    await expect(postJson("https://x.test/a", {}, { timeoutMs: 10, fetchFn: ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as never })).rejects.toMatchObject({ code: "timeout" });
    expect(await postJson("https://x.test/a", { q: 1 }, f(async () => new Response('{"ok":true}')))).toEqual({ ok: true });
  });
});

// ------------------------------------------------------------------ the audit

const core = (npmDeps: Record<string, string>, py: Array<[string, string]> = []) => ({
  "package.json": { sha: "x", kind: "npm", data: { name: "app", deps: Object.keys(npmDeps), devDeps: [], depVersions: npmDeps } },
  ...(py.length ? { "requirements.txt": { sha: "y", kind: "requirements", data: { deps: py } } } : {}),
});

const PNPM = ["lockfileVersion: '9.0'", "", "packages:", "", "  lodash@4.17.15:", "    resolution: {integrity: x}", "", "  minimist@1.2.0:", "    resolution: {integrity: y}", "", "  express@4.18.2:", "    resolution: {integrity: z}", ""].join("\n");

function world() {
  const w = fakeWorld();
  w.osv.set("npm:lodash@4.17.15", [
    osvRecord({ id: "GHSA-lodash-1", pkg: "lodash", ecosystem: "npm", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", fixed: ["4.17.19"] }),
    osvRecord({ id: "GHSA-lodash-2", pkg: "lodash", ecosystem: "npm", severity: "MODERATE", fixed: ["4.17.21"] }),
  ]);
  w.osv.set("npm:minimist@1.2.0", [osvRecord({ id: "GHSA-minimist", pkg: "minimist", ecosystem: "npm", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", fixed: ["1.2.6"] })]);
  return w;
}

describe("auditDeps from a lockfile", () => {
  it("reads the lockfile the brain knows through fetchManifest, asks OSV, and answers worst first with each fix", async () => {
    const { brain } = await fixtureBrain({ files: [{ path: "package.json" }], structure: { lockfiles: ["pnpm-lock.yaml"], packageManagers: ["pnpm"], core: core({ lodash: "^4.17.0" }) } });
    const w = world();
    const read = vi.fn(async (p: string) => (p === "pnpm-lock.yaml" ? PNPM : null));
    const a = await auditDeps(brain, read, { fetchFn: w.fetch as never });
    expect(read).toHaveBeenCalledWith("pnpm-lock.yaml");
    expect(a).toMatchObject({ source: "pnpm-lock.yaml", approximate: false, checked: true, scanned: 3 });
    expect(a.vulnerable.map((v) => [v.name, v.version, v.severity, v.fixedIn])).toEqual([["minimist", "1.2.0", "critical", "1.2.6"], ["lodash", "4.17.15", "high", "4.17.21"]]);
    expect(a.vulnerable[1]!.vulns.map((v) => [v.id, v.severity, v.fixed])).toEqual([["GHSA-lodash-1", "high", "4.17.19"], ["GHSA-lodash-2", "medium", "4.17.21"]]);
    expect(a.counts).toEqual({ critical: 1, high: 1, medium: 0, low: 0, unknown: 0 });
    expect(w.calls.filter((c) => c.url.endsWith("/querybatch"))).toHaveLength(1);
    expect(w.calls.find((c) => c.url.endsWith("/querybatch"))!.body.queries).toEqual([
      { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.15" }, { package: { name: "minimist", ecosystem: "npm" }, version: "1.2.0" }, { package: { name: "express", ecosystem: "npm" }, version: "4.18.2" },
    ]);
    // the advisories are fetched once each, by id
    expect(w.calls.filter((c) => c.url.includes("/v1/vulns/")).map((c) => c.url.split("/").pop()!).sort()).toEqual(["GHSA-lodash-1", "GHSA-lodash-2", "GHSA-minimist"]);
  });

  it("a clean project is a clean answer, with how many were looked at", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["package-lock.json"], core: core({}) } });
    const a = await auditDeps(brain, async () => JSON.stringify({ packages: { "node_modules/ok": { version: "1.0.0" } } }), { fetchFn: world().fetch as never });
    expect(a).toMatchObject({ checked: true, scanned: 1, vulnerable: [], approximate: false });
    expect(a.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });
  });

  it("an advisory that cannot be fetched is still reported, with its severity unknown", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["pnpm-lock.yaml"], core: core({}) } });
    const w = world();
    const f = ((u: string, i: RequestInit) => (String(u).includes("/v1/vulns/") ? Promise.resolve(new Response("{}", { status: 500 })) : w.fetch(u, i))) as never;
    const a = await auditDeps(brain, async () => PNPM, { fetchFn: f });
    expect(a.vulnerable.map((v) => [v.name, v.severity])).toEqual([["lodash", "unknown"], ["minimist", "unknown"]]);
    expect(a.vulnerable[0]!.vulns[0]).toMatchObject({ id: "GHSA-lodash-1", summary: "", severity: "unknown" });
  });

  it("more than fifty distinct advisories: the rest are reported without details, and it says so", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["package-lock.json"], core: core({}) } });
    const w = fakeWorld();
    const pk: Record<string, { version: string }> = {};
    for (let i = 0; i < 60; i += 1) { pk[`node_modules/p${i}`] = { version: "1.0.0" }; w.osv.set(`npm:p${i}@1.0.0`, [osvRecord({ id: `GHSA-${i}`, pkg: `p${i}`, ecosystem: "npm", severity: "LOW" })]); }
    const a = await auditDeps(brain, async () => JSON.stringify({ packages: pk }), { fetchFn: w.fetch as never });
    expect(a.vulnerable).toHaveLength(60);
    expect(w.calls.filter((c) => c.url.includes("/v1/vulns/"))).toHaveLength(50);
    expect(a.notes).toContain("advisories:10_without_details");
  });
});

describe("auditDeps without a lockfile", () => {
  it("takes the manifests at their minimum versions and says the answer is approximate", async () => {
    const { brain } = await fixtureBrain({
      files: [{ path: "package.json" }],
      structure: { core: core({ lodash: "^4.17.15", loose: "*", local: "workspace:*", express: "~4.18.0" }, [["requests", "==2.31.0"], ["flask", ">=2.0"], ["any", ""]]) },
    });
    const w = world();
    w.osv.set("PyPI:requests@2.31.0", [osvRecord({ id: "PYSEC-1", pkg: "requests", ecosystem: "PyPI", severity: "HIGH", fixed: ["2.32.0"] })]);
    const a = await auditDeps(brain, async () => null, { fetchFn: w.fetch as never });
    expect(a).toMatchObject({ source: "manifest", approximate: true, checked: true });
    expect(a.notes).toContain("manifest:approximate");
    const sent = w.calls.find((c) => c.url.endsWith("/querybatch"))!.body.queries.map((q: { package: { name: string; ecosystem: string }; version: string }) => `${q.package.ecosystem}:${q.package.name}@${q.version}`);
    expect(sent.sort()).toEqual(["PyPI:flask@2.0.0", "PyPI:requests@2.31.0", "npm:express@4.18.0", "npm:lodash@4.17.15"].sort());
    expect(a.vulnerable.map((v) => [v.name, v.version, v.severity, v.fixedIn])).toEqual([["lodash", "4.17.15", "high", "4.17.21"], ["requests", "2.31.0", "high", "2.32.0"]]);
  });

  it("an ecosystem with a lockfile uses it, and the other falls back to its manifest", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["package-lock.json"], core: core({ lodash: "^4.17.0" }, [["requests", "==2.31.0"]]) } });
    const lock = JSON.stringify({ packages: { "node_modules/lodash": { version: "4.17.21" } } });
    const w = world();
    const a = await auditDeps(brain, async (p) => (p === "package-lock.json" ? lock : null), { fetchFn: w.fetch as never });
    expect(a).toMatchObject({ source: "package-lock.json and manifests", approximate: true, scanned: 2 });
    const sent = w.calls.find((c) => c.url.endsWith("/querybatch"))!.body.queries.map((q: { package: { name: string }; version: string }) => `${q.package.name}@${q.version}`);
    expect(sent).toEqual(["lodash@4.17.21", "requests@2.31.0"]);
  });

  it("a lockfile that cannot be read, or that throws, or that is empty, falls back and says which", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"], core: core({ lodash: "^4.17.15" }) } });
    const a = await auditDeps(brain, async (p) => { if (p === "yarn.lock") throw new Error("boom"); return p === "pnpm-lock.yaml" ? "nothing useful" : null; }, { fetchFn: world().fetch as never });
    expect(a.source).toBe("manifest");
    expect(a.notes).toEqual(expect.arrayContaining(["package-lock.json:unreadable", "yarn.lock:unreadable", "pnpm-lock.yaml:empty"]));
    expect(a.vulnerable.map((v) => v.name)).toEqual(["lodash"]);
  });

  it("nothing to scan is an answer", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { core: {} } });
    expect(await auditDeps(brain, async () => null, { fetchFn: world().fetch as never })).toMatchObject({ checked: true, scanned: 0, vulnerable: [], notes: expect.arrayContaining(["nothing:to_scan"]) });
  });
});

describe("auditDeps when OSV cannot be reached", () => {
  it("is checked: false and says nothing is wrong with nothing", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["pnpm-lock.yaml"], core: core({}) } });
    const w = world();
    w.down.add("api.osv.dev");
    const a = await auditDeps(brain, async () => PNPM, { fetchFn: w.fetch as never });
    expect(a).toMatchObject({ checked: false, vulnerable: [], scanned: 3 });
    expect(a.notes).toContain("osv:unreachable");
  });

  it("an answer with the wrong number of results is not believed", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["pnpm-lock.yaml"], core: core({}) } });
    const f = (async () => new Response(JSON.stringify({ results: [{}] }), { status: 200 })) as never;
    expect((await auditDeps(brain, async () => PNPM, { fetchFn: f })).checked).toBe(false);
  });

  it("caps the packages sent at the number asked", async () => {
    const { brain } = await fixtureBrain({ files: [], structure: { lockfiles: ["package-lock.json"], core: core({}) } });
    const pk = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`node_modules/p${i}`, { version: "1.0.0" }]));
    const w = world();
    const a = await auditDeps(brain, async () => JSON.stringify({ packages: pk }), { fetchFn: w.fetch as never, max: 10 });
    expect(a.scanned).toBe(10);
    expect(a.notes).toContain("capped:10");
  });
});
