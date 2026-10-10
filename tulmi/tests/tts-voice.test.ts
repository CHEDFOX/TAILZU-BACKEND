/**
 * The read-aloud (TTS) voice: the curated catalog, how /v1/speak and /v1/ask
 * resolve the voice, how a save is validated, and the picker on both surfaces.
 *
 * The one rule under all of it: an unknown voice is NEVER forwarded to OpenAI,
 * never stored, and never offered. Everything reads the catalog in
 * experience/ttsVoices.ts, so the set can't drift between pick, store and send.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

// Capture which voice /v1/speak hands to OpenAI, without calling it.
const tts = vi.hoisted(() => ({ voices: [] as (string | undefined)[] }));
vi.mock("../src/pipeline/tts.js", () => ({
  synthesize: vi.fn(async (input: { voice?: string }) => {
    tts.voices.push(input.voice);
    return { audio: Buffer.from("fake-audio"), contentType: "audio/mpeg" };
  }),
}));

// /v1/ask's model call and read-aloud locale, stubbed as routes.test.ts does.
vi.mock("../src/pipeline/cleanup.js", () => ({
  clean: vi.fn(async (input: string) => `cleaned:${input}`),
  assist: vi.fn(async (input: string) => `assisted:${input}`),
  cleanBasic: vi.fn(async (input: string) => `basic:${input}`),
  cleanStream: async function* () {},
  draftReply: vi.fn(async (sc: string, intent: string) => `drafted:${intent}::${sc}`),
  editSelection: vi.fn(async (text: string, instruction: string) => `edited:${instruction}::${text}`),
  answerAbout: vi.fn(async (sc: string, question: string) => `answered:${question}::${sc}`),
  spokenLanguage: vi.fn((text: string) => (/[ऀ-ॿ]/.test(text) ? { name: "Hindi", locale: "hi-IN" } : null)),
  inferStyle: vi.fn(async () => ({ tone: "learned" })),
  refineWithTone: vi.fn(async (input: string) => `refined:${input}`),
  LLM_TONES: ["formal", "casual", "very-casual", "excited"],
  expandSnippets: (s: string) => s,
}));

vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({ text: "hey there", durationSeconds: 3 })),
  estimateDurationSeconds: () => 0,
}));

// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { buildScreen } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import {
  DEFAULT_TTS_VOICE, TTS_VOICES, TTS_VOICE_IDS, isValidTtsVoice, ttsVoiceById,
} from "../src/experience/ttsVoices.js";

// ---------------------------------------------------------------------------
// The catalog + the guard
// ---------------------------------------------------------------------------

describe("the read-aloud voice catalog", () => {
  it("offers exactly the curated ids, lowercase, with nova first and the default", () => {
    expect(TTS_VOICES.map((v) => v.id)).toEqual([
      "nova", "sage", "onyx", "shimmer", "fable", "coral", "ash", "echo", "alloy",
    ]);
    expect(DEFAULT_TTS_VOICE).toBe("nova");
    expect(TTS_VOICES[0]!.id).toBe(DEFAULT_TTS_VOICE);
    expect(isValidTtsVoice(DEFAULT_TTS_VOICE)).toBe(true);
  });

  it("every voice has a lowercase id in the set, a label and a blurb", () => {
    for (const v of TTS_VOICES) {
      expect(v.id, v.id).toBe(v.id.toLowerCase());
      expect(v.label, v.id).toBeTruthy();
      expect(v.blurb, v.id).toBeTruthy();
      expect(TTS_VOICE_IDS.has(v.id), v.id).toBe(true);
    }
    expect(TTS_VOICE_IDS.size).toBe(TTS_VOICES.length);
  });

  it("the expected blurbs ride with their ids", () => {
    const blurbs = Object.fromEntries(TTS_VOICES.map((v) => [v.id, `${v.label}|${v.blurb}`]));
    expect(blurbs.nova).toBe("Nova|Warm and bright");
    expect(blurbs.sage).toBe("Sage|Calm and soft");
    expect(blurbs.onyx).toBe("Onyx|Deep and steady");
    expect(blurbs.shimmer).toBe("Shimmer|Clear and upbeat");
    expect(blurbs.fable).toBe("Fable|Expressive storyteller");
    expect(blurbs.coral).toBe("Coral|Friendly and light");
    expect(blurbs.ash).toBe("Ash|Natural and even");
    expect(blurbs.echo).toBe("Echo|Measured and cool");
    expect(blurbs.alloy).toBe("Alloy|Neutral and balanced");
  });

  it("the guard passes known ids and rejects everything else", () => {
    for (const v of TTS_VOICES) expect(isValidTtsVoice(v.id), v.id).toBe(true);
    for (const bad of ["Nova", "marin", "ALLOY", "", "  ", "alloy ", undefined, null, 5, {}, []]) {
      expect(isValidTtsVoice(bad as never), JSON.stringify(bad)).toBe(false);
    }
  });

  it("labels a voice by id, and gives nothing for an unknown id", () => {
    expect(ttsVoiceById("nova")?.label).toBe("Nova");
    expect(ttsVoiceById("echo")?.blurb).toBe("Measured and cool");
    expect(ttsVoiceById("marin")).toBeUndefined();
    expect(ttsVoiceById(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The routes (these share one dev user, whose store starts empty)
// ---------------------------------------------------------------------------

describe("the voice through the routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const speak = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/speak", payload });
  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: "/v1/personality", payload });
  const ask = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/ask", payload });

  // Runs first, while nothing is stored: proves the default fallback for both
  // routes before any PUT can set a voice.
  it("falls back to the default when nothing is stored and none is sent", async () => {
    tts.voices.length = 0;
    const s = await speak({ text: "hello" });
    expect(s.statusCode).toBe(200);
    expect(s.headers["content-type"]).toContain("audio/mpeg");
    expect(tts.voices).toEqual([DEFAULT_TTS_VOICE]); // "nova"

    const a = await ask({ question: "when?", screenContent: "3pm" });
    expect(a.statusCode).toBe(200);
    expect(a.json().voice).toBe(DEFAULT_TTS_VOICE);
  });

  it("/v1/speak uses a valid body voice verbatim", async () => {
    await put({ ttsVoice: "sage" });   // a stored voice that must NOT win here
    tts.voices.length = 0;
    const s = await speak({ text: "hello", voice: "onyx" });
    expect(s.statusCode).toBe(200);
    expect(tts.voices).toEqual(["onyx"]);
  });

  it("/v1/speak falls back to the stored voice when none is sent", async () => {
    await put({ ttsVoice: "sage" });
    tts.voices.length = 0;
    const s = await speak({ text: "hello" });
    expect(s.statusCode).toBe(200);
    expect(tts.voices).toEqual(["sage"]);
  });

  it("/v1/speak rejects an invalid body voice and uses the stored one instead", async () => {
    await put({ ttsVoice: "sage" });
    tts.voices.length = 0;
    const s = await speak({ text: "hello", voice: "marin" });   // not in the set
    expect(s.statusCode).toBe(200);
    expect(tts.voices).toEqual(["sage"]);   // never "marin"
  });

  it("/v1/ask returns the stored voice", async () => {
    await put({ ttsVoice: "echo" });
    const a = await ask({ question: "when?", screenContent: "3pm" });
    expect(a.statusCode).toBe(200);
    expect(a.json().voice).toBe("echo");
    // The locale is still derived from the answer, independently of the voice.
    expect(a.json().speak).toBeUndefined();
    const hindi = await ask({ question: "कब?", screenContent: "तीन बजे" });
    expect(hindi.json().speak).toBe("hi-IN");
    expect(hindi.json().voice).toBe("echo");
  });

  it("PUT /v1/personality stores a valid ttsVoice", async () => {
    const res = await put({ ttsVoice: "coral" });
    expect(res.statusCode).toBe(200);
    expect(res.json().personality.ttsVoice).toBe("coral");
    const get = await app.inject({ method: "GET", url: "/v1/personality" });
    expect(get.json().personality.ttsVoice).toBe("coral");
  });

  it("PUT /v1/personality ignores an invalid ttsVoice, keeping the stored one", async () => {
    await put({ ttsVoice: "coral" });            // known-good baseline
    const res = await put({ ttsVoice: "marin" }); // not in the set → ignored
    expect(res.statusCode).toBe(200);
    expect(res.json().personality.ttsVoice).toBe("coral");   // unchanged
  });

  it("an invalid ttsVoice is dropped without failing the rest of the PUT", async () => {
    await put({ ttsVoice: "coral" });
    const res = await put({ ttsVoice: "not-a-voice", tone: "warm and brief here" });
    expect(res.statusCode).toBe(200);
    expect(res.json().personality.tone).toBe("warm and brief here"); // the good field saved
    expect(res.json().personality.ttsVoice).toBe("coral");           // the bad one ignored
  });
});

// ---------------------------------------------------------------------------
// The picker, on both surfaces (pure buildScreen — no store, no app)
// ---------------------------------------------------------------------------

type AnyNode = { on?: any; children?: AnyNode[]; [k: string]: unknown };

/** The voice ids whose phone row carries the active tick ("✓"). */
function phoneMarked(personality: Record<string, unknown>): string[] {
  const s = buildScreen("voice_read", { personality, language: "en" } as never)!;
  const marked: string[] = [];
  const walk = (n: AnyNode | undefined): void => {
    if (!n || typeof n !== "object") return;
    const actions = (n.on as { onPress?: { actions?: Array<{ kind?: string; body?: { ttsVoice?: string } }> } })?.onPress?.actions;
    const body = actions?.find((a) => a.kind === "callEndpoint")?.body;
    if (body?.ttsVoice && JSON.stringify(n).includes("✓")) marked.push(body.ttsVoice);
    for (const c of n.children ?? []) walk(c);
  };
  walk(s.root as AnyNode);
  return marked;
}

