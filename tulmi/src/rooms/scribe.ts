/**
 * THE BOT THAT SITS IN OUR OWN CALLS (src/rooms, docs/brief.md).
 *
 * It is in every call the mail bot makes, from the first person who arrives, and the room says so: it is in the people list,
 * and anyone can see it is there. What it does while it sits there:
 *
 *   hears      one WebSocket adapter a person (ears.ts), each one that person's own track, so who said what is never guessed
 *   writes     every stretch into the call's note (src/notes), the same note a desktop recording makes
 *   draws      the document, a pass every few minutes (src/brief): the overview, the flow they described, the numbers, the
 *              decisions, who does what, what is still open
 *   answers    a question with its name in it — in writing on every screen, and out loud in the call where it has a voice
 *   finishes   when the last person leaves: the ears closed, the note organised, the document's last pass
 *
 * WHAT IT IS NOT: it never speaks unless spoken to, never acts for anybody, and knows nothing of the owner's private life —
 * the only thing in its reach is what was said in this call (brief/role.ts, meet/brain.ts).
 *
 * The service calls this at five seams (join, a microphone on, someone gone, the call over, what to show) and nothing else,
 * so a room with no scribe behaves exactly as a room did before.
 */

import type { NoteSegment } from "../../../shared/types/api.js";
import { applyEdit } from "../brief/edit.js";
import { briefEveryMs, type BriefWriter, type Line } from "../brief/role.js";
import { emptyBrief, type Brief } from "../brief/types.js";
import type { Ears } from "./ears.js";
import type { RoomStore } from "./store.js";

/** What the call screen is told about the bot (rooms/types.ts SeatLive). */
export interface ScribeState {
  /** Its name in the call. */
  name: string;
  /** It is listening and writing: the room says so to everyone in it. */
  taking: boolean;
  /** The document so far. */
  brief: Brief | null;
  /** What it last said in the call, if anything, and when. */
  said?: { text: string; at: number };
}

export interface ScribeDeps {
  ears: Ears;
  /**
   * ITS VOICE, where this server has one (rooms/voice.ts). Given a call and a line, it takes a seat of its own at the SFU,
   * says the line out loud, and everyone in the call hears it as they hear a person. Left out: the bot writes and does not
   * speak, which is the whole of the difference.
   */
  voice?: {
    /** A seat and a track for this call, so people can pull its voice. Answers the seat it took, or null. */
    join(roomId: string): Promise<{ identity: string; name: string; sessionId: string; trackName: string } | null>;
    say(roomId: string, text: string): Promise<void>;
    hush(roomId: string): void;
    leave(roomId: string): Promise<void>;
  };
  store: RoomStore;
  brief: BriefWriter;
  /** A note for this call, made when the first person arrives. */
  startNote(userId: string, title: string): Promise<string | null>;
  /** What was heard, in the note, under the name of whoever said it. */
  heard(noteId: string, userId: string, seg: NoteSegment, seconds: number): Promise<void>;
  /** The note's transcript, which is what the document is written from. */
  lines(noteId: string, userId: string): Promise<Line[]>;
  /** The call is over: the note organised (title, summary, to-dos), as the desktop's recordings are. */
  organise(userId: string, noteId: string): Promise<void>;
  /** A question with the bot's name in it, answered in writing. */
  answer(o: { asked: string; who: string; lines: Line[]; title: string; owner: string; botName: string }): Promise<string>;
  /** The call's screens are told something changed. */
  changed(roomId: string): void;
  now(): number;
}

/** The name it goes by in a call until it has one of its own. */
export const SCRIBE_NAME = "X0";
/** How long after the last pass a question may still be answered, so one person cannot make it answer all day. */
const ANSWER_EVERY_MS = 20_000;

interface Sitting {
  roomId: string;
  userId: string;
  title: string;
  owner: string;
  noteId: string;
  startedAt: number;
  brief: Brief;
  timer: ReturnType<typeof setInterval> | null;
  passing: boolean;
  /** How many lines the last pass read, so a pass with nothing new is not paid for. */
  lastLines: number;
  said: { text: string; at: number } | null;
  answeredAt: number;
  /** Everyone whose track is already being listened to. */
  ears: Set<string>;
  /** It has a seat of its own at the SFU and can be heard. */
  voiced: boolean;
  /** The last line it heard, so a question in the room is only answered once. */
  lastHeard: number;
}

export class Scribe {
  private readonly sittings = new Map<string, Sitting>();

  constructor(private readonly d: ScribeDeps) {}

  /** Whether it is sitting in this call. */
  in(roomId: string): boolean { return this.sittings.has(roomId); }

  /**
   * Somebody is in the call: it takes its seat. The note is made now, so the first words have somewhere to go, and the
   * document's clock starts.
   */
  async sit(room: { id: string; userId: string; title: string; host: string; noteId?: string | null; brief?: Brief | null }): Promise<void> {
    if (this.sittings.has(room.id)) return;
    const noteId = room.noteId ?? await this.d.startNote(room.userId, room.title || room.host || "Call").catch(() => null);
    if (!noteId) return;
    const now = this.d.now();
    const sitting: Sitting = {
      roomId: room.id, userId: room.userId, title: room.title || room.host || "Call", owner: room.host || "",
      noteId, startedAt: now, brief: room.brief ?? emptyBrief(), timer: null, passing: false, lastLines: 0,
      said: null, answeredAt: 0, ears: new Set(), voiced: false, lastHeard: 0,
    };
    this.sittings.set(room.id, sitting);
    this.d.ears.open(room.id, { noteId, userId: room.userId, startedAt: now });
    if (!room.noteId) await this.d.store.update(room.id, { noteId }).catch(() => undefined);
    sitting.timer = setInterval(() => void this.pass(room.id, true), briefEveryMs());
    sitting.timer.unref?.();
    // Its voice, where this server has one: a seat of its own in the call, so everyone's app pulls what it says the way it
    // pulls a person's microphone.
    if (this.d.voice) {
      const seat = await this.d.voice.join(room.id).catch(() => null);
      sitting.voiced = !!seat;
    }
  }

