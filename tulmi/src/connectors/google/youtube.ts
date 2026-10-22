/**
 * YOUTUBE, as a native connector: plain fetch to YouTube Data API v3.
 *
 *   search_videos     read    videos for some words, with titles and links
 *   my_playlists      read    the person's own playlists
 *   add_to_playlist   write   one video into one of their playlists
 *
 * Playing something is not here: "play X" is the play hand-off
 * (handoffs/apps.ts), which opens YouTube's own search on their device and
 * needs no sign-in. This app is for what only their account can do.
 *
 * One scope, `youtube`: playlistItems.insert accepts nothing smaller (its
 * scopes are youtube, youtube.force-ssl and youtubepartner), and `youtube`
 * covers the two reads too, so youtube.readonly beside it would only be a
 * second line on Google's consent page asking for less.
 *
 * Quota: search.list has its own bucket of 100 calls a day for the whole
 * Google project (not per person), so a search is the scarce thing here;
 * playlists.list and videos.list cost 1 unit, playlistItems.insert 50, from
 * the project's 10,000 a day (DEPLOY.md).
 */
import type { CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import type { GoogleSession } from "./oauth.js";
import { clampInt, count, noSuchTool, ok, oneLine, pickByName, reject, str, type Describe } from "./plain.js";

const API = "https://www.googleapis.com/youtube/v3";
const ID = "google-youtube";
const APP = "YouTube";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

interface Snippet { title?: string; channelTitle?: string }
interface Playlist { id: string; snippet?: Snippet; contentDetails?: { itemCount?: number } }

const TOOLS: NativeTool[] = [
  {
    name: "search_videos", risk: "read",
    description: "Find YouTube videos for some words: titles, channels and links. To just play something, the play hand-off opens YouTube instead.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, max: { type: "number", description: "How many (default 5, at most 10)." } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "my_playlists", risk: "read",
    description: "List the person's own YouTube playlists, each with its id.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_to_playlist", risk: "write",
    description: "Add one YouTube video to one of the person's own playlists.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "The video's link or id, from search_videos." },
        playlist: { type: "string", description: "The playlist's name, or its id from my_playlists." },
      },
      required: ["video", "playlist"],
    },
    annotations: {},
  },
];

const watchLink = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** YouTube's titles come HTML-escaped ("Rock &amp; Roll", "Don&#39;t"): said as text. */
const plainText = (s: string | undefined) => (s ?? "")
  .replace(/&#(\d{1,5});/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A video id from an id or any of YouTube's links (watch?v=, youtu.be/, shorts/, embed/). */
export function videoIdOf(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (VIDEO_ID.test(s)) return s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const id = host === "youtu.be" ? u.pathname.slice(1).split("/")[0]
    : host === "youtube.com" ? (u.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname)?.[1])
      : null;
  return id && VIDEO_ID.test(id) ? id : null;
}

export function googleYouTube(o: { session: GoogleSession }): NativeConnector {
  const get = <T>(userId: string, url: string, notFound?: string) => o.session.json<T>(userId, ID, APP, url, { notFound });

  async function playlists(userId: string): Promise<Playlist[]> {
    const q = new URLSearchParams({ part: "snippet,contentDetails", mine: "true", maxResults: "50" });
    const res = await get<{ items?: Playlist[] }>(userId, `${API}/playlists?${q}`);
    return (res.items ?? []).filter((p) => typeof p.id === "string" && PLAYLIST_ID.test(p.id));
  }

  /** The video and the playlist a call names, both checked against YouTube. */
  async function target(userId: string, args: Args): Promise<{ video: { id: string; title: string }; list: Playlist }> {
    const videoId = videoIdOf(args.video);
    if (!videoId) throw reject("I need the video's YouTube link or id. Search for it first.");
    const wanted = str(args.playlist, 150);
    if (!wanted) throw reject("Which playlist should it go in?");
    const [found, mine] = await Promise.all([
      get<{ items?: Array<{ id: string; snippet?: Snippet }> }>(userId, `${API}/videos?${new URLSearchParams({ part: "snippet", id: videoId })}`),
      playlists(userId),
    ]);
    const v = found.items?.[0];
    if (!v) throw reject("I couldn't find that video on YouTube.");
    const list = pickByName(mine, wanted, (p) => p.id, (p) => plainText(p.snippet?.title), "playlist");
    if (!list) {
      const names = mine.slice(0, 5).map((p) => `"${oneLine(plainText(p.snippet?.title), 40)}"`).join(", ");
      throw reject(`I couldn't find a playlist called "${oneLine(wanted, 40)}" in your YouTube.${names ? ` Your playlists: ${names}.` : " You don't have any playlists yet."}`);
    }
    return { video: { id: videoId, title: plainText(v.snippet?.title) }, list };
  }

  async function searchVideos(userId: string, args: Args): Promise<CallOutcome> {
    const query = str(args.query, 150);
    if (!query) throw reject("What should I look for on YouTube?");
    const max = clampInt(args.max, 1, 10, 5);
    const q = new URLSearchParams({ part: "snippet", type: "video", q: query, maxResults: String(max), safeSearch: "moderate" });
    const res = await get<{ items?: Array<{ id?: { videoId?: string }; snippet?: Snippet }> }>(userId, `${API}/search?${q}`);
    const items = (res.items ?? []).filter((i) => VIDEO_ID.test(i.id?.videoId ?? ""));
    if (!items.length) return ok(`No YouTube videos for "${oneLine(query, 60)}".`);
    const lines = items.map((i) => `- ${oneLine(plainText(i.snippet?.title))}${i.snippet?.channelTitle ? ` (${oneLine(plainText(i.snippet.channelTitle), 40)})` : ""} ${watchLink(i.id!.videoId!)}`);
    return ok(`${count(items.length, "video")} for "${oneLine(query, 60)}":\n${lines.join("\n")}`);
  }

  async function myPlaylists(userId: string): Promise<CallOutcome> {
    const mine = await playlists(userId);
    if (!mine.length) return ok("You don't have any YouTube playlists yet.");
    const lines = mine.map((p) => {
      const n = p.contentDetails?.itemCount;
      return `- ${oneLine(plainText(p.snippet?.title))}${typeof n === "number" ? `, ${count(n, "video")}` : ""} (id: ${p.id})`;
    });
    return ok(`${count(mine.length, "playlist")}:\n${lines.join("\n")}`);
  }

  async function addToPlaylist(userId: string, args: Args): Promise<CallOutcome> {
    const { video, list } = await target(userId, args);
    await o.session.json(userId, ID, APP, `${API}/playlistItems?part=snippet`, {
      method: "POST", notFound: "I couldn't find that playlist.",
      body: { snippet: { playlistId: list.id, resourceId: { kind: "youtube#video", videoId: video.id } } },
    });
    return ok(`Added "${oneLine(video.title)}" to your playlist "${oneLine(plainText(list.snippet?.title))}". ${watchLink(video.id)}`);
  }

  /** The confirm card: which video into which playlist. */
  const describe: Describe = async (userId, tool, args) => {
    if (tool !== "add_to_playlist") return undefined;
    const { video, list } = await target(userId, args);
    return `Add "${oneLine(video.title)}" to your YouTube playlist "${oneLine(plainText(list.snippet?.title))}"`;
  };

  return {
    tools: () => TOOLS,
    preview: describe,

    async call(userId, tool, args): Promise<CallOutcome> {
      switch (tool) {
        case "search_videos": return searchVideos(userId, args);
        case "my_playlists": return myPlaylists(userId);
        case "add_to_playlist": return addToPlaylist(userId, args);
        default: throw noSuchTool(APP, tool);
      }
    },
  };
}
