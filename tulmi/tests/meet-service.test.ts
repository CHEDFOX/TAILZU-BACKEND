/**
 * THE MEETING BOT'S ENGINE (meet/service.ts, meet/room.ts): a join checks the link, the person's OK for AI and the day's minutes, and asks
 * Recall for a bot with its own live address, the stage only when it speaks, and its introduction; Recall's status moves the meeting along
 * (one push while it waits to be let in, the note made in the call, organised and pushed when it ends, a push saying why when it fails);
 * the live transcript reaches the note in batches with its speakers; a question said by name (or its name, then the question) is answered
 * from the transcript, out loud through the stage when it is open and its voice is on, in the chat otherwise; a chat message to the bot is
 * answered in the chat and kept out of the note; "stop", "leave" and talking over it are obeyed at once; the notes so far are written as the
 * call goes; a restart rebuilds a meeting from its row and its note; a calendar meeting is scheduled once and can be called off; and nobody
 * reads or changes a meeting that is not theirs.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Answer, Brain, Question } from "../src/meet/brain.js";
import type { MeetPeople } from "../src/meet/people.js";
import type { BotInput, RecallClient } from "../src/meet/recall.js";
import type { Meeting } from "../src/meet/store.js";
import type { ClipInput, StageHub } from "../src/meet/types.js";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { MeetService, MeetError, hashToken } = await import("../src/meet/service.js");
const { MemoryMeetStore } = await import("../src/meet/store.js");
const { RecallError } = await import("../src/meet/recall.js");
const { getNote, updateNote, resetNotesForTests } = await import("../src/notes/store.js");
const { AI_CONSENT_TEXT } = await import("../src/privacy/aiGate.js");

type Service = InstanceType<typeof MeetService>;
type Deps = ConstructorParameters<typeof MeetService>[0];

const USER = "user-1";
const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
const MIN = 60_000;
const MEET = "https://meet.google.com/abc-defg-hij";
const ASHA = { id: 100, name: "Asha" };
const RAVI = { id: 200, name: "Ravi" };
const REPLY = "Ravi said the budget is fine at forty thousand.";
const INTRO = 'Hi, I\'m X0 Bot, taking notes for Aanya. Say "X0 Bot" or message me here to ask me something. Say "X0 Bot, leave" to send me away.';

beforeEach(() => { resetNotesForTests(); });

function rig(o: {
  connected?: boolean; recall?: boolean; ai?: boolean; flushMs?: number; notesEveryMs?: number; owner?: string;
  /** Each person's first name, and whether each said yes to AI (in a space, the admin and the member are two people). */
  names?: Record<string, string>; aiFor?: (userId: string) => boolean; people?: MeetPeople;
} = {}) {
  const clock = { t: T0 };
  const store = new MemoryMeetStore();
  const calls = { create: [] as BotInput[], deleted: [] as string[], left: [] as string[], chat: [] as Array<{ bot: string; message: string }> };
  let bots = 0;
  const rc = {
    create: async (_i: BotInput): Promise<{ id: string }> => ({ id: `bot-${++bots}` }),
    deleteAnswer: true as boolean | Error,
  };
  const recall: RecallClient = {
    async createBot(i) { calls.create.push(i); return rc.create(i); },
    async deleteBot(id) { calls.deleted.push(id); if (rc.deleteAnswer instanceof Error) throw rc.deleteAnswer; return rc.deleteAnswer; },
    async leaveCall(id) { calls.left.push(id); },
    async sendChat(id, message) { calls.chat.push({ bot: id, message }); },
    async getBot(id) { return { id }; },
  };
  const st = { connected: o.connected ?? true, speaking: false, plays: [] as ClipInput[], stops: 0, states: [] as string[], closed: [] as string[] };
  const stage: StageHub = {
    connected: () => st.connected,
    async play(_id, clip) { st.plays.push(clip); return "played"; },
    speaking: () => st.speaking,
    stop() { st.stops++; },
    state(_id, label) { st.states.push(label); },
    open: () => () => undefined,
    clip: () => null,
    done() { /* the routes' */ },
    close(id) { st.closed.push(id); },
  };
  const asked: Question[] = [];
  const noted: Array<{ lines: number; title: string }> = [];
  const br = { reply: { intent: "answer", reply: REPLY } as Answer, fail: false, hold: null as Promise<void> | null };
  const brain: Brain = {
    async answer(q) {
      asked.push(q);
      if (br.hold) await br.hold;
      if (br.fail) throw new Error("the model is down");
      return br.reply;
    },
    async liveNotes(lines, title) {
      noted.push({ lines: lines.length, title });
      return { points: ["The budget stays at forty thousand"], actions: [{ who: "Ravi", what: "Send the deck" }] };
    },
  };
  const spoken: string[] = [];
  const pushes: Array<{ userId: string; kind: string; key: string; vars: Record<string, string>; data: Record<string, string> }> = [];
  const organised: string[] = [];
  const deps: Deps = {
    store, recall: o.recall === false ? null : recall, brain, stage,
    tts: async (text) => { spoken.push(text); return { audio: Buffer.from("mp3 bytes"), contentType: "audio/mpeg" }; },
    notify: async (userId, msg) => { pushes.push({ userId, ...msg }); },
    ownerName: async (userId) => o.names?.[userId] ?? o.owner ?? "Aanya",
    origin: "https://api.test/",
    now: () => clock.t,
    aiAllowed: async (userId) => (o.aiFor ? o.aiFor(userId) : o.ai ?? true),
    organise: async (userId, noteId) => {
      organised.push(noteId);
      return updateNote({ id: userId }, noteId, (n) => ({ ...n, status: "ready", organised: true, title: "Budget review", summary: "They kept the budget." }));
    },
    flushMs: o.flushMs ?? 60_000,
    notesEveryMs: o.notesEveryMs ?? 3_600_000,
    ...(o.people ? { people: o.people } : {}),
  };
  const svc = new MeetService(deps);
  return { svc, again: () => new MeetService(deps), deps, store, calls, rc, st, asked, noted, br, spoken, pushes, organised, clock };
}
type Rig = ReturnType<typeof rig>;

/** A meeting row as the store keeps it. */
const row = (o: Partial<Meeting> = {}): Meeting => ({
  id: randomUUID(), userId: USER, botId: null, tokenHash: randomUUID(), url: "https://meet.google.com/xyz-abcd-xyz", platform: "google_meet",
  title: "Earlier", status: "done", voice: false, source: "link", eventKey: null, joinAt: null, startedAt: null, endedAt: null, noteId: null,
  liveNotes: null, participants: [], error: null, createdAt: T0, updatedAt: T0, spaceId: null, byId: null, ...o,
});

