/**
 * NOTES — where the desktop's note-taker keeps what it heard.
 *
 * One row per note (supabase/migrations/0014_notes.sql). The transcript grows
 * a stretch at a time while the note records; the organised body is written
 * once when it stops. Audio is never stored.
 *
 * Without Supabase (tests, local runs) the rows live in this process, as the
 * history store's do.
 */
import { randomUUID } from "node:crypto";
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";
import type { Note, NoteSegment, NoteStatus, NoteSummary } from "../../../shared/types/api.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when this caller cannot keep notes: a desktop on a static token has
 *  no account row for a note to belong to. */
export class NotesNeedAccount extends Error {
  constructor() { super("Sign in to keep notes."); }
}

/** The organised part of a note, as the writer returns it. */
export interface NoteBody {
  title: string;
  summary: string;
  highlights: Note["highlights"];
  people: Note["people"];
}

export const EMPTY_BODY: NoteBody = { title: "", summary: "", highlights: [], people: [] };

interface Row {
  id: string;
  user_id: string;
  status: NoteStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | string;
  words: number;
  title: string;
  summary: string;
  body: (Partial<Pick<NoteBody, "highlights" | "people">> & { systemAudio?: Note["systemAudio"] }) | null;
  transcript: NoteSegment[] | null;
  organised: boolean;
  deleted_at: string | null;
  updated_at: string;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function fromRow(r: Row): Note {
  const body = r.body ?? {};
  return {
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    ...(r.ended_at ? { endedAt: r.ended_at } : {}),
    durationSeconds: Number(r.duration_seconds) || 0,
    words: r.words ?? 0,
    title: r.title ?? "",
    summary: r.summary ?? "",
    highlights: arr(body.highlights),
    people: arr(body.people),
    ...(body.systemAudio ? { systemAudio: body.systemAudio } : {}),
    transcript: arr(r.transcript),
    organised: !!r.organised,
  };
}

/** When the row last changed, for telling a stuck note from a busy one. */
const touched = new Map<string, number>();

function summaryOf(n: Note): NoteSummary {
  return {
    id: n.id, status: n.status, startedAt: n.startedAt, endedAt: n.endedAt,
    durationSeconds: n.durationSeconds, words: n.words, title: n.title,
    summary: n.summary, people: n.people, organised: n.organised,
    ...(n.systemAudio ? { systemAudio: n.systemAudio } : {}),
  };
}

// ---- in-process rows (no Supabase) -------------------------------------------

const memory = new Map<string, Note[]>();
const mem = (userId: string): Note[] => {
  let rows = memory.get(userId);
  if (!rows) memory.set(userId, (rows = []));
  return rows;
};

/** Forget every in-process note. Tests only. */
export function resetNotesForTests(): void { memory.clear(); touched.clear(); }

// ---- one writer per note ----------------------------------------------------------

const locks = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier write to the same note has finished. Stretches
 *  of audio can arrive together; a read-modify-write each would drop one. */
async function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(id, run);
  try {
    return await run;
  } finally {
    if (locks.get(id) === run) locks.delete(id);
  }
}

function client(user: AuthedUser) {
  const sb = dataClientFor(user);
  if (sb && !UUID.test(user.id)) throw new NotesNeedAccount();
  return sb;
}

// ---- reads ------------------------------------------------------------------

export async function getNote(user: AuthedUser, id: string): Promise<Note | null> {
  if (!UUID.test(id)) return null;
  const sb = client(user);
  if (!sb) return mem(user.id).find((n) => n.id === id) ?? null;
  const { data, error } = await sb.from("notes").select("*")
    .eq("user_id", user.id).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`notes read failed: ${error.message}`);
  return data ? fromRow(data as Row) : null;
}

export async function listNotes(user: AuthedUser, limit = 100): Promise<NoteSummary[]> {
  const sb = client(user);
  const cap = Math.max(1, Math.min(500, Math.floor(limit)));
  if (!sb) return mem(user.id).slice(0, cap).map(summaryOf);
  const { data, error } = await sb.from("notes")
    .select("id,user_id,status,started_at,ended_at,duration_seconds,words,title,summary,body,organised,deleted_at,updated_at")
    .eq("user_id", user.id).is("deleted_at", null)
    .order("started_at", { ascending: false }).limit(cap);
  if (error) throw new Error(`notes list failed: ${error.message}`);
  return (data as Row[]).map((r) => summaryOf(fromRow({ ...r, transcript: [] })));
}

/** Milliseconds since this process last wrote the note, or null if it has
 *  not (another process, or a restart, since). */
export function msSinceTouched(id: string, now = Date.now()): number | null {
  const t = touched.get(id);
  return t == null ? null : now - t;
}

// ---- writes -----------------------------------------------------------------------

export async function createNote(user: AuthedUser, startedAt = new Date()): Promise<Note> {
  const sb = client(user);
  const note: Note = {
    id: randomUUID(), status: "recording", startedAt: startedAt.toISOString(),
    durationSeconds: 0, words: 0, ...EMPTY_BODY, transcript: [], organised: false,
  };
  if (!sb) {
    mem(user.id).unshift(note);
  } else {
    const { error } = await sb.from("notes").insert({
      id: note.id, user_id: user.id, status: note.status, started_at: note.startedAt,
    });
    if (error) throw new Error(`notes insert failed: ${error.message}`);
  }
  touched.set(note.id, Date.now());
  return note;
}

/** Apply `change` to a note and save it. Null when there is no such note. */
export async function updateNote(
  user: AuthedUser,
  id: string,
  change: (n: Note) => Note | null,
): Promise<Note | null> {
  if (!UUID.test(id)) return null;
  return serial(id, async () => {
    const cur = await getNote(user, id);
    if (!cur) return null;
    const next = change(cur);
    if (!next) return cur;
    const sb = client(user);
    if (!sb) {
      const rows = mem(user.id);
      const i = rows.findIndex((n) => n.id === id);
      if (i < 0) return null;
      rows[i] = next;
    } else {
      const { error } = await sb.from("notes").update({
        status: next.status,
        ended_at: next.endedAt ?? null,
        duration_seconds: next.durationSeconds,
        words: next.words,
        title: next.title,
        summary: next.summary,
        body: { highlights: next.highlights, people: next.people, ...(next.systemAudio ? { systemAudio: next.systemAudio } : {}) },
        transcript: next.transcript,
        organised: next.organised,
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("id", id);
      if (error) throw new Error(`notes update failed: ${error.message}`);
    }
    touched.set(id, Date.now());
    return next;
  });
}

/** Out of the list; the row stays until a prune removes it. */
export async function deleteNote(user: AuthedUser, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const sb = client(user);
  if (!sb) {
    const rows = mem(user.id);
    const i = rows.findIndex((n) => n.id === id);
    if (i < 0) return false;
    rows.splice(i, 1);
    return true;
  }
  const { data, error } = await sb.from("notes").update({ deleted_at: new Date().toISOString() })
    .eq("user_id", user.id).eq("id", id).is("deleted_at", null).select("id");
  if (error) throw new Error(`notes delete failed: ${error.message}`);
  touched.delete(id);
  return (data ?? []).length > 0;
}
