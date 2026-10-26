/**
 * THE RESOURCE FINDER: "A DATE PICKER FOR REACT", "PDF PARSING IN PYTHON" -> A RANKED SHORTLIST, WITH A PICK AND THE REASONS.
 *
 *   findResources(need, brain, opts) -> { ecosystem, candidates (ranked, six), pick, pickReason, notes }
 *
 * Choosing a library is the decision a project lives with longest, and the one a
 * model is worst at from memory (it recommends what was popular when it was
 * trained). So this does not ask a model. It searches with layer 3 (the registries
 * and GitHub, `package_lookup` and `compare_libs`), takes the first six packages
 * that really exist, and looks each one up:
 *
 *   licence      as an SPDX id, judged against an allowlist (licences.ts): MIT, Apache-2.0,
 *                BSD-2/3, ISC, 0BSD, Unlicense and MPL-2.0 are ok; LGPL warns; GPL and
 *                AGPL warn strongly for a closed-source project; no licence warns
 *   maintenance  the last publish, deprecated, an archived repo, and GitHub's stars and
 *                open issues when it will say
 *   security     OSV (POST api.osv.dev/v1/query) at the version it would install: how many
 *                known vulnerabilities, how bad, and the version that fixes them
 *   size         npm's unpacked size and its dependency count (PyPI: the release's file
 *                size and requires_dist)
 *   popularity   weekly downloads
 *   stack fit    its peer dependencies against the framework versions the project has
 *                (the brain's manifests): React 17 only, in a React 18 project, is poor
 *
 * Then a score out of 100 (relevance 25, licence 20, maintenance 20, security 15,
 * popularity 10, size 5, fit 5), minus 30 for each thing that rules a package out
 * (deprecated, archived, an unfixed critical vulnerability, a strongly warned
 * licence). The pick is the best one that nothing rules out; if every one is ruled
 * out the pick is null and the reason says why, rather than naming the least bad.
 *
 * Every lookup is a call through the egress guard with an injectable `fetchFn`
 * (nothing here reaches a network in a test), and every one may fail: a package
 * with a lookup that failed is scored on what is known and the reason says what is
 * not (`security: not checked`), never as if the answer were clean.
 */
import type { PlanCtx, Ranked, FetchLike, SearchEnv, SearchPlan, Source, ResultSource } from "../../web/search/types.js";
import { search as layer3Search, type SearchOptions } from "../../web/search/engine.js";
import { getJson } from "../../web/search/http.js";
import { npm } from "../../web/search/sources/index.js";
import { significantWords } from "../../web/search/sources/util.js";
import type { SearchStore } from "../../web/search/index.js";
import type { BrainHandle } from "../project/index.js";
import { judge, normalise, type LicenceVerdict } from "./licences.js";
import type { Ecosystem } from "./lockfiles.js";
import { queryOsv, type OsvEcosystem, type Severity, type Vuln } from "./osv.js";
import { compareVersions, minVersion, satisfies } from "./semver.js";
import { cut } from "../work/model.js";

export interface Maintenance {
  level: "fresh" | "ok" | "stale" | "abandoned" | "unknown";
  lastPublish?: number;
  ageDays?: number;
  deprecated?: string;
  archived?: boolean;
  stars?: number;
  openIssues?: number;
}

export interface SecurityFacts {
  /** OSV answered. False: the number below says nothing. */
  checked: boolean;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  ids: string[];
  /** The version that fixes the worst of them, when one does. */
  fixedIn?: string;
}

export interface ResourceCandidate {
  name: string;
  ecosystem: Ecosystem;
  version: string;
  url: string;
  summary: string;
  /** 0 to 100, after what rules a package out. */
  score: number;
  licence: LicenceVerdict;
  maintenance: Maintenance;
  security: SecurityFacts;
  size: { unpackedBytes?: number; dependencies?: number };
  popularity: { weeklyDownloads?: number };
  fit: { level: "good" | "poor" | "unknown"; unmet: string[]; missing: string[] };
  /** What rules it out, in words; empty when nothing does. */
  avoid: string[];
  /** One line a person can read: what is good about it and what to watch. */
  line: string;
}

export interface Resources {
  need: string;
  ecosystem: Ecosystem;
  candidates: ResourceCandidate[];
  /** The name of the best candidate nothing rules out, or null. */
  pick: string | null;
  pickReason: string;
  notes: string[];
}

export type FinderBrain = Pick<BrainHandle, "status" | "deps">;