const tokenOf = (i: BotInput): string => /\/v1\/meet\/live\/([A-Za-z0-9_-]+)\/$/.exec(i.liveUrl)![1]!;

/** Recall's status webhook. */
const status = (event: string, botId: string, meeting?: string, subCode?: string) => ({
  event,
  data: {
    data: { code: event.replace(/^bot\./, ""), sub_code: subCode ?? null, updated_at: new Date(T0).toISOString() },
    bot: { id: botId, metadata: meeting ? { meeting } : {} },
  },
});

let clockS = 0;
/** One line of the live transcript, a word at a time as Recall sends it. */
const line = (who: { id: number; name: string }, said: string, at = (clockS += 4)) => ({
  event: "transcript.data",
  data: {
    data: {
      words: said.split(" ").map((w, i) => ({ text: w, start_timestamp: { relative: at + i * 0.3 }, end_timestamp: { relative: at + i * 0.3 + 0.2 } })),
      participant: { id: who.id, name: who.name, is_host: who.id === ASHA.id, platform: "desktop", extra_data: {} },
    },
    bot: { id: "bot-1", metadata: {} },
  },
});
const chat = (who: { id: number; name: string }, text: string, to = "everyone") => ({
  event: "participant_events.chat_message",
  data: { data: { participant: { id: who.id, name: who.name }, timestamp: { absolute: new Date(T0).toISOString(), relative: 61 }, data: { text, to } }, bot: { id: "bot-1" } },
});
const presence = (kind: "join" | "leave", who: { id: number; name: string }) => ({
  event: `participant_events.${kind}`,
  data: { data: { participant: { id: who.id, name: who.name, is_host: false }, timestamp: { relative: 1 }, data: null }, bot: { id: "bot-1" } },
});

/** A meeting joined from a link, its bot in the call. */
async function inCall(r: Rig, o: { voice?: boolean; url?: string } = {}) {
  const view = await r.svc.join(USER, { url: o.url ?? MEET, title: "Budget review", ...(o.voice !== undefined ? { voice: o.voice } : {}) });
  await r.svc.idle();
  const token = tokenOf(r.calls.create.at(-1)!);
  const botId = (await r.store.get(view.id))!.botId!;
  await r.svc.onStatus(status("bot.in_call_recording", botId, view.id));
  const noteId = (await r.store.get(view.id))!.noteId!;
  return { id: view.id, token, botId, noteId };
}

const transcriptOf = async (noteId: string) => (await getNote({ id: USER }, noteId))?.transcript ?? [];

describe("joining a call", () => {
  it("is refused without Recall, for a link that is not a meeting, and without the person's OK for AI", async () => {
    await expect(rig({ recall: false }).svc.join(USER, { url: MEET })).rejects.toMatchObject({ status: 503, code: "meet_off" });
    const bad = rig().svc.join(USER, { url: "https://example.com/abc-defg-hij" });
    await expect(bad).rejects.toBeInstanceOf(MeetError);
    await expect(bad).rejects.toMatchObject({ status: 400, code: "bad_link", message: "That isn't a meeting link (Google Meet, Zoom, Teams or Webex)." });
    await expect(rig({ ai: false }).svc.join(USER, { url: MEET })).rejects.toMatchObject({ status: 403, code: "ai_consent_needed", message: AI_CONSENT_TEXT });
  });

  it("stops at the day's minutes, counted over the last 24 hours", async () => {
    const old = rig();
    await old.store.add(row({ startedAt: T0 - 29 * 60 * MIN, endedAt: T0 - 25 * 60 * MIN }));
    await expect(old.svc.join(USER, { url: MEET })).resolves.toMatchObject({ status: "joining" });

    const full = rig();
    await full.store.add(row({ startedAt: T0 - 5 * 60 * MIN, endedAt: T0 - 60 * MIN }));
    await expect(full.svc.join(USER, { url: MEET })).rejects.toMatchObject({
      status: 429, code: "meet_cap", message: "Today's meeting time is used up. It comes back over the next day.",
    });
    expect((await full.svc.overview(USER)).minutesToday).toBe(240);
    expect(full.calls.create).toHaveLength(0);
  });

  it("asks Recall for a bot with its own live address (trailing slash), the stage only when it speaks, and its introduction", async () => {
    const r = rig();
    const view = await r.svc.join(USER, { url: MEET, title: " Budget review ", voice: true });
    expect(view).toMatchObject({ status: "joining", source: "link", platform: "google_meet", url: MEET, title: "Budget review", voice: true, noteId: null });
    expect(Object.keys(view)).not.toContain("botId");
    expect(Object.keys(view)).not.toContain("tokenHash");
    await r.svc.idle();
    const sent = r.calls.create[0]!;
    expect(sent.liveUrl).toMatch(/^https:\/\/api\.test\/v1\/meet\/live\/[A-Za-z0-9_-]{32}\/$/);
    const token = tokenOf(sent);
    expect(sent).toMatchObject({
      meetingUrl: MEET, botName: "X0 Bot", metadata: { meeting: view.id }, stageUrl: `https://api.test/v1/meet/stage/${token}`,
      variant: "web_4_core", language: "en", intro: INTRO,
    });
    expect(sent.joinAt).toBeUndefined();
    const kept = (await r.store.get(view.id))!;
    // Only the token's hash is kept, and Recall's bot id once it answers.
    expect(kept.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(kept)).not.toContain(token);
    expect(kept.botId).toBe("bot-1");

    const quiet = rig({ owner: "" });
    await quiet.svc.saveSettings(USER, { botName: "Nova", voice: false });
    await quiet.svc.join(USER, { url: MEET });
    await quiet.svc.idle();
    expect(quiet.calls.create[0]!.stageUrl).toBeUndefined();
    expect(quiet.calls.create[0]!.botName).toBe("Nova");
    expect(quiet.calls.create[0]!.intro).toBe('Hi, I\'m Nova, taking notes for this call. Say "Nova" or message me here to ask me something. Say "Nova, leave" to send me away.');
  });

  it("answers the bot already in that call when the link is pasted again", async () => {
    const r = rig();
    const a = await r.svc.join(USER, { url: MEET });
    const b = await r.svc.join(USER, { url: `${MEET}#again` });
    expect(b.id).toBe(a.id);
    await r.svc.idle();
    expect(r.calls.create).toHaveLength(1);
  });

  it("is 'failed', with Recall's words, when no bot can be sent", async () => {
    const r = rig();
    r.rc.create = async () => { throw new RecallError(502, "The meeting service couldn't do that just now."); };
    const view = await r.svc.join(USER, { url: MEET });
    expect(view.status).toBe("joining");
    await r.svc.idle();
    expect(await r.store.get(view.id)).toMatchObject({ status: "failed", error: "The meeting service couldn't do that just now." });
  });

  it("calls off a bot that comes after the person already left", async () => {
    const r = rig();
    let answer!: (bot: { id: string }) => void;
    r.rc.create = () => new Promise((res) => { answer = res; });
    const view = await r.svc.join(USER, { url: MEET });
    expect((await r.svc.leave(USER, view.id)).status).toBe("cancelled");
    answer({ id: "late-bot" });
    await r.svc.idle();
    expect(r.calls.deleted).toEqual(["late-bot"]);
  });
});

