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
import { DESK_NAV, DESK_SCREENS, deskNav } from "../src/experience/desk.js";
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
  // Sent only to a window that declared DeskNotes (sdui.js runs it).
  "notes.toggle",
  // Sent only to a window that declared DeskSystemAudio (a Mac).
  "notes.allowSystemAudio",
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
  notes: [
    { id: "11111111-1111-4111-8111-111111111111", status: "ready", startedAt: iso(3_600_000), durationSeconds: 1800, words: 2400,
      title: "Launch plan with Priya", summary: "Agreed to ship on Friday.",
      people: [{ label: "Speaker 1", name: "Priya" }], organised: true },
    { id: "22222222-2222-4222-8222-222222222222", status: "failed", startedAt: iso(2 * 86_400_000), durationSeconds: 300, words: 200,
      title: "", summary: "", people: [], organised: false },
  ],
  note: {
    id: "11111111-1111-4111-8111-111111111111", status: "ready", startedAt: iso(3_600_000), durationSeconds: 1800, words: 2400,
    title: "Launch plan with Priya", summary: "You and Priya agreed to ship on Friday, after a day of testing.", organised: true,
    people: [{ label: "Speaker 1", name: "Priya" }],
    highlights: [
      { speaker: "You", text: "The build will be ready on Thursday." },
      { speaker: "Speaker 1", text: "I want a full day of testing before we ship, so Friday." },
    ],
    transcript: [
      { at: 0, speaker: "You", text: "The build is ready Thursday." },
      { at: 6, speaker: "Speaker 1", text: "Then I want a day of testing, so Friday." },
    ],
  },
  can: new Set(["DeskNotes"]),
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
    // Tapping a room still switches the voice: the activate PUT is kept.
    expect(s).toContain('"method":"PUT","path":"/v1/personality"');
  });

  it("Voices offers an Add-voice affordance that reveals a new-voice editor", () => {
    const s = JSON.stringify(buildScreen("desk_voices", sampleCtx));
    // The one non-card affordance: a link that opens the inline add editor,
    // which hides itself once open (same reveal as Words / History).
    expect(s).toContain('"label":"Add voice"');
    expect(s).toContain('"kind":"setState","path":"edit.add","value":true');
    expect(s).toContain('"falsy":"edit.add"');
    expect(s).toContain('"truthy":"edit.add"');
    // Its two fields, bound to the add slot, and the phone's own wording.
    expect(s).toContain('"content":"New voice"');
    expect(s).toContain('"content":"How it writes"');
    expect(s).toContain('"bind":{"value":"vc.add.name"}');
    expect(s).toContain('"bind":{"value":"vc.add.prompt"}');
    // Save POSTs a new tone (no id ⇒ the server mints a custom one), refreshes.
    expect(s).toContain('"method":"POST","path":"/v1/personality/tone","body":{"name":"$state.vc.add.name","promptStyle":"$state.vc.add.prompt"}');
    expect(s).toContain('"onSuccess":{"kind":"refresh"}');
    expect(s).toContain('"onError":{"kind":"toast","message":"Couldn\'t save that voice. Try again."}');
    // The add editor's fields start empty.
    expect(s).toContain('"add":{"name":"","prompt":""}');
  });

  it("Voices gives each voice but Zu an Edit that opens a pre-filled editor keyed by its id", () => {
    const s = JSON.stringify(buildScreen("desk_voices", sampleCtx));
    // Per-voice toggle + reveal, keyed by the voice id like History's del.<id>.
    expect(s).toContain('"label":"Edit"');
    expect(s).toContain('"kind":"setState","path":"edit.professional","value":true');
    expect(s).toContain('"falsy":"edit.professional"');
    expect(s).toContain('"truthy":"edit.professional"');
    // The editor's fields are bound to that voice's slot and seeded from it.
    expect(s).toContain('"bind":{"value":"vc.professional.name"}');
    expect(s).toContain('"bind":{"value":"vc.professional.prompt"}');
    expect(s).toContain('"professional":{"name":"Professional","prompt":');
    // Save POSTs with that voice's id (an edit, not a new tone).
    expect(s).toContain('"path":"/v1/personality/tone","body":{"id":"professional","name":"$state.vc.professional.name","promptStyle":"$state.vc.professional.prompt"}');
    expect(s).toContain('"content":"Edit voice"');
    // Zu is the person's own voice — never editable, exactly as the phone does.
    expect(s).not.toContain('"path":"edit.signature"');
    expect(s).not.toContain('"id":"signature","name":"$state.vc.signature.name"');
    expect(s).not.toContain('"bind":{"value":"vc.signature.name"}');
  });

  it("Voices edits a custom voice in place, and is drawable with or without one", () => {
    const customCtx = {
      personality: {
        activePresetId: "signature",
        presetOverrides: { custom_abc: { name: "My Voice", promptStyle: "Terse and kind." } },
      },
      language: "en",
    } as never;
    const built = buildScreen("desk_voices", customCtx)!;
    // A custom tone present: only nodes/actions the window can draw and run.
    walk(built.root, (n) => {
      if (n.type) expect(DESKTOP_COMPONENTS.has(n.type), `component ${n.type}`).toBe(true);
    });
    for (const k of actionKinds(built.root)) expect(DESKTOP_ACTIONS.has(k), `action ${k}`).toBe(true);
    const s = JSON.stringify(built);
    // The custom voice shows its own prompt (it has no hand-written sample),
    // and its editor is keyed and seeded by its id; Save POSTs with that id.
    expect(s).toContain("Terse and kind.");
    expect(s).toContain('"kind":"setState","path":"edit.custom_abc","value":true');
    expect(s).toContain('"bind":{"value":"vc.custom_abc.name"}');
    expect(s).toContain('"custom_abc":{"name":"My Voice","prompt":"Terse and kind."}');
    expect(s).toContain('"path":"/v1/personality/tone","body":{"id":"custom_abc","name":"$state.vc.custom_abc.name","promptStyle":"$state.vc.custom_abc.prompt"}');
    // With no tone list at all (built-ins only), the add editor still renders.
    const bare = JSON.stringify(buildScreen("desk_voices", { personality: {}, language: "en" } as never));
    expect(bare).toContain('"label":"Add voice"');
    expect(bare).toContain('"bind":{"value":"vc.add.prompt"}');
  });

  // The month-level breakdowns the phone's Stats screen carries, drawn as the
  // desk's own bars — their titles, their labels, and the figures up top.
  const withStats = {
    ...sampleCtx,
    stats: {
      ...(sampleCtx as { stats: Record<string, unknown> }).stats,
      kindWords: { voice: 900, typing: 300, draft: 0 },
      daypartSessions: { morning: 5, afternoon: 8, evening: 3, night: 1 },
      sessionLengths: [2, 5, 10, 3, 1],
      hourWords: Array.from({ length: 24 }, (_, h) => (h === 9 ? 200 : h === 14 ? 150 : 0)),
      wordsPerDay: Array.from({ length: 30 }, (_, i) => (i % 3) * 20),
      voiceWords: [{ id: "signature", words: 800 }, { id: "professional", words: 400 }],
      toneWords: [{ tone: "none", words: 700 }, { tone: "formal", words: 300 }],
      avgWordsPerSession: 40,
      minutesSaved: 30,
      bestDay: { date: "Oct 3", words: 240 },
      dictionary: {
        saved: 5, used: 3, unused: 2, scanned: 40,
        top: [{ word: "Tailzu", uses: 12 }, { word: "Kubernetes", uses: 4 }],
        unusedWords: ["Foo", "Bar"],
      },
    },
  } as never;

  it("Insights carries the month's breakdowns, their titles and their values", () => {
    const s = JSON.stringify(buildScreen("desk_insights", withStats));
    for (const title of ["How the words came", "When you write", "Hour by hour", "How long, in words",
                         "Who writes for you", "In which register", "What earns its place", "Words a day"]) {
      expect(s, title).toContain(title);
    }
    // the kind, daypart and session-length labels
    expect(s).toContain("Spoken");
    expect(s).toContain("Morning");
    expect(s).toContain("Afternoon");
    expect(s).toContain("1–5");   // 1–5
    expect(s).toContain("100+");
    // voices named id→name; a register read via TONE_LABELS, none as Zu
    expect(s).toContain("Zu");
    expect(s).toContain("Professional");
    expect(s).toContain("Formal");
    // the dictionary line, its most-used count, and the names that never turned up
    expect(s).toContain("3 of 5 words earn their place.");
    expect(s).toContain("Most used");
    expect(s).toContain("12×");   // 12×
    expect(s).toContain("Never turned up");
    // the figures up top
    for (const f of ["Day streak", "Per session", "Best day", "Minutes saved"]) expect(s, f).toContain(f);
  });

  it("Today and Insights both offer a way into the full history", () => {
    expect(JSON.stringify(buildScreen("desk_today", sampleCtx))).toContain('"screenId":"desk_history"');
    expect(JSON.stringify(buildScreen("desk_insights", sampleCtx))).toContain('"screenId":"desk_history"');
  });

  it("History lists every kept cleanup, with a per-row reason card and both delete reasons", () => {
    const s = JSON.stringify(buildScreen("desk_history", sampleCtx));
    // the rows, newest first
    expect(s).toContain("Haan bhai, kal milte hain.");
    expect(s).toContain("Send the deck tonight.");
    // the Copy that entryNode carries is kept per row
    expect(s).toContain('"kind":"copyText","text":"Haan bhai, kal milte hain.","message":"Copied"');
    // the exact reason copy
    expect(s).toContain("Remove from history");
    expect(s).toContain("Why should it go?");
    expect(s).toContain("Either way it's gone for good, and Tailzu stops learning from it.");
    expect(s).toContain("It doesn't sound like me");
    expect(s).toContain("Just a clean-up");
    expect(s).toContain("Leave it");
    // per-row confirm state, keyed by the entry id
    expect(s).toContain('"path":"del.a1","value":true');
    expect(s).toContain('"path":"del.a1","value":false');
    expect(s).toContain('"truthy":"del.a1"');
    expect(s).toContain('"falsy":"del.a1"');
    // the DELETE endpoint, both reasons, scoped to the row's id
    expect(s).toContain('"method":"DELETE","path":"/v1/history/a1?reason=not_me"');
    expect(s).toContain('"method":"DELETE","path":"/v1/history/a1?reason=cleanup"');
    expect(s).toContain('"onSuccess":{"kind":"refresh"}');
    // a way back to Today
    expect(s).toContain('"tabId":"desk_today"');
  });

  it("History is empty-safe", () => {
    const s = JSON.stringify(buildScreen("desk_history", { personality: {}, language: "en", history: [] } as never));
    expect(s).toContain("Nothing here yet.");
    expect(s).toContain("What you write with Tailzu shows up here.");
  });
});

