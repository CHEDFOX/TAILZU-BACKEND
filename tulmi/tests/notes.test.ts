import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

// What the recogniser "hears", by track: the test sets it per request.
const heard: { text: string } = { text: "" };
vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({ text: heard.text, durationSeconds: 30 })),
  estimateDurationSeconds: () => 0,
}));

const organiseCalls: unknown[] = [];
const organiseNotes: unknown[] = [];
vi.mock("../src/notes/organise.js", async (orig) => ({
  ...(await orig<typeof import("../src/notes/organise.js")>()),
  organise: vi.fn(async (note: { transcript: unknown[]; systemAudio?: string }) => {
    organiseCalls.push(note.transcript);
    organiseNotes.push(note.systemAudio);
    return {
      title: "Launch plan", summary: "Ship Friday.",
      highlights: [{ speaker: "Speaker 1", text: "We ship Friday." }],
      people: [{ label: "Speaker 1", name: "Priya" }],
    };
  }),
}));

const diarized: Record<string, unknown> = {};
vi.mock("../src/notes/speakers.js", async (orig) => ({
  ...(await orig<typeof import("../src/notes/speakers.js")>()),
  diarize: vi.fn(async (audio: Buffer) => diarized[audio.toString("utf8", 0, 6)] ?? null),
}));

// eslint-disable-next-line import/first
import { appendHeard, labelSpeakers, overlap } from "../src/notes/speakers.js";
// eslint-disable-next-line import/first
import { parseBody, parts, transcriptLines } from "../src/notes/organise.js";
// eslint-disable-next-line import/first
import { resetNotesForTests } from "../src/notes/store.js";
// eslint-disable-next-line import/first
import { notesWork, resetNotesRoutesForTests } from "../src/routes/notes.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";

describe("who said what", () => {
  it("measures how much of one line another says", () => {
    expect(overlap("We ship on Friday.", "we ship on friday")).toBe(1);
    expect(overlap("We ship on Friday", "Lunch is at noon")).toBe(0);
  });

  it("drops the microphone's echo of the call, and the call's copy replaces an earlier echo", () => {
    let t = appendHeard([], { at: 0, text: "We ship on Friday", track: "system" }, 40).transcript;
    const echo = appendHeard(t, { at: 2, text: "we ship on friday", track: "mic" }, 40);
    expect(echo.kept).toBe(false);
    t = appendHeard([], { at: 0, text: "We ship on Friday", track: "mic" }, 40).transcript;
    t = appendHeard(t, { at: 1, text: "We ship on Friday", track: "system" }, 40).transcript;
    expect(t).toEqual([{ at: 1, text: "We ship on Friday", speaker: "Others" }]);
    // Something else said by you at the same time stays.
    t = appendHeard(t, { at: 3, text: "Fine by me", track: "mic" }, 40).transcript;
    expect(t.map((s) => s.speaker)).toEqual(["Others", "You"]);
  });

  it("on a call: you are You, each voice on the call is its own speaker, turns stay apart", () => {
    const out = labelSpeakers(
      [{ speaker: 0, start: 0, end: 4, text: "The build is ready." }],
      [
        { speaker: 0, start: 5, end: 8, text: "Then test it Thursday." },
        { speaker: 1, start: 9, end: 12, text: "I disagree, ship Friday." },
        { speaker: 0, start: 13, end: 15, text: "Fine." },
      ],
    );
    expect(out.map((s) => s.speaker)).toEqual(["You", "Speaker 1", "Speaker 2", "Speaker 1"]);
  });

  it("in a room: several voices on the microphone are all speakers; one voice is You", () => {
    const room = labelSpeakers([
      { speaker: 0, start: 0, end: 5, text: "Welcome everyone." },
      { speaker: 1, start: 6, end: 11, text: "Thanks, let's start." },
    ], null);
    expect(room.map((s) => s.speaker)).toEqual(["Speaker 1", "Speaker 2"]);
    const memo = labelSpeakers([
      { speaker: 0, start: 0, end: 5, text: "Idea one." },
      { speaker: 0, start: 6, end: 9, text: "Idea two." },
    ], null);
    expect(memo).toEqual([{ at: 0, speaker: "You", text: "Idea one. Idea two." }]);
  });

  it("drops echo and folds a stray blip into the main voice", () => {
    const out = labelSpeakers(
      [
        { speaker: 0, start: 0, end: 30, text: "Let me share my screen now." },
        { speaker: 1, start: 31, end: 31.5, text: "uh" },
        { speaker: 0, start: 40, end: 43, text: "we ship on friday" },
      ],
      [{ speaker: 0, start: 40, end: 43, text: "We ship on Friday." }],
    );
    expect(out.map((s) => [s.speaker, s.text])).toEqual([
      ["You", "Let me share my screen now. uh"],
      ["Speaker 1", "We ship on Friday."],
    ]);
  });
});

