/**
 * NOTES IN NUMBERS: the week's meetings, the hours in them, the people met, and the to-dos still open.
 *
 * From the list (store.ts listNotes: summaries, the to-dos counted), so the Notes page, Home's Notes tile and
 * GET /v1/notes/stats all count the same way. "This week" is the last seven days, as the Notes page groups them.
 * People met: the people the notes could name, each once; a voice nobody named is not counted as someone met.
 */
import type { NoteSummary } from "../../../shared/types/api.js";

export interface NotesStats {
  week: { meetings: number; seconds: number; people: number };
  /** To-dos not yet ticked off, in every meeting. */
  openTodos: number;
  /** A meeting being noted right now. */
  recording: boolean;
  /** Meetings being written up right now. */
  organising: number;
}

export const WEEK_MS = 7 * 86_400_000;

export function notesStats(notes: readonly NoteSummary[], now = Date.now()): NotesStats {
  const since = now - WEEK_MS;
  const week = notes.filter((n) => Date.parse(n.startedAt) >= since);
  const people = new Set<string>();
  for (const n of week) for (const p of n.people) if (p.name?.trim() && p.label !== "You") people.add(p.name.trim().toLowerCase());
  return {
    week: { meetings: week.length, seconds: Math.round(week.reduce((s, n) => s + (n.durationSeconds || 0), 0)), people: people.size },
    openTodos: notes.reduce((s, n) => s + (n.openTodos ?? 0), 0),
    recording: notes.some((n) => n.status === "recording"),
    organising: notes.filter((n) => n.status === "organising").length,
  };
}