describe("Recall's status", () => {
  it("moves a meeting from joining to waiting (one push), into the call (the note made), and over (organised, a push to the note)", async () => {
    const r = rig();
    const view = await r.svc.join(USER, { url: MEET, title: "Budget review" });
    await r.svc.idle();
    await r.svc.onStatus(status("bot.joining_call", "bot-1", view.id));
    expect((await r.store.get(view.id))!.status).toBe("joining");

    await r.svc.onStatus(status("bot.in_waiting_room", "bot-1", view.id));
    await r.svc.onStatus(status("bot.in_waiting_room", "bot-1", view.id));
    expect((await r.store.get(view.id))!.status).toBe("waiting");
    expect(r.pushes).toEqual([{ userId: USER, kind: "meet_waiting", key: `${view.id}:waiting`, vars: { title: "Budget review", name: "X0 Bot" }, data: { m: view.id } }]);

    r.clock.t = T0 + MIN;
    await r.svc.onStatus(status("bot.in_call_recording", "bot-1", view.id));
    const live = (await r.store.get(view.id))!;
    expect(live).toMatchObject({ status: "in_call", startedAt: T0 + MIN });
    expect(live.noteId).toBeTruthy();
    expect(await getNote({ id: USER }, live.noteId!)).toMatchObject({ status: "recording", title: "Budget review", transcript: [] });

    const token = tokenOf(r.calls.create[0]!);
    await r.svc.onLive(token, line(ASHA, "We keep the budget at forty thousand"));
    await r.svc.onLive(token, line(RAVI, "Agreed, I will send the deck tomorrow"));
    r.clock.t = T0 + 31 * MIN;
    await r.svc.onStatus(status("bot.call_ended", "bot-1", view.id));
    await r.svc.idle();

    const over = (await r.store.get(view.id))!;
    expect(over).toMatchObject({ status: "done", endedAt: T0 + 31 * MIN, participants: ["Asha", "Ravi"] });
    const note = (await getNote({ id: USER }, live.noteId!))!;
    expect(note).toMatchObject({ status: "ready", title: "Budget review", durationSeconds: 30 * 60, endedAt: new Date(T0 + 31 * MIN).toISOString() });
    expect(note.transcript.map((s) => [s.speaker, s.text])).toEqual([
      ["Asha", "We keep the budget at forty thousand"],
      ["Ravi", "Agreed, I will send the deck tomorrow"],
    ]);
    expect(r.pushes.at(-1)).toEqual({ userId: USER, kind: "meet_ready", key: `${view.id}:ready`, vars: { title: "Budget review" }, data: { id: live.noteId } });
    expect(r.st.closed).toContain(view.id);

    // Recall's "done" after "call ended": nothing happens twice.
    await r.svc.onStatus(status("bot.done", "bot-1", view.id));
    await r.svc.idle();
    expect(r.organised).toEqual([live.noteId]);
    expect(r.pushes.filter((p) => p.kind === "meet_ready")).toHaveLength(1);
  });

  it("keeps no note, and sends no push, when nobody said anything", async () => {
    const r = rig();
    const { id, botId, noteId } = await inCall(r);
    await r.svc.onStatus(status("bot.call_ended", botId, id));
    await r.svc.idle();
    expect(await r.store.get(id)).toMatchObject({ status: "done", noteId: null });
    expect(await getNote({ id: USER }, noteId)).toBeNull();
    expect(r.organised).toEqual([]);
    expect(r.pushes).toEqual([]);
  });

  it("fails a meeting with why, in a few words, and pushes it", async () => {
    const r = rig();
    const view = await r.svc.join(USER, { url: MEET, title: "Budget review" });
    await r.svc.idle();
    await r.svc.onStatus(status("bot.fatal", "bot-1", view.id, "timeout_exceeded_waiting_room"));
    expect(await r.store.get(view.id)).toMatchObject({ status: "failed", error: "Nobody let it in." });
    expect(r.pushes).toEqual([{
      userId: USER, kind: "meet_failed", key: `${view.id}:failed`, vars: { title: "Budget review", name: "X0 Bot", why: "Nobody let it in." }, data: { m: view.id },
    }]);

    for (const [sub, why] of [
      ["meeting_not_found", "The meeting link didn't work."],
      ["bot_kicked_from_call", "It was removed from the call."],
      ["zoom_internal_error", "It couldn't join the meeting."],
    ] as const) {
      const m = row({ status: "joining", botId: `b-${sub}` });
      await r.store.add(m);
      await r.svc.onStatus(status("bot.fatal", `b-${sub}`, undefined, sub));
      expect((await r.store.get(m.id))!.error).toBe(why);
    }
  });

  it("fails a call that ended before the bot was let in, unless the person sent it away", async () => {
    const r = rig();
    const view = await r.svc.join(USER, { url: MEET, title: "Budget review" });
    await r.svc.idle();
    await r.svc.onStatus(status("bot.in_waiting_room", "bot-1", view.id));
    await r.svc.onStatus(status("bot.call_ended", "bot-1", view.id, "timeout_exceeded_waiting_room"));
    await r.svc.idle();
    expect(await r.store.get(view.id)).toMatchObject({ status: "failed", error: "Nobody let it in." });
    expect(r.pushes.map((p) => [p.kind, p.vars.why])).toEqual([["meet_waiting", undefined], ["meet_failed", "Nobody let it in."]]);

    const sent = rig();
    const away = await sent.svc.join(USER, { url: MEET });
    await sent.svc.idle();
    await sent.svc.leave(USER, away.id);
    await sent.svc.onStatus(status("bot.call_ended", "bot-1", away.id, "bot_received_leave_call"));
    await sent.svc.idle();
    expect((await sent.store.get(away.id))!.status).toBe("done");
    expect(sent.pushes).toEqual([]);
  });

  it("calls off a bot that turns up for a meeting already called off", async () => {
    const r = rig();
    const m = row({ status: "cancelled", botId: "bot-stray" });
    await r.store.add(m);
    r.rc.deleteAnswer = false;
    await r.svc.onStatus(status("bot.joining_call", "bot-stray", m.id));
    expect(r.calls.deleted).toEqual(["bot-stray"]);
    expect(r.calls.left).toEqual(["bot-stray"]);
    expect((await r.store.get(m.id))!.status).toBe("cancelled");
  });

  it("still organises what was heard when the bot is put out of the call", async () => {
    const r = rig();
    const { id, token, botId, noteId } = await inCall(r);
    await r.svc.onLive(token, line(ASHA, "We keep the budget at forty thousand"));
    await r.svc.onStatus(status("bot.fatal", botId, id, "bot_kicked_from_call"));
    await r.svc.idle();
    expect(await r.store.get(id)).toMatchObject({ status: "failed", error: "It was removed from the call." });
    expect((await getNote({ id: USER }, noteId))!.status).toBe("ready");
    expect(r.pushes.map((p) => p.kind)).toEqual(["meet_failed", "meet_ready"]);
  });

  it("finds a meeting by its metadata before Recall's bot id is kept, never moves one back, and ignores what it doesn't know", async () => {
    const r = rig();
    const m = row({ status: "joining", botId: null });
    await r.store.add(m);
    await r.svc.onStatus(status("bot.in_call_recording", "bot-new", m.id));
    expect(await r.store.get(m.id)).toMatchObject({ botId: "bot-new", status: "in_call" });
    await r.svc.onStatus(status("bot.joining_call", "bot-new", m.id));
    await r.svc.onStatus(status("bot.recording_permission_allowed", "bot-new", m.id));
    expect((await r.store.get(m.id))!.status).toBe("in_call");
    await expect(r.svc.onStatus(status("bot.in_call_recording", "nobody", randomUUID()))).resolves.toBeUndefined();
    await expect(r.svc.onStatus("not even an object")).resolves.toBeUndefined();
  });
});

