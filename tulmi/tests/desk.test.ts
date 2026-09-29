import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({ text: "hey", durationSeconds: 1 })),
  estimateDurationSeconds: () => 0,
}));

// eslint-disable-next-line import/first
import { buildBootstrap, buildScreen } from "../src/experience/catalog.js";
import { resetPublishedVersions } from "../src/experience/desktopRelease.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// eslint-disable-next-line import/first
import { DESK_NAV, DESK_SCREENS } from "../src/experience/desk.js";
// eslint-disable-next-line import/first
import { writtenIn } from "../src/history/writtenIn.js";
// eslint-disable-next-line import/first
import { recordUsage, usageSummary } from "../src/usage/metering.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";

/**
 * What the desktop renderer (desktop/sdui.js COMPONENTS and ACTIONS) can draw
 * and do. A desk page that names anything else renders as nothing in the
 * window, so every page is checked against this list.
 */
const DESKTOP_COMPONENTS = new Set([
  "Screen", "Stack", "Spacer", "Text", "Image", "Icon", "Button", "TextField",
  "Chip", "Card", "List", "Divider", "Row", "Overline", "Heading", "Paragraph",
  "Quote", "Badge", "KeyValue", "Hero", "Switch", "SegmentedControl",
  "StatCard", "BarChart", "LineChart", "Sparkline", "PieChart", "DonutChart",
  "ProgressRing", "Gauge", "WordMeter", "Video", "Audio", "Grid",
  "SVG", "Gradient", "BlurBackground", "FlipText", "Modal", "ProgressBar",
  "SwipeAction", "NeuralField", "ChatThread", "VoiceToggle", "VoiceButton",
  "VoiceSession", "DeskShell", "Keys",
]);
const DESKTOP_ACTIONS = new Set([
  "navigate", "back", "switchTab", "callEndpoint", "setState", "toggleState",
  "toggleInArray", "refresh", "openUrl", "toast", "haptic", "sequence",
  "delay", "reloadScreen", "navigateBack", "dismiss", "clearState", "appendState",
  "condition", "iap.subscribe", "iap.showPaywall", "iap.restore",
  "copyText", "desktop.config", "dictate", "signOut",
]);

type AnyNode = { type?: string; props?: Record<string, unknown>; children?: AnyNode[]; on?: Record<string, unknown> };

function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((c) => walk(c, visit)); return; }
  const n = node as AnyNode;
  if (typeof n.type === "string") visit(n);
  for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, visit);
}

function actionKinds(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((c) => actionKinds(c, out)); return out; }
  const o = node as Record<string, unknown>;
  if (typeof o.kind === "string" && !("tabs" in o)) out.add(o.kind);
  // A request's body and a list's rows are data, not actions.
  for (const [k, v] of Object.entries(o)) if (k !== "body" && k !== "items") actionKinds(v, out);
  return out;
}

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const history = [
  { id: "a1", kind: "voice", input: "haan bhai kal milte hain", output: "Haan bhai, kal milte hain.", wordsOut: 4, createdAt: iso(60_000), targetApp: "whatsapp" },
  { id: "a2", kind: "voice", input: "send the deck tonight", output: "Send the deck tonight.", wordsOut: 4, createdAt: iso(3 * 86_400_000) },
];
const sampleCtx = {
  personality: {
    vocabulary: "Tailzu\nKubernetes",
    dictionary: [{ word: "tail zoo", replacement: "Tailzu" }],
    snippets: "my email = hello@example.com",
    activePresetId: "signature",
    stylePortrait: { examples: 2, core: "short sentences" },
    languages: ["hi", "en"],
  },
  language: "en",
  history,
  usage: {
    month: { words: 1200, audioSeconds: 600, requests: 30 },
    total: { words: 5000, audioSeconds: 2400, requests: 120 },
    today: { words: 8, audioSeconds: 6, requests: 2 },
  },
  stats: {
    window: "month", requests: 30, wordsOut: 1200, audioSeconds: 600, minutesSaved: 20,
    sparklinePerDay: Array.from({ length: 30 }, (_, i) => i % 3), currentStreak: 3, bestStreak: 5,
    topApps: [{ app: "whatsapp", words: 700 }, { app: "gmail", words: 500 }],
    writtenIn: [{ key: "hinglish", words: 700 }, { key: "en", words: 500 }],
  },
  allowance: { base: 800, earned: 0, total: 800, used: 120, remaining: 680, streakDays: 0, grants: [] },
  email: "someone@example.com",
  tzOffsetMinutes: 330,
} as never;

