import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

// What the apps used to decide or keep, now sent by the server (docs/server-push-audit.md, groups A and B): the
// words the server sent but never translated, the desktop's lists, the keyboards' word lists and key click, the
// runner's card on bots.computer, and the native name card retired for the Bots app.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.BOTS_APP = "true";

/** The translator: "T:" before every line, after `slowMs` when a test asks for a slow one. */
const translator = { slowMs: 0, calls: 0 };
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          translator.calls++;
          const content = req.messages[1]!.content;
          const items = JSON.parse(content.slice(content.lastIndexOf("Input JSON:\n") + "Input JSON:\n".length)) as string[];
          if (translator.slowMs) await new Promise((r) => setTimeout(r, translator.slowMs));
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => `T:${s}`) }) } }] };
        },
      },
    };
  },
}));
// The translation cache on disk is left alone: nothing read, nothing written.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const ours = (p: unknown) => String(p).includes(`${path.sep}data${path.sep}i18n`);
  const readFile = ((p: unknown, ...a: unknown[]) => (ours(p) ? Promise.reject(new Error("no cache")) : (real.readFile as (...x: unknown[]) => unknown)(p, ...a))) as typeof real.readFile;
  const writeFile = ((p: unknown, ...a: unknown[]) => (ours(p) ? Promise.resolve() : (real.writeFile as (...x: unknown[]) => unknown)(p, ...a))) as typeof real.writeFile;
  const mkdir = ((p: unknown, ...a: unknown[]) => (ours(p) ? Promise.resolve(undefined) : (real.mkdir as (...x: unknown[]) => unknown)(p, ...a))) as typeof real.mkdir;
  return { ...real, default: { ...real, readFile, writeFile, mkdir }, readFile, writeFile, mkdir };
});

const { buildBootstrap, buildKeyboardConfig } = await import("../src/experience/catalog.js");
const { localize, localizeKeyboardLabels } = await import("../src/experience/i18n.js");
const { DESKTOP_ROUTER, SWIPE_CORE_WORDS, deskVoices } = await import("../src/experience/appLists.js");
const { GRAMMAR_RULES } = await import("../src/agent/grammar.js");
const { withKeybotKeyboard } = await import("../src/keybot/keyboard.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");
const { RUNNER_CARD_WORDS } = await import("../src/experience/bots/screens/you.js");

type Flags = Record<string, unknown>;
const flagsOf = (b: { flags?: unknown }) => (b.flags ?? {}) as Flags;

describe("A1: the words the server sent but never translated", () => {
  it("the desktop's tray and notifications, the tones, the genders and the countries, in the person's language", async () => {
    const boot = buildBootstrap({ onboarded: true, formFactor: "desktop" });
    const f = flagsOf(await localize(boot, "hi"));
    const shell = f["desktop.shell"] as { tray: Record<string, string>; notify: Record<string, string>; gate: Record<string, string>; gateLayout: Record<string, unknown> };
    expect(shell.tray.quit).toBe("T:Quit X0 Bot");
    expect(shell.notify.micBusy).toBe("T:microphone is in use by another app");
    expect(shell.gate.title).toBe("X0 Bot");                        // the brand is never translated
    expect(shell.gateLayout.align).toBe("right");                   // a layout value is not a word
    expect(shell.gateLayout.scrim).toMatch(/^linear-gradient/);
    expect((f["desktop.tones"] as Array<{ id: string; label: string }>)[1]).toEqual({ id: "formal", label: "T:Formal" });
    expect((f["profile.genders"] as Array<{ key: string; label: string }>)[0]).toEqual({ key: "male", label: "T:Male" });
    const india = (f["auth.countries"] as Array<{ iso: string; name: string; dial: string }>).find((c) => c.iso === "IN")!;
    expect(india.dial).toBe("+91");
    expect(india.name).not.toBe("India");                           // the runtime's own name for it, no translation paid
    // English is untouched.
    const en = flagsOf(await localize(buildBootstrap({ onboarded: true, formFactor: "desktop" }), "en"));
    expect((en["desktop.shell"] as { tray: Record<string, string> }).tray.quit).toBe("Quit X0 Bot");
  });

  it("the keyboard's labels, and nothing else of its config", async () => {
    const cfg = buildKeyboardConfig(undefined, undefined, { platform: "ios", kbBuild: 42 });
    const out = await localizeKeyboardLabels(cfg, "ta");
    expect(out.labels.words_out_status).toBe(`T:${cfg.labels.words_out_status}`);
    expect(out.root).toBe(cfg.root);
    expect(out.flags).toBe(cfg.flags);
    expect(await localizeKeyboardLabels(cfg, "en")).toBe(cfg);
    expect(await localizeKeyboardLabels(cfg, undefined)).toBe(cfg);
  });

  it("a keyboard never waits on a slow translator: English now, the translation on the next fetch", async () => {
    translator.slowMs = 200;
    try {
      const cfg = buildKeyboardConfig(undefined, undefined, { platform: "android" });
      const first = await localizeKeyboardLabels(cfg, "mr", 20);
      expect(first.labels).toEqual(cfg.labels);
      await new Promise((r) => setTimeout(r, 400));
      const next = await localizeKeyboardLabels(cfg, "mr", 20);
      expect(next.labels.words_out_status).toBe(`T:${cfg.labels.words_out_status}`);
    } finally {
      translator.slowMs = 0;
    }
  });
});

