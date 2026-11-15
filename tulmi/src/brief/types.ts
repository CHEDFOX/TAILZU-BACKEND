/**
 * THE BRIEF: THE DOCUMENT THE BOT MAKES WHILE A MEETING RUNS (docs/brief.md).
 *
 * A meeting used to leave a note behind: a transcript, a summary, to-dos. That is what was SAID. The brief is what the meeting
 * was ABOUT — written as it happens, by the one participant who is paying attention to all of it at once:
 *
 *   the overview     what this meeting is, who is in it, where it has got to
 *   the pictures     the flow they described, drawn; the thing they compared, as a table; the numbers, as a chart
 *   what was said    the points and the decisions, which is the note's part of it
 *   who does what    the to-dos, with names on them
 *   still open       the questions nobody answered
 *
 * It is made of the same building blocks a bot already draws under its words (`src/show/`, docs/show.md): text, callout, list,
 * facts, table, stat, steps, chart, progress, draw, image, link, and the boxes that hold them. So "illustrations, stats and
 * sheets" need nothing new in the phone or the window — they are drawn today, as monochrome dot art, by whatever shows the
 * brief. A block the checker will not take is not drawn at all (`show/check.ts`).
 *
 * ONE BRIEF, TWO KINDS OF MEETING. A meeting the bot joined through Recall (docs/meet.md: Meet, Zoom, Teams, Webex) and one of
 * our own calls (docs/rooms.md) differ only in how the words reach us. Everything here is fed lines and gives back a document,
 * so both get the same thing and neither knows about the other.
 *
 * HOW IT GROWS: in edits, never in rewrites. Every pass the model is shown the brief as it stands and the lines since the last
 * pass, and answers with the parts to put in or replace, by id. A part nobody touched stays exactly as it was — so the thing
 * people are reading does not shuffle under them, and a pass costs one short answer rather than the whole document.
 */

import type { Block } from "../show/types.js";

/** What a part of the brief is for. The model picks one; the order below is the order they are drawn in. */
export const PART_KINDS = ["overview", "picture", "numbers", "said", "decisions", "todos", "open", "other"] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** Where each kind sits in the document, whatever order the parts arrived in. */
export const PART_ORDER: Record<PartKind, number> = {
  overview: 0, picture: 1, numbers: 2, said: 3, decisions: 4, todos: 5, open: 6, other: 7,
};

/** One part of the brief: a heading and the blocks under it, replaced whole when it changes. */
export interface BriefPart {
  /** The model's own name for it ("flow", "pricing"), so it can come back and change that one part. */
  id: string;
  kind: PartKind;
  title: string;
  blocks: Block[];
  /** When this part was last written. */
  at: number;
  /** The pass that wrote it, so a client can tell what is new since it last looked. */
  v: number;
}

/** The document, as it stands. */
export interface Brief {
  /** Up one on every pass that changed something. */
  v: number;
  parts: BriefPart[];
  /** When it last changed. */
  at: number;
}

/**
 * What one pass may do. `say` is the one line the bot puts in the meeting's chat when, and only when, something it just wrote
 * is worth telling them about ("I've drawn the flow you described"). Most passes say nothing.
 */
export interface BriefEdit {
  parts?: Array<{ id?: unknown; kind?: unknown; title?: unknown; blocks?: unknown }>;
  remove?: unknown;
  say?: unknown;
}

/** What the limits are, so a meeting that runs for three hours still has a document a person can read. */
export const BRIEF_LIMITS = {
  /** Parts in the whole document. The oldest "other" goes first when it is full. */
  parts: 14,
  /** Parts one pass may write. */
  perPass: 4,
  /** An id's length, and what it may be made of. */
  id: 40,
  title: 80,
  /** A line to the meeting's chat. Google Meet's chat takes 500. */
  say: 450,
  /** Lines of transcript one pass reads. */
  lines: 220,
} as const;

/** The empty document a meeting starts with. */
export const emptyBrief = (): Brief => ({ v: 0, parts: [], at: 0 });

/** Whether there is anything to show a person yet. */
export const briefHasAnything = (b: Brief | null | undefined): boolean => !!b && b.parts.some((p) => p.blocks.length > 0);
