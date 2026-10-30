/**
 * IS ANYTHING THE PROJECT DEPENDS ON DEPRECATED OR A MAJOR VERSION BEHIND? (npm AND PyPI, FIFTEEN LOOKUPS.)
 *
 * The welcome message offers first tasks, and "update the dependency that has
 * been deprecated" is a good one: concrete, checkable, and usually safe. Whether
 * a package has a newer major version, or was deprecated by its author, is a
 * question for the registries, so the project brain asks them, through the
 * layer 3 sources (web/search/sources/npm.ts and pypi.ts: the same calls the
 * Xode's package search makes, behind the same egress guard and size caps),
 * for at most FIFTEEN packages, a few at a time:
 *
 *   npm    the registry's search, then `/<pkg>/latest` for the exact name: the
 *          latest version, and the deprecation notice if there is one
 *   PyPI   `/pypi/<pkg>/json`: the latest version, and whether it is yanked
 *          or marked inactive
 *
 * Which fifteen: the runtime dependencies in the order the manifests list them
 * (before the dev ones), npm first, then Python; nothing internal to a
 * workspace, nothing pinned to a path, a URL or a git ref, no @types.
 *
 * "Behind" means the latest MAJOR version is higher than the one the manifest
 * pins or allows (^18 against 19). A lower bound (>=2) is never behind: it
 * allows the latest. A lookup that fails is a package we know nothing about,
 * not a failure of the build.
 *
 * The fetch is injectable, and so are the sources, so tests answer from fixtures.
 */
import type { FetchLike, Source } from "../../web/search/types.js";
import { npm, pypi } from "../../web/search/sources/index.js";
import { REGISTRY_LOOKUPS_MAX, type CoreEntry } from "./types.js";

export interface DeclaredDep { name: string; ecosystem: "npm" | "pypi"; spec: string }

export interface DepNote {
  name: string;
  ecosystem: "npm" | "pypi";
  declared: string;
  latest: string | null;
  deprecated: string | null;
  /** The latest major version is higher than the manifest's. */
  behind: boolean;
}

const get = (e: CoreEntry) => e.data as Record<string, unknown>;

/** Runtime dependencies first, then the rest; npm, then Python. No workspace-internal names, no path/url/git specs. */
export function declaredDeps(core: Record<string, CoreEntry>): DeclaredDep[] {
  const internal = new Set<string>();
  for (const e of Object.values(core)) if (e.kind === "npm" && typeof get(e).name === "string") internal.add(String(get(e).name));
  const runtime: DeclaredDep[] = [];
  const dev: DeclaredDep[] = [];
  const seen = new Set<string>();
  const entries = Object.entries(core).sort((a, b) => a[0].split("/").length - b[0].split("/").length || (a[0] < b[0] ? -1 : 1));
  for (const [, e] of entries) {
    const d = get(e);
    if (e.kind === "npm") {
      const versions = (d.depVersions ?? {}) as Record<string, string>;
      const runtimeNames = new Set(Array.isArray(d.deps) ? (d.deps as string[]) : []);
      for (const name of [...(Array.isArray(d.deps) ? (d.deps as string[]) : []), ...(Array.isArray(d.devDeps) ? (d.devDeps as string[]) : [])]) {
        const spec = String(versions[name] ?? "");
        if (name.startsWith("@types/") || internal.has(name) || /^(?:workspace:|file:|link:|git|https?:|github:|npm:|\.|\/)/.test(spec) || seen.has(`npm:${name}`)) continue;
        seen.add(`npm:${name}`);
        (runtimeNames.has(name) ? runtime : dev).push({ name, ecosystem: "npm", spec });
      }
    } else if (e.kind === "requirements" || e.kind === "pyproject" || e.kind === "pipfile") {
      for (const pair of Array.isArray(d.deps) ? (d.deps as unknown[]) : []) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
        const name = pair[0];
        if (seen.has(`pypi:${name}`)) continue;
        seen.add(`pypi:${name}`);
        runtime.push({ name, ecosystem: "pypi", spec: String(pair[1] ?? "") });
      }
    }
  }
  const npmFirst = (a: DeclaredDep, b: DeclaredDep) => (a.ecosystem === b.ecosystem ? 0 : a.ecosystem === "npm" ? -1 : 1);
  return [...runtime.sort(npmFirst), ...dev.sort(npmFirst)];
}

/** The major version a spec pins or allows, or null when it allows anything newer (>=, *, latest) or says nothing. */
export function declaredMajor(spec: string): number | null {
  const s = spec.trim();
  if (!s || /^(?:\*|latest|x|next)$/i.test(s) || /^[><]/.test(s) || /\|\|/.test(s)) return null;
  const m = /(\d+)(?:\.(?:\d+|x|\*))?/.exec(s);
  return m ? Number(m[1]) : null;
}
const majorOf = (v: string): number | null => { const m = /^v?(\d+)/.exec(v.trim()); return m ? Number(m[1]) : null; };

const norm = (n: string) => n.toLowerCase().replace(/[_.]+/g, "-");

export interface CheckOptions {
  fetchFn?: FetchLike;
  /** Instead of the layer 3 npm and PyPI sources. */
  sources?: Partial<Record<"npm" | "pypi", Source>>;
  /** At most this many lookups (15). */
  max?: number;
  concurrency?: number;
}

export async function checkDeps(deps: readonly DeclaredDep[], o: CheckOptions = {}): Promise<DepNote[]> {
  const max = Math.min(o.max ?? REGISTRY_LOOKUPS_MAX, REGISTRY_LOOKUPS_MAX);
  const chosen = deps.slice(0, max);
  const sources = { npm: o.sources?.npm ?? npm, pypi: o.sources?.pypi ?? pypi };
  const out: Array<DepNote | null> = new Array(chosen.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const i = next++;
      const d = chosen[i]!;
      try {
        const results = await sources[d.ecosystem].search(d.name, { fetchFn: o.fetchFn, limit: 1 });
        const hit = results.find((r) => typeof r.meta?.name === "string" && norm(String(r.meta.name)) === norm(d.name));
        if (!hit) continue;
        const latest = typeof hit.meta?.version === "string" ? hit.meta.version : null;
        const have = declaredMajor(d.spec);
        const lm = latest ? majorOf(latest) : null;
        out[i] = {
          name: d.name, ecosystem: d.ecosystem, declared: d.spec, latest,
          deprecated: typeof hit.meta?.deprecated === "string" && hit.meta.deprecated ? hit.meta.deprecated.slice(0, 160) : null,
          behind: have !== null && lm !== null && lm > have,
        };
      } catch {
        // A registry that doesn't answer says nothing about the package.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 4, chosen.length) }, worker));
  return out.filter((x): x is DepNote => x !== null);
}
