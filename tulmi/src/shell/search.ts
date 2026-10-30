/**
 * SEARCH EVERYTHING (bots.search): one query across the person's projects, chats, notes, files and bots.
 *
 *   searchAll(q, sources, o) -> { q, total, groups }
 *
 * The sources are read by routes/botsShell.ts, each as the person (their Xode projects and the conversations about them, what
 * each bot and they last said to each other, their meeting notes, their files, their bots); this file only matches and orders,
 * for nothing, the same words always giving the same answer. A query matches when every one of its words is in the thing (case
 * and accents aside); a match in a name ranks over one in the words under it, then the newest first.
 */

export const SEARCH_KINDS = ["projects", "chats", "notes", "files", "bots"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** One thing that can be found. `text` is what is searched besides the title; `snippet` is drawn under it. */
export interface Findable {
  id: string;
  title: string;
  /** The words under the title (a project's last change, a chat's place and day, a note's prices…). */
  sub?: string;
  /** Searched, never drawn whole. */
  text?: string;
  at?: number;
  /** The bot it belongs to, for its head. */
  bot?: string;
  open: { screenId: string; params?: Record<string, string> };
  /** What the window's preview pane shows. */
  preview?: { lines?: Array<{ who: "you" | "bot"; text: string }>; body?: string; at?: string };
  /** A file, to ask about: the attachment ref POST /v1/ask takes (routes/files.ts attachmentOf). */
  attachment?: Record<string, unknown>;
}

export type SearchSources = Record<SearchKind, Findable[]>;

export interface SearchHit extends Findable { kind: SearchKind; snippet?: string }

export interface SearchResult {
  q: string;
  total: number;
  groups: Record<SearchKind, SearchHit[]>;
}

/** Lower case, accents off, punctuation to spaces. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}#@.]+/gu, " ").trim();
}

/** The query's words (two letters at least, the first eight). */
export function wordsOfQuery(q: string): string[] {
  return [...new Set(fold(q).split(/\s+/).filter((w) => w.length >= 2))].slice(0, 8);
}

/** The words around the first match: at most `n` characters, cut at word edges, with an ellipsis where it was cut. */
export function snippetOf(text: string, words: readonly string[], n = 90): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= n) return one;
  const low = fold(one);
  const at = Math.max(0, Math.min(...words.map((w) => low.indexOf(w)).filter((i) => i >= 0), one.length));
  let start = Math.max(0, at - Math.floor(n / 3));
  if (start > 0) { const sp = one.indexOf(" ", start); start = sp > 0 && sp < at ? sp + 1 : start; }
  let end = Math.min(one.length, start + n);
  if (end < one.length) { const sp = one.lastIndexOf(" ", end); end = sp > start + 20 ? sp : end; }
  return `${start > 0 ? "…" : ""}${one.slice(start, end).trim()}${end < one.length ? "…" : ""}`;
}

/** Every kind's matches, best first; `per` of each at most. */
export function searchAll(q: string, sources: Partial<SearchSources>, o: { per?: number } = {}): SearchResult {
  const words = wordsOfQuery(q);
  const per = o.per ?? 8;
  const groups = Object.fromEntries(SEARCH_KINDS.map((k) => [k, [] as SearchHit[]])) as Record<SearchKind, SearchHit[]>;
  if (!words.length) return { q: q.trim(), total: 0, groups };
  for (const kind of SEARCH_KINDS) {
    const scored: Array<{ hit: SearchHit; score: number }> = [];
    for (const f of sources[kind] ?? []) {
      const title = fold(f.title);
      const rest = fold(`${f.sub ?? ""} ${f.text ?? ""}`);
      if (!words.every((w) => title.includes(w) || rest.includes(w))) continue;
      const inTitle = words.filter((w) => title.includes(w)).length;
      const starts = words.some((w) => title.startsWith(w) || title.includes(` ${w}`)) ? 1 : 0;
      const where = !inTitle && f.text ? f.text : undefined;
      scored.push({ hit: { ...f, kind, ...(where ? { snippet: snippetOf(where, words) } : {}) }, score: inTitle * 10 + starts * 3 });
    }
    scored.sort((a, b) => b.score - a.score || (b.hit.at ?? 0) - (a.hit.at ?? 0));
    groups[kind] = scored.slice(0, per).map((s) => s.hit);
  }
  return { q: q.trim(), total: SEARCH_KINDS.reduce((n, k) => n + groups[k].length, 0), groups };
}

/** A bot thread's buffer line ("said: … | bot: …") as its two sides. */
export function turnOf(line: string): Array<{ who: "you" | "bot"; text: string }> {
  const m = /^said:\s*([\s\S]*?)\s*\|\s*bot:\s*([\s\S]*)$/.exec(line.trim());
  if (!m) return line.trim() ? [{ who: "you", text: line.trim() }] : [];
  return [{ who: "you" as const, text: m[1]!.trim() }, { who: "bot" as const, text: m[2]!.trim() }].filter((t) => t.text);
}

/** "From Gmail · 2 pages · 12 Oct", "4 KB": a file's line. */
export function fileLine(f: { bytes: number; pages?: number; format?: string; createdAt: number }, tzOffsetMinutes: number): string {
  const size = f.bytes >= 1_048_576 ? `${(f.bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.bytes / 1024))} KB`;
  const d = new Date(f.createdAt + tzOffsetMinutes * 60_000);
  const day = `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
  return [f.pages ? `${f.pages} ${f.pages === 1 ? "page" : "pages"}` : size, day].join(" · ");
}
