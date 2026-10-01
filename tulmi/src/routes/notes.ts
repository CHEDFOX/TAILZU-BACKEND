/**
 * NOTES — the desktop's note-taker, server side.
 *
 *   POST   /v1/notes                start a note → { note }
 *   POST   /v1/notes/:id/audio      a stretch of one track, while it records
 *                                   (multipart: audio, track = mic | system,
 *                                   at = seconds from the start) → { kept, words }
 *   POST   /v1/notes/:id/track      one track whole, after it stops, to tell
 *                                   its speakers apart (multipart: audio,
 *                                   track, at) → { speakers }
 *   POST   /v1/notes/:id/finish     stop, and organise (JSON: durationSeconds?)
 *                                   → 202 { note }; the writer runs after
 *   POST   /v1/notes/:id/organise   organise again from the kept transcript
 *   GET    /v1/notes                the list → { notes }
 *   GET    /v1/notes/:id            one note → { note }
 *   DELETE /v1/notes/:id            → { ok }
 *
 * Nothing here is ever typed anywhere: notes are kept, and shown in the app.
 * The words heard count against the same allowance as dictation, a stretch at
 * a time, so running out stops the note where it is and keeps what it has.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AudioFormat, Personality } from "../../../shared/types/api.js";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { appendHeard, diarize, labelSpeakers, type Track, type Utterance } from "../notes/speakers.js";
import { organise } from "../notes/organise.js";
import {
  NotesNeedAccount, createNote, deleteNote, getNote, listNotes, msSinceTouched, updateNote,
} from "../notes/store.js";
import { getPersonality } from "../personality/store.js";
import { estimateDurationSeconds, transcribe } from "../pipeline/stt.js";
import { enforceQuota, recordUsage } from "../usage/metering.js";

export interface NotesRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** The language to hear in: the hint, else the user's own (server.ts). */
  effectiveLanguage: (user: AuthedUser, hint: string | undefined, p?: Personality) => Promise<string>;
}

const FORMATS: AudioFormat[] = ["wav", "m4a", "webm", "mp3", "ogg", "flac"];
const formatOf = (name?: string): AudioFormat | null => {
  const ext = name?.split(".").pop()?.toLowerCase() as AudioFormat | undefined;
  return ext && FORMATS.includes(ext) ? ext : null;
};
const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** How far apart a stretch on each track can start and still be the same
 *  sentence heard twice: about one stretch. */
const ECHO_WINDOW_S = 40;

/** A track's speakers, held between its upload and the finish. In memory:
 *  a restart in between costs the speaker labels, never the note. */
const diarized = new Map<string, { mic?: { at: number; us: Utterance[] }; system?: { at: number; us: Utterance[] }; t: number }>();
const DIARIZED_TTL_MS = 2 * 60 * 60_000;
function sweep(now = Date.now()) {
  for (const [k, v] of diarized) if (now - v.t > DIARIZED_TTL_MS) diarized.delete(k);
}

/** A recording note written to this recently is still being recorded. */
const STILL_RECORDING_MS = 3 * 60_000;
/** An "organising" note this quiet lost its writer (a restart). */
const STUCK_ORGANISING_MS = 10 * 60_000;

/** Background writes still running, by note. Tests await these. */
const work = new Map<string, Promise<void>>();
export function notesWork(id: string): Promise<void> { return work.get(id) ?? Promise.resolve(); }

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof NotesNeedAccount) {
    return reply.code(403).send({ code: "needs_account", message: err.message });
  }
  throw err;
}

/** Speakers in, then the writer. Runs after the finish has answered. */
async function organiseInBackground(user: AuthedUser, id: string): Promise<void> {
  const d = diarized.get(id);
  diarized.delete(id);
  let note = await getNote(user, id);
  if (!note) return;
  if (d && (d.mic?.us.length || d.system?.us.length)) {
    const labelled = labelSpeakers(d.mic?.us ?? null, d.system?.us ?? null, d.mic?.at ?? 0, d.system?.at ?? 0);
    // Only a pass that heard at least half of what the live stretches did
    // replaces them: a track that failed to upload must not erase its words.
    const live = note.transcript.reduce((s, x) => s + countWords(x.text), 0);
    const heard = labelled.reduce((s, x) => s + countWords(x.text), 0);
    if (labelled.length && heard >= live * 0.5) {
      note = (await updateNote(user, id, (n) => ({ ...n, transcript: labelled }))) ?? note;
    }
  }
  const body = await organise(note);
  await updateNote(user, id, (n) => body
    ? { ...n, ...body, status: "ready", organised: true }
    : { ...n, status: n.transcript.length ? "failed" : "ready", organised: false });
}

function startWork(user: AuthedUser, id: string) {
  const job = organiseInBackground(user, id)
    .catch(async () => {
      await updateNote(user, id, (n) => ({ ...n, status: "failed" })).catch(() => {});
    })
    .finally(() => { if (work.get(id) === job) work.delete(id); });
  work.set(id, job);
}