describe("the phone read-aloud voice picker", () => {
  it("builds, lists every voice, and saves via PUT /v1/personality with the id", () => {
    const s = buildScreen("voice_read", { personality: {}, language: "en" } as never)!;
    expect(s).not.toBeNull();
    expect(s.screenId).toBe("voice_read");
    const json = JSON.stringify(s);
    // Every voice's name is on the screen (labels are single words, untouched
    // by the phone's title-casing).
    for (const v of TTS_VOICES) expect(json, v.id).toContain(v.label);
    // Each row saves its own id (ids live in the request body, never title-cased).
    for (const v of TTS_VOICES) expect(json, v.id).toContain(`"ttsVoice":"${v.id}"`);
    expect(json).toContain('"path":"/v1/personality"');
    expect(json).toContain('"method":"PUT"');
    // The save refreshes so the tick follows the pick.
    expect(json).toContain('"kind":"refresh"');
  });

  it("marks the stored voice, and the default when none is stored", () => {
    expect(phoneMarked({})).toEqual([DEFAULT_TTS_VOICE]); // ["nova"]
    expect(phoneMarked({ ttsVoice: "echo" })).toEqual(["echo"]);
    expect(phoneMarked({ ttsVoice: "marin" })).toEqual([DEFAULT_TTS_VOICE]); // invalid → default
  });

  it("the title and subtitle name the feature", () => {
    const json = JSON.stringify(buildScreen("voice_read", { personality: {}, language: "en" } as never));
    // Title-cased on the phone: "Read-aloud voice" → "Read-Aloud Voice".
    expect(json).toContain("Read-Aloud Voice");
    expect(json).toContain("The Voice That Reads Answers Back To You.");
  });

  it("Settings has a way into the picker", () => {
    const json = JSON.stringify(buildScreen("settings", { personality: {}, language: "en" } as never));
    expect(json).toContain('"screenId":"voice_read"');
    expect(json).toContain("Read-Aloud Voice");
  });
});