describe("the live transcript", () => {
  it("reaches the note in batches, each line with its speaker", async () => {
    const r = rig({ flushMs: 20 });
    const { token, noteId } = await inCall(r);
    await r.svc.onLive(token, line(ASHA, "We keep the budget at forty thousand", 12));
    await r.svc.onLive(token, line(RAVI, "Agreed", 15.5));
    expect(await transcriptOf(noteId)).toEqual([]);
    await vi.waitFor(async () => expect(await transcriptOf(noteId)).toHaveLength(2));
    expect(await transcriptOf(noteId)).toEqual([
      { at: 12, text: "We keep the budget at forty thousand", speaker: "Asha" },
      { at: 15.5, text: "Agreed", speaker: "Ravi" },
    ]);
    expect((await getNote({ id: USER }, noteId))!.words).toBe(8);

    // A full batch does not wait for the timer.
    const busy = rig();
    const b = await inCall(busy);
    for (let i = 0; i < 15; i++) await busy.svc.onLive(b.token, line(i % 2 ? RAVI : ASHA, `point number ${i}`));
    await busy.svc.idle();
    expect(await transcriptOf(b.noteId)).toHaveLength(15);
  });

  it("keeps who is in the call on the row, each name once, never the bot itself", async () => {
    const r = rig();
    const { id, token } = await inCall(r);
    await r.svc.onLive(token, presence("join", ASHA));
    await r.svc.onLive(token, presence("join", RAVI));
    await r.svc.onLive(token, presence("join", RAVI));
    await r.svc.onLive(token, presence("join", { id: 1, name: "X0 Bot" }));
    await r.svc.idle();
    expect((await r.store.get(id))!.participants).toEqual(["Asha", "Ravi"]);
    await r.svc.onLive(token, presence("leave", ASHA));
    await r.svc.idle();
    expect((await r.store.get(id))!.participants).toEqual(["Ravi"]);
  });

  it("ignores an unknown token, and a meeting that is over", async () => {
    const r = rig();
    await expect(r.svc.onLive("an-unknown-token-0000000000000000", line(ASHA, "X0, what did Ravi say?"))).resolves.toBeUndefined();
    await expect(r.svc.onLive("short", line(ASHA, "X0, what did Ravi say?"))).resolves.toBeUndefined();
    const { id, token, botId } = await inCall(r);
    await r.svc.onLive(token, line(ASHA, "We keep the budget at forty thousand"));
    await r.svc.onStatus(status("bot.call_ended", botId, id));
    await r.svc.idle();
    const noteId = (await r.store.get(id))!.noteId!;
    await r.svc.onLive(token, line(ASHA, "X0, what did Ravi say?"));
    await r.svc.idle();
    expect(r.asked).toEqual([]);
    expect(await transcriptOf(noteId)).toHaveLength(1);
  });
});

