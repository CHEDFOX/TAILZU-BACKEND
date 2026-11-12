/**
 * ONE MEETING WHILE ITS BOT IS IN THE CALL (docs/meet.md): what the meeting engine (service.ts) keeps in memory for it, and how Recall's
 * live events read.
 *
 *   Room             per meeting: the last lines said (what questions are answered from), the lines waiting to be written to the note,
 *                    who is in the call now and who came at all, the questions waiting their turn, and someone who said only the bot's
 *                    name (their next line is the question)
 *   heardOf(body)    a transcript.data event: who said it, the words, and when (seconds from the start of the recording)
 *   chatOf(body)     a participant_events.chat_message event: who wrote it, the text, and whether it was written to the bot alone
 *   personOf(body)   a participant_events.join or .leave event's participant
 *   botIdOf(body)    the Recall bot an event is about
 *
 * Everything here is lost on a restart; service.ts rebuilds it from the meeting's row and its note. A person's name is never empty: a
 * participant without one is "Speaker <id>". Names and words are cleaned of control characters and kept to a sane length.
 */
import type { NoteSegment } from "../../../shared/types/api.js";
import type { Line } from "./brain.js";
import type { Meeting } from "./store.js";
import { wakeNames } from "./words.js";

/** The lines kept for answering questions. */
export const KEEP_LINES = 400;
/** A batch this long is written to the note at once, without waiting for the timer. */
export const FLUSH_LINES = 15;
/** Questions waiting while one is answered; any more are dropped. */
export const QUEUE_MAX = 2;
/** After someone says only the bot's name, how long their next line counts as the question. */
export const WAKE_WAIT_MS = 10_000;
/** Lines held for the note while it cannot be written (the database is down): the oldest go first. */
const BUFFER_MAX = 2_000;

export interface Person { id: string; name: string }
export interface Heard { who: Person; text: string; at: number; words: number }
export interface Chat { who: Person; text: string; at: number; toBot: boolean }
/** A question for the bot: who asked, what (without its name), how, and when (seconds into the meeting). */
export interface Ask { who: string; asked: string; how: "voice" | "chat"; at: number }

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g;

