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
import { POLICY, buildScreen } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { DESK_SCREENS, buildDeskScreen } from "../src/experience/desk.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";

/**
 * LET ASK SEE WHAT YOU SEE, from the server's side (permissions-spec §2, §4).
 * The window (desktop sdui.js askSetupNode) draws the node and reads each
 * row's state from its own main process; the server sends the words, and
 * only to a window that said it can draw them ("DeskAskSetup", which it says
 * only while Ask is on there).
 */

type AnyNode = { type?: string; props?: Record<string, any>; style?: Record<string, unknown>; children?: AnyNode[] };

function nodesOf(root: unknown, type: string): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as AnyNode;
    if (n.type === type) out.push(n);
    for (const c of Object.values(n)) if (c && typeof c === "object") walk(c);
  };
  walk(root);
  return out;
}

const ctx = (can: string[], extra: Record<string, unknown> = {}) =>
  ({ personality: {}, language: "en", formFactor: "desktop", can: new Set(can), ...extra }) as never;
const ASK = ["DeskShell", "DeskAskSetup"];

/** The §4 defaults, word for word. */
const WORDS = {
  eyebrow: "Ask · one-time setup",
  title: "Let Ask see",
  titleEm: "what you see.",
  lede: "Allow these once and Ask answers straight away on any screen, without stopping to ask.",
  on: "On",
  allow: "Allow",
  turnOff: "Turn off",
  restart: "Restart Tailzu to finish",
  restartButton: "Restart",
  policyLabel: "Privacy policy",
};
const ROWS = [
  { key: "read", title: "Read the screen", sub: "Buttons, fields and text, so it can point at things and do small jobs." },
  { key: "see", title: "See the screen", sub: "Text in pictures, charts and diagrams. Opens the Mac's Screen Recording setting." },
  { key: "pictures", title: "Look at the screen when it's needed", sub: "When a question is about something on your screen, Ask looks without stopping to ask." },
];

describe("Ask's one-time setup card on the desk home", () => {
  it("is the first thing on Today for a window that declared DeskAskSetup", () => {
    const s = buildScreen("desk_today", ctx(ASK, { os: "mac" })) as any;
    const first = s.root.children[0] as AnyNode;
    expect(first.type).toBe("DeskAskSetup");
    expect(first.props).toEqual({
      place: "home", cls: "d-page", ...WORDS, rows: ROWS,
      foot: "Change these any time in Settings. How Ask uses what it sees:",
      policyUrl: POLICY.privacy,
    });
    // On the page's measure, above the room, with its own air.
    expect(first.style).toMatchObject({ maxWidth: 920, paddingLeft: 56, paddingRight: 56, paddingTop: 44, paddingBottom: 44 });
    // The room still follows it: the card is added, nothing is taken away.
    expect((s.root.children[1] as AnyNode).props?.cls).toBe("d-room");
    expect(nodesOf(s.root, "DeskAskSetup")).toHaveLength(1);
  });

  it("is not sent to a window that did not declare it", () => {
    for (const can of [["DeskShell"], ["DeskShell", "DeskNotes", "DeskSystemAudio"], []]) {
      expect(nodesOf(buildScreen("desk_today", ctx(can)), "DeskAskSetup")).toHaveLength(0);
      expect(nodesOf(buildScreen("desk_settings", ctx(can)), "DeskAskSetup")).toHaveLength(0);
    }
  });

  it("the home page is otherwise the page it was", () => {
    const without = buildScreen("desk_today", ctx(["DeskShell"])) as any;
    const withCard = buildScreen("desk_today", ctx(ASK)) as any;
    expect(withCard.root.children.slice(1)).toEqual(without.root.children);
  });

  it("sits under the update card when there is one", () => {
    const s = buildDeskScreen("desk_today", {
      personality: {} as never,
      askSetup: { privacyUrl: POLICY.privacy, os: "mac" },
      update: { version: "9.9.9", url: "https://tailzu.space/download" },
    })!;
    const types = (s.root.children ?? []).slice(0, 3).map((c) => (c.type === "DeskAskSetup" ? "ask" : String(c.props?.cls ?? c.type)));
    expect(types[1]).toBe("ask");
    expect(types[2]).toBe("d-room");
  });
});