  /**
   * SOMEBODY SAID ITS NAME. Every line the ears write down comes through here: a line that calls it by name is a question
   * to answer, and everything else is simply the meeting. One answer at a time, and never to its own voice.
   */
  async overheard(roomId: string, line: { who: string; text: string; at: number }): Promise<void> {
    const s = this.sittings.get(roomId);
    if (!s || line.at <= s.lastHeard) return;
    s.lastHeard = line.at;
    const asked = wokeIt(line.text);
    if (!asked) return;
    await this.asked(roomId, { asked, who: line.who });
  }

  /** Somebody turned their microphone on: that track is listened to from now on. */
  async hear(roomId: string, o: { identity: string; name: string; sessionId: string; trackName: string }): Promise<void> {
    const s = this.sittings.get(roomId);
    if (!s || s.ears.has(o.identity)) return;
    s.ears.add(o.identity);
    const on = await this.d.ears.listenTo(roomId, o);
    if (!on) s.ears.delete(o.identity);
  }

  /** Somebody is gone: their ear closed, and what they were in the middle of saying written down. */
  async gone(roomId: string, identity: string): Promise<void> {
    const s = this.sittings.get(roomId);
    if (!s) return;
    s.ears.delete(identity);
    await this.d.ears.forget(roomId, identity);
  }

  /**
   * The call is over. Everything left is written down, the document gets its last pass (told the meeting has ended), and
   * the note is organised the way every other recording is.
   */
  async leave(roomId: string): Promise<void> {
    const s = this.sittings.get(roomId);
    if (!s) return;
    this.sittings.delete(roomId);
    if (s.timer) clearInterval(s.timer);
    if (s.voiced && this.d.voice) await this.d.voice.leave(roomId).catch(() => undefined);
    await this.d.ears.stop(roomId);
    await this.pass(roomId, false, s);
    await this.d.organise(s.userId, s.noteId).catch((err) => console.warn(`[rooms] a call's note could not be organised: ${said(err)}`));
  }

  /** What the call screen shows: the bot, and the document so far. */
  state(roomId: string): ScribeState | null {
    const s = this.sittings.get(roomId);
    if (!s) return null;
    return { name: SCRIBE_NAME, taking: true, brief: s.brief.parts.length ? s.brief : null, ...(s.said ? { said: s.said } : {}) };
  }

  /**
   * Somebody asked it something, in the call. Answered from what was said in this call and general knowledge, in writing,
   * and kept on the room so every screen in the call sees it. Never more than one answer every twenty seconds.
   */
  async asked(roomId: string, o: { asked: string; who: string }): Promise<string | null> {
    const s = this.sittings.get(roomId);
    if (!s) return null;
    const now = this.d.now();
    // The first question is always answered; after that, not twice in a breath.
    if (s.answeredAt && now - s.answeredAt < ANSWER_EVERY_MS) return null;
    s.answeredAt = now;
    try {
      const lines = await this.d.lines(s.noteId, s.userId);
      const reply = await this.d.answer({ asked: o.asked, who: o.who, lines, title: s.title, owner: s.owner, botName: SCRIBE_NAME });
      const text = reply.trim();
      if (!text) return null;
      s.said = { text, at: now };
      this.d.changed(roomId);
      // Out loud as well, where it has a voice: the people in the call hear the answer, and every screen has it in writing.
      if (s.voiced && this.d.voice) await this.d.voice.say(roomId, text).catch(() => undefined);
      return text;
    } catch (err) {
      console.warn(`[rooms] a question in a call could not be answered: ${said(err)}`);
      return null;
    }
  }

  /** One pass of the document. `live` false is the last one, once the call is over. */
  private async pass(roomId: string, live: boolean, sitting?: Sitting): Promise<void> {
    const s = sitting ?? this.sittings.get(roomId);
    if (!s || s.passing) return;
    s.passing = true;
    try {
      const lines = await this.d.lines(s.noteId, s.userId);
      if (!lines.length || (live && lines.length <= s.lastLines)) return;
      s.lastLines = lines.length;
      const edit = await this.d.brief.write({
        botName: SCRIBE_NAME, owner: s.owner, title: s.title,
        people: [...new Set(lines.map((l) => l.who).filter(Boolean))],
        lines, brief: s.brief, live,
      });
      if (!edit) return;
      const next = applyEdit(s.brief, edit, this.d.now());
      if (!next.changed) return;
      s.brief = next.brief;
      await this.d.store.update(roomId, { brief: next.brief }).catch(() => undefined);
      if (next.say && live) s.said = { text: next.say, at: this.d.now() };
      this.d.changed(roomId);
    } catch (err) {
      console.warn(`[rooms] a call's document could not be written: ${said(err)}`);
    } finally {
      s.passing = false;
    }
  }
}

const said = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * WHETHER A LINE IS TALKING TO IT, and what it asked. Its name at the start of what somebody said ("X0, what did we decide?"
 * / "hey X0 — read that back"), which is how a person addresses anyone in a room. A name in the middle of a sentence is
 * somebody talking ABOUT it, and is left alone.
 */
export function wokeIt(text: string, name = SCRIBE_NAME): string {
  const t = String(text ?? "").trim();
  const m = new RegExp(`^(?:hey |ok |okay |hi )?${name}\\b[\\s,:—–-]*(.*)$`, "i").exec(t);
  const asked = (m?.[1] ?? "").trim();
  return asked.length >= 2 ? asked : "";
}