describe("the desk is for a window that can draw it", () => {
  it("a desktop that declared DeskShell gets the masthead's tabs and lands on Today", () => {
    const b = buildBootstrap({ formFactor: "desktop", desk: true } as never) as any;
    expect(b.navigation.tabs.map((t: { id: string }) => t.id)).toEqual(DESK_NAV.tabs.map((t) => t.id));
    expect(b.initialScreenId).toBe("desk_today");
    expect(b.flags["desktop.desk"]).toBe(true);
    expect(b.flags["desktop.desk.settingsScreenId"]).toBe("desk_settings");
    expect(b.flags["quota.screenId"]).toBe("desk_plan");
    expect(b.flags["desktop.mast"]).toEqual({ logo: 19, brand: 18, tabs: "center" });
  });

  it("a closed desktop window opens fresh next time", () => {
    const b = buildBootstrap({ formFactor: "desktop" } as never) as any;
    expect(b.flags["desktop.window.closeAction"]).toBe("close");
    expect(b.flags["desktop.update"]).toMatchObject({ latest: "0.2.1", url: "https://tailzu.space/download" });
  });

  it("an older desktop, and every phone, keep what they had", () => {
    for (const opts of [{ formFactor: "desktop" }, { formFactor: "phone", desk: true }, {}]) {
      const b = buildBootstrap(opts as never) as any;
      expect(b.initialScreenId).not.toBe("desk_today");
      expect(b.flags["desktop.desk"]).toBeUndefined();
      expect(b.navigation.tabs.some((t: { id: string }) => t.id.startsWith("desk_"))).toBe(false);
    }
  });
});

describe("the desk pages", () => {
  const ctxs = { sample: sampleCtx, empty: { personality: {}, language: "en" } as never };

  for (const id of DESK_SCREENS) {
    for (const [name, ctx] of Object.entries(ctxs)) {
      it(`${id} builds (${name}) with only what the window can draw`, () => {
        const s = buildScreen(id, ctx) as any;
        expect(s).toBeTruthy();
        expect(s.screenId).toBe(id);
        expect(s.look).toBe("desk");
        expect(s.root.props.layout).toBe("full");
        walk(s.root, (n) => {
          expect(DESKTOP_COMPONENTS.has(n.type!), `component ${n.type}`).toBe(true);
          const cls = n.props?.cls;
          if (cls !== undefined) {
            // Only the window's named styles pass (sdui.js cls()); anything
            // else is dropped and the text falls back to the phone's colours.
            for (const c of String(cls).split(/\s+/).filter(Boolean)) expect(c, `class on ${n.type}`).toMatch(/^d-[a-z0-9-]+$/);
          }
        });
        for (const k of actionKinds(s.root)) expect(DESKTOP_ACTIONS.has(k), `action ${k}`).toBe(true);
      });
    }
  }

  it("Today shows today's note, said above written, and not an older one", () => {
    const s = JSON.stringify(buildScreen("desk_today", sampleCtx));
    expect(s).toContain("haan bhai kal milte hain");
    expect(s).toContain("Haan bhai, kal milte hain.");
    expect(s).not.toContain("send the deck tonight");
  });

  it("Today's Copy carries the note's own text, and there is no Delete", () => {
    // An action reads its values when clicked, when a list row's item is gone:
    // Copy put "" on the clipboard. Each note's action holds its text now.
    const s = JSON.stringify(buildScreen("desk_today", sampleCtx));
    expect(s).toContain('"kind":"copyText","text":"Haan bhai, kal milte hain.","message":"Copied"');
    expect(s).not.toContain("$state.item");
    expect(s).not.toContain('"label":"Delete"');
    expect(s).not.toContain("/v1/history/");
  });

  it("Words' Remove names the word it removes", () => {
    const s = JSON.stringify(buildScreen("desk_words", sampleCtx));
    expect(s).not.toContain("$state.item");
    expect(s).toContain('"body":{"remove":"Kubernetes","kind":"word"}');
  });

  it("Today with nothing written offers to start talking", () => {
    const s = buildScreen("desk_today", { personality: {}, language: "en", history: [] } as never);
    expect(actionKinds(s!.root).has("dictate")).toBe(true);
  });

  it("Insights names the languages as their speakers write them", () => {
    const s = JSON.stringify(buildScreen("desk_insights", sampleCtx));
    expect(s).toContain("Hinglish");
    expect(s).toContain("English");
  });

  it("Words lists the vocabulary, the proof marks and the snippets", () => {
    const s = JSON.stringify(buildScreen("desk_words", sampleCtx));
    for (const w of ["Kubernetes", "tail zoo", "my email", "hello@example.com"]) expect(s).toContain(w);
    expect(s).toContain("/v1/words");
    expect(s).toContain("/v1/snippets");
  });

  it("Voices shows every voice's sentence and marks the active one", () => {
    const s = JSON.stringify(buildScreen("desk_voices", sampleCtx));
    expect(s).toContain("/v1/personality");
    expect(s).toContain("Haan bhai, kal milte hain paanch baje.");
  });
});

