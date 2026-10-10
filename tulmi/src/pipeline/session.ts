/**
 * THE SESSION: WHAT THEY DICTATED IN THE LAST FEW MINUTES, HANDED TO THE
 * WRITER WITH EACH NEW ONE.
 *
 * Every dictation used to reach the writer alone. It could not know who "him"
 * was, that the name it was about to spell had been spelled another way a
 * minute ago, that they had been writing Hinglish all evening, or that "send
 * the same to Aarav" meant the message just before. The owner: "in a session
 * we will be sending to the llm the previous transcriptions and refinements
 * with the current one… with all the relevant details, like what app it is
 * done in, what time".
 *
 * The backend already keeps them (history), so the server reads them itself:
 * no client sends anything new, and no client can send this.
 *
 * BOUNDED THREE WAYS, because it rides on every dictation:
 *   - time: the last thirty minutes, which is what a session is;
 *   - count: the five most recent, each cut to a few hundred characters;
 *   - waiting: a read that has not answered in a moment is skipped, so a slow
 *     database never stands between someone and their cursor.
 * And never what is already in the field: the desktop sends each pause of one
 * dictation on its own, and those are in <before> already.
 */
import type { AuthedUser } from "../auth/supabase.js";
import { listHistory } from "../history/store.js";
import { stripFenceTags } from "./assistPrompt.js";

export interface RecentDictation {
  /** ISO time it was written. */
  at: string;
  /** The app it went into, as the client named it. */
  app?: string;
  /** What they said or typed. */
  said: string;
  /** What Tailzu wrote for it. */
  wrote: string;
}

export const SESSION_WINDOW_MS = 30 * 60_000;
export const SESSION_MAX = 5;
const SESSION_READ_MS = 350;
const CLIP = 400;

/** Their recent dictations, oldest first; [] when there are none or the read is slow. */
export async function recentDictations(user: AuthedUser, now = Date.now()): Promise<RecentDictation[]> {
  const read = listHistory(user, { limit: SESSION_MAX + 3 })
    .then(({ entries }) => entries)
    .catch(() => []);
  const entries = await Promise.race([
    read,
    new Promise<[]>((r) => setTimeout(() => r([]), SESSION_READ_MS)),
  ]);
  return entries
    .filter((e) => e.kind !== "draft" && e.output?.trim() && now - Date.parse(e.createdAt) <= SESSION_WINDOW_MS)
    .slice(0, SESSION_MAX)
    .map((e) => ({ at: e.createdAt, app: e.targetApp, said: e.input ?? "", wrote: e.output }))
    .reverse();
}

const clip = (s: string) => {
  const t = stripFenceTags(s.replace(/\s+/g, " ").trim());
  return t.length > CLIP ? `${t.slice(0, CLIP)}…` : t;
};

/** "3:42 PM" on their clock, when we know it. */
function clock(ms: number, tzOffsetMinutes: number): string {
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** One app name, as a label: a client-named app or field, kept short and on one line. */
const appLabel = (app?: string) => (app ?? "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 40);

/**
 * The <earlier> block, or "" when there is nothing worth sending. `context` is
 * what is already in the field: a dictation whose text is in it is skipped.
 */
export function earlierBlock(
  recent: RecentDictation[] | undefined,
  o: { now?: number; tzOffsetMinutes?: number; context?: string } = {},
): string {
  const now = o.now ?? Date.now();
  const field = (o.context ?? "").replace(/\s+/g, " ");
  const tz = typeof o.tzOffsetMinutes === "number" && Number.isFinite(o.tzOffsetMinutes) ? o.tzOffsetMinutes : undefined;
  const items = (recent ?? [])
    .filter((r) => r.wrote.trim() && !(field && field.includes(r.wrote.replace(/\s+/g, " ").trim())))
    .map((r) => {
      const at = Date.parse(r.at);
      const mins = Math.max(0, Math.round((now - at) / 60_000));
      const ago = mins < 1 ? "just now" : `${mins} min ago`;
      const when = tz === undefined ? ago : `${ago} (${clock(at, tz)})`;
      const app = appLabel(r.app);
      return `${when}${app ? `, in ${app}` : ""}\nsaid: ${clip(r.said)}\nwrote: ${clip(r.wrote)}`;
    });
  if (!items.length) return "";
  const today = tz === undefined ? "" : `Now: ${DAYS[new Date(now + tz * 60_000).getUTCDay()]}, ${clock(now, tz)}.\n\n`;
  return `<earlier>\n${today}${items.join("\n\n")}\n</earlier>\n`;
}
