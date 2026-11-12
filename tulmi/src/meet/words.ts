/**
 * THE MEETING BOT'S WORDS (docs/meet.md): which links are meetings, when someone in the call is talking to it, and the two things it does
 * at once when told (stop talking, leave). Pure functions, so each is tested on its own (tests/meet-words.test.ts).
 *
 *   meetingOf(text)          the first meeting link in a text (an invite's location or description, or what was pasted): Google Meet,
 *                            Zoom, Microsoft Teams or Webex, with its platform; null for anything else
 *   wakeNames(name)          what it answers to: "X0" as people say it and speech-to-text writes it ("x zero", "ex oh"…), and the first
 *                            word of the name it was given in the call
 *   addressed(text, names)   whether a line someone said is to it: its name at the start (after "hey" or "ok"), or at the end of a
 *                            question; and what they asked, without the name
 *   commandOf(asked)         "stop" (stop talking), "leave" (leave the call), or null (a question)
 */

export type Platform = "google_meet" | "zoom" | "teams" | "webex";

export interface MeetingLink { url: string; platform: Platform }

const HOSTS: Array<[RegExp, Platform]> = [
  [/^meet\.google\.com$/i, "google_meet"],
  [/^([a-z0-9-]+\.)?zoom\.us$/i, "zoom"],
  [/^([a-z0-9-]+\.)?zoomgov\.com$/i, "zoom"],
  [/^teams\.(microsoft|live)\.com$/i, "teams"],
  [/^([a-z0-9-]+\.)?webex\.com$/i, "webex"],
];

/** A meeting's own path, so a link to a platform's home page or help is not taken for a meeting. */
const PATHS: Record<Platform, RegExp> = {
  google_meet: /^\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}\/?$|^\/lookup\/[a-z0-9]+/i,
  zoom: /^\/(j|my|w|s)\/[^/\s]+/i,
  teams: /^\/(l\/meetup-join|meet)\//i,
  webex: /^\/(meet|join|[a-z0-9.]+\/j\.php|wbxmjs)/i,
};

/** The first meeting link in the text, cleaned of what an invite puts around it. */
export function meetingOf(text: string | null | undefined): MeetingLink | null {
  const s = String(text ?? "");
  for (const m of s.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    let raw = m[0].replace(/[.,;:!?]+$/, "");
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const hit = HOSTS.find(([re]) => re.test(u.hostname));
    if (!hit) continue;
    const platform = hit[1];
    if (!PATHS[platform].test(u.pathname)) continue;
    u.protocol = "https:";
    u.hash = "";
    raw = u.toString();
    return { url: raw, platform };
  }
  // A bare Google Meet code, as some invites write it ("meet.google.com/abc-defg-hij").
  const bare = /(?:^|\s)meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})\b/i.exec(s);
  return bare ? { url: `https://meet.google.com/${bare[1]!.toLowerCase()}`, platform: "google_meet" } : null;
}

/** "X0" as people say it and as speech-to-text writes it. */
const X0 = ["x0", "x 0", "x-0", "x zero", "x-zero", "ex zero", "ex-zero", "x o", "ex oh", "x oh", "xo", "exo"];

/** What the bot answers to: X0, its whole name as the intro tells people to say it ("X0 Bot"), and that name's first word of its own ("Nova"
 *  for "Nova from Leaf & Co"). */
export function wakeNames(botName: string): string[] {
  const full = norm(botName);
  const own = full.split(" ").find((w) => w.length >= 2 && !["the", "a", "an", "bot", "x0", "ai", "assistant", "notes", "notetaker"].includes(w));
  return [...new Set([...X0, ...(full.length >= 2 ? [full] : []), ...(own ? [own] : [])])];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\u0900-\u097f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** A request's or a question's first word: what follows its name when someone is talking to it. */
const INVITES = /^(what|whats|who|whos|when|where|why|how|can|could|would|will|do|does|did|should|please|tell|give|summari[sz]e|sum|recap|list|remind|note|add|explain|check|find|read|repeat|stop|leave|thanks|thank)\b/;
const QUESTION = /^(what|whats|who|whos|when|where|why|how|can|could|would|will|do|does|did|is|are|should|any|was|were|have|has)\b/;

/**
 * Whether a line is said to the bot, and what was asked without its name. Its name at the start counts when they greet it ("hey X0"),
 * set it off ("X0, …"), or go on to ask or tell it something ("X0 what did Ravi say"): "X0 is slow on Android" is about it, not to it.
 * Its name at the end counts for a question ("what do you think, X0?"). Just its name ("X0?") is to it, with nothing asked yet.
 */
export function addressed(text: string, names: readonly string[]): { to: boolean; asked: string } {
  const said = norm(text);
  if (!said) return { to: false, asked: "" };
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const n = norm(name);
    if (!n) continue;
    const start = new RegExp(`^((?:hey|hi|ok|okay|so|and|um|uh)\\s+)?${esc(n)}\\b\\s*(.*)$`).exec(said);
    if (start) {
      const rest = start[2] ?? "";
      const setOff = new RegExp(`${esc(n).replace(/\\s\+/g, "[\\s-]*")}\\s*[,?!:]`, "i").test(text.toLowerCase().replace(/[’']/g, ""));
      if (!rest || start[1] || setOff || INVITES.test(rest)) return { to: true, asked: tidy(text, rest) };
      continue;
    }
    const end = new RegExp(`^(.*?)\\s*\\b${esc(n)}$`).exec(said);
    if (end && end[1] && (/\?\s*$/.test(text) || QUESTION.test(said))) return { to: true, asked: tidy(text, end[1]) };
  }
  return { to: false, asked: "" };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");

/** What they asked, as they said it where possible (the normalised words otherwise). */
function tidy(original: string, rest: string): string {
  const r = rest.trim();
  if (!r) return "";
  const i = original.toLowerCase().replace(/[’']/g, "").indexOf(r.split(" ")[0]!);
  const kept = i >= 0 ? original.slice(i).trim() : r;
  return kept.replace(/^[,.:;\s-]+/, "");
}

/** Stop talking, leave the call, or a question. */
export function commandOf(asked: string): "stop" | "leave" | null {
  const s = norm(asked);
  if (!s) return null;
  if (/^(please\s+)?(stop|stop talking|be quiet|quiet|shush|hush|thats enough|enough|pause|hold on|wait)( please)?$/.test(s)) return "stop";
  if (/^(please\s+)?(leave|leave the (call|meeting)|you can (leave|go)|go away|get out|bye|goodbye|drop off|hang up)( now| please)?$/.test(s)) return "leave";
  return null;
}
