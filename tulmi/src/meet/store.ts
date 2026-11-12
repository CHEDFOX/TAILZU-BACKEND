/**
 * THE MEETING BOT'S ROWS (migration 0082_meetings.sql): each person's settings, each meeting its bot was sent to, and what people asked
 * it in the call. The transcript is the meeting's note (src/notes).
 *
 * The server's alone (no policy lets a token read or write them); they go with the account. The memory twin is what tests and a server
 * with no Supabase use; it is bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { Platform } from "./words.js";

export type MeetStatus = "scheduled" | "joining" | "waiting" | "in_call" | "ended" | "done" | "failed" | "cancelled";
/** Where a meeting stands is one of these until it is over. */
export const LIVE_STATUSES: ReadonlySet<MeetStatus> = new Set(["joining", "waiting", "in_call"]);

export interface MeetSettings { autoJoin: boolean; voice: boolean; botName: string }
export const DEFAULT_SETTINGS: MeetSettings = { autoJoin: false, voice: true, botName: "" };

/** The notes so far, written every few minutes while the meeting goes on (brain.ts liveNotes). */
export interface LiveNotes { points: string[]; actions: Array<{ who: string; what: string }>; at: number }

export interface Meeting {
  id: string;
  userId: string;
  botId: string | null;
  tokenHash: string;
  url: string;
  platform: Platform;
  title: string;
  status: MeetStatus;
  voice: boolean;
  source: "link" | "calendar";
  eventKey: string | null;
  joinAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  noteId: string | null;
  liveNotes: LiveNotes | null;
  participants: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MeetAsk { askedBy: string; question: string; answer: string; how: "voice" | "chat"; at: number }

export interface MeetStore {
  settings(userId: string): Promise<MeetSettings>;
  saveSettings(userId: string, s: MeetSettings): Promise<MeetSettings>;
  /** Everyone whose bot joins their calendar's meetings by itself. */
  autoJoiners(): Promise<string[]>;
  add(m: Meeting): Promise<void>;
  get(id: string): Promise<Meeting | null>;
  byTokenHash(hash: string): Promise<Meeting | null>;
  byBot(botId: string): Promise<Meeting | null>;
  byEvent(userId: string, eventKey: string): Promise<Meeting | null>;
  update(id: string, patch: Partial<Omit<Meeting, "id" | "userId" | "createdAt">>): Promise<Meeting | null>;
  /** Newest first. */
  list(userId: string, limit?: number): Promise<Meeting[]>;
  addAsk(meetingId: string, a: MeetAsk): Promise<void>;
  asks(meetingId: string, limit?: number): Promise<MeetAsk[]>;
}

const MEMORY_MAX = 5_000;

export class MemoryMeetStore implements MeetStore {
  private readonly prefs = new Map<string, MeetSettings>();
  private readonly rows = new Map<string, Meeting>();
  private readonly asked = new Map<string, MeetAsk[]>();

  async settings(userId: string): Promise<MeetSettings> { return { ...(this.prefs.get(userId) ?? DEFAULT_SETTINGS) }; }
  async saveSettings(userId: string, s: MeetSettings): Promise<MeetSettings> { this.prefs.set(userId, { ...s }); return { ...s }; }
  async autoJoiners(): Promise<string[]> { return [...this.prefs].filter(([, s]) => s.autoJoin).map(([u]) => u); }

  async add(m: Meeting): Promise<void> {
    if (m.eventKey && [...this.rows.values()].some((r) => r.userId === m.userId && r.eventKey === m.eventKey)) throw new Error("meeting already scheduled");
    this.rows.set(m.id, { ...m });
    while (this.rows.size > MEMORY_MAX) {
      const oldest = this.rows.keys().next().value!;
      this.rows.delete(oldest);
      this.asked.delete(oldest);
    }
  }
  async get(id: string): Promise<Meeting | null> { const m = this.rows.get(id); return m ? { ...m } : null; }
  async byTokenHash(hash: string): Promise<Meeting | null> { const m = [...this.rows.values()].find((r) => r.tokenHash === hash); return m ? { ...m } : null; }
  async byBot(botId: string): Promise<Meeting | null> { const m = [...this.rows.values()].find((r) => r.botId === botId); return m ? { ...m } : null; }
  async byEvent(userId: string, eventKey: string): Promise<Meeting | null> {
    const m = [...this.rows.values()].find((r) => r.userId === userId && r.eventKey === eventKey);
    return m ? { ...m } : null;
  }
  async update(id: string, patch: Partial<Meeting>): Promise<Meeting | null> {
    const m = this.rows.get(id);
    if (!m) return null;
    const next = { ...m, ...patch, id: m.id, userId: m.userId, createdAt: m.createdAt, updatedAt: Date.now() };
    this.rows.set(id, next);
    return { ...next };
  }
  async list(userId: string, limit = 50): Promise<Meeting[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((m) => ({ ...m }));
  }
  async addAsk(meetingId: string, a: MeetAsk): Promise<void> {
    const list = this.asked.get(meetingId) ?? [];
    list.push({ ...a });
    if (list.length > 200) list.shift();
    this.asked.set(meetingId, list);
  }
  async asks(meetingId: string, limit = 100): Promise<MeetAsk[]> { return (this.asked.get(meetingId) ?? []).slice(-limit).map((a) => ({ ...a })); }
}

interface Row {
  id: string; user_id: string; bot_id: string | null; token_hash: string; url: string; platform: Platform; title: string; status: MeetStatus;
  voice: boolean; source: "link" | "calendar"; event_key: string | null; join_at: string | null; started_at: string | null; ended_at: string | null;
  note_id: string | null; live_notes: LiveNotes | null; participants: string[] | null; error: string | null; created_at: string; updated_at: string;
}

const ms = (s: string | null): number | null => (s ? Date.parse(s) || null : null);
const iso = (n: number | null | undefined): string | null => (n ? new Date(n).toISOString() : null);

function fromRow(r: Row): Meeting {
  return {
    id: r.id, userId: r.user_id, botId: r.bot_id, tokenHash: r.token_hash, url: r.url, platform: r.platform, title: r.title ?? "",
    status: r.status, voice: !!r.voice, source: r.source, eventKey: r.event_key, joinAt: ms(r.join_at), startedAt: ms(r.started_at),
    endedAt: ms(r.ended_at), noteId: r.note_id, liveNotes: r.live_notes ?? null, participants: Array.isArray(r.participants) ? r.participants : [],
    error: r.error, createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
  };
}

function toRow(p: Partial<Meeting>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Array<[keyof Meeting, string, (v: unknown) => unknown]> = [
    ["botId", "bot_id", (v) => v], ["tokenHash", "token_hash", (v) => v], ["url", "url", (v) => v], ["platform", "platform", (v) => v],
    ["title", "title", (v) => v], ["status", "status", (v) => v], ["voice", "voice", (v) => v], ["source", "source", (v) => v],
    ["eventKey", "event_key", (v) => v], ["joinAt", "join_at", (v) => iso(v as number | null)], ["startedAt", "started_at", (v) => iso(v as number | null)],
    ["endedAt", "ended_at", (v) => iso(v as number | null)], ["noteId", "note_id", (v) => v], ["liveNotes", "live_notes", (v) => v],
    ["participants", "participants", (v) => v], ["error", "error", (v) => v],
  ];
  for (const [k, col, f] of map) if (p[k] !== undefined) out[col] = f(p[k]);
  return out;
}

export class SupabaseMeetStore implements MeetStore {
  constructor(private readonly db: SupabaseClient) {}

