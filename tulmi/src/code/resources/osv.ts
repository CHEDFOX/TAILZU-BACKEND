/**
 * OSV: KNOWN VULNERABILITIES FOR A PACKAGE AT A VERSION, FROM osv.dev, THE OPEN DATABASE BEHIND GITHUB'S ADVISORIES AND MORE.
 *
 *   POST https://api.osv.dev/v1/query         { package: { name, ecosystem }, version }
 *                                              -> { vulns: [full records] }
 *   POST https://api.osv.dev/v1/querybatch    { queries: [{ package, version }, ...] }
 *                                              -> { results: [{ vulns: [{ id }] }, ...] }  (ids only)
 *   GET  https://api.osv.dev/v1/vulns/<id>    one full record
 *
 * Keyless and free. `query` is what the finder asks about one candidate at the
 * version it would install; `querybatch` is what an audit asks about a whole
 * lockfile, and then the records of the distinct ids are fetched (50 at most) for
 * their severity and the version that fixes them. A record's severity is its
 * CVSS v3 base score where it gives a vector (cvss3Score computes it), else the
 * database's own word (`database_specific.severity`: LOW, MODERATE, HIGH,
 * CRITICAL), else "unknown".
 *
 * Every call goes through the egress guard (connectors/egress.ts: https, public
 * addresses, 10 s, a size cap) with an injectable `fetchFn`. A failure is a thrown
 * WebError the caller turns into "could not check", never into "no
 * vulnerabilities".
 */
import { WebError } from "../../web/error.js";
import { getJson } from "../../web/search/http.js";
import type { FetchLike } from "../../web/search/types.js";
import { compareVersions } from "./semver.js";
import { postJson } from "./net.js";

export type OsvEcosystem = "npm" | "PyPI" | "crates.io" | "Go" | "RubyGems" | "Packagist" | "Pub" | "Maven" | "NuGet";
export type Severity = "critical" | "high" | "medium" | "low" | "unknown";

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "unknown"];

export interface Vuln {
  id: string;
  summary: string;
  severity: Severity;
  /** The CVSS base score, when the record gives a vector. */
  score?: number;
  /** The lowest version that fixes it, when there is one above the version asked about. */
  fixed?: string;
}

const OSV = "https://api.osv.dev/v1";
const BATCH_MAX = 1000;
export const RECORDS_MAX = 50;

// ----------------------------------------------------------------------- CVSS

const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

/** CVSS v3.x base score from a vector string ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" -> 9.8), or null if it is not one. */
export function cvss3Score(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":") as [string, string]));
  const av = W.AV[m.AV as keyof typeof W.AV], ac = W.AC[m.AC as keyof typeof W.AC], ui = W.UI[m.UI as keyof typeof W.UI];
  const c = W.CIA[m.C as keyof typeof W.CIA], i = W.CIA[m.I as keyof typeof W.CIA], a = W.CIA[m.A as keyof typeof W.CIA];
  const changed = m.S === "C";
  const pr = m.PR === "N" ? 0.85 : m.PR === "L" ? (changed ? 0.68 : 0.62) : m.PR === "H" ? (changed ? 0.5 : 0.27) : undefined;
  if ([av, ac, ui, c, i, a, pr].some((x) => x === undefined) || (m.S !== "U" && m.S !== "C")) return null;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploit = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  const up = (x: number) => { const n = Math.round(x * 100000); return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10; };
  return up(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10));
}

export function severityOfScore(score: number): Severity {
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score > 0 ? "low" : "unknown";
}

interface OsvRecord {
  id?: string; summary?: string; details?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ package?: { name?: string; ecosystem?: string }; ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string }> }> }>;
}

function severityOf(r: OsvRecord): { severity: Severity; score?: number } {
  for (const s of r.severity ?? []) {
    const score = typeof s.score === "string" ? cvss3Score(s.score) : null;
    if (score !== null) return { severity: severityOfScore(score), score };
  }
  const word = String(r.database_specific?.severity ?? "").toUpperCase();
  if (word === "CRITICAL") return { severity: "critical" };
  if (word === "HIGH") return { severity: "high" };
  if (word === "MODERATE" || word === "MEDIUM") return { severity: "medium" };
  if (word === "LOW") return { severity: "low" };
  return { severity: "unknown" };
}

/** The lowest fixed version above `version` that any range of this package names. */
function fixedFor(r: OsvRecord, name: string, version: string): string | undefined {
  let best: string | undefined;
  for (const a of r.affected ?? []) {
    if (a.package?.name && a.package.name.toLowerCase() !== name.toLowerCase()) continue;
    for (const range of a.ranges ?? []) for (const e of range.events ?? []) {
      if (e.fixed && compareVersions(e.fixed, version) > 0 && (best === undefined || compareVersions(e.fixed, best) < 0)) best = e.fixed;
    }
  }
  return best;
}

export function vulnOf(r: OsvRecord, name: string, version: string): Vuln | null {
  if (!r.id) return null;
  const sev = severityOf(r);
  const fixed = fixedFor(r, name, version);
  return { id: r.id.slice(0, 60), summary: String(r.summary ?? r.details ?? "").replace(/\s+/g, " ").trim().slice(0, 200), ...sev, ...(fixed ? { fixed } : {}) };
}

// -------------------------------------------------------------------- queries

export interface OsvOptions { fetchFn?: FetchLike }

/** Vulnerabilities of one package at one version (the first page of OSV's answer, and the second if it has one). */
export async function queryOsv(name: string, ecosystem: OsvEcosystem, version: string, o: OsvOptions = {}): Promise<Vuln[]> {
  const out: Vuln[] = [];
  let token: string | undefined;
  for (let page = 0; page < 2; page += 1) {
    const r = await postJson<{ vulns?: OsvRecord[]; next_page_token?: string }>(`${OSV}/query`, { package: { name, ecosystem }, version, ...(token ? { page_token: token } : {}) }, { fetchFn: o.fetchFn });
    for (const v of r.vulns ?? []) { const x = vulnOf(v, name, version); if (x && !out.some((y) => y.id === x.id)) out.push(x); }
    token = r.next_page_token;
    if (!token) break;
  }
  return out;
}

export interface BatchQuery { name: string; ecosystem: OsvEcosystem; version: string }

/** For each query, the ids of the vulnerabilities OSV knows (in the same order). Chunks of 1,000. */
export async function queryBatch(queries: readonly BatchQuery[], o: OsvOptions = {}): Promise<string[][]> {
  const out: string[][] = [];
  for (let i = 0; i < queries.length; i += BATCH_MAX) {
    const chunk = queries.slice(i, i + BATCH_MAX);
    const r = await postJson<{ results?: Array<{ vulns?: Array<{ id?: string }> }> }>(
      `${OSV}/querybatch`, { queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: q.ecosystem }, version: q.version })) }, { fetchFn: o.fetchFn, maxBytes: 8 * 1024 * 1024 },
    );
    const results = r.results ?? [];
    if (results.length !== chunk.length) throw new WebError("unsupported_type", "osv");
    for (const res of results) out.push([...new Set((res.vulns ?? []).map((v) => v.id).filter((x): x is string => typeof x === "string"))]);
  }
  return out;
}

/** The full record of an advisory. Null for one OSV does not have. */
export async function fetchRecord(id: string, o: OsvOptions = {}): Promise<OsvRecord | null> {
  try {
    return (await getJson<OsvRecord>(`${OSV}/vulns/${encodeURIComponent(id)}`, { fetchFn: o.fetchFn })).data;
  } catch (err) {
    if (err instanceof WebError && err.code === "http_404") return null;
    throw err;
  }
}
