/**
 * WHAT THE MEETING BOT'S CHAT KNOWS: THE PERSON'S MEETINGS, AS THE BOT NOTED THEM.
 *
 *   meetDigest(userId, o) -> string | null     bots/run.ts gives it to the meeting bot's turn as <knowledge>, wrapped as untrusted data
 *
 * From the meetings store (store.ts), the latest fifteen: the call going on now with the notes so far, what is scheduled, what is over with
 * its note (who was there, the summary, the decisions, the to-dos with the open ones first), and what could not join and why. So "what did we
 * decide with Asha?" or "what is open from Monday?" is answered from the real notes, with one model call and no tool.
 * What was said in a meeting is other people's words: the whole text is fenced as data, and our tags and the fence are broken inside it.
 */
import { neutral } from "../bots/prompt.js";
import { asUntrustedFile } from "../media/untrusted.js";
import type { AuthedUser } from "../auth/supabase.js";
import type { Note } from "../../../shared/types/api.js";
import { getNote as readNote } from "../notes/store.js";
import { LIVE_STATUSES, meetStore, type Meeting, type MeetStore } from "./store.js";

const MAX_CHARS = 9_000;
const RECENT = 15;
const NONE = "They have not had a meeting with the meeting bot yet. To start, paste a meeting link on the meeting bot's page.";

function when(ms: number, tzOffsetMinutes: number): string {
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const clip = (s: string | null | undefined, n: number): string => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const defaultGetNote = (userId: string, id: string): Promise<Note | null> => readNote({ id: userId } as AuthedUser, id);

/** The person's meetings as the chat reads them. */
export async function meetDigest(userId: string, o: {
  store?: MeetStore; getNote?: (userId: string, id: string) => Promise<Note | null>; now?: number; tzOffsetMinutes?: number;
} = {}): Promise<string | null> {
  const store = o.store ?? meetStore();
  const getNote = o.getNote ?? defaultGetNote;
  const tz = o.tzOffsetMinutes ?? 330;
  const meetings = await store.list(userId, RECENT);
  if (!meetings.length) return NONE;

  const out: string[] = [`Now: ${when(o.now ?? Date.now(), tz)} (their time).`];
  const live = meetings.filter((m) => LIVE_STATUSES.has(m.status));
  const scheduled = meetings.filter((m) => m.status === "scheduled").sort((a, b) => (a.joinAt ?? 0) - (b.joinAt ?? 0));
  const failed = meetings.filter((m) => m.status === "failed");
  const over = meetings.filter((m) => m.status === "ended" || m.status === "done");

  for (const m of live) {
    out.push("", `In a call now: "${clip(m.title, 100) || "Meeting"}"${m.startedAt ? `, since ${when(m.startedAt, tz)}` : ""}${m.status === "in_call" ? "" : " (not in yet)"}.`);
    const n = m.liveNotes;
    if (n?.points.length) out.push("Notes so far:", ...n.points.slice(0, 15).map((p) => `- ${clip(p, 200)}`));
    if (n?.actions.length) out.push("Actions so far:", ...n.actions.slice(0, 10).map((a) => `- ${clip(a.who, 40) || "someone"}: ${clip(a.what, 160)}`));
  }
  if (scheduled.length) {
    out.push("", "Scheduled:");
    for (const m of scheduled) out.push(`- ${m.joinAt ? when(m.joinAt, tz) : "time not set"}: "${clip(m.title, 100) || "Meeting"}"`);
  }
  for (const m of over) out.push(...await finished(m, getNote, userId, tz));
  if (failed.length) {
    out.push("", "Could not join:");
    for (const m of failed) out.push(`- "${clip(m.title, 100) || "Meeting"}"${m.error ? `: ${clip(m.error, 120)}` : ""}`);
  }

  let body = out.join("\n");
  if (body.length > MAX_CHARS) body = `${body.slice(0, MAX_CHARS)}\n(more not shown)`;
  // What was said in a meeting is other people's words: our tags and the fence are broken in it, so it cannot close one.
  return asUntrustedFile({ name: "Their meetings, as the meeting bot noted them", kind: "meetings", body: neutral(body) });
}

async function finished(m: Meeting, getNote: (userId: string, id: string) => Promise<Note | null>, userId: string, tz: number): Promise<string[]> {
  let note: Note | null = null;
  if (m.noteId) {
    try { note = await getNote(userId, m.noteId); } catch { note = null; }
  }
  if (!note) return [];
  const at = m.startedAt ?? m.endedAt ?? m.createdAt;
  const lines = ["", `Meeting, ${when(at, tz)}: "${clip(note.title || m.title, 100) || "Meeting"}"`];
  if (m.participants.length) lines.push(`Who was there: ${m.participants.slice(0, 20).map((p) => clip(p, 40)).join(", ")}.`);
  if (note.summary) lines.push(`Summary: ${clip(note.summary, 600)}`);
  if (note.decisions?.length) lines.push("Decisions:", ...note.decisions.slice(0, 10).map((d) => `- ${clip(d, 200)}`));
  const todos = [...(note.todos ?? [])].sort((a, b) => Number(a.done) - Number(b.done));
  if (todos.length) {
    lines.push("To-dos:", ...todos.slice(0, 15).map((t) => `- ${t.done ? "[done] " : "[open] "}${t.who ? `${clip(t.who, 40)}: ` : ""}${clip(t.text, 200)}${t.when ? ` (${clip(t.when, 40)})` : ""}`));
  }
  return lines;
}
