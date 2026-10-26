/**
 * PyPI: EXACT NAMES ONLY.
 *
 *   pypi.org/pypi/<pkg>/json
 *
 * PyPI has no search API (its web search is HTML, and the XML-RPC one is shut
 * down), so this asks for a package by the name it is written as. The query's
 * package-shaped words (sources/util.ts packageCandidates) are tried, two at
 * most, in parallel; a 404 is a package that is not there, which is an empty
 * answer, not a failure. Keyless.
 *
 * The project document lists every release's files, so for a package with
 * thousands of releases (boto3) it passes any sensible size cap. It is read up
 * to 6 MiB and a bigger one counts as failed: the planner also asks GitHub and
 * a discovery engine, which find the package's page anyway.
 */
import { WebError } from "../../error.js";
import { getJson } from "../http.js";
import type { Result, Source, SourceOpts } from "../types.js";
import { clip, compact, packageCandidates, repoUrl, toMs } from "./util.js";

const PYPI_MAX_BYTES = 6 * 1024 * 1024;

interface PypiDoc {
  info?: {
    name?: string; version?: string; summary?: string; license?: string; home_page?: string; package_url?: string; project_url?: string;
    project_urls?: Record<string, string> | null; requires_python?: string; yanked?: boolean; classifiers?: string[];
  };
  urls?: Array<{ upload_time_iso_8601?: string; upload_time?: string }>;
}

/** The project link that is the source code, if it has one. */
function sourceLink(urls: Record<string, string> | null | undefined, home: string | undefined): string | undefined {
  for (const [k, v] of Object.entries(urls ?? {})) {
    if (/^(source|source code|repository|code|github|git)$/i.test(k.trim())) return repoUrl(v);
  }
  return repoUrl(Object.values(urls ?? {}).find((v) => /github\.com|gitlab\.com|codeberg\.org/.test(v)) ?? home);
}

/** A license field is sometimes the whole license text; a short one is a name. */
const licenseOf = (s: string | undefined): string | undefined => (s && s.trim().length <= 60 && !s.includes("\n") ? s.trim() : undefined);

export const pypi: Source = {
  id: "pypi",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const names = packageCandidates(q, 2).filter((n) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n));
    if (!names.length) return [];
    const settled = await Promise.allSettled(names.map((n) => getJson<PypiDoc>(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`, { fetchFn: o.fetchFn, maxBytes: PYPI_MAX_BYTES })));
    const out: Result[] = [];
    let failure: unknown;
    for (const s of settled) {
      if (s.status === "rejected") {
        if (!(s.reason instanceof WebError && s.reason.code === "http_404")) failure ??= s.reason;
        continue;
      }
      const info = s.value.data.info;
      if (!info?.name) continue;
      const modified = toMs(s.value.data.urls?.[0]?.upload_time_iso_8601 ?? s.value.data.urls?.[0]?.upload_time);
      out.push({
        title: `${info.name}${info.version ? ` ${info.version}` : ""}`,
        url: info.package_url ?? `https://pypi.org/project/${info.name}/`,
        snippet: clip(info.summary ?? "", 300),
        source: "pypi",
        ...(modified ? { published: modified } : {}),
        meta: compact({
          kind: "package", ecosystem: "pypi", name: info.name, version: info.version, license: licenseOf(info.license),
          repo: sourceLink(info.project_urls, info.home_page), homepage: info.home_page || undefined,
          requiresPython: info.requires_python, modified,
          deprecated: info.yanked ? "this release was yanked" : info.classifiers?.some((c) => /Development Status :: 7 - Inactive/.test(c)) ? "marked inactive" : undefined,
        }),
      });
    }
    // Every name failed for a reason other than "no such package": that is a source that is down, not an empty answer.
    if (!out.length && failure) throw failure;
    return out;
  },
};