describe("answering", () => {
  it("answers a question said by name from the transcript, out loud when the stage is open and its voice is on", async () => {
    const r = rig();
    const { id, token, botId, noteId } = await inCall(r, { voice: true });
    await r.svc.onLive(token, line(RAVI, "The budget is fine at forty thousand"));
    await r.svc.onLive(token, line(ASHA, "X0, what did Ravi say about the budget?"));
    await r.svc.idle();
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0]).toMatchObject({ who: "Asha", asked: "what did Ravi say about the budget?", how: "voice", botName: "X0 Bot", owner: "Aanya", title: "Budget review" });
    expect(r.asked[0]!.lines.map((l) => l.who)).toEqual(["Ravi", "Asha"]);
    expect(r.asked[0]!.participants).toEqual(["Ravi", "Asha"]);
    expect(r.spoken).toEqual([REPLY]);
    expect(r.st.plays.map((p) => [p.text, p.contentType])).toEqual([[REPLY, "audio/mpeg"]]);
    expect(r.calls.chat).toEqual([]);
    expect(r.st.states.slice(-2)).toEqual(["Thinking…", "Listening"]);
    expect((await r.svc.meeting(USER, id))!.asks).toEqual([{ askedBy: "Asha", question: "what did Ravi say about the budget?", answer: REPLY, how: "voice", at: T0 }]);
    await r.svc.onStatus(status("bot.call_ended", botId, id));
    await r.svc.idle();
    expect((await transcriptOf(noteId)).at(-1)).toMatchObject({ speaker: "X0 Bot", text: REPLY });
  });

  it("answers in the chat when no stage is open, or its voice is off", async () => {
    const r = rig({ connected: false });
    const { token, botId } = await inCall(r, { voice: true });
    await r.svc.onLive(token, line(ASHA, "X0, what did Ravi say?"));
    await r.svc.idle();
    expect(r.st.plays).toEqual([]);
    expect(r.calls.chat).toEqual([{ bot: botId, message: REPLY }]);

    const off = rig();
    const m = await inCall(off, { voice: true });
    expect((await off.svc.setVoice(USER, m.id, false)).voice).toBe(false);
    await off.svc.onLive(m.token, line(ASHA, "X0, what did Ravi say?"));
    await off.svc.idle();
    expect(off.st.plays).toEqual([]);
    expect(off.calls.chat.map((c) => c.message)).toEqual([REPLY]);
  });

  it("answers a chat message to the bot in the chat, and keeps the chat out of the note", async () => {
    const r = rig();
    const { id, token, botId, noteId } = await inCall(r, { voice: true });
    await r.svc.onLive(token, chat(RAVI, "When is the launch?", "only_bot"));
    await r.svc.idle();
    expect(r.asked[0]).toMatchObject({ who: "Ravi", asked: "When is the launch?", how: "chat" });
    expect(r.st.plays).toEqual([]);
    expect(r.calls.chat).toEqual([{ bot: botId, message: REPLY }]);

    await r.svc.onLive(token, chat(ASHA, "X0, what's next?"));
    await r.svc.onLive(token, chat(ASHA, "Lunch is at noon, everyone"));
    await r.svc.idle();
    expect(r.asked.map((q) => q.asked)).toEqual(["When is the launch?", "what's next?"]);

    await r.svc.onStatus(status("bot.call_ended", botId, id));
    await r.svc.idle();
    const said = (await transcriptOf(noteId)).map((s) => s.text).join("\n");
    expect(said).not.toContain("When is the launch?");
    expect(said).not.toContain("Lunch is at noon");
  });

  it("stops at once when told to, and when someone talks over it, but not for a word or two", async () => {
    const r = rig();
    const { token } = await inCall(r, { voice: true });
    r.st.speaking = true;
    await r.svc.onLive(token, line(ASHA, "X0, stop"));
    expect(r.st.stops).toBe(1);
    await r.svc.onLive(token, line(RAVI, "ok sure"));
    expect(r.st.stops).toBe(1);
    await r.svc.onLive(token, line(RAVI, "I think we should move on to hiring"));
    expect(r.st.stops).toBe(2);
    // A question to it while it speaks is not talking over it.
    await r.svc.onLive(token, line(ASHA, "X0, what about hiring?"));
    await r.svc.idle();
    expect(r.st.stops).toBe(2);
    expect(r.asked.map((q) => q.asked)).toEqual(["what about hiring?"]);
  });

  it("says goodbye and leaves when told to leave, and answers nothing after", async () => {
    const r = rig();
    const { token, botId } = await inCall(r);
    await r.svc.onLive(token, line(ASHA, "X0, leave"));
    await r.svc.idle();
    expect(r.calls.chat).toEqual([{ bot: botId, message: "Okay, I'm leaving the call now. Bye!" }]);
    expect(r.calls.left).toEqual([botId]);
    await r.svc.onLive(token, line(ASHA, "X0, what did Ravi say?"));
    await r.svc.idle();
    expect(r.asked).toEqual([]);
  });

  it("takes the next line of whoever said only its name as the question, for ten seconds", async () => {
    const r = rig({ connected: false });
    const { token } = await inCall(r);
    await r.svc.onLive(token, line(ASHA, "X0"));
    await r.svc.onLive(token, line(RAVI, "Sorry, go on"));
    await r.svc.idle();
    expect(r.asked).toEqual([]);
    await r.svc.onLive(token, line(ASHA, "what was the budget number"));
    await r.svc.idle();
    expect(r.asked.map((q) => [q.who, q.asked])).toEqual([["Asha", "what was the budget number"]]);

    await r.svc.onLive(token, line(ASHA, "Hey X0"));
    r.clock.t += 11_000;
    await r.svc.onLive(token, line(ASHA, "never mind then, folks"));
    await r.svc.idle();
    expect(r.asked).toHaveLength(1);
  });

  it("answers one at a time: two more wait, the rest are dropped", async () => {
    const r = rig({ connected: false });
    const { token } = await inCall(r);
    let release!: () => void;
    r.br.hold = new Promise<void>((res) => { release = res; });
    for (const q of ["first", "second", "third", "fourth"]) await r.svc.onLive(token, line(ASHA, `X0, what is the ${q} thing?`));
    expect(r.asked).toHaveLength(1);
    release();
    await r.svc.idle();
    expect(r.asked.map((q) => q.asked)).toEqual(["what is the first thing?", "what is the second thing?", "what is the third thing?"]);
    expect(r.calls.chat).toHaveLength(3);
  });

  it("says sorry in the chat when an answer fails", async () => {
    const r = rig();
    const { token, botId } = await inCall(r);
    r.br.fail = true;
    await r.svc.onLive(token, line(ASHA, "X0, what did Ravi say?"));
    await r.svc.idle();
    expect(r.calls.chat).toEqual([{ bot: botId, message: "Sorry, I couldn't answer that just now." }]);
    expect(r.st.states.at(-1)).toBe("Listening");
  });

  it("does what the model reads as stop or leave", async () => {
    const r = rig();
    const { token, botId } = await inCall(r);
    r.br.reply = { intent: "stop", reply: "" };
    await r.svc.onLive(token, line(ASHA, "X0, could you please be quiet for a bit"));
    await r.svc.idle();
    expect(r.st.stops).toBe(1);
    r.br.reply = { intent: "leave", reply: "Bye, everyone." };
    await r.svc.onLive(token, line(ASHA, "X0, would you mind dropping off the call now"));
    await r.svc.idle();
    expect(r.calls.chat.at(-1)).toEqual({ bot: botId, message: "Bye, everyone." });
    expect(r.calls.left).toEqual([botId]);
  });

  it("comes back after a restart: the meeting rebuilt from its row, the transcript so far from its note", async () => {
    const r = rig({ connected: false });
    const { token, noteId } = await inCall(r);
    for (let i = 0; i < 15; i++) await r.svc.onLive(token, line(i % 2 ? RAVI : ASHA, `point number ${i}`));
    await r.svc.idle();
    expect(await transcriptOf(noteId)).toHaveLength(15);

    const restarted = r.again();
    await restarted.onLive(token, line(ASHA, "X0, what did Ravi say?"));
    await restarted.idle();
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0]!.lines).toHaveLength(16);
    expect(r.asked[0]!.lines[0]).toMatchObject({ who: "Asha", text: "point number 0" });
    expect(r.calls.chat.map((c) => c.message)).toEqual([REPLY]);
  });
});

