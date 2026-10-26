/**
 * THE DEPENDENCY AUDIT: WHICH OF THE PROJECT'S PACKAGES HAVE KNOWN VULNERABILITIES, HOW BAD, AND WHAT FIXES THEM.
 *
 *   auditDeps(brain, fetchManifest) -> { source, approximate, scanned, vulnerable, counts, notes }
 *
 * What is INSTALLED decides whether a vulnerability matters, and only a lockfile
 * says what is installed. So the audit reads the lockfiles the brain knows exist
 * (structure.lockfiles: package-lock.json, pnpm-lock.yaml, yarn.lock, poetry.lock,
 * Pipfile.lock) through `fetchManifest(path)`, which is the workspace's read of
 * the work branch, and parses them for name and version (lockfiles.ts). An
 * ecosystem with no lockfile falls back to the manifests' declared ranges, taken at
 * their minimum (`^4.17.0` is 4.17.0: semver.ts minVersion), and then the answer is
 * marked `approximate`: a vulnerable minimum may not be what is installed, and a
 * clean one may be.
 *
 * The packages go to OSV in batches (`POST /v1/querybatch`, a thousand at a time),
 * which answers with advisory ids; the distinct ids (fifty at most) are then
 * fetched for their severity (CVSS) and the version that fixes each. What comes
 * back is the vulnerable packages only, worst first, each with the worst severity,
 * its advisories and `fixedIn`, the lowest version that fixes them all.
 *
 * If OSV cannot be reached, `checked` is false and nothing is claimed.
 */
import type { BrainHandle } from "../project/index.js";
import type { FetchLike } from "../../web/search/types.js";
import { baseName } from "../project/lang.js";
import { parseLockfile, type Ecosystem, type LockedPackage } from "./lockfiles.js";
import { fetchRecord, queryBatch, RECORDS_MAX, SEVERITY_ORDER, vulnOf, type OsvEcosystem, type Severity, type Vuln } from "./osv.js";
import { compareVersions, minVersion } from "./semver.js";

export type AuditBrain = Pick<BrainHandle, "status" | "deps">;

export interface VulnerablePackage {
  name: string;
  ecosystem: Ecosystem;
  version: string;
  dev?: boolean;
  /** The worst of its advisories. */
  severity: Severity;
  vulns: Vuln[];
  /** The lowest version that fixes all of them that name a fix, when any does. */
  fixedIn?: string;
}

export interface Audit {
  /** The lockfiles read, or "manifest". */
  source: string;
  /** Some versions are the manifests' minimum, not what is installed. */
  approximate: boolean;
  /** OSV answered. When false, `vulnerable` is empty because nothing was checked, not because nothing is wrong. */
  checked: boolean;
  scanned: number;
  vulnerable: VulnerablePackage[];
  /** Packages by their worst severity. */
  counts: Record<Severity, number>;
  notes: string[];
}

export interface AuditOptions {
  fetchFn?: FetchLike;
  /** Packages sent to OSV (3,000). */
  max?: number;
}

export const AUDIT_PACKAGES_MAX = 3000;
const LOCKFILES_READ = 6;
const RANK = new Map(SEVERITY_ORDER.map((s, i) => [s, i]));
const worst = (a: Severity, b: Severity): Severity => ((RANK.get(a) ?? 4) <= (RANK.get(b) ?? 4) ? a : b);

const LOCK_PRIORITY = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "pipfile.lock"];
const depth = (p: string): number => p.split("/").length;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

const empty = (): Record<Severity, number> => ({ critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });

export async function auditDeps(brain: AuditBrain, fetchManifest: (path: string) => Promise<string | null>, o: AuditOptions = {}): Promise<Audit> {
  const view = await brain.status();
  const notes: string[] = [];
  const locks = (view.structure?.lockfiles ?? [])
    .filter((p) => LOCK_PRIORITY.includes(baseName(p).toLowerCase()))
    .sort((a, b) => depth(a) - depth(b) || LOCK_PRIORITY.indexOf(baseName(a).toLowerCase()) - LOCK_PRIORITY.indexOf(baseName(b).toLowerCase()) || (a < b ? -1 : 1))
    .slice(0, LOCKFILES_READ);

  const packages = new Map<string, LockedPackage>();
  const read: string[] = [];
  const covered = new Set<Ecosystem>();
  for (const path of locks) {
    let text: string | null = null;
    try { text = await fetchManifest(path); } catch { text = null; }
    if (text === null) { notes.push(`${baseName(path)}:unreadable`); continue; }
    const parsed = parseLockfile(path, text) ?? [];
    if (!parsed.length) { notes.push(`${baseName(path)}:empty`); continue; }
    read.push(path);
    for (const p of parsed) { covered.add(p.ecosystem); const k = `${p.ecosystem}:${p.name}@${p.version}`; if (!packages.has(k)) packages.set(k, p); }
  }

  // An ecosystem with no lockfile is audited from the manifests, at their minimum versions.
  let approximate = false;
  for (const d of await brain.deps().catch(() => [])) {
    const eco: Ecosystem = d.ecosystem === "npm" ? "npm" : "PyPI";
    if (covered.has(eco)) continue;
    const v = minVersion(d.spec);
    if (!v) continue;
    approximate = true;
    const k = `${eco}:${d.name}@${v}`;
    if (!packages.has(k)) packages.set(k, { name: d.name, version: v, ecosystem: eco });
  }
  if (approximate) notes.push("manifest:approximate");

  const max = Math.min(o.max ?? AUDIT_PACKAGES_MAX, AUDIT_PACKAGES_MAX);
  const all = [...packages.values()];
  if (all.length > max) notes.push(`capped:${max}`);
  const list = all.slice(0, max);
  const source = read.length ? read.map(baseName).join(", ") + (approximate ? " and manifests" : "") : "manifest";
  const base = { source, approximate, scanned: list.length, counts: empty() };
  if (!list.length) return { ...base, checked: true, vulnerable: [], notes: [...notes, "nothing:to_scan"] };

  let ids: string[][];
  try {
    ids = await queryBatch(list.map((p) => ({ name: p.name, ecosystem: p.ecosystem as OsvEcosystem, version: p.version })), { fetchFn: o.fetchFn });
  } catch {
    return { ...base, checked: false, vulnerable: [], notes: [...notes, "osv:unreachable"] };
  }

  const distinct = [...new Set(ids.flat())];
  const records = new Map<string, Awaited<ReturnType<typeof fetchRecord>>>();
  await mapLimit(distinct.slice(0, RECORDS_MAX), 5, async (id) => { try { records.set(id, await fetchRecord(id, { fetchFn: o.fetchFn })); } catch { records.set(id, null); } });
  if (distinct.length > RECORDS_MAX) notes.push(`advisories:${distinct.length - RECORDS_MAX}_without_details`);

  const vulnerable: VulnerablePackage[] = [];
  list.forEach((p, i) => {
    const found = ids[i] ?? [];
    if (!found.length) return;
    const vulns: Vuln[] = found.map((id) => {
      const rec = records.get(id);
      return (rec ? vulnOf(rec, p.name, p.version) : null) ?? { id, summary: "", severity: "unknown" as Severity };
    });
    vulns.sort((a, b) => (RANK.get(a.severity) ?? 4) - (RANK.get(b.severity) ?? 4) || (a.id < b.id ? -1 : 1));
    const fixes = vulns.map((v) => v.fixed).filter((x): x is string => !!x);
    const fixedIn = fixes.length ? fixes.sort(compareVersions).pop() : undefined;
    vulnerable.push({
      name: p.name, ecosystem: p.ecosystem, version: p.version, ...(p.dev ? { dev: true } : {}),
      severity: vulns.map((v) => v.severity).reduce(worst), vulns: vulns.slice(0, 10), ...(fixedIn ? { fixedIn } : {}),
    });
  });
  vulnerable.sort((a, b) => (RANK.get(a.severity) ?? 4) - (RANK.get(b.severity) ?? 4) || (a.name < b.name ? -1 : 1));
  const counts = empty();
  for (const v of vulnerable) counts[v.severity] += 1;
  return { ...base, counts, checked: true, vulnerable, notes };
}