describe("Insights opens a day and an app for their own detail", () => {
  const withDetail = {
    ...sampleCtx,
    formFactor: "desktop",
    can: new Set(["DeskShell", "Keys"]),
    stats: {
      ...(sampleCtx as { stats: Record<string, unknown> }).stats,
      days: Array.from({ length: 30 }, (_, i) => ({
        words: i === 29 ? 120 : (i % 3) * 10,
        sessions: i === 29 ? 4 : i % 3,
        saidSeconds: i === 29 ? 180 : 0,
        apps: i === 29 ? [{ app: "whatsapp", words: 80 }, { app: "gmail", words: 40 }] : [],
        hours: Array.from({ length: 24 }, (_, h) => (i === 29 && (h === 9 || h === 14) ? 60 : 0)),
        kinds: { voice: i === 29 ? 100 : 0, typing: i === 29 ? 20 : 0, draft: 0 },
        languages: i === 29 ? [{ key: "hinglish", words: 80 }, { key: "en", words: 40 }] : [],
        first: i === 29 ? "09:10" : undefined,
        last: i === 29 ? "18:40" : undefined,
      })),
      appDetail: [
        { app: "whatsapp", words: 700, sessions: 40, kinds: { voice: 600, typing: 100, draft: 0 },
          dayparts: { morning: 300, afternoon: 200, evening: 150, night: 50 }, avgWords: 18,
          lastAt: iso(60_000), voices: [{ id: "Zu", words: 500 }, { id: "Work", words: 200 }] },
        { app: "gmail", words: 500, sessions: 20, kinds: { voice: 500, typing: 0, draft: 0 },
          dayparts: { morning: 100, afternoon: 300, evening: 100, night: 0 }, avgWords: 25,
          lastAt: iso(3 * 86_400_000), voices: [{ id: "Zu", words: 500 }] },
      ],
    },
  } as never;

  // Every detail page the window is handed must only name nodes and actions
  // the renderer can draw and run — the same bar the screen loop holds the
  // tabs to, applied here to the full (not the empty) path.
  const drawable = (s: { root: unknown }) => {
    walk(s.root, (node) => {
      if (node.type) expect(DESKTOP_COMPONENTS.has(node.type), `component ${node.type}`).toBe(true);
    });
    for (const k of actionKinds((s as { root: unknown }).root)) expect(DESKTOP_ACTIONS.has(k), `action ${k}`).toBe(true);
  };

  it("a filled day square and a known app bar carry a tap into their page", () => {
    const s = JSON.stringify(buildScreen("desk_insights", withDetail));
    expect(s).toContain('"screenId":"desk_day"');
    expect(s).toContain('"screenId":"desk_app"');
    expect(s).toContain('"app":"whatsapp"');
  });

  it("a day opens on its own page with that day's numbers", () => {
    const built = buildScreen("desk_day", { ...(withDetail as object), params: { day: 29 } } as never)!;
    drawable(built);
    const s = JSON.stringify(built);
    expect(s).toContain("120 words");
    expect(s).toContain("4 dictations");
    expect(s).toContain("09:10–18:40");
    expect(s).toContain("whatsapp");   // where the words went that day
    expect(s).toContain("Hinglish");   // and in what
    expect(s).toContain('"tabId":"desk_insights"'); // the way back
  });

  it("an app opens on its own page with how and when it is used", () => {
    const built = buildScreen("desk_app", { ...(withDetail as object), params: { app: "whatsapp" } } as never)!;
    drawable(built);
    const s = JSON.stringify(built);
    expect(s).toContain("700 words");
    expect(s).toContain("40 dictations");
    expect(s).toContain("Morning");
    expect(s).toContain("Work");       // a second voice, so the split shows
  });

  it("a day out of range and an unknown app fall back to a way home, not a crash", () => {
    const day = JSON.stringify(buildScreen("desk_day", { ...(withDetail as object), params: { day: 999 } } as never));
    expect(day).toContain("isn't here");
    expect(day).toContain('"tabId":"desk_insights"');
    const app = JSON.stringify(buildScreen("desk_app", { ...(withDetail as object), params: { app: "nope" } } as never));
    expect(app).toContain("Nothing for that app");
    expect(app).toContain('"tabId":"desk_insights"');
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

describe("a length of time, as a person says it", () => {
  it("rounds once, so no hour ever has sixty minutes", async () => {
    const { span } = await import("../src/experience/phoneLook.js");
    expect(span(119.7)).toBe("2 h");
    expect(span(59.7)).toBe("1 h");
    expect(span(0.995)).toBe("1 min");
    expect(span(0.2)).toBe("12 sec");
    expect(span(65)).toBe("1 h 05");
    expect(span(9.4)).toBe("9 min");
  });
});

describe("the desk's notes", () => {
  it("a window that can take notes gets the Notes tab after Today; one that cannot does not", () => {
    const withNotes = buildBootstrap({ formFactor: "desktop", desk: true, deskNotes: true } as never) as any;
    expect(withNotes.navigation.tabs.map((t: { id: string }) => t.id)).toEqual(
      ["desk_today", "desk_notes", ...DESK_NAV.tabs.slice(1).map((t) => t.id)]);
    expect(deskNav(false)).toBe(DESK_NAV);
    const older = buildBootstrap({ formFactor: "desktop", desk: true } as never) as any;
    expect(older.navigation.tabs.some((t: { id: string }) => t.id === "desk_notes")).toBe(false);
  });

  it("the list goes by day, opens each note, and names people the writer named", () => {
    const s = JSON.stringify(buildScreen("desk_notes", sampleCtx));
    expect(s).toContain("Launch plan with Priya");
    expect(s).toContain("Priya");
    expect(s).toContain('"screenId":"desk_note","params":{"noteId":"11111111-1111-4111-8111-111111111111"}');
    // A note the writer could not organise says so, and still has a title.
    expect(s).toContain("Couldn't organise this one");
    expect(s).toContain("Notes, ");
  });

  it("a note is the meeting, one paragraph, and what mattered, each line with who said it", () => {
    const s = buildScreen("desk_note", sampleCtx) as any;
    const j = JSON.stringify(s);
    expect(j).toContain("Launch plan with Priya");
    expect(j).toContain("You and Priya agreed to ship on Friday, after a day of testing.");
    expect(j).toContain('"content":"Priya"');
    expect(j).toContain('"content":"You"');
    expect(j).toContain("I want a full day of testing before we ship, so Friday.");
    // The transcript is kept to organise again, never shown.
    expect(j).not.toContain("Then I want a day of testing, so Friday.");
    const copy = [] as string[];
    walk(s.root, (n) => {
      const a = (n as any).on?.onPress;
      if (a?.kind === "copyText") copy.push(a.text);
    });
    expect(copy[0]).toContain("With: You, Priya");
    expect(copy[0]).toContain("Priya: I want a full day of testing before we ship, so Friday.");
    expect(copy[0]).toContain("You: The build will be ready on Thursday.");
  });

  it("a gone note says so; the Notes page has a start button only where the hotkey exists", () => {
    expect(JSON.stringify(buildScreen("desk_note", { personality: {}, language: "en", note: null } as never))).toContain("This note is gone.");
    const empty = (can: string[]) => JSON.stringify(buildScreen("desk_notes", { personality: {}, language: "en", notes: [], can: new Set(can) } as never));
    expect(empty(["DeskNotes"])).toContain('"kind":"notes.toggle"');
    expect(empty([])).not.toContain("notes.toggle");
  });
});

describe("a note with only your side", () => {
  const note = (systemAudio?: string) => ({
    id: "33333333-3333-4333-8333-333333333333", status: "ready", startedAt: new Date().toISOString(), durationSeconds: 600, words: 300,
    title: "Standup", summary: "You went through your updates.", organised: true, people: [],
    highlights: [{ speaker: "You", text: "The build is ready." }], transcript: [{ at: 0, speaker: "You", text: "The build is ready." }],
    ...(systemAudio ? { systemAudio } : {}),
  });
  const page = (systemAudio: string | undefined, can: string[]) =>
    JSON.stringify(buildScreen("desk_note", { personality: {}, language: "en", note: note(systemAudio), can: new Set(can) } as never));

  it("says so, with an Allow button where the window can open the setting", () => {
    const j = page("denied", ["DeskNotes", "DeskSystemAudio"]);
    expect(j).toContain("Only your side");
    expect(j).toContain('"kind":"notes.allowSystemAudio"');
  });

  it("an older window is told where the setting is instead", () => {
    const j = page("denied", ["DeskNotes"]);
    expect(j).toContain("Screen & System Audio Recording");
    expect(j).not.toContain("notes.allowSystemAudio");
  });

  it("a note that heard everything, or one from before this was kept, says nothing about it", () => {
    for (const v of ["ok", "unavailable", undefined]) expect(page(v, ["DeskNotes", "DeskSystemAudio"])).not.toContain("Only your side");
  });

  it("the list marks it", () => {
    const list = JSON.stringify(buildScreen("desk_notes", { personality: {}, language: "en", notes: [note("denied")] } as never));
    expect(list).toContain("Your side only");
  });
});