export interface FinderOptions {
  fetchFn?: FetchLike;
  now?: () => number;
  /** Which registry; inferred from the words of the need and the project's language when not given. */
  ecosystem?: Ecosystem;
  /** The project does not publish its source, so GPL and AGPL warn strongly. True unless said. */
  closedSource?: boolean;
  /** A GitHub token, to raise the limit on the repository lookups. */
  githubToken?: string;
  /** Layer 3's search, or a stand-in. */
  search?: typeof layer3Search;
  /** The search cache and index: the shared one unless given; null for neither. */
  store?: SearchStore | null;
  env?: SearchEnv;
  sources?: Partial<Record<ResultSource, Source>>;
  signal?: AbortSignal;
  /** Candidates looked up (6). */
  max?: number;
}

export const CANDIDATES_MAX = 6;
const POINTS = { relevance: 25, licence: 20, maintenance: 20, security: 15, popularity: 10, size: 5, fit: 5 } as const;
const AVOID_PENALTY = 30;
const DAY = 86_400_000;
/** Lookups in flight at once. */
const AT_ONCE = 3;

const get = async <T>(url: string, fetchFn: FetchLike | undefined, headers?: Record<string, string>, maxBytes?: number): Promise<T | null> => {
  try { return (await getJson<T>(url, { fetchFn, ...(headers ? { headers } : {}), ...(maxBytes ? { maxBytes } : {}) })).data; } catch { return null; }
};

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

// ----------------------------------------------------------- what to look for

const PY = /\b(python|pip|pypi|django|flask|fastapi|pandas|numpy|pytest|jupyter|scipy|sklearn|pydantic)\b/i;
const JS = /\b(node|nodejs|npm|react|vue|svelte|angular|next\.?js|nuxt|typescript|javascript|expo|react native|express|tailwind|vite|jquery|deno)\b/i;

/** The registry a need is about: its own words, then the project's main language, then npm. */
export function ecosystemFor(need: string, languages: readonly string[] = []): Ecosystem {
  if (PY.test(need) && !JS.test(need)) return "PyPI";
  if (JS.test(need)) return "npm";
  const top = languages[0]?.toLowerCase();
  return top === "python" ? "PyPI" : "npm";
}

/** The words of a need that make a search, in order: "date picker for React" -> "date picker react". */
export function keywordsOf(need: string): string {
  return significantWords(need, 6).join(" ");
}

const planFor = (intent: SearchPlan["intent"], queries: string[], sources: SearchPlan["sources"], freshness: SearchPlan["freshness"]): SearchPlan =>
  ({ intent, queries, sources, freshness, confidence: 1 });

interface Raw { name: string; ecosystem: Ecosystem; score: number; kind: "package" | "repo"; repo?: string }

const nameOk = (n: string, eco: Ecosystem): boolean => (eco === "npm" ? /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(n) : /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n)) && n.length <= 214;