  async settings(userId: string): Promise<MeetSettings> {
    const { data, error } = await this.db.from("meet_settings").select("auto_join,voice,bot_name").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("meet_settings read failed");
    return data ? { autoJoin: !!data.auto_join, voice: !!data.voice, botName: String(data.bot_name ?? "") } : { ...DEFAULT_SETTINGS };
  }
  async saveSettings(userId: string, s: MeetSettings): Promise<MeetSettings> {
    const { error } = await this.db.from("meet_settings").upsert({
      user_id: userId, auto_join: s.autoJoin, voice: s.voice, bot_name: s.botName, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error("meet_settings write failed");
    return { ...s };
  }
  async autoJoiners(): Promise<string[]> {
    const { data, error } = await this.db.from("meet_settings").select("user_id").eq("auto_join", true).limit(5000);
    if (error) throw new Error("meet_settings read failed");
    return (data ?? []).map((r) => String(r.user_id));
  }
  async add(m: Meeting): Promise<void> {
    const { error } = await this.db.from("meetings").insert({ id: m.id, user_id: m.userId, ...toRow(m), created_at: iso(m.createdAt), updated_at: iso(m.updatedAt) });
    if (error) throw new Error(error.code === "23505" ? "meeting already scheduled" : "meetings insert failed");
  }
  private async one(col: string, value: string, more?: [string, string]): Promise<Meeting | null> {
    let q = this.db.from("meetings").select("*").eq(col, value);
    if (more) q = q.eq(more[0], more[1]);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error("meetings read failed");
    return data ? fromRow(data as Row) : null;
  }
  get(id: string) { return this.one("id", id); }
  byTokenHash(hash: string) { return this.one("token_hash", hash); }
  byBot(botId: string) { return this.one("bot_id", botId); }
  byEvent(userId: string, eventKey: string) { return this.one("user_id", userId, ["event_key", eventKey]); }
  async update(id: string, patch: Partial<Meeting>): Promise<Meeting | null> {
    const { data, error } = await this.db.from("meetings").update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error("meetings update failed");
    return data ? fromRow(data as Row) : null;
  }
  async list(userId: string, limit = 50): Promise<Meeting[]> {
    const { data, error } = await this.db.from("meetings").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(Math.min(200, limit));
    if (error) throw new Error("meetings list failed");
    return (data as Row[]).map(fromRow);
  }
  async addAsk(meetingId: string, a: MeetAsk): Promise<void> {
    const { error } = await this.db.from("meeting_asks").insert({
      meeting_id: meetingId, asked_by: a.askedBy.slice(0, 120), question: a.question.slice(0, 2000), answer: a.answer.slice(0, 4000), how: a.how,
      created_at: new Date(a.at).toISOString(),
    });
    if (error) throw new Error("meeting_asks insert failed");
  }
  async asks(meetingId: string, limit = 100): Promise<MeetAsk[]> {
    const { data, error } = await this.db.from("meeting_asks").select("asked_by,question,answer,how,created_at").eq("meeting_id", meetingId).order("id", { ascending: false }).limit(limit);
    if (error) throw new Error("meeting_asks read failed");
    return (data ?? []).reverse().map((r) => ({ askedBy: String(r.asked_by ?? ""), question: String(r.question), answer: String(r.answer ?? ""), how: r.how as "voice" | "chat", at: Date.parse(String(r.created_at)) || 0 }));
  }
}

let shared: MeetStore | null = null;

/** The server's: Supabase when it is set up, else the memory twin. */
export function meetStore(): MeetStore {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseMeetStore(db) : new MemoryMeetStore();
  }
  return shared;
}