describe("the writer's answer", () => {
  const labels = new Set(["You", "Speaker 1"]);

  it("is the meeting, a paragraph and a few lines; names only speakers that exist and never You", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ speaker: "You", text: `point ${i}` }));
    const b = parseBody(`Here: ${JSON.stringify({
      title: "  Plan  ", summary: "S",
      people: [{ label: "Speaker 1", name: "Priya" }, { label: "You", name: "Me" }, { label: "Speaker 9", name: "X" }],
      highlights: [
        { speaker: "Speaker 1", text: "“We ship Friday.”" },
        { speaker: "Speaker 9", text: "Nobody by this label spoke." },
        { speaker: "You", text: "" },
        ...many,
      ],
    })}`, labels)!;
    expect(b.title).toBe("Plan");
    expect(b.people).toEqual([{ label: "Speaker 1", name: "Priya" }]);
    // Quotes stripped, an unknown speaker's line dropped, at most seven kept.
    expect(b.highlights[0]).toEqual({ speaker: "Speaker 1", text: "We ship Friday." });
    expect(b.highlights).toHaveLength(7);
    expect(b.highlights.some((h) => h.speaker === "Speaker 9")).toBe(false);
  });

  it("is refused when it is not a note", () => {
    expect(parseBody("no json here", labels)).toBeNull();
    expect(parseBody("{broken", labels)).toBeNull();
    expect(parseBody("{}", labels)).toBeNull();
  });

  it("reads the transcript by speaker and time, and splits a long one", () => {
    expect(transcriptLines([{ at: 65, speaker: "You", text: "hello  there" }])).toEqual(["[1:05] You: hello there"]);
    expect(parts(["a".repeat(60), "b".repeat(60), "c".repeat(10)], 100).map((p) => p.length)).toEqual([1, 2]);
  });
});

