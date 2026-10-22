/**
 * YOUTUBE'S SEARCH, with no Google permission at all.
 *
 *   search_videos   read   videos for some words: titles, channels and watch links
 *
 * What YouTube shows for a search is public, so it is read with Tailzu's own
 * API key (YOUTUBE_API_KEY), not as the person: no sign-in, no scope on
 * Google's consent page, nothing of their account read or changed. That is
 * why this is an always-on app beside the hand-offs (catalog.ts ALWAYS_ON,
 * id "youtube") and not one of the Google apps people connect; Tailzu used
 * to have one (google-youtube, the `youtube` scope, for playlists) and asks
 * for it no more.
 *
 * Quota: search.list costs 100 of the Google project's 10,000 units a day
 * (Google's page now books it as its own bucket of 100 searches a day; it
 * comes to the same), shared by everyone, so about 100 searches a day until
 * Google raises it. When the search cannot run, because this server has no
 * key, the day's searches are spent, Google refuses the key or cannot be
 * reached, or its answer cannot be read, it does not fail: it opens
 * YouTube's own search for the same words through the play hand-off, the
 * very link and line "play X on YouTube" gives (handoffs/apps.ts). Opening a
 * search changes nothing and sends nothing, so it is fine as the answer to a
 * question too.
 *
 * The key travels in the x-goog-api-key header, not the address, so it is
 * never in what error reporting keeps of the call (observability.ts).
 *
 * Playing something is still the play hand-off: this only finds.
 */
import type { CallOutcome } from "../client.js";
import { handoffApp } from "../handoffs/apps.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import { count, noSuchTool, ok, oneLine, reject, str } from "./plain.js";

export const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const APP = "YouTube";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** As many as YouTube gives by default, and as many as a person listens to read out. */
const RESULTS = 5;
const QUERY_MAX = 150;
/** The search gets this long before YouTube's own search is opened instead. */
const REQUEST_MS = 10_000;
/** Google's reasons for "not now": the project's searches for the day are spent, or it asks us to slow down. */
const QUOTA = /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|RESOURCE_EXHAUSTED/;

interface Snippet { title?: string; channelTitle?: string }
interface Found { id?: { videoId?: string }; snippet?: Snippet }
interface SearchBody { items?: Found[]; error?: { errors?: Array<{ reason?: string }>; status?: string } }

const TOOLS: NativeTool[] = [
  {
    name: "search_videos", risk: "read",
    description: "Find YouTube videos for some words: their titles, channels and links. To just play something, use the play hand-off instead.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for, as they said it." } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
];

const watchLink = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** YouTube's titles come HTML-escaped ("Rock &amp; Roll", "Don&#39;t"): said as text. */
const plainText = (s: string | undefined) => (s ?? "")
  .replace(/&#(\d{1,5});/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export interface YouTubeOptions {
  /** The server's API key for YouTube Data API v3 (YOUTUBE_API_KEY). Without one, every search opens YouTube's own. */
  apiKey?: string | null;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Where a key Google refuses is said, for us to fix. Never the key, never the person's words. */
  warn?: (line: string) => void;
}

export function youtubeSearch(o: YouTubeOptions = {}): NativeConnector {
  const play = handoffApp("play", { now: o.now })!;
  const warn = o.warn ?? ((line: string) => console.warn(line));

  /** YouTube's own search for these words, opened on their device: the play hand-off's youtube tool, link and line alike. */
  const openSearch = (userId: string, query: string) => play.call(userId, "youtube", { query });

  async function searchVideos(userId: string, args: Args): Promise<CallOutcome> {
    const query = str(args.query, QUERY_MAX)?.replace(/\s+/g, " ");
    if (!query) throw reject("What should I look for on YouTube?");
    if (!o.apiKey) return openSearch(userId, query);
    const q = new URLSearchParams({ part: "snippet", type: "video", maxResults: String(RESULTS), q: query });
    let res: Response;
    try {
      // The key in Google's header for it, never in the address (see the top).
      res = await (o.fetchFn ?? fetch)(`${SEARCH_URL}?${q}`, {
        headers: { accept: "application/json", "x-goog-api-key": o.apiKey },
        signal: AbortSignal.timeout(REQUEST_MS),
      });
    } catch {
      return openSearch(userId, query);
    }
    // Null when the answer cannot be read: cut off, or too slow to finish
    // (the time limit covers the body too).
    const body = (await res.json().catch(() => null)) as SearchBody | null;
    if (!res.ok) {
      const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "");
      // Spent for the day, or Google down: nothing for us to fix. Anything else
      // (a key refused, the API switched off in the project) is, and until it
      // is every search only opens YouTube, so it is said where we will see it.
      if (!QUOTA.test(reason) && res.status !== 429 && res.status < 500) {
        warn(`[connectors] youtube: Google refused the search (${res.status}${reason ? ` ${reason.slice(0, 40)}` : ""}); YouTube's own search opens instead until YOUTUBE_API_KEY works.`);
      }
      return openSearch(userId, query);
    }
    // A 200 with no list in it is a search that did not finish, not one that
    // found nothing: "no videos" is said only on Google's own empty list.
    const found = body?.items;
    if (!Array.isArray(found)) return openSearch(userId, query);
    const items = found.filter((i) => VIDEO_ID.test(i.id?.videoId ?? ""));
    if (!items.length) return ok(`No YouTube videos for "${oneLine(query, 60)}".`);
    const lines = items.map((i) => `- ${oneLine(plainText(i.snippet?.title))}${i.snippet?.channelTitle ? ` (${oneLine(plainText(i.snippet.channelTitle), 40)})` : ""} ${watchLink(i.id!.videoId!)}`);
    return ok(`${count(items.length, "video")} for "${oneLine(query, 60)}":\n${lines.join("\n")}`);
  }

  return {
    tools: () => TOOLS,
    async call(userId, tool, args): Promise<CallOutcome> {
      if (tool === "search_videos") return searchVideos(userId, args ?? {});
      throw noSuchTool(APP, tool);
    },
  };
}
