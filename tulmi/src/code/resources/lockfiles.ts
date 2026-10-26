/**
 * LOCKFILES, READ FOR NAME AND VERSION AND NOTHING ELSE.
 *
 * An audit needs to know what is really installed, and the manifest only says
 * what is allowed. A lockfile says what is installed. This reads the ones that
 * matter, as plain text, with no dependency and no YAML or TOML library: each
 * format has one line that names a package and one that gives its version, and
 * that is all we want.
 *
 *   package-lock.json, npm-shrinkwrap.json   lockfileVersion 1 (dependencies, nested), 2 and 3 (packages)
 *   pnpm-lock.yaml                           v5 (/name/1.2.3), v6 (/name@1.2.3) and v9 (name@1.2.3), peers cut off
 *   yarn.lock                                v1 (version "1.2.3") and berry (version: 1.2.3)
 *   poetry.lock                              [[package]] name / version
 *   Pipfile.lock                             default and develop
 *   requirements.txt                         name==1.2.3 pins (a range is not a version)
 *
 * Each returns `{ name, version, ecosystem, dev? }`, once per name and version.
 * A file that does not parse is an empty list, not an error: the audit then says
 * it had nothing to go on. Pure.
 */
import { baseName } from "../project/lang.js";

export type Ecosystem = "npm" | "PyPI";

export interface LockedPackage { name: string; version: string; ecosystem: Ecosystem; dev?: boolean }

const VERSION = /^\d+(?:\.\d+)*(?:[-+.\w]*)$/;

function dedupe(list: LockedPackage[]): LockedPackage[] {
  const seen = new Map<string, LockedPackage>();
  for (const p of list) {
    const k = `${p.ecosystem}:${p.name}@${p.version}`;
    const had = seen.get(k);
    // A package that is both a dev and a runtime dependency somewhere is a runtime one.
    if (!had) seen.set(k, p);
    else if (had.dev && !p.dev) seen.set(k, { ...had, dev: false });
  }
  return [...seen.values()];
}

// ------------------------------------------------------------------------ npm

export function parsePackageLock(text: string): LockedPackage[] {
  let j: { packages?: Record<string, { version?: string; dev?: boolean; link?: boolean; name?: string }>; dependencies?: Record<string, unknown> };
  try { j = JSON.parse(text); } catch { return []; }
  const out: LockedPackage[] = [];
  if (j.packages && typeof j.packages === "object") {
    for (const [key, p] of Object.entries(j.packages)) {
      if (!key || p?.link || typeof p?.version !== "string") continue;
      const at = key.lastIndexOf("node_modules/");
      if (at < 0) continue;
      const name = p.name ?? key.slice(at + "node_modules/".length);
      if (name) out.push({ name, version: p.version, ecosystem: "npm", ...(p.dev ? { dev: true } : {}) });
    }
    return dedupe(out);
  }
  const walk = (deps: Record<string, unknown> | undefined) => {
    for (const [name, raw] of Object.entries(deps ?? {})) {
      const d = raw as { version?: string; dev?: boolean; dependencies?: Record<string, unknown> };
      if (typeof d?.version === "string" && VERSION.test(d.version)) out.push({ name, version: d.version, ecosystem: "npm", ...(d.dev ? { dev: true } : {}) });
      walk(d?.dependencies);
    }
  };
  walk(j.dependencies);
  return dedupe(out);
}