describe("A2, B1, B4: the desktop's lists", () => {
  const desk = flagsOf(buildBootstrap({ onboarded: true, formFactor: "desktop", botsApp: true }));
  it("the tray's tones are the tones' names, not their ids", () => {
    expect(desk["desktop.tones"]).toEqual([
      { id: "none", label: "ZU" }, { id: "formal", label: "Formal" }, { id: "casual", label: "Casual" },
      { id: "very-casual", label: "Very Casual" }, { id: "excited", label: "Excited" },
    ]);
  });
  it("the person's own voices for the tray: the pinned ones, Zu left to the tones", () => {
    expect(deskVoices(null)).toEqual([]);
    const v = deskVoices({ pinnedPresetIds: ["signature", "professional", "gone"] } as never);
    expect(v.map((x) => x.id)).toEqual(["professional"]);
    expect(v[0]!.label).toBeTruthy();
  });
  it("the one-key router's lists, every pattern compiling as router.js compiles it", () => {
    for (const k of Object.keys(DESKTOP_ROUTER)) expect(desk[`desktop.router.${k}`], k).toEqual(DESKTOP_ROUTER[k as keyof typeof DESKTOP_ROUTER]);
    for (const p of DESKTOP_ROUTER.screenStrong) expect(() => new RegExp(p, "u")).not.toThrow();
    for (const t of DESKTOP_ROUTER.tasks) expect(new RegExp(t.re, "u").test("")).toBe(false);
    expect(new RegExp(DESKTOP_ROUTER.tasks[0]!.re, "u").test("plan my saturday")).toBe(true);
    expect(desk["desktop.router.names"]).toEqual(["X0", "Blip", "Tailzu"]);
  });
  it("Ask's grammar is the server's own rules, not a copy", () => {
    const g = desk["desktop.agent.grammar"] as Record<string, { source: string; flags: string }>;
    expect(g.headFiller).toEqual({ source: GRAMMAR_RULES.headFiller.source, flags: GRAMMAR_RULES.headFiller.flags });
    const re = new RegExp(g.politeRequest!.source, g.politeRequest!.flags);
    expect(re.test("Could you open it")).toBe(true);
  });
  it("the runner's page for the Bots app; nothing of this on a phone", () => {
    expect(desk["desktop.runner.screenId"]).toBe("bots.computer");
    expect(flagsOf(buildBootstrap({ onboarded: true, formFactor: "desktop" }))["desktop.runner.screenId"]).toBe("");
    const phone = flagsOf(buildBootstrap({ onboarded: true }));
    expect(phone["desktop.router.greetings"]).toBeUndefined();
    expect(phone["desktop.agent.grammar"]).toEqual({});
  });
});

