/**
 * ORGANISING A FINISHED NOTE: THE ONE STEP EVERY NOTE-TAKER ENDS WITH. The desktop's notes (routes/notes.ts, after its speakers are
 * told apart) and the meeting bot's (meet/service.ts, when the call ends) both finish here.
 *
 *   organiseNote(user, id)   the transcript is final: its to-dos and decisions are read (notes/extract.ts) beside the writer
 *                            (notes/organise.ts); the note is "ready" with its title, summary and highlights, or "failed" when the writer
 *                            could not produce them (the transcript is kept either way, and it can be organised again). Whoever wants to
 *                            know that a note is ready is told (notes/ready.ts). Answers the note as it ends up, or null when it is gone.
 *
 * The note waits for its to-dos at most FIND_WAIT_MS, so "your notes are ready" has them; a slower read lands when it comes. The caller
 * decides whose meter it goes on and whose consent it runs under (usage/cost.ts chargedTo, privacy/aiGate.ts asPerson).
 */
import type { Note } from "../../../shared/types/api.js";
import type { AuthedUser } from "../auth/supabase.js";
import { findOnce } from "./extract.js";
import { organise } from "./organise.js";
import { noteReady } from "./ready.js";
import { getNote, updateNote } from "./store.js";

/** The longest a written-up note waits for its to-dos before it is ready without them (they land when they come). */
export const FIND_WAIT_MS = 60_000;

export async function organiseNote(user: AuthedUser, id: string): Promise<Note | null> {
  const note = await getNote(user, id);
  if (!note) return null;
  // The transcript is final now: its to-dos and decisions are read beside the writer (notes/extract.ts), once. The
  // note is ready when both are, so "your notes are ready" has its to-dos; a read slower than FIND_WAIT_MS lands after.
  const finding = findOnce(user, id);
  const body = await organise(note);
  await Promise.race([finding, new Promise((r) => setTimeout(r, FIND_WAIT_MS).unref?.())]);
  await updateNote(user, id, (n) => body
    ? { ...n, ...body, status: "ready", organised: true }
    : { ...n, status: n.transcript.length ? "failed" : "ready", organised: false });
  await finding;
  // Ready, with its to-dos: Plan Ease may turn the named ones into one card (notes/ready.ts). Never holds the note up.
  const ready = await getNote(user, id).catch(() => null);
  if (ready && ready.status === "ready") noteReady(user.id, ready);
  return ready;
}