/** A name or a title as a person would write it: no control characters, single spaces, at most `max` characters. */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const idText = (v: unknown): string => (typeof v === "string" ? v.slice(0, 80) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const seconds = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The event's inner `data.data`, where Recall puts what happened. */
const inner = (body: unknown): Record<string, unknown> => obj(obj(obj(body).data).data);

export function eventOf(body: unknown): string {
  const e = obj(body).event;
  return typeof e === "string" ? e : "";
}

export function botIdOf(body: unknown): string {
  return idText(obj(obj(obj(body).data).bot).id);
}

function personFrom(p: unknown): Person {
  const o = obj(p);
  const id = idText(o.id);
  const name = cleanText(o.name, 80);
  return { id, name: name || (id ? `Speaker ${id}` : "Someone") };
}

/** A line of the live transcript, or null when it has no words. */
export function heardOf(body: unknown): Heard | null {
  const d = inner(body);
  const words = Array.isArray(d.words) ? d.words : [];
  const said = words.map((w) => cleanText(obj(w).text, 200)).filter(Boolean);
  if (!said.length) return null;
  const at = seconds(obj(obj(words[0]).start_timestamp).relative);
  return { who: personFrom(d.participant), text: said.join(" ").slice(0, 4000), at, words: said.length };
}

/** A message in the meeting's chat, or null when it has no text. */
export function chatOf(body: unknown): Chat | null {
  const d = inner(body);
  const msg = obj(d.data);
  const text = typeof msg.text === "string" ? msg.text.replace(CONTROL, " ").trim().slice(0, 2000) : "";
  if (!text) return null;
  return { who: personFrom(d.participant), text, at: seconds(obj(d.timestamp).relative), toBot: msg.to === "only_bot" };
}

/** Who joined or left, or null when the event names nobody. */
export function personOf(body: unknown): Person | null {
  const p = inner(body).participant;
  return p && typeof p === "object" ? personFrom(p) : null;
}

export class Room {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly title: string;
  /** The name it shows in the call, and what it answers to (wakeNames, and the whole name as people read it off the screen). */
  readonly botName: string;
  readonly wake: string[];
  /** The person's first name ("" when not known). */
  readonly owner: string;
  botId: string | null;
  voice: boolean;
  startedAt: number | null;
  noteId: string | null;
  /** The person deleted the meeting's note while the call went on: nothing more is written to it. */
  noteGone = false;
  noteMaking: Promise<string | null> | null = null;

  /** The last lines said, the bot's answers among them, oldest first. */
  readonly lines: Line[] = [];
  /** Lines heard since the room was made, and how many there were at the last notes pass. */
  heard = 0;
  notesAt = 0;
  notesRunning = false;
  notesTimer: ReturnType<typeof setInterval> | null = null;

  /** Lines waiting to be written to the note, and the writes, one after another. */
  readonly buffer: NoteSegment[] = [];
  flushTimer: ReturnType<typeof setTimeout> | null = null;
  flushChain: Promise<void> = Promise.resolve();

  /** Who is in the call now (by participant id, or by name when the id is not known), and everyone who came at all. */
  private readonly present = new Map<string, string>();
  private readonly everyone = new Set<string>();
  peopleDirty = false;
  peopleChain: Promise<void> | null = null;

  /** Someone said only the bot's name: their next line, until `until`, is the question. */
  waitingFor: { who: string; until: number } | null = null;
  readonly queue: Ask[] = [];
  answering = false;
  /** Told to leave (by the person, or in the call): it answers nothing more. */
  leaving = false;
  /** The meeting is over: nothing more is heard, answered or written here. */
  closed = false;

  constructor(m: Meeting, botName: string, owner: string) {
    this.id = m.id;
    this.userId = m.userId;
    this.tokenHash = m.tokenHash;
    this.title = m.title;
    this.botName = botName;
    this.wake = [...new Set([...wakeNames(botName), botName])];
    this.owner = owner;
    this.botId = m.botId;
    this.voice = m.voice;
    this.startedAt = m.startedAt;
    this.noteId = m.noteId;
    for (const name of m.participants) {
      this.present.set(name, name);
      this.everyone.add(name);
    }
  }

  /** A line said (or the bot's answer), kept for answering. */
  hear(line: Line): void {
    this.lines.push(line);
    if (this.lines.length > KEEP_LINES) this.lines.splice(0, this.lines.length - KEEP_LINES);
    this.heard++;
  }

  /** After a restart: the transcript so far is the note's. */
  resume(segs: readonly NoteSegment[]): void {
    for (const s of segs.slice(-KEEP_LINES)) this.lines.push({ who: s.speaker || "Someone", text: s.text, at: s.at });
  }

  /** A line for the note, written with the next batch. */
  keep(seg: NoteSegment): void {
    this.buffer.push(seg);
    if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
  }

  /** Lines that could not be written, put back in front of the ones that came since. */
  putBack(segs: NoteSegment[]): void {
    this.buffer.unshift(...segs);
    if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
  }

  /** When the last line was said, in seconds into the meeting. */
  lastAt(): number {
    return this.lines.length ? this.lines[this.lines.length - 1]!.at : 0;
  }

  /** Who is in the call now, each name once. */
  names(): string[] {
    return [...new Set(this.present.values())];
  }

  /** Everyone who was in the call at some point, each name once. */
  cameNames(): string[] {
    return [...this.everyone];
  }

  /** Someone is in the call (they joined, spoke or wrote): true when the names in the call changed. */
  arrive(p: Person): boolean {
    this.everyone.add(p.name);
    const key = p.id || p.name;
    if (this.present.has(key)) {
      if (this.present.get(key) === p.name) return false;
      const before = this.names().join("\n");
      this.present.set(key, p.name);
      return this.names().join("\n") !== before;
    }
    // Known by name only (kept on the row before a restart): the same person, now with their id.
    if (p.id && this.present.get(p.name) === p.name) {
      this.present.delete(p.name);
      this.present.set(key, p.name);
      return false;
    }
    const had = this.names().includes(p.name);
    this.present.set(key, p.name);
    return !had;
  }

  /** Someone left: true when the names in the call changed. */
  depart(p: Person): boolean {
    const before = this.names().join("\n");
    if (!(p.id && this.present.delete(p.id))) this.present.delete(p.name);
    return this.names().join("\n") !== before;
  }
}
