/**
 * THE RESOURCE FINDER (src/code/resources/finder.ts, licences.ts, semver.ts): "a date picker for React", "PDF parsing in
 * Python" -> a ranked shortlist with the reasons, from layer 3's search and a lookup of each candidate.
 *
 * Against a fake world (tests/work-fixtures.ts): npm, PyPI, OSV and GitHub answering from memory, every call written
 * down, nothing reaching a network. What these hold down:
 *   - licences: SPDX from whatever the registry typed; MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, Unlicense and MPL-2.0 ok;
 *     LGPL warns; GPL and AGPL warn strongly for a closed-source project and only warn for an open one; no licence warns;
 *   - maintenance (last publish, deprecated, archived, stars and issues), security (OSV, at the version it would
 *     install, POSTed in OSV's shape), size, popularity, and fit with the project's framework versions;
 *   - the score, what rules a package out, and a pick that is never one of those;
 *   - a lookup that fails is "not checked", never "clean".
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
const { findResources, ecosystemFor, keywordsOf, candidatesOf, fitOf, scoreCandidate } = await import("../src/code/resources/finder.js");
const { normalise, judge } = await import("../src/code/resources/licences.js");
const { compareVersions, satisfies, minVersion, parseVersion } = await import("../src/code/resources/semver.js");
type Ranked = import("../src/web/search/types.js").Ranked;
type Source = import("../src/web/search/types.js").Source;

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const quiet = (id: "ddg" | "searxng" | "brave"): Source => ({ id, async search() { return []; } });
const SOURCES = { ddg: quiet("ddg"), searxng: quiet("searxng"), brave: quiet("brave") };

// ----------------------------------------------------------------- licences

describe("licences: what a registry says, as SPDX", () => {
  it("reads the ways an author types a licence", () => {
    expect(normalise("MIT")).toBe("MIT");
    expect(normalise("mit license")).toBe("MIT");
    expect(normalise("Apache 2.0")).toBe("Apache-2.0");
    expect(normalise("Apache License 2.0")).toBe("Apache-2.0");
    expect(normalise("BSD")).toBe("BSD-3-Clause");
    expect(normalise("BSD-2-Clause")).toBe("BSD-2-Clause");
    expect(normalise("GPLv3")).toBe("GPL-3.0-only");
    expect(normalise("LGPL-2.1+")).toBe("LGPL-2.1-or-later");
    expect(normalise("AGPL-3.0-or-later")).toBe("AGPL-3.0-or-later");
    expect(normalise({ type: "ISC" })).toBe("ISC");
    expect(normalise("(MIT OR Apache-2.0)")).toBe("MIT OR Apache-2.0");
    expect(normalise("MIT AND CC0-1.0")).toBe("MIT AND CC0-1.0");
    expect(normalise([{ type: "MIT" }, { type: "Apache-2.0" }])).toBe("MIT OR Apache-2.0");
  });

  it("reads PyPI's classifiers when the licence field is empty or a whole licence text", () => {
    expect(normalise("", ["License :: OSI Approved :: MIT License"])).toBe("MIT");
    expect(normalise(undefined, ["Programming Language :: Python", "License :: OSI Approved :: Apache Software License"])).toBe("Apache-2.0");
    expect(normalise(undefined, ["License :: OSI Approved :: GNU General Public License v3 (GPLv3)"])).toBe("GPL-3.0-only");
    expect(normalise("Permission is hereby granted, free of charge, to any person\nobtaining a copy", ["License :: OSI Approved :: BSD License"])).toBe("BSD-3-Clause");
  });

  it("gives nothing for what is not a licence", () => {
    for (const v of ["UNLICENSED", "SEE LICENSE IN LICENSE.md", "Proprietary", "", undefined, null, 5, "Some custom thing"]) expect(normalise(v), String(v)).toBeNull();
  });
});

describe("licences: the allowlist", () => {
  it("MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, Unlicense and MPL-2.0 are ok, however closed the project", () => {
    for (const id of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "MPL-2.0"]) {
      expect(judge(id, true).level, id).toBe("ok");
      expect(judge(id, false).level, id).toBe("ok");
    }
  });

  it("LGPL warns", () => {
    expect(judge("LGPL-3.0-only")).toMatchObject({ level: "warn" });
    expect(judge("LGPL-2.1-or-later").note).toMatch(/Check before you modify it/);
    expect(judge("EPL-2.0").level).toBe("warn");
  });

  it("GPL and AGPL warn strongly for a closed-source project, and only warn for an open one", () => {
    for (const id of ["GPL-3.0-only", "GPL-2.0-or-later", "AGPL-3.0-only"]) {
      expect(judge(id, true).level, id).toBe("strong_warn");
      expect(judge(id, false).level, id).toBe("warn");
    }
    expect(judge("AGPL-3.0-only", true).note).toMatch(/closed-source/);
  });

  it("no licence, or one it does not know, warns", () => {
    expect(judge(null)).toMatchObject({ spdx: null, level: "unknown" });
    expect(judge(null).note).toMatch(/all rights are reserved/);
    expect(judge("Zed-1.0").level).toBe("warn");
  });

  it("'A OR B' is as good as the better, 'A AND B' as bad as the worse", () => {
    expect(judge("MIT OR GPL-3.0-only", true).level).toBe("ok");
    expect(judge("GPL-3.0-only OR LGPL-3.0-only", true).level).toBe("warn");
    expect(judge("MIT AND GPL-3.0-only", true).level).toBe("strong_warn");
    expect(judge("MIT OR Apache-2.0").spdx).toBe("MIT OR Apache-2.0");
  });
});

// ------------------------------------------------------------------- semver

describe("semver, just enough", () => {
  it("compares versions, a pre-release below its release", () => {
    expect(compareVersions("1.2.3", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBe(-1);
    expect(compareVersions("v3", "2.9.9")).toBe(1);
    expect(parseVersion("not a version")).toBeNull();
  });

  it("tests a version against npm's ranges and Python's", () => {
    for (const [v, r] of [["18.2.0", "^18.0.0"], ["18.2.0", "^16.9 || ^17 || ^18"], ["18.2.0", ">=16.8"], ["1.4.9", "~1.4.0"], ["3.1.0", "3.x"], ["2.5.0", ">=2 <3"], ["2.0.0", "1.0.0 - 2.0.0"], ["9.9.9", "*"], ["1.2.3", "==1.2.3"], ["2.3.0", "~=2.1"]] as const) {
      expect(satisfies(v, r), `${v} ${r}`).toBe(true);
    }
    for (const [v, r] of [["18.2.0", "^17.0.0"], ["19.0.0", "^16.9 || ^17 || ^18"], ["1.5.0", "~1.4.0"], ["3.0.0", ">=2 <3"], ["0.3.0", "^0.2.0"], ["1.2.4", "==1.2.3"]] as const) {
      expect(satisfies(v, r), `${v} ${r}`).toBe(false);
    }
  });

  it("finds the lowest version a manifest's range allows, and none for what names none", () => {
    for (const [r, v] of [["^4.17.0", "4.17.0"], [">=2", "2.0.0"], ["~1.4", "1.4.0"], ["==3.1.2", "3.1.2"], ["^18.2.0 || ^19", "18.2.0"], ["1.2.3", "1.2.3"], [">=1.0,<2.0", "1.0.0"], ["~=2.1", "2.1.0"]] as const) {
      expect(minVersion(r), r).toBe(v);
    }
    for (const r of ["*", "latest", "workspace:*", "github:a/b", "file:../x", "git+https://x/y.git", ""]) expect(minVersion(r), r).toBeNull();
  });
});

// ------------------------------------------------------------------- the pieces

describe("what the words of a need say", () => {
  it("picks the registry from the words, then from the project's language, then npm", () => {
    expect(ecosystemFor("pdf parsing in Python")).toBe("PyPI");
    expect(ecosystemFor("a date picker for React")).toBe("npm");
    expect(ecosystemFor("an http client", ["Python"])).toBe("PyPI");
    expect(ecosystemFor("an http client", ["TypeScript"])).toBe("npm");
    expect(ecosystemFor("an http client")).toBe("npm");
    expect(ecosystemFor("a python wrapper for node")).toBe("npm");
  });

  it("keeps the meaningful words, in order", () => {
    expect(keywordsOf("a date picker for React")).toBe("date picker react");
    expect(keywordsOf("PDF parsing in Python")).toBe("pdf parsing python");
    expect(keywordsOf("")).toBe("");
  });

  it("packages come from package results, and a repository only names a guess at one", () => {
    const hit = (o: Partial<Ranked>): Ranked => ({ title: "x", url: "https://x", snippet: "", source: "npm", score: 1, reasons: [], ...o });
    const found = candidatesOf([
      hit({ title: "react-datepicker@7", score: 2, meta: { kind: "package", ecosystem: "npm", name: "react-datepicker" } }),
      hit({ title: "Hacker0x01/react-datepicker", source: "github", score: 1.5, url: "https://github.com/Hacker0x01/react-datepicker", meta: { kind: "repo" } }),
      hit({ title: "gorilla/mux", source: "github", score: 0.5, meta: { kind: "repo" } }),
      hit({ title: "somepkg 1.0", source: "pypi", score: 3, meta: { kind: "package", ecosystem: "pypi", name: "somepkg" } }),
      hit({ title: "BAD NAME/with spaces", source: "github", score: 0.1, meta: { kind: "repo" } }),
    ], "npm");
    expect(found.map((c) => [c.name, c.kind])).toEqual([["react-datepicker", "package"], ["mux", "repo"]]);
  });

  it("peer dependencies against the project's: those it breaks, those it lacks, and those that are optional", () => {
    const project = new Map([["react", "^18.2.0"], ["react-dom", "^18.2.0"]]);
    expect(fitOf({ react: "^16.9 || ^17 || ^18", "react-dom": ">=16" }, new Set(), project)).toEqual({ level: "good", unmet: [], missing: [] });
    expect(fitOf({ react: "^15.0.0" }, new Set(), project)).toEqual({ level: "poor", unmet: ["react ^15.0.0 (the project has ^18.2.0)"], missing: [] });
    expect(fitOf({ vue: "^3", date: "*" }, new Set(["date"]), project)).toEqual({ level: "unknown", unmet: [], missing: ["vue"] });
    expect(fitOf({}, new Set(), project).level).toBe("unknown");
  });
});

// ------------------------------------------------------------------- the find

/** A world where "a date picker for React" has a clean winner, a deprecated one, a GPL one, a vulnerable one and a misfit. */
function datePickerWorld() {
  const w = fakeWorld();
  const base = { version: "1.0.0", date: "2026-08-20T00:00:00.000Z", license: "MIT", weekly: 100_000, unpackedSize: 200_000, tags: ["date", "picker", "react", "datepicker"] };
  w.npm.set("react-datepicker", { ...base, version: "7.3.0", weekly: 1_200_000, unpackedSize: 900_000, dependencies: { a: "1", b: "1", c: "1" }, peers: { react: "^16.9 || ^17 || ^18 || ^19", "react-dom": "^16.9 || ^17 || ^18 || ^19" }, repo: "https://github.com/Hacker0x01/react-datepicker" });
  w.npm.set("react-day-picker", { ...base, version: "9.1.0", weekly: 900_000, unpackedSize: 80_000, peers: { react: ">=16.8.0" }, repo: "https://github.com/gpbl/react-day-picker" });
  w.npm.set("old-datepicker", { ...base, version: "2.0.0", date: "2021-02-01T00:00:00.000Z", weekly: 50_000, deprecated: "no longer maintained, use react-day-picker" });
  w.npm.set("gpl-datepicker", { ...base, version: "3.0.0", license: "GPL-3.0", weekly: 40_000 });
  w.npm.set("vuln-datepicker", { ...base, version: "4.2.0", weekly: 300_000 });
  w.npm.set("react15-datepicker", { ...base, version: "1.9.0", weekly: 20_000, peers: { react: "^15.0.0" } });
  w.github.set("Hacker0x01/react-datepicker", { stars: 7200, issues: 340, spdx: "MIT" });
  w.github.set("gpbl/react-day-picker", { stars: 6000, issues: 12, spdx: "MIT" });
  w.osv.set("npm:vuln-datepicker@4.2.0", [osvRecord({ id: "GHSA-aaaa-bbbb-cccc", pkg: "vuln-datepicker", ecosystem: "npm", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", fixed: ["4.2.1"] })]);
  w.osv.set("npm:react-datepicker@7.3.0", [osvRecord({ id: "GHSA-low", pkg: "react-datepicker", ecosystem: "npm", severity: "LOW" })]);
  return w;
}

async function reactProject() {
  const { brain } = await fixtureBrain({
    files: [{ path: "src/App.tsx" }],
    structure: {
      languages: [{ lang: "TypeScript", bytes: 1000, files: 3, pct: 100 }], frameworks: ["React"],
      core: { "package.json": { sha: "x", kind: "npm", data: { name: "app", deps: ["react", "react-dom"], devDeps: [], depVersions: { react: "^18.2.0", "react-dom": "^18.2.0" } } } },
    },
  });
  return brain;
}

describe("findResources", () => {
  it("ranks the shortlist and picks the best that nothing rules out, with a line each", async () => {
    const w = datePickerWorld();
    const out = await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    expect(out.ecosystem).toBe("npm");
    expect(out.candidates.length).toBeGreaterThanOrEqual(5);
    expect(out.candidates.length).toBeLessThanOrEqual(6);
    const names = out.candidates.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["react-datepicker", "react-day-picker", "old-datepicker", "gpl-datepicker", "vuln-datepicker", "react15-datepicker"]));
    // the clean ones lead; each thing that rules a package out puts it below them
    const pos = (n: string) => names.indexOf(n);
    for (const bad of ["old-datepicker", "gpl-datepicker", "vuln-datepicker"]) expect(pos(bad), bad).toBeGreaterThan(pos("react-day-picker"));
    expect(["react-datepicker", "react-day-picker"]).toContain(out.pick);
    expect(out.candidates.find((c) => c.name === out.pick)!.avoid).toEqual([]);
    expect(out.pickReason).toContain(out.pick!);
  });

  it("collects the licence, maintenance, security, size, popularity and fit of each", async () => {
    const w = datePickerWorld();
    const out = await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    const by = (n: string) => out.candidates.find((c) => c.name === n)!;

    const rdp = by("react-datepicker");
    expect(rdp).toMatchObject({ version: "7.3.0", ecosystem: "npm", url: "https://www.npmjs.com/package/react-datepicker" });
    expect(rdp.licence).toMatchObject({ spdx: "MIT", level: "ok" });
    expect(rdp.maintenance).toMatchObject({ level: "fresh", ageDays: 68, stars: 7200, openIssues: 340 });
    expect(rdp.security).toMatchObject({ checked: true, total: 1, low: 1, critical: 0 });
    expect(rdp.size).toEqual({ unpackedBytes: 900_000, dependencies: 3 });
    expect(rdp.popularity.weeklyDownloads).toBe(1_200_000);
    expect(rdp.fit).toEqual({ level: "good", unmet: [], missing: [] });
    expect(rdp.line).toMatch(/^react-datepicker@7\.3\.0: MIT, last published 2 months ago, 1\.2M downloads a week, 7\.2k stars, 340 open issues, 1 known vulnerability \(1 low\), 879 KB, 3 dependencies, fits the project's frameworks\.$/);

    expect(by("react15-datepicker").fit).toMatchObject({ level: "poor", unmet: ["react ^15.0.0 (the project has ^18.2.0)"] });
    expect(by("react15-datepicker").line).toMatch(/Watch: .*needs react \^15\.0\.0/);
  });

  it("asks OSV in its own shape, for the version it would install, once for each candidate", async () => {
    const w = datePickerWorld();
    await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    const osv = w.calls.filter((c) => c.url === "https://api.osv.dev/v1/query");
    expect(osv.every((c) => c.method === "POST")).toBe(true);
    expect(osv.find((c) => c.body.package.name === "react-datepicker")!.body).toEqual({ package: { name: "react-datepicker", ecosystem: "npm" }, version: "7.3.0" });
    expect(new Set(osv.map((c) => c.body.package.name)).size).toBe(osv.length);
  });

  it("rules out a deprecated package, a closed-source project's GPL package, and one with an unfixed critical vulnerability", async () => {
    const w = datePickerWorld();
    const out = await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    const by = (n: string) => out.candidates.find((c) => c.name === n)!;
    expect(by("old-datepicker").avoid[0]).toMatch(/^it is deprecated \(no longer maintained/);
    expect(by("old-datepicker").maintenance).toMatchObject({ level: "abandoned", deprecated: expect.stringContaining("no longer maintained") });
    expect(by("gpl-datepicker").avoid).toEqual(["its licence is GPL-3.0-only"]);
    expect(by("gpl-datepicker").licence.level).toBe("strong_warn");
    expect(by("vuln-datepicker").avoid).toEqual(["it has 1 critical known vulnerability (fixed in 4.2.1)"]);
    expect(by("vuln-datepicker").security).toMatchObject({ critical: 1, fixedIn: "4.2.1" });
    for (const n of ["old-datepicker", "gpl-datepicker", "vuln-datepicker"]) expect(by(n).line, n).toMatch(/ruled out:/);
  });

  it("a GPL package is only a warning for an open-source project", async () => {
    const w = datePickerWorld();
    const out = await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES, closedSource: false });
    const gpl = out.candidates.find((c) => c.name === "gpl-datepicker")!;
    expect(gpl.licence.level).toBe("warn");
    expect(gpl.avoid).toEqual([]);
  });

  it("with every candidate ruled out there is no pick, and the reason says why", async () => {
    const w = fakeWorld();
    w.npm.set("only-one", { version: "1.0.0", license: "GPL-3.0", tags: ["widget"], date: "2026-09-01T00:00:00.000Z" });
    const out = await findResources("a widget", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    expect(out.pick).toBeNull();
    expect(out.pickReason).toMatch(/Every one of these has a reason to be careful: only-one \(its licence is GPL-3\.0-only\)/);
  });

  it("a failed OSV lookup is 'not checked', never clean", async () => {
    const w = datePickerWorld();
    w.status.set("api.osv.dev", 503);
    const out = await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    expect(out.candidates.every((c) => c.security.checked === false && c.security.total === 0)).toBe(true);
    expect(out.notes).toContain("security:not_checked");
    expect(out.candidates[0]!.line).toMatch(/security not checked/);
    // so a package the database would have ruled out is not: that is why it is said.
    expect(out.candidates.find((c) => c.name === "vuln-datepicker")!.avoid).toEqual([]);
  });

  it("GitHub saying no (a rate limit, a missing repo) costs the stars and nothing else", async () => {
    const w = datePickerWorld();
    w.status.set("api.github.com", 403);
    const out = await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    const rdp = out.candidates.find((c) => c.name === "react-datepicker");
    // the repositories came from GitHub's search too, so with GitHub refusing the registry search is what finds them
    expect(rdp).toBeDefined();
    expect(rdp!.maintenance.stars).toBeUndefined();
    expect(rdp!.maintenance.level).toBe("fresh");
  });

  it("Python: the repositories GitHub finds name packages, which PyPI is asked for; a classifier is a licence", async () => {
    const w = fakeWorld();
    w.github.set("py-pdf/pypdf", { stars: 8000, issues: 100, spdx: "BSD-3-Clause", description: "PDF parsing library", topics: ["pdf", "parsing"] });
    w.github.set("jsvine/pdfplumber", { stars: 6000, issues: 80, spdx: "MIT", description: "pdf parsing and table extraction", topics: ["pdf"] });
    w.github.set("someone/not-on-pypi", { stars: 10, issues: 1, spdx: "MIT", description: "pdf parsing toy", topics: ["pdf"] });
    w.pypi.set("pypdf", { version: "5.1.0", classifiers: ["License :: OSI Approved :: BSD License"], uploaded: "2026-08-01T00:00:00Z", weekly: 3_000_000, requires: ["typing_extensions; python_version<'3.11'", "x; extra == 'full'"], size: 300_000, repo: "https://github.com/py-pdf/pypdf" });
    w.pypi.set("pdfplumber", { version: "0.11.4", license: "MIT", uploaded: "2026-07-01T00:00:00Z", weekly: 500_000, requires: ["pdfminer.six", "Pillow"], size: 60_000 });
    const brain = (await fixtureBrain({ files: [{ path: "app/main.py", lang: "Python" }], structure: { languages: [{ lang: "Python", bytes: 100, files: 1, pct: 100 }] } })).brain;
    const out = await findResources("PDF parsing in Python", brain, { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    expect(out.ecosystem).toBe("PyPI");
    expect(out.candidates.map((c) => c.name).sort()).toEqual(["pdfplumber", "pypdf"]);
    const pypdf = out.candidates.find((c) => c.name === "pypdf")!;
    expect(pypdf.licence).toMatchObject({ spdx: "BSD-3-Clause", level: "ok" });
    expect(pypdf.popularity.weeklyDownloads).toBe(3_000_000);
    expect(pypdf.size).toEqual({ unpackedBytes: 300_000, dependencies: 1 });
    expect(pypdf.maintenance.stars).toBe(8000);
    const osv = w.calls.find((c) => c.url === "https://api.osv.dev/v1/query" && c.body.package.name === "pypdf")!;
    expect(osv.body).toEqual({ package: { name: "pypdf", ecosystem: "PyPI" }, version: "5.1.0" });
    expect(out.pick).toBeTruthy();
  });

  it("nothing found is said, and an empty need asks for words", async () => {
    const w = fakeWorld();
    const none = await findResources("a quantum flux capacitor", await reactProject(), { fetchFn: w.fetch as never, now: () => NOW, store: null, sources: SOURCES });
    expect(none).toMatchObject({ candidates: [], pick: null });
    expect(none.pickReason).toMatch(/couldn't find an npm package for "a quantum flux capacitor"/);
    expect((await findResources("   ", await reactProject(), { fetchFn: w.fetch as never })).pickReason).toMatch(/Say what you need/);
  });

  it("uses layer 3's search with its own plans: the registry for the words, and GitHub and Hacker News for the landscape", async () => {
    const searched: Array<{ q: string; plan: unknown; fetchFn: unknown; store: unknown }> = [];
    const search = vi.fn(async (q: string, o: { plan?: { intent: string; sources: string[]; queries: string[] }; fetchFn?: unknown; store?: unknown }) => {
      searched.push({ q, plan: o.plan, fetchFn: o.fetchFn, store: o.store });
      return { plan: o.plan as never, results: [] as Ranked[], via: [], cached: false };
    });
    const w = fakeWorld();
    await findResources("a date picker for React", await reactProject(), { fetchFn: w.fetch as never, search: search as never, store: null });
    expect(searched).toHaveLength(2);
    expect(searched[0]).toMatchObject({ q: "date picker react", plan: { intent: "package_lookup", sources: ["npm", "github"], queries: ["date picker react"] } });
    expect(searched[1]).toMatchObject({ q: "date picker react", plan: { intent: "compare_libs", sources: ["github", "hn"], queries: ["date picker react library", "best date picker react libraries"] } });
    expect(searched.every((s) => s.fetchFn === w.fetch && s.store === null)).toBe(true);
  });

  it("scores a package down by 30 for each thing that rules it out, and a clean one by what it is", () => {
    const base = {
      name: "x", ecosystem: "npm" as const, version: "1.0.0", url: "u", summary: "", licence: judge("MIT"), maintenance: { level: "fresh" as const }, security: { checked: true, total: 0, critical: 0, high: 0, medium: 0, low: 0, unknown: 0, ids: [] },
      size: { unpackedBytes: 50_000 }, popularity: { weeklyDownloads: 2_000_000 }, fit: { level: "good" as const, unmet: [], missing: [] },
    };
    const clean = scoreCandidate(base, 0);
    expect(clean.score).toBe(100);
    expect(clean.avoid).toEqual([]);
    const dep = scoreCandidate({ ...base, maintenance: { level: "fresh", deprecated: "gone" } }, 0);
    expect(dep.avoid).toHaveLength(1);
    expect(dep.score).toBe(100 - 20 - 30);
    const two = scoreCandidate({ ...base, maintenance: { level: "fresh", archived: true }, licence: judge("GPL-3.0-only", true) }, 0);
    expect(two.avoid).toHaveLength(2);
    expect(two.score).toBeLessThan(dep.score);
    expect(scoreCandidate(base, 3).score).toBe(88);
  });
});