describe("Ask's section in desk Settings", () => {
  it("is the same card, placed in Settings, under its own heading after Talking", () => {
    const s = buildScreen("desk_settings", ctx(ASK, { os: "mac" })) as any;
    const cards = nodesOf(s.root, "DeskAskSetup");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.props).toEqual({
      place: "settings", ...WORDS, rows: ROWS,
      // On the Settings page the home card's "Change these any time in
      // Settings" pointed at the page it was on.
      foot: "How Ask uses what it sees:",
      policyUrl: POLICY.privacy,
    });
    expect(card.props!.cls).toBeUndefined();
    expect(card.style).toBeUndefined();

    const page = s.root.children.find((c: AnyNode) => c.props?.cls === "d-page") as AnyNode;
    const sections = page.children!.filter((c) => c.type === "Stack");
    const headings = sections.map((sec) => (sec.children?.[0] as AnyNode | undefined)?.props?.content);
    expect(headings.slice(0, 3)).toEqual(["Talking", "Ask", "Languages"]);
    expect(sections[1]!.children![1]).toBe(card);
  });

  it("shows in Settings whatever the rows' states: the window, not the server, hides only the home card", () => {
    // The server cannot know a row's state; it sends the Settings card every
    // time, and the home card every time too (the window puts that one away
    // when every row is on).
    for (let i = 0; i < 3; i++) {
      expect(nodesOf(buildScreen("desk_settings", ctx(ASK)), "DeskAskSetup")).toHaveLength(1);
      expect(nodesOf(buildScreen("desk_today", ctx(ASK)), "DeskAskSetup")).toHaveLength(1);
    }
  });
});

describe("the card's words", () => {
  it("on Windows, the See row does not send anyone to a Mac's setting", () => {
    const s = buildScreen("desk_settings", ctx(ASK, { os: "windows" })) as any;
    const see = nodesOf(s.root, "DeskAskSetup")[0]!.props!.rows.find((r: { key: string }) => r.key === "see");
    expect(see).toEqual({ key: "see", title: "See the screen", sub: "Text in pictures, charts and diagrams." });
    // A window that does not say which computer it is keeps the Mac's line.
    const unknown = nodesOf(buildScreen("desk_today", ctx(ASK)), "DeskAskSetup")[0]!.props!.rows[1];
    expect(unknown.sub).toContain("Screen Recording");
  });

  it("asks to see, and says nothing about sending (the owner's wording rule)", () => {
    for (const id of ["desk_today", "desk_settings"]) {
      for (const os of ["mac", "windows"]) {
        const card = nodesOf(buildScreen(id, ctx(ASK, { os })), "DeskAskSetup")[0]!;
        const words = JSON.stringify({ ...card.props, policyUrl: "" });
        expect(words).not.toMatch(/\b(?:send|sends|sent|sending|photo|photos|screenshot|screenshots)\b/i);
        expect(words).not.toMatch(/\bpicture of\b|\bpictures? (?:goes|go|is|are)\b/i);
        expect(words).toMatch(/\bsee\b/);
        expect(words).toMatch(/\blooks?\b/);
      }
    }
  });

  it("links the privacy policy where the server serves it", () => {
    expect(POLICY.privacy).toBe("https://tailzu.space/privacy");
    const card = nodesOf(buildScreen("desk_today", ctx(ASK)), "DeskAskSetup")[0]!;
    // The window draws the link only for an https address (sdui.js).
    expect(card.props!.policyUrl).toMatch(/^https:\/\//);
  });

  it("the window can draw the class it is given", () => {
    const card = nodesOf(buildScreen("desk_today", ctx(ASK)), "DeskAskSetup")[0]!;
    for (const c of String(card.props!.cls).split(/\s+/)) expect(c).toMatch(/^d-[a-z0-9-]+$/);
  });

  it("no other desk page carries it", () => {
    for (const id of DESK_SCREENS) {
      if (id === "desk_today" || id === "desk_settings") continue;
      expect(nodesOf(buildScreen(id, ctx(ASK)), "DeskAskSetup"), id).toHaveLength(0);
    }
  });
});

describe("through the screen route", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  const screen = (screenId: string, components: string[], os = "mac") => app.inject({
    method: "POST", url: "/v1/app/screen",
    payload: { screenId, capabilities: { device: { formFactor: "desktop", os }, components }, tzOffsetMinutes: 330 },
  });

  it("a window that declares DeskAskSetup gets the card on Today and in Settings", async () => {
    for (const [id, place] of [["desk_today", "home"], ["desk_settings", "settings"]] as const) {
      const res = await screen(id, ["DeskShell", "DeskAskSetup"]);
      expect(res.statusCode).toBe(200);
      const cards = nodesOf(res.json().root, "DeskAskSetup");
      expect(cards, id).toHaveLength(1);
      expect(cards[0]!.props!.place).toBe(place);
      expect(cards[0]!.props!.policyUrl).toBe(POLICY.privacy);
    }
  });

  it("one that does not, does not", async () => {
    for (const id of ["desk_today", "desk_settings"]) {
      const res = await screen(id, ["DeskShell", "DeskNotes", "DeskSystemAudio"]);
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain("DeskAskSetup");
    }
  });

  it("reads the window's own name for its computer", async () => {
    const res = await screen("desk_settings", ["DeskShell", "DeskAskSetup"], "windows");
    expect(nodesOf(res.json().root, "DeskAskSetup")[0]!.props!.rows[1].sub).toBe("Text in pictures, charts and diagrams.");
  });
});
