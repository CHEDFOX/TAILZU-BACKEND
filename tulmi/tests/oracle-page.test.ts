/**
 * THE ORACLE'S PAGE (src/experience/bots/screens/bots/oraclePage.ts, oracleCards.ts): its bot page and its chat are one page; what it needs is asked
 * as one card after another over it (when, where, and name and gender only when the app lacks them), each kept as it is answered; one of its two
 * characters on the page, never two: big on his own stage before the first question, up in the head once there are turns; Change opens the
 * cards again; a build without the living card gets the same steps in a plain card.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");
const { needsYou } = await import("../src/experience/bots/screens/bots/oracleCards.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const ORACLE = {
  slug: "oracle", name: "Oracle", colour: "plum", builtin: true, publicCard: false, tone: "", principles: [],
  purpose: "Reads your birth chart and the world's divination traditions to answer what you ask about your life, love, work and timing.",
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const KNOWN = { due: false, name: "Aanya Sharma", source: "saved", via: "google", gender: "female", botName: "" };
const UNKNOWN = { due: false, name: "Aanya Sharma", source: "provider", via: "google", gender: null, botName: "" };
const WHOLE = { sky: { place: "Mumbai, Maharashtra, India" }, line: "13 July 1994, 9:30 am, Mumbai", when: { date: "13 July 1994", time: "9:30 am", line: "13 July 1994, 9:30 am" } };
const turn = (id: string, role: "me" | "bot", text: string) => ({ id, role, text, at: FIXED_NOW - 60_000, opens: [], approvals: [], paise: 0 });

async function oraclePage(o: { sky?: unknown; about?: unknown; turns?: ReturnType<typeof turn>[]; can?: string[]; now?: number; screen?: string; edit?: boolean } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "oracle", name: "Oracle", colour: "plum", purpose: ORACLE.purpose, builtin: true }], calls,
    ...(o.now ? { now: o.now } : {}),
    api: {
      "GET /v1/bots/oracle": { bot: ORACLE }, "GET /v1/bots/oracle/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/oracle/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/oracle?limit=30": { turns: o.turns ?? [] },
      "GET /v1/oracle/sky": o.sky ?? { sky: null, line: null, when: null },
      "GET /v1/bots/first-run/about": o.about ?? KNOWN,
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: "phone", params: { slug: "oracle", ...(o.edit ? { edit: "1" } : {}) }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(o.can ?? DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const nodes = walk(root);
  const card = nodes.find((n) => n.type === "BotCard");
  const actions = (n: Node): ActionSpec[] => walk(n).flatMap((x) => Object.values(x.on ?? {}) as ActionSpec[]);
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; onSuccess?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else), ...flat(x.onSuccess)];
  };
  return {
    calls, nodes, card, state: (s as unknown as { state?: Record<string, unknown> }).state ?? {},
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    buddies: nodes.filter((n) => n.type === "BotBuddy").map((n) => n.props as Record<string, unknown>),
    every: (n: Node = root) => actions(n).flatMap(flat),
  };
}

describe("the Oracle's cards", () => {
  it("ask when, then where, then name and gender (only when the app lacks them), over the page with the day's character", async () => {
    const p = await oraclePage({ about: UNKNOWN });
    expect(p.card?.props).toMatchObject({ overlay: true, kind: "custom", avatar: expect.stringMatching(/^(wanderer|seer)$/), doneWhen: { all: [{ truthy: "oc_when" }, { truthy: "oc_place" }, { truthy: "oc_you" }] } });
    const steps = walk(p.card!).filter((n) => n.type === "Text").map((n) => String(n.props?.content));
    expect(steps).toEqual(expect.arrayContaining(["When were you born?", "Where were you born?", "And you?", "Ask away."]));
    expect(p.state).toMatchObject({ oc_when: false, oc_place: false, oc_you: false, oc_date: "", oc_name: "Aanya Sharma", oc_gender: "" });
    expect(String(p.state.oc_s)).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.calls.some((c) => c.method === "GET" && c.path === "/v1/oracle/sky")).toBe(true);

    const all = p.every(p.card!);
    expect(all).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/oracle/sky", body: { date: "$state.oc_date", time: "$state.oc_time" } }));
    expect(all).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "GET", path: "/v1/oracle/places?q=$state.oc_q&s=$state.oc_s", assignTo: "oc_found" }));
    expect(all).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/oracle/sky", body: { placeId: "$state.oc_found.places.0.id", place: "$state.oc_found.places.0.label", session: "$state.oc_s" } }));
    expect(all).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { full_name: "$state.oc_name", gender: "$state.oc_gender" } }));
    // Five rows for what the search found, each shown while its answer has one.
    const rows = walk(p.card!).filter((n) => (n.visibleIf as { truthy?: string } | undefined)?.truthy?.startsWith("oc_found.places."));
    expect(rows.map((n) => (n.visibleIf as { truthy: string }).truthy)).toEqual([0, 1, 2, 3, 4].map((i) => `oc_found.places.${i}`));
    expect(walk(rows[0]!).some((n) => (n.bind as { content?: string } | undefined)?.content === "oc_found.places.0.label")).toBe(true);
  });

  it("pass what is already kept: the place is next when the when is kept, and there is no name and gender step when the app has them", async () => {
    const p = await oraclePage({ sky: { sky: null, line: null, when: { date: "13 July 1994", time: "", line: "13 July 1994, time not known" } }, about: KNOWN });
    expect(p.state).toMatchObject({ oc_when: true, oc_place: false, oc_you: true, oc_date: "13 July 1994", oc_time: "" });
    expect(walk(p.card!).some((n) => n.props?.content === "And you?")).toBe(false);
  });

  it("are not there once everything is kept: the sky is one line, and Change opens them again, filled in", async () => {
    const p = await oraclePage({ sky: WHOLE, about: KNOWN });
    expect(p.card).toBeUndefined();
    expect(p.texts).toContain("13 July 1994, 9:30 am, Mumbai");
    expect(p.every()).toContainEqual({ kind: "navigate", screenId: "bots.chat", params: { slug: "oracle", edit: "1" }, replace: true });

    const again = await oraclePage({ sky: WHOLE, about: KNOWN, edit: true, screen: "bots.chat" });
    expect(again.card).toBeDefined();
    expect(again.state).toMatchObject({ oc_when: false, oc_place: false, oc_date: "13 July 1994", oc_time: "9:30 am" });
    expect(again.card!.on?.onComplete).toMatchObject({ kind: "sequence" });
    expect(again.every(again.card!)).toContainEqual({ kind: "navigate", screenId: "bots.chat", params: { slug: "oracle" }, replace: true });
  });

  it("come as a plain card for a build without the living one, and go back to the page as the last step is kept", async () => {
    const p = await oraclePage({ can: ["BotsKit"], about: UNKNOWN });
    expect(p.card).toBeUndefined();
    expect(p.texts).toEqual(expect.arrayContaining(["When were you born?", "Where were you born?", "And you?"]));
    expect(p.every()).toContainEqual(expect.objectContaining({ kind: "condition", then: { kind: "navigate", screenId: "bots.chat", params: { slug: "oracle" }, replace: true } }));
  });

  it("cannot be put off: there is no Not now, and only Change's cards (a sky already kept) can be left as they were", async () => {
    const first = await oraclePage({ about: UNKNOWN });
    expect(walk(first.card!).some((n) => n.props?.content === "Not now")).toBe(false);
    expect(walk(first.card!).some((n) => n.props?.content === "Cancel")).toBe(false);
    const change = await oraclePage({ sky: WHOLE, about: KNOWN, edit: true, screen: "bots.chat" });
    expect(walk(change.card!).some((n) => n.props?.content === "Cancel")).toBe(true);
  });

  it("ask for name and gender only when they are owed", () => {
    expect(needsYou(KNOWN as never)).toBe(false);
    expect(needsYou(UNKNOWN as never)).toBe(true);
    expect(needsYou({ ...KNOWN, source: "email" } as never)).toBe(true);                    // a guess from the email is not their name
    expect(needsYou({ ...KNOWN, via: "apple", name: "", source: null } as never)).toBe(false); // Apple's sign-in: the name is never asked again
    expect(needsYou(undefined)).toBe(false);                                                  // unread: nothing is asked twice
  });
});

describe("the Oracle's page", () => {
  it("shows the day's character big on his own stage before the first question, with a way back to the cards", async () => {
    const p = await oraclePage({ about: KNOWN });
    expect(p.texts).toContain("Ask the Oracle anything");
    expect(p.buddies).toHaveLength(1);                                   // one character: on the stage, none in the head
    expect(p.buddies[0]).toMatchObject({ kind: "custom", life: "page.oracle", avatar: expect.stringMatching(/^(wanderer|seer)$/) });
    expect(Number(p.buddies[0]!.size)).toBeGreaterThan(60);
    expect(p.texts).toContain("Add your birth details");
  });

  it("has nothing to ask with until the sky is kept, and the ask bar once it is", async () => {
    const bar = (p: Awaited<ReturnType<typeof oraclePage>>) => p.nodes.some((n) => n.type === "TextField" && n.props?.placeholder === "Ask the Oracle…");
    expect(bar(await oraclePage({ about: KNOWN }))).toBe(false);
    expect(bar(await oraclePage({ sky: { sky: null, line: null, when: { date: "13 July 1994", time: "", line: "13 July 1994, time not known" } }, about: KNOWN }))).toBe(false);
    expect(bar(await oraclePage({ sky: WHOLE, about: KNOWN }))).toBe(true);
  });

  it("is a tap away from Ask's answer when the Oracle answered", async () => {
    const deps = fakeDeps({ bots: [...SAMPLE_BOTS, { slug: "oracle", name: "Oracle", colour: "plum", purpose: ORACLE.purpose, builtin: true }] });
    const s = await buildBotsScreen({
      screenId: "bots.ask", client: "phone", params: { message: "meri shaadi kab hogi", answer: "To read this, I need to know when and where you were born.", bot: "oracle" },
      tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false },
    }, deps);
    const nodes = walk(s.root as Node);
    const open = nodes.find((n) => n.props?.label === "Open the Oracle" || n.props?.content === "Open the Oracle");
    expect(open).toBeDefined();
    expect(JSON.stringify(nodes.map((n) => n.on ?? {}))).toContain('"screenId":"bots.chat","params":{"slug":"oracle"}');
  });

  it("is the Wanderer on one day and the Seer on the next", async () => {
    const a = (await oraclePage()).buddies[0]!.avatar;
    const b = (await oraclePage({ now: FIXED_NOW + 86_400_000 })).buddies[0]!.avatar;
    expect(new Set([a, b])).toEqual(new Set(["wanderer", "seer"]));
  });

  it("once the sky is kept: first questions under the stage", async () => {
    const p = await oraclePage({ sky: WHOLE });
    expect(p.texts).toContain("Pull a tarot card for me");
    expect(p.texts).not.toContain("Add your birth details");
    expect(p.buddies).toHaveLength(1);
  });

  it("once there are turns, the character is up in the head, small, and the stage is gone", async () => {
    const p = await oraclePage({ sky: WHOLE, screen: "bots.chat", turns: [turn("t1", "me", "Will I find the right person?"), turn("t2", "bot", "Yes, though not in the season you're standing in.")] });
    expect(p.texts).not.toContain("Ask the Oracle anything");
    expect(p.buddies).toHaveLength(1);
    expect(Number(p.buddies[0]!.size)).toBeLessThan(60);
    expect(p.texts.some((t) => t.includes("not in the season"))).toBe(true);
  });

  it("a build that cannot draw him gets the plain empty state, and no character anywhere", async () => {
    const p = await oraclePage({ can: ["BotsKit"], sky: WHOLE });
    expect(p.buddies).toHaveLength(0);
    expect(p.texts).toContain("Ask the Oracle anything");
  });
});
