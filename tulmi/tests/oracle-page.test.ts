/**
 * THE ORACLE'S PAGE (src/experience/bots/screens/bots/oraclePage.ts): its bot page and its chat are one page; before anything is asked, the card for
 * when and where they were born; one of its two characters on the page, never two: big on his own stage before the first question, up in the head
 * once there are turns; a build that cannot draw him gets the plain empty state; the page reads the Oracle's own store.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const ORACLE = {
  slug: "oracle", name: "Oracle", colour: "plum", builtin: true, publicCard: false, tone: "", principles: [],
  purpose: "Reads your birth chart and the world's divination traditions to answer what you ask about your life, love, work and timing.",
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const turn = (id: string, role: "me" | "bot", text: string) => ({ id, role, text, at: FIXED_NOW - 60_000, opens: [], approvals: [], paise: 0 });

async function oraclePage(o: { sky?: boolean; turns?: ReturnType<typeof turn>[]; can?: string[]; now?: number; screen?: string } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "oracle", name: "Oracle", colour: "plum", purpose: ORACLE.purpose, builtin: true }], calls,
    ...(o.now ? { now: o.now } : {}),
    api: {
      "GET /v1/bots/oracle": { bot: ORACLE }, "GET /v1/bots/oracle/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/oracle/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/oracle?limit=30": { turns: o.turns ?? [] },
      "GET /v1/oracle/sky": o.sky ? { sky: { place: "Mumbai, Maharashtra, India" }, line: "13 July 1994, 9:30 am, Mumbai" } : { sky: null, line: null },
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: "phone", params: { slug: "oracle" }, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" },
    can: new Set(o.can ?? DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const nodes = walk(root);
  // What shows before anything is pressed: not what waits behind "Change" (visibleIf truthy oracle_edit).
  const shown = (n: Node): Node[] => ((n.visibleIf as { truthy?: string } | undefined)?.truthy === "oracle_edit" ? [] : [n, ...(n.children ?? []).flatMap(shown)]);
  return {
    calls, nodes,
    shownTexts: shown(root).filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    buddies: nodes.filter((n) => n.type === "BotBuddy").map((n) => n.props as Record<string, unknown>),
    blips: nodes.filter((n) => /blip/i.test(n.type)).length,
  };
}

describe("the Oracle's page", () => {
  it("asks when and where they were born before anything else, and shows the day's character big on his own stage", async () => {
    const p = await oraclePage();
    expect(p.texts).toContain("When and where were you born?");
    expect(p.texts).toContain("Ask the Oracle anything");
    expect(p.buddies).toHaveLength(1);                                   // one character: on the stage, none in the head
    expect(p.buddies[0]).toMatchObject({ kind: "custom", life: "page.oracle", avatar: expect.stringMatching(/^(wanderer|seer)$/) });
    expect(Number(p.buddies[0]!.size)).toBeGreaterThan(60);
    expect(p.calls.some((c) => c.method === "GET" && c.path === "/v1/oracle/sky")).toBe(true);
  });

  it("is the Wanderer on one day and the Seer on the next", async () => {
    const a = (await oraclePage()).buddies[0]!.avatar;
    const b = (await oraclePage({ now: FIXED_NOW + 86_400_000 })).buddies[0]!.avatar;
    expect(new Set([a, b])).toEqual(new Set(["wanderer", "seer"]));
  });

  it("once the sky is kept: one line with Change, and first questions under the stage", async () => {
    const p = await oraclePage({ sky: true });
    expect(p.texts).toContain("13 July 1994, 9:30 am, Mumbai");
    expect(p.texts).toContain("Change");
    expect(p.shownTexts).toContain("13 July 1994, 9:30 am, Mumbai");
    expect(p.shownTexts).not.toContain("When and where were you born?");     // the card waits behind Change
    expect(p.texts).toContain("When and where were you born?");
    expect(p.texts).toContain("Pull a tarot card for me");
    expect(p.buddies).toHaveLength(1);
  });

  it("once there are turns, the character is up in the head, small, and the stage is gone", async () => {
    const p = await oraclePage({ sky: true, screen: "bots.chat", turns: [turn("t1", "me", "Will I find the right person?"), turn("t2", "bot", "Yes, though not in the season you're standing in.")] });
    expect(p.texts).not.toContain("Ask the Oracle anything");
    expect(p.buddies).toHaveLength(1);
    expect(Number(p.buddies[0]!.size)).toBeLessThan(60);
    expect(p.texts.some((t) => t.includes("not in the season"))).toBe(true);
  });

  it("a build that cannot draw him gets the plain empty state, and no character anywhere", async () => {
    const p = await oraclePage({ can: ["BotsKit"] });
    expect(p.buddies).toHaveLength(0);
    expect(p.texts).toContain("Ask the Oracle anything");
  });
});