describe("A3, A4, A5: the keyboards", () => {
  const ios = flagsOf(buildKeyboardConfig(undefined, undefined, { platform: "ios", kbBuild: 42 }));
  const android = flagsOf(buildKeyboardConfig(undefined, undefined, { platform: "android" }));
  it("swipe's word lists come from the server, Hinglish and the product's names included", () => {
    for (const f of [ios, android]) {
      expect(f["kb.swipe.coreWords"]).toEqual([...SWIPE_CORE_WORDS]);
      expect(f["kb.swipe.extraWords"]).toEqual(expect.arrayContaining(["tailzu", "tulmi", "keybot", "hai", "kal", "accha"]));
    }
    expect((ios["kb.swipe.coreWords"] as string[]).slice(0, 4)).toEqual(["the", "be", "to", "of"]);
  });
  it("the key click is said for everyone, as each keyboard behaves today; Keybot's choice still wins", () => {
    expect(ios["kb.key.sound"]).toBe(true);
    expect(android["kb.key.sound"]).toBe(false);
    const quiet = withKeybotKeyboard(buildKeyboardConfig(undefined, undefined, { platform: "ios" }), { sounds: false } as never);
    expect(flagsOf(quiet)["kb.key.sound"]).toBe(false);
  });
  it("keys the console could not see now have their values", () => {
    expect(ios["kb.flash.durationMs"]).toBe(260);
    expect(ios["kb.smartPunctuation"]).toBe(true);
    expect(ios["kb.space.holdToSpeak"]).toBe(false);
    expect(android["kb.icons"]).toEqual({});
    // Absence still means something for these.
    expect(ios["kb.dictation.targetApp"]).toBeUndefined();
    expect(ios["kb.look.force"]).toBeUndefined();
  });
});

const build = (screenId: string, client: "phone" | "desktop", api: Record<string, unknown>, can: string[] = []) =>
  buildBotsScreen({
    screenId, client, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya", email: "aanya@example.in" },
    can: new Set(["BotsKit", ...can]), desk: { pages: false, notes: false },
  }, fakeDeps({ api }));
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
function actionKinds(n: unknown, out: string[] = []): string[] {
  if (Array.isArray(n)) { n.forEach((x) => actionKinds(x, out)); return out; }
  if (n && typeof n === "object") {
    const o = n as Record<string, unknown>;
    if (typeof o.kind === "string") out.push(o.kind);
    for (const v of Object.values(o)) if (v && typeof v === "object") actionKinds(v, out);
  }
  return out;
}

describe("A6: the name card, for someone onboarded before the Bots app asked it", () => {
  const api = (onboarded: boolean) => ({
    "GET /v1/bots/first-run/profile": { name: "Aanya Rao", via: "email", source: "saved", gender: null, saved: false, onboarded },
    "GET /v1/personality": { personality: { assistantName: "Zara" } },
  });
  it("bots.name-it is About you alone, which closes once saved: not Name your X0 Bot, not the first run's finish", async () => {
    const s = await build("bots.name-it", "phone", api(true));
    const t = texts(s.root!);
    expect(t).toContain("What's your name?");
    expect(t).not.toContain("What will you call me?");
    const kinds = actionKinds(s.root);
    expect(kinds).toContain("navigateBack");
    expect(kinds).not.toContain("switchTab");
  });
  it("someone in the first run still gets both steps", async () => {
    const t = texts((await build("bots.name-it", "phone", api(false))).root!);
    expect(t).toContain("What's your name?");
    expect(t).toContain("What will you call me?");
  });
});

describe("B3: X0 Code on this computer, drawn on bots.computer", () => {
  const api = { "GET /v1/you/computers": { online: [], offline: [], helped: { jobs: 0, minutes: 0 } } };
  it("a window that has the card gets it, with every word it shows; any other gets none", async () => {
    const card = walk((await build("bots.computer", "desktop", api, ["DeskRunner"])).root!).find((n) => n.type === "DeskRunner");
    expect(card?.props).toEqual({ ...RUNNER_CARD_WORDS });
    expect(walk((await build("bots.computer", "desktop", api)).root!).some((n) => n.type === "DeskRunner")).toBe(false);
  });
  it("its words are translated with the page", async () => {
    const s = await build("bots.computer", "desktop", api, ["DeskRunner"]);
    const out = await localize(s, "bn");
    const card = walk(out.root!).find((n) => n.type === "DeskRunner")!;
    expect(card.props?.use).toBe(`T:${RUNNER_CARD_WORDS.use}`);
    expect(card.props?.stateWorking).toBe(`T:${RUNNER_CARD_WORDS.stateWorking}`);
  });
});
