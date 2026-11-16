/**
 * THE BOT IN OUR OWN CALLS, PUT TOGETHER (src/rooms, docs/brief.md).
 *
 * `scribe.ts` says what it does; this is where its parts come from — the ears at the SFU, the speech service, the note, the
 * document's writer, the answer it gives when asked — and the one switch that decides whether it sits in a call at all.
 *
 * Everything it does is the owner's: their note, their meter, their AI permission (privacy/aiGate.ts asPerson). It is put
 * together once, when the first call needs it.
 */

import type { NoteSegment } from "../../../shared/types/api.js";
import { briefWriter, briefOn, type Line } from "../brief/role.js";
import { getConfig } from "../config.js";
import { answerPrompt, jsonOf } from "../meet/brain.js";
import { complete } from "../pipeline/writing/model.js";
import { organiseNote } from "../notes/finish.js";
import { createNote, getNote, updateNote } from "../notes/store.js";
import { getPersonality } from "../personality/store.js";
import { transcribe } from "../pipeline/stt.js";
import { asPerson } from "../privacy/aiGate.js";
import { chargedTo } from "../usage/cost.js";
import { recordUsage } from "../usage/metering.js";
import { livePublish } from "../live/writes.js";
import { Ears } from "./ears.js";
import { Scribe, SCRIBE_NAME } from "./scribe.js";
import { readAloud, Speaker } from "./speaker.js";
import type { RoomStore } from "./store.js";
import { roomTopic } from "../live/topics.js";
import { sfu as makeSfu, sfuKeys, type Sfu } from "./sfu.js";

/** Where the SFU dials to take the bot's own voice from us. */
export function voiceEndpoint(token: string): string {
  return earsEndpoint(token).replace("/v1/rooms/ears/", "/v1/rooms/voice/");
}

/** Where the SFU dials to send us one person's sound. Public, wss, and carrying that listener's own token. */
export function earsEndpoint(token: string): string {
  const origin = (process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, "");
  const ws = origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${ws}/v1/rooms/ears/${token}`;
}

/**
 * Whether the bot sits in calls on this server: the brief is on, the SFU is set up, and we have a public address for the
 * SFU to dial. Without the last one nothing could hear a call, so nothing pretends to.
 */
export function sitsIn(): boolean {
  if (!briefOn() || !sfuKeys()) return false;
  return /^wss:\/\//.test(earsEndpoint("x"));
}

let shared: { scribe: Scribe; ears: Ears; speaker: Speaker } | null | undefined;

/** The server's own, made once. Null when it does not sit in calls here. */
export function sitIn(store: RoomStore, client?: Sfu | null): { scribe: Scribe; ears: Ears; speaker: Speaker } | null {
  if (shared !== undefined) return shared;
  const sfu = client ?? (sfuKeys() ? makeSfu() : null);
  if (!sfu || !sitsIn()) { shared = null; return null; }

  const ears = new Ears({
    sfu,
    endpoint: earsEndpoint,
    token: () => crypto.randomUUID().replace(/-/g, ""),
    now: Date.now,
    // Written down as the person, on their meter, by the same speech service everything else uses.
    async listen(audio, format, o) {
      const out = await transcribe({ audio, format, ...(o.language ? { language: o.language } : {}) });
      return { text: out.text ?? "", ...(out.durationSeconds ? { durationSeconds: out.durationSeconds } : {}) };
    },
    heard: (noteId, userId, seg, seconds) => heard(noteId, userId, seg, seconds),
    // Every line also reaches the bot, which answers the ones that call it by name.
    line: (roomId, line) => { void shared?.scribe.overheard(roomId, line); },
  });

  // Its voice: a seat of its own at the SFU, the words read aloud and let out a frame at a time (rooms/speaker.ts).
  const speaker = new Speaker({ sfu, store, endpoint: voiceEndpoint, read: (text) => readAloud(text), now: Date.now });

  const scribe = new Scribe({
    ears,
    store,
    brief: briefWriter(),
    voice: {
      join: (roomId) => speaker.join(roomId),
      say: (roomId, text) => speaker.say(roomId, text),
      hush: (roomId) => speaker.hush(roomId),
      leave: (roomId) => speaker.leave(roomId),
    },
    async startNote(userId, title) {
      const note = await createNote({ id: userId });
      await updateNote({ id: userId }, note.id, (n) => ({ ...n, title: title.slice(0, 120) }));
      return note.id;
    },
    heard,
    async lines(noteId, userId) {
      const note = await getNote({ id: userId }, noteId);
      return (note?.transcript ?? []).map((s) => ({ who: s.speaker ?? "Someone", text: s.text, at: s.at }));
    },
    async organise(userId, noteId) {
      await asPerson(userId, () => chargedTo(userId, "rooms", () => organiseNote({ id: userId }, noteId)));
    },
    async answer(o) {
      // The meeting bot's own answering prompt (meet/brain.ts): it knows this call and nothing private of the owner's.
      const p = answerPrompt({
        who: o.who, asked: o.asked, how: "chat", botName: o.botName, owner: o.owner,
        title: o.title, participants: [...new Set(o.lines.map((l) => l.who).filter(Boolean))], lines: o.lines as Line[],
      });
      const res = await asPerson(o.owner ? o.owner : "", () => complete({
        model: getConfig().MEET_MODEL, max_tokens: 320, temperature: 0.3,
        messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }],
      } as never)) as { choices?: Array<{ message?: { content?: string } }> };
      const j = jsonOf(res.choices?.[0]?.message?.content ?? "");
      const reply = typeof j?.reply === "string" ? j.reply : "";
      return reply.slice(0, 450);
    },
    changed: (roomId) => { try { livePublish("", [roomTopic(roomId)]); } catch { /* a screen will poll anyway */ } },
    now: Date.now,
  });

  shared = { scribe, ears, speaker };
  return shared;
}

/** The ears, once something has built them (the room service does, when it is first asked for). */
export function earsNow(): Ears | null { return shared?.ears ?? null; }

/** The voice, the same way: the socket route hands the SFU's connection to it. */
export function speakerNow(): Speaker | null { return shared?.speaker ?? null; }

/** For the tests: the next call to sitIn() builds it again. */
export function forgetSitIn(): void { shared = undefined; }

/** One stretch of a call, in the note, under the name of whoever said it, and on their meter. */
async function heard(noteId: string, userId: string, seg: NoteSegment, seconds: number): Promise<void> {
  const user = { id: userId };
  const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
  await updateNote(user, noteId, (n) => ({
    ...n,
    durationSeconds: Math.max(n.durationSeconds, seg.at + seconds),
    transcript: [...n.transcript, seg].sort((a, b) => a.at - b.at),
    words: n.words + words,
  }));
  await recordUsage({ user, source: "rest", audioSeconds: seconds, sttSeconds: seconds, words, model: "rooms" }).catch(() => undefined);
}

export { SCRIBE_NAME };

/** The personality's languages, for a call in a language that is not English. Read once a call by the ears. */
export async function callLanguage(userId: string): Promise<string | undefined> {
  try {
    const p = await getPersonality({ id: userId });
    const first = p.languages?.[0];
    return typeof first === "string" && first && first !== "auto" ? first : undefined;
  } catch { return undefined; }
}
