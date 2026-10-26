/**
 * npm: THE REGISTRY'S OWN SEARCH, PLUS THE FACTS OF THE BEST FEW HITS.
 *
 *   registry.npmjs.org/-/v1/search?text=&size=10    the search
 *   registry.npmjs.org/<pkg>/latest                 license, repository, deprecated
 *   api.npmjs.org/downloads/point/last-week/<pkg>   weekly downloads
 *
 * Keyless. The search answer has a package's name, version, description and the
 * date of its last publish; the license, the repository and a deprecation
 * notice are in the package's own document, and the downloads come from the
 * downloads API. Those two extra calls are made for the first three hits only
 * (and for an exact name match first of all), in parallel, and a hit whose
 * extras failed is still a hit, just with less in `meta`.
 *
 * It asks for `/<pkg>/latest` and not the whole `/<pkg>`: the full document of
 * a popular package is several megabytes of every version it ever had, and the
 * newest version's own document says the same things in a few kilobytes. The
 * date a package was last published is the search answer's.
 */
import { getJson } from "../http.js";
import type { Result, Source, SourceOpts } from "../types.js";
import { clip, compact, repoUrl, toMs } from "./util.js";

interface NpmSearch {
  objects?: Array<{
    package?: {
      name?: string; version?: string; description?: string; date?: string;
      links?: { npm?: string; homepage?: string; repository?: string };
      license?: string; keywords?: string[];
    };
    downloads?: { weekly?: number; monthly?: number };
    score?: { final?: number };
  }>;
}

interface NpmLatest { license?: unknown; repository?: unknown; deprecated?: unknown; homepage?: unknown }

/** How many hits get the two extra calls. */
const ENRICH = 3;

const licenseOf = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof (v as { type?: unknown } | null)?.type === "string" ? (v as { type: string }).type : undefined;

export const npm: Source = {
  id: "npm",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const size = Math.min(Math.max(o.limit ?? 10, 1), 10);
    const text = q.trim();
    if (!text) return [];
    const { data } = await getJson<NpmSearch>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${size}`, { fetchFn: o.fetchFn });
    const hits = (data.objects ?? []).filter((x) => typeof x.package?.name === "string");
    // An exact name match is the thing most likely asked about: it gets the extras first.
    const lower = text.toLowerCase();
    const order = hits.map((_, i) => i).sort((a, b) => Number(hits[b]!.package!.name!.toLowerCase() === lower) - Number(hits[a]!.package!.name!.toLowerCase() === lower) || a - b);
    const extras = new Map<number, { latest?: NpmLatest; weekly?: number }>();
    await Promise.allSettled(order.slice(0, ENRICH).map(async (i) => {
      const name = hits[i]!.package!.name!;
      const enc = name.replace("/", "%2F");
      const [latest, down] = await Promise.allSettled([
        getJson<NpmLatest>(`https://registry.npmjs.org/${enc}/latest`, { fetchFn: o.fetchFn }),
        // The search answer already carries weekly downloads today; the API is for when it does not.
        typeof hits[i]!.downloads?.weekly === "number" ? Promise.resolve(null) : getJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${enc}`, { fetchFn: o.fetchFn }),
      ]);
      extras.set(i, {
        ...(latest.status === "fulfilled" ? { latest: latest.value.data } : {}),
        ...(down.status === "fulfilled" && down.value && typeof down.value.data.downloads === "number" ? { weekly: down.value.data.downloads } : {}),
      });
    }));

    return hits.map((h, i): Result => {
      const p = h.package!;
      const ex = extras.get(i);
      const deprecated = typeof ex?.latest?.deprecated === "string" && ex.latest.deprecated ? clip(ex.latest.deprecated, 160) : undefined;
      const modified = toMs(p.date);
      return {
        title: `${p.name}${p.version ? `@${p.version}` : ""}`,
        url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
        snippet: clip(p.description ?? "", 300),
        source: "npm",
        ...(modified ? { published: modified } : {}),
        meta: compact({
          kind: "package", ecosystem: "npm", name: p.name, version: p.version,
          license: licenseOf(ex?.latest?.license) ?? (typeof p.license === "string" ? p.license : undefined),
          repo: repoUrl((ex?.latest?.repository as { url?: unknown } | undefined)?.url ?? ex?.latest?.repository ?? p.links?.repository),
          homepage: p.links?.homepage ?? (typeof ex?.latest?.homepage === "string" ? ex.latest.homepage : undefined),
          deprecated, modified,
          weeklyDownloads: h.downloads?.weekly ?? ex?.weekly,
          keywords: p.keywords?.length ? p.keywords.slice(0, 8) : undefined,
        }),
      };
    });
  },
};