describe("the notes so far", () => {
  it("are written every few minutes, once enough was said since the last time", async () => {
    const r = rig({ notesEveryMs: 15 });
    const { id, token } = await inCall(r);
    for (let i = 0; i < 5; i++) await r.svc.onLive(token, line(ASHA, `point number ${i}`));
    await new Promise((res) => setTimeout(res, 60));
    expect(r.noted).toEqual([]);
    for (let i = 5; i < 8; i++) await r.svc.onLive(token, line(RAVI, `point number ${i}`));
    await vi.waitFor(async () => expect((await r.store.get(id))!.liveNotes).not.toBeNull());
    await r.svc.idle();
    expect((await r.store.get(id))!.liveNotes).toEqual({
      points: ["The budget stays at forty thousand"], actions: [{ who: "Ravi", what: "Send the deck" }], at: T0,
    });
    expect(r.noted).toEqual([{ lines: 8, title: "Budget review" }]);
  });
});

describe("the calendar", () => {
  const EVENT = { key: "evt-1:2026-11-12T09:30:00Z", title: "Standup", startMs: T0 + 30 * MIN, url: MEET, platform: "google_meet" as const };

  it("schedules a bot for the meeting's start, once per event", async () => {
    const r = rig();
    const view = await r.svc.schedule(USER, EVENT);
    expect(view).toMatchObject({ status: "scheduled", source: "calendar", joinAt: T0 + 30 * MIN, title: "Standup" });
    expect(r.calls.create[0]).toMatchObject({ joinAt: new Date(T0 + 30 * MIN).toISOString(), meetingUrl: MEET, metadata: { meeting: view!.id } });
    expect(await r.store.get(view!.id)).toMatchObject({ botId: "bot-1", eventKey: EVENT.key });
    expect(await r.svc.schedule(USER, EVENT)).toBeNull();
    expect(r.calls.create).toHaveLength(1);

    expect(await rig({ ai: false }).svc.schedule(USER, EVENT)).toBeNull();
    const full = rig();
    await full.store.add(row({ startedAt: T0 - 5 * 60 * MIN, endedAt: T0 - 60 * MIN }));
    expect(await full.svc.schedule(USER, EVENT)).toBeNull();
    expect(full.calls.create).toHaveLength(0);
  });

  it("calls off a scheduled bot, and asks one Recall already sent to leave", async () => {
    const r = rig();
    const a = (await r.svc.schedule(USER, EVENT))!;
    expect(await r.svc.cancel(USER, a.id)).toBe(true);
    expect(r.calls.deleted).toEqual(["bot-1"]);
    expect(r.calls.left).toEqual([]);
    expect((await r.store.get(a.id))!.status).toBe("cancelled");
    expect(await r.svc.cancel(USER, a.id)).toBe(false);

    r.rc.deleteAnswer = false;
    const b = (await r.svc.schedule(USER, { ...EVENT, key: "evt-2" }))!;
    expect(await r.svc.cancel("someone-else", b.id)).toBe(false);
    expect(await r.svc.cancel(USER, b.id)).toBe(true);
    expect(r.calls.deleted).toEqual(["bot-1", "bot-2"]);
    expect(r.calls.left).toEqual(["bot-2"]);
  });
});

describe("the person's", () => {
  it("meeting is theirs alone", async () => {
    const r = rig();
    const { id } = await inCall(r);
    expect(await r.svc.meeting("someone-else", id)).toBeNull();
    expect(await r.svc.meeting(USER, "not-a-meeting")).toBeNull();
    expect((await r.svc.meeting(USER, id))!.meeting.id).toBe(id);
    await expect(r.svc.setVoice("someone-else", id, false)).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(r.svc.leave("someone-else", id)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await r.svc.cancel("someone-else", id)).toBe(false);
    expect(r.calls.left).toEqual([]);
  });

  it("bot leaves when they say so; the meeting stays in the call until Recall says it ended", async () => {
    const r = rig();
    const { id, botId } = await inCall(r);
    expect((await r.svc.leave(USER, id)).status).toBe("in_call");
    expect(r.calls.left).toEqual([botId]);
  });

  it("settings are merged, the bot's name trimmed to 40 characters without control characters", async () => {
    const r = rig();
    expect(await r.svc.saveSettings(USER, { botName: "  Nova\u0007 the\tGreat  " })).toEqual({ autoJoin: false, voice: true, botName: "Nova the Great" });
    expect(await r.svc.saveSettings(USER, { voice: false, autoJoin: true })).toEqual({ autoJoin: true, voice: false, botName: "Nova the Great" });
    expect((await r.svc.saveSettings(USER, { botName: "N".repeat(60) })).botName).toHaveLength(40);
    expect((await r.svc.overview(USER)).botName).toBe("N".repeat(40));
  });

  it("overview has the live, the upcoming soonest first, the recent newest first, and today's minutes", async () => {
    const r = rig();
    await r.store.add(row({ status: "scheduled", source: "calendar", eventKey: "e2", joinAt: T0 + 120 * MIN, title: "Later" }));
    await r.store.add(row({ status: "scheduled", source: "calendar", eventKey: "e1", joinAt: T0 + 60 * MIN, title: "Sooner" }));
    await r.store.add(row({ status: "done", startedAt: T0 - 180 * MIN, endedAt: T0 - 120 * MIN, title: "Older" }));
    await r.store.add(row({ status: "failed", createdAt: T0 - 30 * MIN, title: "Couldn't join" }));
    await r.store.add(row({ status: "cancelled", title: "Called off" }));
    await r.store.add(row({ status: "in_call", startedAt: T0 - 30 * MIN, title: "Now" }));
    const o = await r.svc.overview(USER, { calendar: true });
    expect(o.live.map((m) => m.title)).toEqual(["Now"]);
    expect(o.upcoming.map((m) => m.title)).toEqual(["Sooner", "Later"]);
    expect(o.recent.map((m) => m.title)).toEqual(["Couldn't join", "Older"]);
    expect(o).toMatchObject({ minutesToday: 90, minutesCap: 240, calendar: true, botName: "X0 Bot", settings: { autoJoin: false, voice: true, botName: "" } });
    expect((await r.svc.overview(USER)).calendar).toBe(false);
  });

  it("stage is found by the meeting's token while it goes on, with the bot's name and whose it is", async () => {
    const r = rig();
    const { id, token, botId } = await inCall(r);
    expect(await r.svc.stageFor(token)).toEqual({ meetingId: id, botName: "X0 Bot", owner: "Aanya" });
    expect(await r.svc.stageFor("x".repeat(32))).toBeNull();
    await r.svc.onStatus(status("bot.call_ended", botId, id));
    await r.svc.idle();
    expect(await r.svc.stageFor(token)).toBeNull();
  });

  it("bots are called off when the account goes, and that never fails", async () => {
    const r = rig();
    const scheduled = (await r.svc.schedule(USER, { key: "evt-9", title: "Later", startMs: T0 + 30 * MIN, url: "https://meet.google.com/qrs-tuvw-xyz", platform: "google_meet" }))!;
    const { botId } = await inCall(r);
    await r.svc.forAccountDelete(USER);
    expect(r.calls.deleted).toEqual([(await r.store.get(scheduled.id))!.botId]);
    expect(r.calls.left).toEqual([botId]);

    const broken = rig();
    await broken.svc.schedule(USER, { key: "evt-9", title: "Later", startMs: T0 + 30 * MIN, url: MEET, platform: "google_meet" });
    broken.rc.deleteAnswer = new Error("Recall is down");
    await expect(broken.svc.forAccountDelete(USER)).resolves.toBeUndefined();
  });
});