/** The packages a search found, or could be named by the repositories it found. Best first. */
export function candidatesOf(results: readonly Ranked[], eco: Ecosystem): Raw[] {
  const out: Raw[] = [];
  const seen = new Set<string>();
  const add = (r: Raw) => { const k = r.name.toLowerCase(); if (!seen.has(k) && nameOk(r.name, eco)) { seen.add(k); out.push(r); } };
  for (const r of results) {
    const m = r.meta ?? {};
    if (m.kind === "package" && typeof m.name === "string" && String(m.ecosystem ?? "").toLowerCase() === eco.toLowerCase()) {
      add({ name: m.name, ecosystem: eco, score: r.score, kind: "package", ...(typeof m.repo === "string" ? { repo: m.repo } : {}) });
    }
  }
  for (const r of results) {
    const m = r.meta ?? {};
    if (m.kind === "repo" && r.source === "github" && m.deprecated === undefined) {
      const name = r.title.split("/").pop() ?? "";
      add({ name: eco === "npm" ? name.toLowerCase() : name, ecosystem: eco, score: r.score * 0.8, kind: "repo", repo: r.url });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// ----------------------------------------------------------------- the lookups

interface NpmLatest {
  version?: string; license?: unknown; deprecated?: unknown; description?: string; homepage?: string; repository?: unknown;
  dist?: { unpackedSize?: number }; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
interface PypiDoc {
  info?: { name?: string; version?: string; summary?: string; license?: string; classifiers?: string[]; requires_dist?: string[] | null; project_urls?: Record<string, string> | null; home_page?: string; package_url?: string; yanked?: boolean };
  urls?: Array<{ size?: number; packagetype?: string; upload_time_iso_8601?: string; yanked?: boolean }>;
}

interface Facts {
  name: string; ecosystem: Ecosystem; version: string; url: string; summary: string;
  licence: string | null; lastPublish?: number; deprecated?: string; repo?: string;
  unpackedBytes?: number; dependencies?: number; weeklyDownloads?: number; peers: Record<string, string>; optionalPeers: Set<string>;
}

const githubRepo = (url: string | undefined): { owner: string; name: string } | null => {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(url ?? "");
  return m ? { owner: m[1]!, name: m[2]! } : null;
};

const repoOf = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v : typeof (v as { url?: unknown } | null)?.url === "string" ? (v as { url: string }).url : "";
  const t = s.trim().replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://").replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  return /^https?:\/\//.test(t) ? t : undefined;
};

async function npmFacts(name: string, o: FinderOptions): Promise<Facts | null> {
  const enc = name.replace("/", "%2F");
  const [latest, hit] = await Promise.all([
    get<NpmLatest>(`https://registry.npmjs.org/${enc}/latest`, o.fetchFn),
    // The layer 3 source: the last publish, the weekly downloads and the repository, for the exact name.
    npm.search(name, { fetchFn: o.fetchFn, limit: 3 }).then((rs) => rs.find((r) => String(r.meta?.name ?? "").toLowerCase() === name.toLowerCase())).catch(() => undefined),
  ]);
  if (!latest && !hit) return null;
  const m = hit?.meta ?? {};
  const deprecated = typeof latest?.deprecated === "string" && latest.deprecated ? latest.deprecated : typeof m.deprecated === "string" ? m.deprecated : undefined;
  const repo = repoOf(latest?.repository) ?? (typeof m.repo === "string" ? m.repo : undefined);
  return {
    name, ecosystem: "npm", version: latest?.version ?? String(m.version ?? ""), url: `https://www.npmjs.com/package/${name}`, summary: cut(latest?.description ?? hit?.snippet ?? "", 160),
    licence: normalise(latest?.license ?? m.license), lastPublish: typeof m.modified === "number" ? m.modified : hit?.published, ...(deprecated ? { deprecated: cut(deprecated, 160) } : {}),
    ...(repo ? { repo } : {}), ...(typeof latest?.dist?.unpackedSize === "number" ? { unpackedBytes: latest.dist.unpackedSize } : {}),
    ...(latest?.dependencies ? { dependencies: Object.keys(latest.dependencies).length } : {}),
    ...(typeof m.weeklyDownloads === "number" ? { weeklyDownloads: m.weeklyDownloads } : {}),
    peers: latest?.peerDependencies ?? {}, optionalPeers: new Set(Object.entries(latest?.peerDependenciesMeta ?? {}).filter(([, v]) => v?.optional).map(([k]) => k)),
  };
}

async function pypiFacts(name: string, o: FinderOptions): Promise<Facts | null> {
  const [doc, stats] = await Promise.all([
    get<PypiDoc>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, o.fetchFn, undefined, 6 * 1024 * 1024),
    get<{ data?: { last_week?: number } }>(`https://pypistats.org/api/packages/${encodeURIComponent(name.toLowerCase())}/recent`, o.fetchFn),
  ]);
  const info = doc?.info;
  if (!info?.name || !info.version) return null;
  const files = doc?.urls ?? [];
  const wheel = files.find((f) => f.packagetype === "bdist_wheel") ?? files[0];
  const up = Date.parse(files.map((f) => f.upload_time_iso_8601 ?? "").sort().pop() ?? "");
  const deps = (info.requires_dist ?? []).filter((r) => !/;\s*.*\bextra\b/.test(r));
  const links = info.project_urls ?? {};
  const repo = repoOf(Object.entries(links).find(([k]) => /^(source|source code|repository|code|github|git)$/i.test(k.trim()))?.[1] ?? Object.values(links).find((v) => /github\.com/.test(v)) ?? info.home_page);
  return {
    name: info.name, ecosystem: "PyPI", version: info.version, url: info.package_url ?? `https://pypi.org/project/${info.name}/`, summary: cut(info.summary ?? "", 160),
    licence: normalise(info.license && info.license.length <= 60 && !info.license.includes("\n") ? info.license : undefined, info.classifiers ?? []),
    ...(Number.isFinite(up) ? { lastPublish: up } : {}),
    ...(info.yanked ? { deprecated: "this release was yanked" } : info.classifiers?.some((c) => /Development Status :: 7 - Inactive/.test(c)) ? { deprecated: "marked inactive" } : {}),
    ...(repo ? { repo } : {}), ...(typeof wheel?.size === "number" ? { unpackedBytes: wheel.size } : {}), dependencies: deps.length,
    ...(typeof stats?.data?.last_week === "number" ? { weeklyDownloads: stats.data.last_week } : {}),
    peers: {}, optionalPeers: new Set(),
  };
}

interface GhRepo { stargazers_count?: number; open_issues_count?: number; archived?: boolean; pushed_at?: string; license?: { spdx_id?: string | null } | null }

async function githubFacts(repo: string | undefined, o: FinderOptions): Promise<GhRepo | null> {
  const r = githubRepo(repo);
  if (!r) return null;
  return get<GhRepo>(`https://api.github.com/repos/${r.owner}/${r.name}`, o.fetchFn, {
    Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(o.githubToken ? { Authorization: `Bearer ${o.githubToken}` } : {}),
  });
}

async function securityFacts(f: Facts, o: FinderOptions): Promise<SecurityFacts> {
  const none: SecurityFacts = { checked: false, total: 0, critical: 0, high: 0, medium: 0, low: 0, unknown: 0, ids: [] };
  if (!f.version) return none;
  try {
    const vulns = await queryOsv(f.name, f.ecosystem as OsvEcosystem, f.version, { fetchFn: o.fetchFn });
    const by = (s: Severity) => vulns.filter((v) => v.severity === s).length;
    const worst = vulns.filter((v) => v.severity === "critical" || v.severity === "high").concat(vulns);
    const fixed = worst.map((v) => v.fixed).filter((x): x is string => !!x).sort(compareVersions).pop();
    return {
      checked: true, total: vulns.length, critical: by("critical"), high: by("high"), medium: by("medium"), low: by("low"), unknown: by("unknown"),
      ids: vulns.slice(0, 8).map((v: Vuln) => v.id), ...(fixed ? { fixedIn: fixed } : {}),
    };
  } catch {
    return none;
  }
}

// --------------------------------------------------------------------- scoring

function maintenanceOf(f: Facts, gh: GhRepo | null, now: number): Maintenance {
  const last = f.lastPublish ?? (gh?.pushed_at ? Date.parse(gh.pushed_at) : undefined);
  const ageDays = last !== undefined && Number.isFinite(last) ? Math.max(0, Math.round((now - last) / DAY)) : undefined;
  const level: Maintenance["level"] = ageDays === undefined ? "unknown" : ageDays <= 180 ? "fresh" : ageDays <= 540 ? "ok" : ageDays <= 1100 ? "stale" : "abandoned";
  return {
    level, ...(last !== undefined && Number.isFinite(last) ? { lastPublish: last } : {}), ...(ageDays !== undefined ? { ageDays } : {}),
    ...(f.deprecated ? { deprecated: f.deprecated } : {}), ...(gh?.archived ? { archived: true } : {}),
    ...(typeof gh?.stargazers_count === "number" ? { stars: gh.stargazers_count } : {}), ...(typeof gh?.open_issues_count === "number" ? { openIssues: gh.open_issues_count } : {}),
  };
}

/** Peer dependencies against what the project has: those it breaks, and those it lacks. */
export function fitOf(peers: Readonly<Record<string, string>>, optional: ReadonlySet<string>, project: ReadonlyMap<string, string>): ResourceCandidate["fit"] {
  const unmet: string[] = [];
  const missing: string[] = [];
  let checked = 0;
  for (const [name, range] of Object.entries(peers)) {
    const spec = project.get(name);
    if (spec === undefined) { if (!optional.has(name)) missing.push(name); continue; }
    const v = minVersion(spec);
    if (!v) continue;
    checked += 1;
    if (!satisfies(v, range)) unmet.push(`${name} ${range} (the project has ${spec})`);
  }
  return { level: unmet.length ? "poor" : checked > 0 ? "good" : "unknown", unmet, missing };
}

const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const count = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
const ago = (days: number): string => (days < 45 ? `${days} day${days === 1 ? "" : "s"} ago` : days < 700 ? `${Math.round(days / 30)} months ago` : `${(days / 365).toFixed(1).replace(/\.0$/, "")} years ago`);

export function scoreCandidate(c: Omit<ResourceCandidate, "score" | "avoid" | "line">, index: number): { score: number; avoid: string[]; line: string } {
  let pts = Math.max(5, POINTS.relevance - 4 * index);
  pts += c.licence.level === "ok" ? POINTS.licence : c.licence.level === "warn" ? 8 : c.licence.level === "unknown" ? 4 : 0;
  const m = c.maintenance;
  pts += m.deprecated || m.archived ? 0 : m.level === "fresh" ? POINTS.maintenance : m.level === "ok" ? 14 : m.level === "stale" ? 6 : m.level === "abandoned" ? 0 : 8;
  const s = c.security;
  pts += !s.checked ? 7 : s.critical ? 0 : s.high ? 3 : s.medium ? 8 : s.low || s.unknown ? 12 : POINTS.security;
  const dl = c.popularity.weeklyDownloads ?? 0;
  pts += dl >= 1e6 ? 10 : dl >= 1e5 ? 8 : dl >= 1e4 ? 6 : dl >= 1e3 ? 4 : dl >= 100 ? 2 : 0;
  const bytes = c.size.unpackedBytes;
  pts += bytes === undefined ? 2 : bytes < 100 * 1024 ? 5 : bytes < 1024 * 1024 ? 4 : bytes < 5 * 1024 * 1024 ? 2 : 0;
  if ((c.size.dependencies ?? 0) > 30) pts -= 1;
  pts += c.fit.level === "good" ? POINTS.fit : c.fit.level === "unknown" ? 3 : 0;

  const avoid: string[] = [];
  if (m.deprecated) avoid.push(`it is deprecated (${cut(m.deprecated, 80)})`);
  if (m.archived) avoid.push("its repository is archived");
  if (s.checked && s.critical) avoid.push(`it has ${s.critical} critical known ${s.critical === 1 ? "vulnerability" : "vulnerabilities"}${s.fixedIn ? ` (fixed in ${s.fixedIn})` : ""}`);
  if (c.licence.level === "strong_warn") avoid.push(`its licence is ${c.licence.spdx}`);
  const score = Math.max(0, Math.min(100, Math.round(pts - AVOID_PENALTY * avoid.length)));

  const good: string[] = [];
  good.push(c.licence.spdx ?? "no licence stated");
  if (m.ageDays !== undefined) good.push(`last published ${ago(m.ageDays)}`);
  if (dl) good.push(`${count(dl)} downloads a week`);
  if (m.stars !== undefined) good.push(`${count(m.stars)} stars${m.openIssues !== undefined ? `, ${count(m.openIssues)} open issues` : ""}`);
  good.push(!s.checked ? "security not checked" : s.total === 0 ? "no known vulnerabilities" : `${s.total} known ${s.total === 1 ? "vulnerability" : "vulnerabilities"} (${[s.critical && `${s.critical} critical`, s.high && `${s.high} high`, s.medium && `${s.medium} medium`, s.low && `${s.low} low`].filter(Boolean).join(", ") || "severity unknown"})`);
  if (bytes !== undefined) good.push(`${kb(bytes)}${c.size.dependencies !== undefined ? `, ${c.size.dependencies} dependenc${c.size.dependencies === 1 ? "y" : "ies"}` : ""}`);
  if (c.fit.level === "good") good.push("fits the project's frameworks");
  const watch: string[] = [...avoid.map((a) => `ruled out: ${a}`), ...(c.licence.level === "warn" || c.licence.level === "unknown" ? [c.licence.note] : []), ...c.fit.unmet.map((u) => `needs ${u}`)];
  if (m.level === "stale" || m.level === "abandoned") watch.push("not updated for a long time");
  return { score, avoid, line: `${c.name}@${c.version}: ${good.join(", ")}.${watch.length ? ` Watch: ${watch.join("; ")}.` : ""}` };
}

// -------------------------------------------------------------------- the find

export async function findResources(need: string, brain: FinderBrain, o: FinderOptions = {}): Promise<Resources> {
  const text = String(need ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const now = (o.now ?? Date.now)();
  const view = await brain.status().catch(() => null);
  const languages = (view?.structure?.languages ?? []).map((l) => l.lang);
  const eco = o.ecosystem ?? ecosystemFor(text, languages);
  const notes: string[] = [];
  const empty = (why: string): Resources => ({ need: text, ecosystem: eco, candidates: [], pick: null, pickReason: why, notes });
  const kw = keywordsOf(text);
  if (!kw) return empty("Say what you need, for example \"a date picker for React\" or \"PDF parsing in Python\".");

  const deps = await brain.deps().catch(() => []);
  const project = new Map(deps.filter((d) => d.ecosystem === (eco === "npm" ? "npm" : "pypi")).map((d) => [d.name, d.spec]));
  const ctx: PlanCtx = { languages: languages.map((l) => l.toLowerCase()), deps: deps.slice(0, 40).map((d) => d.name), ...(view?.structure?.frameworks?.[0] ? { framework: view.structure.frameworks[0].toLowerCase() } : {}) };

  // Layer 3: the registry for the words, and the landscape (GitHub, Hacker News) for what people use.
  const run = o.search ?? layer3Search;
  const common: SearchOptions = {
    ctx, depth: "quick", limit: 12, ...(o.fetchFn ? { fetchFn: o.fetchFn } : {}), now: () => now, ...(o.store !== undefined ? { store: o.store } : {}),
    ...(o.env ? { env: o.env } : {}), ...(o.sources ? { sources: o.sources } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(o.githubToken ? { env: { ...(o.env ?? {}), githubToken: o.githubToken } } : {}),
  };
  const registry = eco === "npm" ? "npm" : "pypi";
  const found = await Promise.allSettled([
    run(kw, { ...common, plan: planFor("package_lookup", [kw], [registry, "github"], "any") }),
    run(kw, { ...common, plan: planFor("compare_libs", [`${kw} library`, `best ${kw} libraries`], ["github", "hn"], "year") }),
  ]);
  const results: Ranked[] = [];
  for (const f of found) {
    if (f.status === "fulfilled") { results.push(...f.value.results); for (const n of f.value.notes ?? []) if (!notes.includes(n)) notes.push(n); } else notes.push("search:failed");
  }
  const raw = candidatesOf(results, eco);
  if (!raw.length) return empty(`I couldn't find ${eco === "npm" ? "an npm package" : "a PyPI package"} for "${text}". Try other words.`);

  // The first six that exist: a repository's name is only a guess at a package, so each is looked up.
  const max = Math.min(o.max ?? CANDIDATES_MAX, CANDIDATES_MAX);
  const looked = await mapLimit(raw.slice(0, max * 2), AT_ONCE, async (r) => ({ r, f: await (eco === "npm" ? npmFacts(r.name, o) : pypiFacts(r.name, o)) }));
  const real = looked.filter((x): x is { r: Raw; f: Facts } => x.f !== null && !!x.f.version).slice(0, max);
  if (!real.length) return empty(`None of what I found could be looked up in the ${eco === "npm" ? "npm" : "PyPI"} registry. Try other words.`);

  const built = await mapLimit(real, AT_ONCE, async ({ f }, index) => {
    const [security, gh] = await Promise.all([securityFacts(f, o), githubFacts(f.repo, o)]);
    const verdict = judge(f.licence ?? normalise(gh?.license?.spdx_id && gh.license.spdx_id !== "NOASSERTION" ? gh.license.spdx_id : undefined), o.closedSource ?? true);
    const base = {
      name: f.name, ecosystem: f.ecosystem, version: f.version, url: f.url, summary: f.summary, licence: verdict, maintenance: maintenanceOf(f, gh, now), security,
      size: { ...(f.unpackedBytes !== undefined ? { unpackedBytes: f.unpackedBytes } : {}), ...(f.dependencies !== undefined ? { dependencies: f.dependencies } : {}) },
      popularity: { ...(f.weeklyDownloads !== undefined ? { weeklyDownloads: f.weeklyDownloads } : {}) },
      fit: fitOf(f.peers, f.optionalPeers, project),
    };
    return { ...base, ...scoreCandidate(base, index) } as ResourceCandidate;
  });
  if (built.some((c) => !c.security.checked)) notes.push("security:not_checked");

  const candidates = built.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  const clean = candidates.find((c) => c.avoid.length === 0);
  const pick = clean?.name ?? null;
  const pickReason = clean
    ? `${clean.name} scores best of those nothing rules out (${clean.score} out of 100). ${clean.line}`
    : `Every one of these has a reason to be careful: ${candidates.slice(0, 3).map((c) => `${c.name} (${c.avoid[0]})`).join("; ")}. Look at the options before choosing.`;
  return { need: text, ecosystem: eco, candidates, pick, pickReason, notes };
}