describe("the notes routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { resetNotesForTests(); resetNotesRoutesForTests(); organiseCalls.length = 0; organiseNotes.length = 0; for (const k of Object.keys(diarized)) delete diarized[k]; });

  const upload = (id: string, track: string, at: number, bytes = "audio-" + track, path = "audio") => {
    const b = "----notes";
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="track"\r\n\r\n${track}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="at"\r\n\r\n${at}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      Buffer.from(bytes.padEnd(2048, ".")),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    return app.inject({ method: "POST", url: `/v1/notes/${id}/${path}`, payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${b}` } });
  };

  it("records, drops the echo, organises, lists, opens and deletes", async () => {
    const start = await app.inject({ method: "POST", url: "/v1/notes" });
    expect(start.statusCode).toBe(200);
    const id = start.json().note.id as string;

    heard.text = "We ship on Friday";
    expect((await upload(id, "system", 0)).json()).toEqual({ kept: true, words: 4 });
    heard.text = "we ship on friday";
    expect((await upload(id, "mic", 0)).json()).toEqual({ kept: false, words: 0 });
    heard.text = "Sounds good";
    expect((await upload(id, "mic", 30)).json()).toEqual({ kept: true, words: 2 });

    const fin = await app.inject({ method: "POST", url: `/v1/notes/${id}/finish`, payload: { durationSeconds: 61 } });
    expect(fin.statusCode).toBe(202);
    expect(fin.json().note.status).toBe("organising");
    await notesWork(id);

    const note = (await app.inject({ method: "GET", url: `/v1/notes/${id}` })).json().note;
    expect(note).toMatchObject({ status: "ready", organised: true, title: "Launch plan", words: 6, durationSeconds: 61 });
    expect(note.people).toEqual([{ label: "Speaker 1", name: "Priya" }]);
    expect(note.transcript.map((s: { speaker: string }) => s.speaker)).toEqual(["Others", "You"]);
    // Audio after the finish is refused, not added to a finished note.
    expect((await upload(id, "mic", 90)).statusCode).toBe(409);

    const list = (await app.inject({ method: "GET", url: "/v1/notes" })).json().notes;
    expect(list).toHaveLength(1);
    expect(list[0].transcript).toBeUndefined();

    expect((await app.inject({ method: "DELETE", url: `/v1/notes/${id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: `/v1/notes/${id}` })).statusCode).toBe(404);
  });

  it("tells the speakers apart from the whole tracks when it stops", async () => {
    const id = (await app.inject({ method: "POST", url: "/v1/notes" })).json().note.id as string;
    heard.text = "The build is ready and we can test";
    await upload(id, "mic", 0);
    heard.text = "Then test Thursday and ship Friday please";
    await upload(id, "system", 0);
    diarized["micTrk"] = [{ speaker: 0, start: 0, end: 3, text: "The build is ready and we can test." }];
    diarized["sysTrk"] = [
      { speaker: 0, start: 4, end: 6, text: "Then test Thursday." },
      { speaker: 1, start: 7, end: 9, text: "And ship Friday, please." },
    ];
    expect((await upload(id, "mic", 0, "micTrk", "track")).json()).toEqual({ speakers: 1 });
    expect((await upload(id, "system", 0, "sysTrk", "track")).json()).toEqual({ speakers: 2 });
    await app.inject({ method: "POST", url: `/v1/notes/${id}/finish`, payload: {} });
    await notesWork(id);
    const note = (await app.inject({ method: "GET", url: `/v1/notes/${id}` })).json().note;
    expect(note.transcript.map((s: { speaker: string }) => s.speaker)).toEqual(["You", "Speaker 1", "Speaker 2"]);
    // The writer read the labelled transcript, not the live one.
    expect(JSON.stringify(organiseCalls[0])).toContain("Speaker 2");
  });

  it("keeps whether the computer's sound was heard, and the writer is told", async () => {
    const id = (await app.inject({ method: "POST", url: "/v1/notes" })).json().note.id as string;
    heard.text = "My update is the build";
    await upload(id, "mic", 0);
    await app.inject({ method: "POST", url: `/v1/notes/${id}/finish`, payload: { systemAudio: "denied" } });
    await notesWork(id);
    const note = (await app.inject({ method: "GET", url: `/v1/notes/${id}` })).json().note;
    expect(note.systemAudio).toBe("denied");
    expect((await app.inject({ method: "GET", url: "/v1/notes" })).json().notes[0].systemAudio).toBe("denied");
    expect(organiseNotes[0]).toBe("denied");
    // Anything else is not kept.
    const id2 = (await app.inject({ method: "POST", url: "/v1/notes" })).json().note.id as string;
    await upload(id2, "mic", 0);
    await app.inject({ method: "POST", url: `/v1/notes/${id2}/finish`, payload: { systemAudio: "maybe" } });
    await notesWork(id2);
    expect((await app.inject({ method: "GET", url: `/v1/notes/${id2}` })).json().note.systemAudio).toBeUndefined();
  });

  it("a finish never starts the writer twice, and a note that is not there is a 404", async () => {
    const id = (await app.inject({ method: "POST", url: "/v1/notes" })).json().note.id as string;
    heard.text = "One thing";
    await upload(id, "mic", 0);
    await Promise.all([
      app.inject({ method: "POST", url: `/v1/notes/${id}/finish`, payload: {} }),
      app.inject({ method: "POST", url: `/v1/notes/${id}/finish`, payload: {} }),
    ]);
    await notesWork(id);
    expect(organiseCalls).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/v1/notes/00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/notes/not-a-uuid" })).statusCode).toBe(404);
  });
});