describe("leaving a shared screen lands on the desk, not a phone tab", () => {
  const desk = { ...sampleCtx, formFactor: "desktop", can: new Set(["DeskShell", "Keys"]) } as never;
  const phone = { ...sampleCtx } as never;
  const exits = (id: string, ctx: never) => JSON.stringify(buildScreen(id, ctx));

  it("training returns to the Train page on the desk and to You on the phone", () => {
    expect(exits("training_live", desk)).toContain('"tabId":"desk_train"');
    expect(exits("training_live", desk)).not.toContain('"screenId":"personality"');
    expect(exits("training_live", phone)).toContain('"screenId":"personality"');
  });

  it("a purchase lands on Today on the desk and on Stats on the phone", () => {
    expect(exits("paywall", desk)).toContain('"tabId":"desk_today"');
    expect(exits("paywall", desk)).not.toContain('"screenId":"stats"');
    expect(exits("paywall", phone)).toContain('"screenId":"stats"');
  });

  it("every screen a desk page opens names no phone tab as its way out", () => {
    const all = new Set<string>();
    for (const id of DESK_SCREENS) {
      const opened = new Set<string>();
      walk(buildScreen(id, desk)!.root, (n) => {
        const a = (n as { on?: Record<string, unknown> }).on;
        for (const v of Object.values(a ?? {})) {
          const act = v as { kind?: string; screenId?: string };
          if (act?.kind === "navigate" && act.screenId && !DESK_SCREENS.has(act.screenId)) opened.add(act.screenId);
        }
      });
      for (const sid of opened) {
        all.add(sid);
        const s = exits(sid, desk);
        for (const tab of ["personality", "stats", "home"]) {
          expect(s, `${id} → ${sid}`).not.toContain(`"screenId":"${tab}"`);
          expect(s, `${id} → ${sid}`).not.toContain(`"tabId":"${tab}"`);
        }
      }
    }
    expect([...all]).toEqual(expect.arrayContaining(["training_live", "languages"]));
  });
});

describe("the network on the desk", () => {
  const withField = { ...sampleCtx, formFactor: "desktop", can: new Set(["DeskShell", "Keys", "DeskField"]) } as never;
  const older = { ...sampleCtx, formFactor: "desktop", can: new Set(["DeskShell", "Keys"]) } as never;
  const fields = (s: unknown) => { let k = 0; walk(s, (n) => { if (n.type === "NeuralField") k++; }); return k; };

  it("the Train page carries it for a build that can show it on a page", () => {
    expect(fields(buildScreen("desk_train", withField)!.root)).toBe(1);
  });

  it("an older build, which drew it behind the sheet, is not sent it", () => {
    expect(fields(buildScreen("desk_train", older)!.root)).toBe(0);
  });

  it("no other desk page carries it", () => {
    for (const id of DESK_SCREENS) if (id !== "desk_train") expect(fields(buildScreen(id, withField)!.root), id).toBe(0);
  });
});

