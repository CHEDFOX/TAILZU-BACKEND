/**
 * START SOMETHING (screens/bots/botsStart.ts): the bots as a launcher, one living tile a row, each with its name and a short
 * line on what it can do; every built-in in a group or deliberately not a tile.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { builtinBots } = await import("../src/bots/builtin.js");
const { GROUPED_SLUGS, NOT_TILED, START_LINES, START_TILE_HEIGHT } = await import("../src/experience/bots/screens/bots/botsStart.js");

const build = (client: "phone" | "desktop", can: (c: string) => boolean = () => true) => buildBotsScreen({
  screenId: SCREENS.start, client, params: {}, tzOffsetMinutes: IST, user: { id: "u-aanya", name: "Aanya" },
  can: { has: can } as unknown as Set<string>, desk: { pages: client === "desktop", notes: true },
}, fakeDeps({}));

describe("Start something", () => {
  it("every built-in is in a group, or deliberately not a tile", () => {
    for (const b of builtinBots()) expect(GROUPED_SLUGS.includes(b.slug) || NOT_TILED.includes(b.slug), b.slug).toBe(true);
  });

  it("draws each group as living tiles, ONE A ROW, taller than Home's, each saying what its bot can do", async () => {
    const s = await build("phone");
    const tiles = walk(s.root!).filter((n) => n.type === "BotTiles");
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.props!.columns).toBe(1);
      expect(t.props!.height).toBe(START_TILE_HEIGHT);
      expect(START_TILE_HEIGHT).toBeGreaterThan(104);
    }
    const specs = tiles.flatMap((t) => t.props!.tiles as Array<{ slug: string; sub: string; state: string }>);
    const plan = specs.find((x) => x.slug === "plan")!;
    expect(plan.sub).toBe(START_LINES.plan);
    // A description, never a status: no bot here reads "Working · …".
    for (const x of specs) expect(x.state).toBe("idle");
    // Make a bot closes the list.
    expect(specs.at(-1)!.slug).toBe("make");
  });

  it("every line fits two lines of a tile", () => {
    for (const [slug, line] of Object.entries(START_LINES)) expect(line.length, slug).toBeLessThanOrEqual(90);
  });

  it("a build that cannot draw the living tiles gets the same rows, still, one a row", async () => {
    const s = await build("phone", (c) => c !== "BotsMotion");
    expect(walk(s.root!).some((n) => n.type === "BotTiles")).toBe(false);
    expect(JSON.stringify(s)).toContain(START_LINES.plan);
  });

  it("keeps to the kit on both clients, alive or still", async () => {
    for (const client of ["phone", "desktop"] as const) {
      for (const can of [() => true, (c: string) => c !== "BotsMotion"]) {
        const s = await build(client, can);
        expect(lintTree(s.root!, { client }), client).toEqual([]);
      }
    }
  });
});
