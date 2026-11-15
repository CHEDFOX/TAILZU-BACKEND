/**
 * A SESSION'S SCREEN (screens/bots/cinemaSession.ts): the talk, what it made drawn where it happened, the dotted line where it was
 * picked up again, and the card the bot proposed. Drawn by the shipped app (the linter), on the phone and in the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
/** Actions nest (a sequence, a condition, what happens after a call): every one of them, flattened. */
const flat = (a: unknown): unknown[] => {
  if (!a || typeof a !== "object") return [];
  const x = a as { actions?: unknown[]; then?: unknown; else?: unknown; ok?: unknown; fail?: unknown };
  return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else), ...flat(x.ok), ...flat(x.fail)];
};

const turn = (id: string, role: "me" | "bot", text: string, at: number) => ({ id, role, text, at, opens: [], approvals: [], paise: 0 });

const VIEW = (over: Record<string, unknown> = {}) => ({
  session: { id: "s1", bot: "cinema", title: "a short one for reels", startedAt: T0, touchedAt: T0 + 18 * DAY },
  turns: [
    turn("t1", "me", "something for my chai stall", T0),
    turn("t2", "bot", "Is it for a feed, or a screen?", T0 + 4000),
    turn("t3", "me", "reels, the first rain", T0 + 18 * DAY),
  ],
  ...over,
});

async function build(o: { client?: "phone" | "desktop"; view?: unknown } = {}) {
  const client = o.client ?? "phone";
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "cinema", name: "Cinema", colour: "plum", purpose: "Films", builtin: true }],
    api: { "GET /v1/botsapp/bots/session/s1": o.view ?? VIEW() },
  });
  const built = await buildBotsScreen({
    screenId: "bots.session", client, params: { s: "s1" }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const nodes = walk(built.root as Node);
  return {
    nodes, lint: lintTree(built.root as Node, client),
    texts: nodes.filter((n) => n.type === "Text").map((n) => String((n.props as { content?: unknown })?.content ?? "")),
    paths: nodes.flatMap((n) => Object.values((n.on ?? {}) as Record<string, unknown>)).flatMap(flat)
      .filter((a) => (a as { kind?: string }).kind === "callEndpoint")
      .map((a) => `${(a as { method: string }).method} ${(a as { path: string }).path}`),
  };
}

for (const client of ["phone", "desktop"] as const) {
  describe(`a session on the ${client}`, () => {
    it("draws the talk, and a dotted line where it was picked up again", async () => {
      const p = await build({ client });
      expect(p.lint).toEqual([]);
      expect(p.texts).toContain("something for my chai stall");
      expect(p.texts).toContain("Is it for a feed, or a screen?");
      // Eighteen days between the second turn and the third: one break, and only one.
      expect(p.texts.filter((t) => t.startsWith("picked up again"))).toHaveLength(1);
      expect(p.paths).toContain("POST /v1/botsapp/bots/chat/cinema");
    });

    it("draws no break in a conversation that never stopped", async () => {
      const view = VIEW({ turns: [turn("t1", "me", "hello", T0), turn("t2", "bot", "Hello.", T0 + 9000)] });
      const p = await build({ client, view });
      expect(p.lint).toEqual([]);
      expect(p.texts.some((t) => t.startsWith("picked up again"))).toBe(false);
    });

    it("draws the film it made, as it stands, in the talk", async () => {
      const view = VIEW({
        made: [{ kind: "film", id: "f1", at: T0 + 5000, title: "Chai in the Rain", status: "rendering", hold: null, aspect: "4:5", seconds: 24, shots: 4, done: 2 }],
      });
      const p = await build({ client, view });
      expect(p.lint).toEqual([]);
      expect(p.texts).toContain("Chai in the Rain");
      expect(p.texts).toContain("Filming: 2 of 4 shots done");
      expect(p.texts).toContain("Open it");
      // Filming needs nothing from the person, so it asks for nothing.
      expect(p.texts).not.toContain("Film it");
    });

    it("puts the one thing to do on a film that waits", async () => {
      const script = VIEW({ made: [{ kind: "film", id: "f1", at: T0 + 5000, title: "Chai", status: "script", hold: null, aspect: "9:16", seconds: 24, shots: 4, done: 0 }] });
      const a = await build({ client, view: script });
      expect(a.texts).toContain("Make the storyboard");
      expect(a.paths).toContain("POST /v1/cinema/films/f1/approve-script");

      const board = VIEW({ made: [{ kind: "film", id: "f1", at: T0 + 5000, title: "Chai", status: "board", hold: null, aspect: "9:16", seconds: 24, shots: 4, done: 0 }] });
      const b = await build({ client, view: board });
      expect(b.texts).toContain("Film it");
      expect(b.paths).toContain("POST /v1/cinema/films/f1/approve-board");

      const done = VIEW({ made: [{ kind: "film", id: "f1", at: T0 + 5000, title: "Chai", status: "done", hold: null, aspect: "9:16", seconds: 24, shots: 4, done: 4, film: "/v1/cinema/media/u/u1/cinema/films/f1/film.mp4?exp=1&sig=x" }] });
      const c = await build({ client, view: done });
      expect(c.texts).toContain("Watch");
    });

    it("draws the card with what the bot chose already chosen", async () => {
      const view = VIEW({ proposal: { concept: "A 24-second film of a chai stall in the first monsoon rain", seconds: 24, aspect: "4:5", because: "you said reels" } });
      const p = await build({ client, view });
      expect(p.lint).toEqual([]);
      expect(p.texts).toContain("Chosen from what you said — tap to change");
      expect(p.texts).toContain("A 24-second film of a chai stall in the first monsoon rain");
      // The proposed length sits among the ladder, and every shape is offered.
      expect(p.texts).toContain("24s");
      expect(p.texts).toContain("30s");
      for (const a of ["9:16", "4:5", "1:1", "16:9", "21:9"]) expect(p.texts).toContain(a);
      expect(p.texts).toContain("Create");
      expect(p.paths).toContain("POST /v1/cinema/films");
      // Never a cost, as everywhere else.
      expect(p.texts.join(" ")).not.toMatch(/₹|cost|price/i);
    });

    it("draws no card until the bot has something to propose", async () => {
      const p = await build({ client });
      expect(p.texts).not.toContain("Create");
      expect(p.texts).not.toContain("Chosen from what you said — tap to change");
    });

    it("says so when the conversation cannot be read", async () => {
      const deps = fakeDeps({ bots: [...SAMPLE_BOTS], api: {} });
      const built = await buildBotsScreen({
        screenId: "bots.session", client, params: { s: "s1" }, tzOffsetMinutes: IST,
        user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false },
      }, deps);
      const texts = walk(built.root as Node).filter((n) => n.type === "Text").map((n) => String((n.props as { content?: unknown })?.content ?? ""));
      expect(texts).toContain("This conversation couldn't be read.");
    });
  });
}