describe("a newer build, said in the window", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-dl-"));
  const at = (appVersion: string, osName: string) =>
    ({ ...sampleCtx, formFactor: "desktop", can: new Set(["DeskShell"]), appVersion, os: osName }) as never;
  const card = (s: unknown) => JSON.stringify((s as { root: { children: unknown[] } }).root.children[0]);

  beforeAll(() => {
    process.env.DOWNLOADS_DIR = dir;
    fs.writeFileSync(path.join(dir, "Tailzu-Setup.exe.version"), "0.2.2\n");
    resetPublishedVersions();
  });
  afterAll(() => { delete process.env.DOWNLOADS_DIR; resetPublishedVersions(); });

  it("tops every page on an older build, and its button downloads the installer", () => {
    for (const id of DESK_SCREENS) {
      const c = card(buildScreen(id, at("0.2.1", "windows")));
      expect(c, id).toContain("Tailzu 0.2.2 is ready.");
      expect(c, id).toContain('"kind":"openUrl","url":"https://tailzu.space/downloads/Tailzu-Setup.exe"');
    }
  });

  it("is not there once the build is current", () => {
    expect(card(buildScreen("desk_today", at("0.2.2", "windows")))).not.toContain("is ready");
  });

  it("is not offered to an OS with nothing newer published", () => {
    expect(card(buildScreen("desk_today", at("0.2.1", "mac")))).not.toContain("is ready");
  });

  it("is not guessed at for a build that does not say its version", () => {
    expect(card(buildScreen("desk_today", at("", "windows")))).not.toContain("is ready");
  });

  it("tells the tray's notification the same version, with the installer as its link", () => {
    const b = buildBootstrap({ formFactor: "desktop", desk: true, os: "win32" } as never) as { flags: Record<string, { latest: string; url: string }> };
    expect(b.flags["desktop.update"]!.latest).toBe("0.2.2");
    expect(b.flags["desktop.update"]!.url).toBe("https://tailzu.space/downloads/Tailzu-Setup.exe");
  });

  describe("installed from the window", () => {
    const sha = "ab".repeat(64);
    const selfUpdating = (appVersion: string) =>
      ({ ...sampleCtx, formFactor: "desktop", can: new Set(["DeskShell", "DeskSelfUpdate"]), appVersion, os: "windows" }) as never;
    beforeAll(() => { fs.writeFileSync(path.join(dir, "Tailzu-Setup.exe.sha512"), sha.toUpperCase() + "\n"); resetPublishedVersions(); });
    afterAll(() => { fs.rmSync(path.join(dir, "Tailzu-Setup.exe.sha512"), { force: true }); resetPublishedVersions(); });

    it("a build that can update itself gets one button that installs, checked against the published checksum", () => {
      const s = buildScreen("desk_today", selfUpdating("0.2.1")) as { root: { children: Array<Record<string, unknown>> } };
      const c = JSON.stringify(s.root.children[0]);
      expect(c).toContain('"kind":"installUpdate"');
      expect(c).toContain(`"sha512":"${sha}"`);
      expect(c).toContain('"version":"0.2.2"');
      expect(c).toContain('"url":"https://tailzu.space/downloads/Tailzu-Setup.exe"');
      expect(c).toContain("Update now");
      // Its line follows the install, and the button steps aside while it runs.
      expect(c).toContain('"bind":{"content":"upd.line"}');
      expect(c).toContain('"visibleIf":{"falsy":"upd.busy"}');
      expect(c).toContain("{pct}");
      expect(c).not.toContain('"kind":"openUrl"');
    });

    it("an older build keeps the download link", () => {
      expect(card(buildScreen("desk_today", at("0.2.1", "windows")))).toContain('"kind":"openUrl"');
    });

    it("the tray's notification is told there is a checksum, so it can open the card instead", () => {
      const b = buildBootstrap({ formFactor: "desktop", desk: true, os: "win32" } as never) as { flags: Record<string, { sha512?: string }> };
      expect(b.flags["desktop.update"]!.sha512).toBe(sha);
    });

    it("with no checksum recorded, even a self-updating build gets the link", () => {
      fs.rmSync(path.join(dir, "Tailzu-Setup.exe.sha512"), { force: true });
      resetPublishedVersions();
      const c = card(buildScreen("desk_today", selfUpdating("0.2.1")));
      expect(c).toContain('"kind":"openUrl"');
      expect(c).not.toContain("installUpdate");
      fs.writeFileSync(path.join(dir, "Tailzu-Setup.exe.sha512"), sha + "\n");
      resetPublishedVersions();
    });
  });
});