describe("in a space", () => {
  const ADMIN = "u-admin";
  const MEMBER = "u-member";
  const STRANGER = "u-stranger";
  const SPACE = "s-home";
  const NAMES = { [ADMIN]: "Aanya", [MEMBER]: "Ravi", [STRANGER]: "Sam" };
  /** Aanya is the admin of Home, where Ravi agreed to the line about her (people.ts decides that; here it is given). */
  const home = (o: { off?: boolean } = {}): MeetPeople => ({
    async membersOf(adminId) { return !o.off && adminId === ADMIN ? [{ userId: MEMBER, name: "Ravi Kumar", spaceId: SPACE }] : []; },
    async adminsOf(memberId) { return !o.off && memberId === MEMBER ? [{ userId: ADMIN, name: "Aanya Sharma", spaceId: SPACE, memberName: "Ravi Kumar" }] : []; },
  });

  it("the admin sends the bot to a member's meeting: the member's in every way, and the member is told", async () => {
    const r = rig({ people: home(), names: NAMES });
    await r.svc.saveSettings(MEMBER, { botName: "Nova", voice: false });
    const view = await r.svc.join(ADMIN, { url: MEET, title: "Ravi's standup", forUser: MEMBER });
    expect(view).toMatchObject({ status: "joining", owner: { id: MEMBER, name: "Ravi Kumar" }, voice: false });
    expect(view.by).toBeUndefined();
    await r.svc.idle();
    expect(await r.store.get(view.id)).toMatchObject({ userId: MEMBER, byId: ADMIN, spaceId: SPACE, voice: false, botId: "bot-1" });
    expect(r.calls.create[0]).toMatchObject({ botName: "Nova", metadata: { meeting: view.id } });
    expect(r.calls.create[0]!.intro).toContain("taking notes for Ravi.");
    expect(r.calls.create[0]!.stageUrl).toBeUndefined();
    // The member is told who sent it, and to what; their admin is not told of what they sent themself.
    expect(r.pushes).toEqual([{ userId: MEMBER, kind: "space_meet_sent", key: `${view.id}:sent`, vars: { name: "Aanya", title: "Ravi's standup" }, data: { m: view.id } }]);

    // The member sees it among their own, sent by their admin; the admin among their people's, with whose it is.
    const mine = await r.svc.overview(MEMBER);
    expect(mine.live).toEqual([expect.objectContaining({ id: view.id, by: "Aanya Sharma" })]);
    expect(mine.live[0]!.owner).toBeUndefined();
    expect(mine).toMatchObject({ people: [], sendFor: [] });
    const theirs = await r.svc.overview(ADMIN);
    expect(theirs.live).toEqual([]);
    expect(theirs.sendFor).toEqual([{ id: MEMBER, name: "Ravi Kumar" }]);
    expect(theirs.people).toEqual([expect.objectContaining({ id: view.id, owner: { id: MEMBER, name: "Ravi Kumar" } })]);
    expect(theirs.people[0]!.by).toBeUndefined();
  });

  it("refuses someone who isn't theirs to look after, a member without the OK for AI, and a member past their minutes", async () => {
    const r = rig({ people: home(), names: NAMES, aiFor: (u) => u !== STRANGER });
    await expect(r.svc.join(ADMIN, { url: MEET, forUser: STRANGER })).rejects.toMatchObject({
      status: 404, code: "not_your_person", message: "You can send it only for someone in a space you look after.",
    });
    await expect(r.svc.join(STRANGER, { url: MEET, forUser: MEMBER })).rejects.toMatchObject({ status: 404, code: "not_your_person" });
    await expect(rig({ people: home({ off: true }) }).svc.join(ADMIN, { url: MEET, forUser: MEMBER })).rejects.toMatchObject({ code: "not_your_person" });
    await expect(r.svc.join(ADMIN, { url: "https://example.com/x", forUser: MEMBER })).rejects.toMatchObject({ status: 400, code: "bad_link" });

    const noAi = rig({ people: home(), names: NAMES, aiFor: (u) => u !== MEMBER });
    await expect(noAi.svc.join(ADMIN, { url: MEET, forUser: MEMBER })).rejects.toMatchObject({
      status: 403, code: "ai_consent_needed", message: "Ravi Kumar hasn't turned on AI services in X0 Bot yet.",
    });

    const full = rig({ people: home(), names: NAMES });
    await full.store.add(row({ userId: MEMBER, startedAt: T0 - 5 * 60 * MIN, endedAt: T0 - 60 * MIN }));
    await expect(full.svc.join(ADMIN, { url: MEET, forUser: MEMBER })).rejects.toMatchObject({ status: 429, code: "meet_cap" });
    // The admin's own minutes are theirs: their meeting goes.
    await expect(full.svc.join(ADMIN, { url: MEET })).resolves.toMatchObject({ status: "joining" });
    expect(r.calls.create).toHaveLength(0);
    expect(r.pushes).toEqual([]);

    // Sending it for themself is their own join.
    const self = rig({ people: home(), names: NAMES });
    const own = await self.svc.join(ADMIN, { url: MEET, forUser: ADMIN });
    expect(await self.store.get(own.id)).toMatchObject({ userId: ADMIN, byId: null });
  });

  it("a member taking the bot to a meeting tells their admin, with their name and its title only", async () => {
    const r = rig({ people: home(), names: NAMES });
    const a = await r.svc.join(MEMBER, { url: MEET, title: "Standup" });
    const b = await r.svc.join(MEMBER, { url: "https://zoom.us/j/123456789" });
    await r.svc.schedule(MEMBER, { key: "evt-1", title: "Planning", startMs: T0 + 30 * MIN, url: "https://meet.google.com/qrs-tuvw-xyz", platform: "google_meet" });
    await r.svc.idle();
    const sched = (await r.store.list(MEMBER)).find((m) => m.source === "calendar")!;
    expect(r.pushes).toEqual(expect.arrayContaining([
      { userId: ADMIN, kind: "space_meet", key: `${a.id}:admin:${ADMIN}`, vars: { name: "Ravi Kumar", title: "Standup" }, data: { m: a.id } },
      { userId: ADMIN, kind: "space_meet", key: `${b.id}:admin:${ADMIN}`, vars: { name: "Ravi Kumar", title: "a meeting" }, data: { m: b.id } },
      { userId: ADMIN, kind: "space_meet", key: `${sched.id}:admin:${ADMIN}`, vars: { name: "Ravi Kumar", title: "Planning" }, data: { m: sched.id } },
    ]));
    expect(r.pushes).toHaveLength(3);
    // Nothing of the call ever reaches the admin by push.
    const { token, botId } = { token: tokenOf(r.calls.create[0]!), botId: (await r.store.get(a.id))!.botId! };
    await r.svc.onStatus(status("bot.in_call_recording", botId, a.id));
    await r.svc.onLive(token, line(ASHA, "The budget is forty thousand"));
    await r.svc.onStatus(status("bot.call_ended", botId, a.id));
    await r.svc.idle();
    const toAdmin = r.pushes.filter((p) => p.userId === ADMIN);
    expect(toAdmin.map((p) => p.kind)).toEqual(["space_meet", "space_meet", "space_meet"]);
    expect(JSON.stringify(toAdmin)).not.toContain("forty thousand");

    // The admin's own meetings tell nobody.
    const own = rig({ people: home(), names: NAMES });
    await own.svc.join(ADMIN, { url: MEET });
    await own.svc.idle();
    expect(own.pushes).toEqual([]);
  });

  it("the admin reads a member's meeting, read only, and sees their latest meetings; nobody else does", async () => {
    const r = rig({ people: home(), names: NAMES });
    await r.store.add(row({ userId: MEMBER, status: "done", startedAt: T0 - 3 * 60 * MIN, endedAt: T0 - 2 * 60 * MIN, title: "Earlier" }));
    await r.store.add(row({ userId: MEMBER, status: "cancelled", title: "Called off" }));
    // Someone else's meeting (USER is in nobody's space here), and the member's own.
    const { id } = await inCall(r);
    const view = await r.svc.join(MEMBER, { url: "https://meet.google.com/qrs-tuvw-xyz", title: "Ravi's call" });
    await r.svc.idle();
    const mine = (await r.svc.meeting(MEMBER, view.id))!;
    expect(mine.readOnly).toBeUndefined();
    expect(mine.meeting.owner).toBeUndefined();

    const seen = (await r.svc.meeting(ADMIN, view.id))!;
    expect(seen).toMatchObject({ readOnly: true, meeting: { id: view.id, owner: { id: MEMBER, name: "Ravi Kumar" } }, asks: [] });
    expect(await r.svc.meeting(STRANGER, view.id)).toBeNull();
    expect(await r.svc.meeting(ADMIN, id)).toBeNull();

    const o = await r.svc.overview(ADMIN);
    expect(o.people.map((m) => m.title)).toEqual(["Ravi's call", "Earlier"]);
    expect(o.people.every((m) => m.owner?.id === MEMBER)).toBe(true);

    // Read only: the admin can't change it, send its bot away or call it off, when they didn't send it.
    await expect(r.svc.setVoice(ADMIN, view.id, true)).rejects.toMatchObject({ status: 404 });
    await expect(r.svc.leave(ADMIN, view.id)).rejects.toMatchObject({ status: 404 });
    expect(await r.svc.cancel(ADMIN, view.id)).toBe(false);
    expect(r.calls.left).toEqual([]);
  });

  it("the admin who sent the bot may send it away or call it off, while the member is still theirs", async () => {
    const r = rig({ people: home(), names: NAMES });
    const view = await r.svc.join(ADMIN, { url: MEET, title: "Ravi's standup", forUser: MEMBER });
    await r.svc.idle();
    const botId = (await r.store.get(view.id))!.botId!;
    await r.svc.onStatus(status("bot.in_call_recording", botId, view.id));
    // The member may change its voice; the admin may not.
    await expect(r.svc.setVoice(ADMIN, view.id, false)).rejects.toMatchObject({ status: 404 });
    expect((await r.svc.setVoice(MEMBER, view.id, false)).by).toBe("Aanya Sharma");
    const left = await r.svc.leave(ADMIN, view.id);
    expect(left).toMatchObject({ id: view.id, status: "in_call", owner: { id: MEMBER, name: "Ravi Kumar" } });
    expect(r.calls.left).toEqual([botId]);
    expect(await r.svc.cancel(ADMIN, view.id)).toBe(true);

    // Once the member is no longer theirs to look after (they left, a block, Spaces off), it is not the admin's to stop.
    const gone = rig({ people: home(), names: NAMES });
    const sent = await gone.svc.join(ADMIN, { url: MEET, forUser: MEMBER });
    await gone.svc.idle();
    const after = new MeetService({ ...gone.deps, people: home({ off: true }) });
    await expect(after.leave(ADMIN, sent.id)).rejects.toMatchObject({ status: 404 });
    expect(await after.cancel(ADMIN, sent.id)).toBe(false);
    expect(await after.meeting(ADMIN, sent.id)).toBeNull();
  });
});
