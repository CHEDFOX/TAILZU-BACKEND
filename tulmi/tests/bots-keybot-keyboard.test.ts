/**
 * KEYBOT'S SETTINGS, REAL (src/keybot/keyboard.ts, GET /v1/keyboard/config, POST /v1/speak):
 *
 *   - nothing chosen, nothing changed: the keyboard config is the same object, byte for byte, on both platforms
 *   - key height moves the key rows and the frame together; the tools row stays
 *   - haptics: Strong is a stronger style, Light the keyboard's own, Off quiets the rest without undoing keys picked one by one
 *   - the Keybot key moves beside the space bar in both appearances, or stays on top
 *   - look, key sounds and hold space to speak are knobs sent only when chosen
 *   - over HTTP: the person's saved choices reach their keyboard config, and their read-aloud speed reaches the voice
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

// What /v1/speak hands the voice, without calling it.
const tts = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("../src/pipeline/tts.js", async (orig) => ({
  ...(await orig<typeof import("../src/pipeline/tts.js")>()),
  synthesize: vi.fn(async (input: Record<string, unknown>) => {
    tts.calls.push(input);
    return { audio: Buffer.from("fake-audio"), contentType: "audio/mpeg" };
  }),
}));
vi.mock("../src/pipeline/cleanup.js", () => ({
  clean: vi.fn(async (s: string) => `cleaned:${s}`),
  assist: vi.fn(async (s: string) => `assisted:${s}`),
  cleanBasic: vi.fn(async (s: string) => `basic:${s}`),
  cleanStream: async function* () {},
  draftReply: vi.fn(async () => "drafted"),
  inferStyle: vi.fn(async () => ({})),
  refineWithTone: vi.fn(async (s: string) => `refined:${s}`),
  LLM_TONES: ["formal", "casual", "very-casual", "excited"],
  expandSnippets: (s: string) => s,
}));
vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({ text: "", durationSeconds: 0 })),
  estimateDurationSeconds: () => 0,
}));

import { buildApp } from "../src/server.js";
import { buildKeyboardConfig } from "../src/experience/catalog.js";
import { KEY_ROWS, KEY_ROW_HEIGHT, STRONG_HAPTIC_STYLE, withKeybotKeyboard } from "../src/keybot/keyboard.js";
import { paceFor } from "../src/pipeline/tts.js";
import type { Personality } from "../../shared/types/api.js";
import type { KeyboardNode } from "../../shared/types/sdui.js";

type Cfg = ReturnType<typeof buildKeyboardConfig>;
const PLATFORMS = ["ios", "android"] as const;
const build = (platform: (typeof PLATFORMS)[number] = "ios", p?: Personality) => buildKeyboardConfig(p, "kb-user", { platform });
const rows = (c: Cfg) => (c.root?.children ?? []) as KeyboardNode[];
const has = (n: KeyboardNode, type: string) => (n.children ?? []).some((c) => c.type === type);
const toolsRows = (c: Cfg) => rows(c).filter((r) => has(r, "SuggestionBar"));
const spaceRows = (c: Cfg) => rows(c).filter((r) => has(r, "SpaceKey"));
const flag = (c: Cfg, k: string) => (c.flags as Record<string, unknown>)[k];

describe("nothing chosen, nothing changed", () => {
  const people: Array<Personality | undefined> = [undefined, {}, { hapticsAll: true, hapticKeys: ["space", "q"] }];
  for (const platform of PLATFORMS) {
    it(`${platform}: the config is the same, byte for byte`, () => {
      for (const p of people) {
        const cfg = build(platform, p);
        const before = JSON.stringify(cfg);
        for (const choices of [undefined, {}, { look: undefined, height: "normal" as const, keyAt: "top" as const, sounds: undefined, holdSpace: false }, { haptics: "light" as const }]) {
          const out = withKeybotKeyboard(cfg, choices, p);
          expect(out).toBe(cfg);
          expect(JSON.stringify(out)).toBe(before);
        }
      }
    });
  }
  it("sends none of the new knobs unless chosen; the key click and hold-space are said as each keyboard does today", () => {
    const cfg = build();
    expect(flag(cfg, "kb.look.force")).toBeUndefined();
    // Said for everyone now (appLists.ts keyboardLists, the audit's A4): iOS clicks, Android is quiet, neither holds space.
    expect(flag(cfg, "kb.key.sound")).toBe(true);
    expect(flag(build("android"), "kb.key.sound")).toBe(false);
    expect(flag(cfg, "kb.space.holdToSpeak")).toBe(false);
  });
});

describe("key height", () => {
  it("moves every key row and the frame by the same four rows; the tools row stays", () => {
    const cfg = build();
    const keyRows = rows(cfg).filter((r) => r.type === "Row" && r.style?.height === KEY_ROW_HEIGHT && !has(r, "SuggestionBar"));
    // Every layer is four key rows (letters, 123, #+=, the number pad).
    expect(keyRows.filter((r) => JSON.stringify(r.visibleIf).includes('"en"') && !JSON.stringify(r.visibleIf).includes('"123"'))).toHaveLength(KEY_ROWS);
    for (const [height, row] of [["tall", 48], ["short", 40]] as const) {
      const out = withKeybotKeyboard(cfg, { height }, undefined);
      const grow = (row - KEY_ROW_HEIGHT) * KEY_ROWS;
      expect(rows(out).filter((r) => r.style?.height === row)).toHaveLength(keyRows.length);
      for (const t of toolsRows(out)) expect(t.style?.height).toBe(KEY_ROW_HEIGHT);
      expect(flag(out, "kb.height.pt")).toBe((flag(cfg, "kb.height.pt") as number) + grow);
      expect(flag(out, "kb.height.byWidth")).toEqual((flag(cfg, "kb.height.byWidth") as Array<{ maxWidth: number; height: number }>)
        .map((b) => ({ ...b, height: b.height + grow })));
    }
    expect(flag(cfg, "kb.height.pt")).toBe(272);   // the config it was built from is untouched
  });
});

describe("haptics", () => {
  it("Strong is a stronger style; Light is the keyboard's own tick", () => {
    expect(flag(withKeybotKeyboard(build(), { haptics: "strong" }, { hapticsAll: true }), "kb.haptics.style")).toBe(STRONG_HAPTIC_STYLE);
    expect(flag(withKeybotKeyboard(build(), { haptics: "light" }, { hapticsAll: true }), "kb.haptics.style")).toBe("selection");
  });
  it("Off quiets everything, unless keys were picked one by one or the master was turned on since", () => {
    expect(flag(withKeybotKeyboard(build(), { haptics: "off" }, {}), "kb.haptics.enabled")).toBe(false);
    const picked: Personality = { hapticKeys: ["space"] };
    const kept = withKeybotKeyboard(build("ios", picked), { haptics: "off" }, picked);
    expect(flag(kept, "kb.haptics.enabled")).toBe(true);
    expect(flag(kept, "kb.haptics.keys")).toEqual({ space: true });
    expect(flag(withKeybotKeyboard(build("android", { hapticsAll: true }), { haptics: "off" }, { hapticsAll: true }), "kb.haptics.enabled")).toBe(true);
  });
});

describe("the Keybot key", () => {
  for (const platform of PLATFORMS) {
    for (const side of ["left", "right"] as const) {
      it(`${platform}: ${side} of space, in both appearances, out of the tools row`, () => {
        const cfg = build(platform);
        const before = toolsRows(cfg).map((r) => r.children!.find((c) => c.type === "MicKey")!);
        expect(before).toHaveLength(2);
        const out = withKeybotKeyboard(cfg, { keyAt: side }, undefined);
        for (const t of toolsRows(out)) expect(has(t, "MicKey")).toBe(false);
        expect(spaceRows(out)).toHaveLength(2);   // the letter page and the 123 / #+= pages
        for (const r of spaceRows(out)) {
          const kids = r.children!;
          const space = kids.findIndex((c) => c.type === "SpaceKey");
          const mics = side === "left" ? kids.slice(space - 2, space) : kids.slice(space + 1, space + 3);
          expect(mics.map((m) => m.type)).toEqual(["MicKey", "MicKey"]);
          mics.forEach((m, i) => {
            expect(m.props).toEqual(before[i]!.props);
            expect(m.style).toMatchObject({ width: 44, bg: before[i]!.style!.bg, fg: before[i]!.style!.fg });
            expect(m.visibleIf).toEqual({ all: [{ falsy: "state.secured" }, toolsRows(cfg)[i]!.visibleIf] });
          });
        }
      });
    }
  }
  it("Top is where it already is", () => {
    const cfg = build();
    expect(withKeybotKeyboard(cfg, { keyAt: "top" }, undefined)).toBe(cfg);
  });
});

describe("look, key sounds, hold space to speak", () => {
  it("are knobs sent when chosen", () => {
    const out = withKeybotKeyboard(build(), { look: "dark", sounds: true, holdSpace: true }, undefined);
    expect(flag(out, "kb.look.force")).toBe("dark");
    expect(flag(out, "kb.key.sound")).toBe(true);
    expect(flag(out, "kb.space.holdToSpeak")).toBe(true);
    expect(flag(withKeybotKeyboard(build(), { look: "light" }, undefined), "kb.look.force")).toBe("light");
  });
  it("key sounds: not chosen is the keyboard's own way, Off sends false, On sends true", () => {
    expect(flag(withKeybotKeyboard(build(), { sounds: false }, undefined), "kb.key.sound")).toBe(false);
    expect(flag(withKeybotKeyboard(build("android"), {}, undefined), "kb.key.sound")).toBe(false);
    expect(flag(withKeybotKeyboard(build("android"), { sounds: true }, undefined), "kb.key.sound")).toBe(true);
  });
});

describe("read-aloud speed, as the voice takes it", () => {
  it("is a rate for tts-1, the pace in the instructions for the gpt-4o voices, and nothing at normal", () => {
    expect(paceFor("tts-1", 1.25)).toEqual({ speed: 1.25 });
    expect(paceFor("tts-1-hd", 0.8, "calm")).toEqual({ speed: 0.8, instructions: "calm" });
    expect(paceFor("gpt-4o-mini-tts", 1.5).instructions).toBe("Speak much faster than usual, at about 1.5× your normal pace.");
    expect(paceFor("gpt-4o-mini-tts", 0.8, "Warm.").instructions).toBe("Warm. Speak a little slower than usual, at about 0.8× your normal pace.");
    expect(paceFor("gpt-4o-mini-tts", 1.5)).not.toHaveProperty("speed");
    expect(paceFor("gpt-4o-mini-tts", 1, "calm")).toEqual({ instructions: "calm" });
    expect(paceFor("tts-1", undefined)).toEqual({});
  });
});

describe("over HTTP", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const IOS = { "user-agent": "TailzuKeyboard CFNetwork Darwin" };
  const ANDROID = { "user-agent": "okhttp/4.12 TailzuKeyboard" };
  const config = async (headers: Record<string, string>) => (await app.inject({ method: "GET", url: "/v1/keyboard/config", headers })).body;
  const prefs = (payload: object) => app.inject({ method: "PUT", url: "/v1/keybot/prefs", payload });

  // Runs first, while the dev person has chosen nothing.
  it("a person with no keyboard choices gets the config byte for byte", async () => {
    const ios = await config(IOS), android = await config(ANDROID);
    expect((await prefs({ read: { speed: "1" } })).statusCode).toBe(200);
    expect((await prefs({ keyboard: {} })).statusCode).toBe(200);
    expect(await config(IOS)).toBe(ios);
    expect(await config(ANDROID)).toBe(android);
  });

  it("their choices reach their keyboard", async () => {
    expect((await prefs({ keyboard: { height: "tall", haptics: "strong", keyAt: "right", look: "light", sounds: true, holdSpace: true } })).statusCode).toBe(200);
    for (const ua of [IOS, ANDROID]) {
      const c = JSON.parse(await config(ua)) as Cfg;
      expect(flag(c, "kb.height.pt")).toBe(272 + 16);
      expect(flag(c, "kb.haptics.style")).toBe(STRONG_HAPTIC_STYLE);
      expect(flag(c, "kb.haptics.all")).toBe(true);   // the PUT turned the master on
      expect(flag(c, "kb.look.force")).toBe("light");
      expect(flag(c, "kb.key.sound")).toBe(true);
      expect(flag(c, "kb.space.holdToSpeak")).toBe(true);
      for (const t of toolsRows(c)) expect(has(t, "MicKey")).toBe(false);
      for (const r of spaceRows(c)) expect(r.children![r.children!.findIndex((k) => k.type === "SpaceKey") + 1]!.type).toBe("MicKey");
    }
  });

  it("the read-aloud speed reaches the voice; normal sends none", async () => {
    tts.calls.length = 0;
    expect((await app.inject({ method: "POST", url: "/v1/speak", payload: { text: "hello" } })).statusCode).toBe(200);
    expect(tts.calls[0]).not.toHaveProperty("speed");
    expect((await prefs({ read: { speed: "1.25" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/speak", payload: { text: "hello" } })).statusCode).toBe(200);
    expect(tts.calls[1]).toMatchObject({ text: "hello", speed: 1.25 });
  });

  it("Key sounds Off from the page is an explicit false", async () => {
    expect((await prefs({ keyboard: { sounds: "off" } })).statusCode).toBe(200);
    expect(flag(JSON.parse(await config(IOS)) as Cfg, "kb.key.sound")).toBe(false);
    expect((await prefs({ keyboard: { sounds: "loud" } })).statusCode).toBe(400);
  });

  it("no longer takes the two read-aloud switches nothing acted on", async () => {
    expect((await prefs({ read: { driving: true } })).statusCode).toBe(400);
    expect((await prefs({ read: { draftBack: true } })).statusCode).toBe(400);
  });
});
