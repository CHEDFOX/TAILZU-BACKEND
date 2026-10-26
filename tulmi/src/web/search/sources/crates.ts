/**
 * crates.io: THE REGISTRY'S SEARCH.
 *
 *   crates.io/api/v1/crates?q=&per_page=10
 *
 * Keyless, but crates.io turns away a request that does not say who is asking,
 * so the User-Agent (WEB_BOT_UA, with a page about the bot in it) matters here
 * more than anywhere. Its crawler policy asks for at most one request a second;
 * a search makes one.
 */
import { getJson } from "../http.js";
import type { Result, Source, SourceOpts } from "../types.js";
import { clip, compact, repoUrl, toMs } from "./util.js";

interface CratesAnswer {
  crates?: Array<{
    id?: string; name?: string; max_version?: string; newest_version?: string; description?: string | null; downloads?: number;
    recent_downloads?: number; updated_at?: string; repository?: string | null; homepage?: string | null; documentation?: string | null;
    exact_match?: boolean; yanked?: boolean;
  }>;
}

export const crates: Source = {
  id: "crates",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const text = q.trim();
    if (!text) return [];
    const per = Math.min(Math.max(o.limit ?? 10, 1), 10);
    const { data } = await getJson<CratesAnswer>(`https://crates.io/api/v1/crates?q=${encodeURIComponent(text)}&per_page=${per}`, { fetchFn: o.fetchFn });
    return (data.crates ?? []).flatMap((c): Result[] => {
      if (!c.name) return [];
      const version = c.max_version ?? c.newest_version;
      const modified = toMs(c.updated_at);
      return [{
        title: `${c.name}${version ? ` ${version}` : ""}`,
        url: `https://crates.io/crates/${c.name}`,
        snippet: clip(c.description ?? "", 300),
        source: "crates",
        ...(modified ? { published: modified } : {}),
        meta: compact({
          kind: "package", ecosystem: "crates", name: c.name, version, repo: repoUrl(c.repository), homepage: c.homepage ?? undefined,
          docs: c.documentation ?? undefined, downloads: c.downloads, recentDownloads: c.recent_downloads, modified,
          exactMatch: c.exact_match === true ? true : undefined, deprecated: c.yanked ? "the newest version was yanked" : undefined,
        }),
      }];
    });
  },
};
