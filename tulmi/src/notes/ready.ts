/**
 * WHEN A MEETING'S NOTES ARE READY (routes/notes.ts, after its to-dos are found): whoever wants to know is told, once a note.
 *
 *   onNoteReady(fn)        Plan Ease's capture (botsBots/planInWire.ts): the note's to-dos with a real name and a day become one card
 *   noteReady(user, note)  the notes route, when organising is done; never throws, never waits for the listener
 *
 * Kept apart so the notes route needs nothing of Plan Ease, and a note is ready the same way with Plan Ease off.
 */
import type { Note } from "../../../shared/types/api.js";

type Listener = (userId: string, note: Note) => Promise<unknown>;
let listener: Listener | null = null;

export function onNoteReady(fn: Listener | null): void { listener = fn; }

export function noteReady(userId: string, note: Note): void {
  if (!listener) return;
  try { void listener(userId, note).catch(() => undefined); } catch { /* a listener's failure is never the note's */ }
}