/** "/@scope/pkg@1.2.3(react@18)", "pkg@1.2.3", "/pkg/1.2.3_peer@1" -> { name, version } */
function pnpmKey(raw: string): { name: string; version: string } | null {
  let k = raw.trim().replace(/^['"]|['"]$/g, "").replace(/^\//, "");
  // v5: name/version, with _peers after the version.
  const v5 = /^(@[^/@]+\/[^/@]+|[^/@]+)\/(\d[^/]*)$/.exec(k);
  if (v5) {
    const version = v5[2]!.replace(/_.*$/, "");
    return VERSION.test(version) ? { name: v5[1]!, version } : null;
  }
  // v6 and v9: name@version, peers in brackets after it. The name may start with @scope/, so the version is after the LAST @ that is not the first character.
  k = k.replace(/\(.*$/, "");
  const at = k.lastIndexOf("@");
  if (at > 0) {
    const version = k.slice(at + 1);
    const name = k.slice(0, at);
    if (VERSION.test(version) && name) return { name, version };
  }
  return null;
}

export function parsePnpmLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let inPackages = false;
  let cur: LockedPackage | null = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) { inPackages = /^packages:\s*$/.test(line); cur = null; continue; }
    if (!inPackages) continue;
    const key = /^ {2}(\S.*?):\s*$/.exec(line);
    if (key) {
      const p = pnpmKey(key[1]!);
      cur = p ? { name: p.name, version: p.version, ecosystem: "npm" } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (cur && /^ {4}dev:\s*true\s*$/.test(line)) cur.dev = true;
  }
  return dedupe(out);
}

export function parseYarnLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let names: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\S/.test(line) && !line.startsWith("#")) {
      if (line.startsWith("__metadata")) { names = []; continue; }
      names = line.replace(/:\s*$/, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).map((spec) => {
        // "@babel/core@^7.0.0", lodash@^4, "lodash@npm:^4.17.21"
        const at = spec.indexOf("@", 1);
        return at > 0 ? spec.slice(0, at) : "";
      }).filter(Boolean);
      names = [...new Set(names)];
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (v && names.length && VERSION.test(v[1]!)) { for (const name of names) out.push({ name, version: v[1]!, ecosystem: "npm" }); names = []; }
  }
  return dedupe(out);
}

// --------------------------------------------------------------------- Python

export function parsePoetryLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let name = "", version = "", dev = false;
  const flush = () => { if (name && version) out.push({ name, version, ecosystem: "PyPI", ...(dev ? { dev: true } : {}) }); name = ""; version = ""; dev = false; };
  for (const line of text.split("\n")) {
    if (line.startsWith("[[package]]")) { flush(); continue; }
    const kv = /^(\w+)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (!kv) continue;
    if (kv[1] === "name") name = kv[2]!;
    else if (kv[1] === "version") version = kv[2]!;
    else if (kv[1] === "category" && kv[2] === "dev") dev = true;
  }
  flush();
  return dedupe(out);
}

export function parsePipfileLock(text: string): LockedPackage[] {
  let j: Record<string, Record<string, { version?: string }>>;
  try { j = JSON.parse(text); } catch { return []; }
  const out: LockedPackage[] = [];
  for (const [section, dev] of [["default", false], ["develop", true]] as const) {
    for (const [name, p] of Object.entries(j[section] ?? {})) {
      const v = typeof p?.version === "string" ? p.version.replace(/^==/, "") : "";
      if (VERSION.test(v)) out.push({ name, version: v, ecosystem: "PyPI", ...(dev ? { dev: true } : {}) });
    }
  }
  return dedupe(out);
}

export function parseRequirements(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+#.*$/, "").trim();
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([\w.+!-]+)/.exec(l);
    if (m && VERSION.test(m[2]!)) out.push({ name: m[1]!, version: m[2]!, ecosystem: "PyPI" });
  }
  return dedupe(out);
}

// ----------------------------------------------------------------- the dispatch

/** The lockfiles the audit reads, best first for each ecosystem. */
export const LOCKFILE_NAMES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "Pipfile.lock"] as const;

/** The parser for a lockfile's path, or null for a file we do not read. */
export function parseLockfile(path: string, text: string): LockedPackage[] | null {
  switch (baseName(path).toLowerCase()) {
    case "package-lock.json": case "npm-shrinkwrap.json": return parsePackageLock(text);
    case "pnpm-lock.yaml": return parsePnpmLock(text);
    case "yarn.lock": return parseYarnLock(text);
    case "poetry.lock": return parsePoetryLock(text);
    case "pipfile.lock": return parsePipfileLock(text);
    default: return /^requirements[\w.-]*\.txt$/i.test(baseName(path)) ? parseRequirements(text) : null;
  }
}