describe("what a note was written in", () => {
  it("a script names its language", () => {
    expect(writtenIn("நாளை சந்திப்போம்")).toBe("ta");
    expect(writtenIn("কাল দেখা হবে")).toBe("bn");
  });
  it("a shared script is decided by the person's own languages", () => {
    expect(writtenIn("उद्या भेटू")).toBe("hi");
    expect(writtenIn("उद्या भेटू", ["mr", "en"])).toBe("mr");
  });
  it("Hindi in English letters is Hinglish, not English", () => {
    expect(writtenIn("haan bhai kal milte hain")).toBe("hinglish");
    expect(writtenIn("Send the deck tonight, it is done")).toBe("en");
  });
  it("other Latin-letter languages by their everyday words", () => {
    expect(writtenIn("estoy en la oficina y llego tarde")).toBe("es");
  });
  it("nothing to read is no language", () => {
    expect(writtenIn("")).toBeNull();
    expect(writtenIn("   123 !!")).toBeNull();
  });
});

describe("today, in the caller's day", () => {
  it("is counted only when a clock was given", async () => {
    const user = { id: "static-desk-today" } as never;
    await recordUsage({ user, audioSeconds: 12, words: 30, model: "m", source: "test" } as never);
    const withClock = await usageSummary(user, 330);
    expect(withClock.today).toEqual({ words: 30, audioSeconds: 12, requests: 1 });
    const without = await usageSummary(user);
    expect(without.today).toBeUndefined();
    expect(without.month.words).toBe(30);
  });
});

describe("words and snippets, one at a time", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  const personality = async () => (await app.inject({ method: "GET", url: "/v1/personality" })).json().personality;

  it("adds a word once, and removes it", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: "/v1/words", payload: { add: "Deskword" } });
      expect(res.statusCode).toBe(200);
    }
    let lines = String((await personality()).vocabulary ?? "").split("\n");
    expect(lines.filter((l) => l === "Deskword")).toHaveLength(1);
    await app.inject({ method: "POST", url: "/v1/words", payload: { remove: "deskword" } });
    lines = String((await personality()).vocabulary ?? "").split("\n");
    expect(lines).not.toContain("Deskword");
  });

  it("removing a proof mark removes its dictionary pair", async () => {
    await app.inject({ method: "PUT", url: "/v1/personality", payload: { dictionary: [{ word: "tail zoo", replacement: "Tailzu" }, { word: "k eight s", replacement: "K8s" }] } });
    await app.inject({ method: "POST", url: "/v1/words", payload: { remove: "Tailzu", kind: "pair" } });
    const d = (await personality()).dictionary ?? [];
    expect(d.map((x: { replacement: string }) => x.replacement)).toEqual(["K8s"]);
  });

  it("needs a word", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/words", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("saves a snippet on one line, replaces it by name, and removes it", async () => {
    await app.inject({ method: "POST", url: "/v1/snippets", payload: { say: "sign off", get: "Thanks,\nAsha" } });
    expect(String((await personality()).snippets)).toContain("sign off = Thanks,\\nAsha");
    await app.inject({ method: "POST", url: "/v1/snippets", payload: { say: "Sign off", get: "Best" } });
    let s = String((await personality()).snippets);
    expect(s).toContain("Sign off = Best");
    expect(s).not.toContain("Asha");
    await app.inject({ method: "POST", url: "/v1/snippets", payload: { remove: "sign off" } });
    s = String((await personality()).snippets);
    expect(s.toLowerCase()).not.toContain("sign off");
  });

  it("a snippet needs a name and what it writes", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/snippets", payload: { say: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("the bootstrap reads the window's components", async () => {
    const boot = (components?: string[]) => app.inject({
      method: "POST", url: "/v1/app/bootstrap",
      payload: { capabilities: { device: { formFactor: "desktop" }, ...(components ? { components } : {}) } },
    });
    const desk = await boot(["DeskShell", "Keys"]);
    expect(desk.statusCode).toBe(200);
    expect(desk.json().initialScreenId).toBe("desk_today");
    const older = await boot();
    expect(older.json().initialScreenId).not.toBe("desk_today");
  });

  it("a desk page is served through the screen route", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/app/screen",
      payload: { screenId: "desk_today", capabilities: { device: { formFactor: "desktop" }, components: ["DeskShell"] }, tzOffsetMinutes: 330 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().look).toBe("desk");
  });
});