describe("the desk read-aloud voice picker", () => {
  it("builds, lists every voice with its blurb, and the non-active ones save via PUT", () => {
    const s = buildScreen("desk_voice_read", { personality: { ttsVoice: "sage" }, language: "en" } as never)!;
    expect(s).not.toBeNull();
    expect(s.screenId).toBe("desk_voice_read");
    expect(s.look).toBe("desk");
    const json = JSON.stringify(s);
    for (const v of TTS_VOICES) {
      expect(json, v.id).toContain(v.label);
      expect(json, v.id).toContain(v.blurb); // desk keeps sentence case
    }
    expect(json).toContain('"path":"/v1/personality"');
    expect(json).toContain('"method":"PUT"');
    // Non-active voices carry a save link; the active one shows "In use" and
    // therefore has NO save for its own id.
    expect(json).toContain('"ttsVoice":"nova"');
    expect(json).not.toContain('"ttsVoice":"sage"');
    expect(json).toContain("In use");
  });

  it("falls back to the default active voice when none is stored", () => {
    const json = JSON.stringify(buildScreen("desk_voice_read", { personality: {}, language: "en" } as never));
    // The default (nova) is active, so there is no save for it, but there is for others.
    expect(json).not.toContain('"ttsVoice":"nova"');
    expect(json).toContain('"ttsVoice":"sage"');
    expect(json).toContain("In use");
  });

  it("desk Settings links to the picker and names the current voice", () => {
    const json = JSON.stringify(buildScreen("desk_settings", { personality: { ttsVoice: "onyx" }, language: "en" } as never));
    expect(json).toContain('"screenId":"desk_voice_read"');
    expect(json).toContain("Onyx");          // the friendly label of the stored voice
    expect(json).toContain("Reading aloud"); // the section
  });
});