export function registerNotesRoutes(app: FastifyInstance, deps: NotesRouteDeps): void {
  const RL = deps.rateLimit;

  app.post("/v1/notes", { config: RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    try {
      return reply.send({ note: await createNote(user) });
    } catch (err) { return fail(reply, err); }
  });

  // A stretch of one track, while the note records.
  app.post<{ Params: { id: string } }>("/v1/notes/:id/audio", { config: RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    let audio: Buffer | null = null, format: AudioFormat | null = null;
    let track: Track = "mic", at = 0, language: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === "file") { format = formatOf(part.filename) ?? "webm"; audio = await part.toBuffer(); }
      else if (part.fieldname === "track") track = String(part.value) === "system" ? "system" : "mic";
      else if (part.fieldname === "at") at = Math.max(0, Number(part.value) || 0);
      else if (part.fieldname === "language") language = String(part.value);
    }
    if (!audio || !format) return reply.code(400).send({ code: "bad_request", message: "Missing 'audio' file" });
    try {
      const note = await getNote(user, req.params.id);
      if (!note) return reply.code(404).send({ code: "not_found", message: "No such note" });
      if (note.status !== "recording") return reply.code(409).send({ code: "finished", message: "This note has stopped." });
      const quota = await enforceQuota(user);
      if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
      const personality = await getPersonality(user);
      const lang = await deps.effectiveLanguage(user, language, personality);
      const stt = await transcribe({
        audio, format, language: lang,
        vocabulary: personality.vocabulary,
        languages: personality.languages?.map(String),
      });
      const text = stt.text.trim();
      const seconds = stt.durationSeconds || estimateDurationSeconds(audio, format);
      let kept = false;
      await updateNote(user, note.id, (n) => {
        const next = { ...n, durationSeconds: Math.max(n.durationSeconds, at + seconds) };
        if (!text) return next;
        const r = appendHeard(n.transcript, { at, text, track }, ECHO_WINDOW_S);
        kept = r.kept;
        return r.kept ? { ...next, transcript: r.transcript, words: n.words + countWords(text) } : next;
      });
      const words = kept ? countWords(text) : 0;
      // Words count like dictation's; an echo dropped here costs nothing. Time
      // is the microphone's alone: both tracks cover the same minutes.
      await recordUsage({ user, source: "rest", audioSeconds: track === "mic" ? seconds : 0, words, model: "notes" });
      return reply.send({ kept, words });
    } catch (err) { return fail(reply, err); }
  });

  // One track whole, after it stops: its speakers, for the finish.
  app.post<{ Params: { id: string } }>("/v1/notes/:id/track", { config: RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    let audio: Buffer | null = null, format: AudioFormat | null = null;
    let track: Track = "mic", at = 0;
    for await (const part of req.parts()) {
      if (part.type === "file") { format = formatOf(part.filename) ?? "webm"; audio = await part.toBuffer(); }
      else if (part.fieldname === "track") track = String(part.value) === "system" ? "system" : "mic";
      else if (part.fieldname === "at") at = Math.max(0, Number(part.value) || 0);
    }
    if (!audio || !format) return reply.code(400).send({ code: "bad_request", message: "Missing 'audio' file" });
    try {
      const note = await getNote(user, req.params.id);
      if (!note) return reply.code(404).send({ code: "not_found", message: "No such note" });
      sweep();
      const us = await diarize(audio, format);
      if (us) {
        const cur = diarized.get(note.id) ?? { t: Date.now() };
        cur[track] = { at, us };
        cur.t = Date.now();
        diarized.set(note.id, cur);
      }
      return reply.send({ speakers: us ? new Set(us.map((u) => u.speaker)).size : null });
    } catch (err) { return fail(reply, err); }
  });

  const finish = (again: boolean) => async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const body = (req.body ?? {}) as { durationSeconds?: unknown };
    const dur = Number(body.durationSeconds);
    try {
      // Only the request that moves the note to "organising" starts the
      // writer: two finishes at once (a retry, a double press) start one.
      let started = false;
      const note = await updateNote(user, req.params.id, (n) => {
        if (work.has(n.id)) return null;
        const since = msSinceTouched(n.id) ?? Infinity;
        if (!again && n.status !== "recording") return null;
        // Organising again is for a note that stopped without being organised
        // (the app closed, the writer failed, a restart cut it off) — not one
        // still being recorded, and not one being organised right now.
        if (again && n.status === "recording" && since < STILL_RECORDING_MS) return null;
        if (again && n.status === "organising" && since < STUCK_ORGANISING_MS) return null;
        if (again && n.status === "ready" && n.organised) return null;
        started = true;
        return {
          ...n,
          status: "organising",
          endedAt: n.endedAt ?? new Date().toISOString(),
          durationSeconds: Number.isFinite(dur) && dur > 0 ? Math.max(n.durationSeconds, dur) : n.durationSeconds,
        };
      });
      if (!note) return reply.code(404).send({ code: "not_found", message: "No such note" });
      if (started) startWork(user, note.id);
      return reply.code(202).send({ note: { ...note, transcript: [] } });
    } catch (err) { return fail(reply, err); }
  };
  app.post<{ Params: { id: string } }>("/v1/notes/:id/finish", { config: RL }, finish(false));
  app.post<{ Params: { id: string } }>("/v1/notes/:id/organise", { config: RL }, finish(true));

  app.get<{ Querystring: { limit?: string } }>("/v1/notes", { config: RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      return reply.send({ notes: await listNotes(user, Number(req.query.limit) || 100) });
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/notes/:id", { config: RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      const note = await getNote(user, req.params.id);
      return note ? reply.send({ note }) : reply.code(404).send({ code: "not_found", message: "No such note" });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/notes/:id", { config: RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      return (await deleteNote(user, req.params.id))
        ? reply.send({ ok: true })
        : reply.code(404).send({ code: "not_found", message: "No such note" });
    } catch (err) { return fail(reply, err); }
  });
}

/** For tests: forget held speaker passes. */
export function resetNotesRoutesForTests(): void { diarized.clear(); work.clear(); }
