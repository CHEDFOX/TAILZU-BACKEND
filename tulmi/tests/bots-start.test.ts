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
const { CINEMA_3D_LINE, GROUPED_SLUGS, NOT_TILED, START_LINES, START_TILE_HEIGHT, START_STAGE, START_STAGE_HEIGHT, START_SUB_LINES } = await import("../src/experience/bots/screens/bots/botsStart.js");

const build = (client: "phone" | "desktop", can: (c: string) => boolean = () => true) => buildBotsScreen({
  screenId: SCREENS.start, client, params: {}, tzOffsetMinutes: IST, user: { id: "u-aanya", name: "Aanya" },
  can: { has: can } as unknown as Set<string>, desk: { pages: client === "desktop", notes: true },
}, fakeDeps({}));

describe("Start something", () => {
  it("every built-in is in a group, or deliberately not a tile", () => {
    for (const b of builtinBots()) expect(GROUPED_SLUGS.includes(b.slug) || NOT_TILED.includes(b.slug), b.slug).toBe(true);
  });

  it("draws each group as living tiles, ONE A ROW, taller than Home's, each saying what its bot can do", async () => {
    const s = await build("phone", (c) => c !== "BotTilesStage");
    const tiles = walk(s.root!).filter((n) => n.type === "BotTiles");
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.props!.columns).toBe(1);
      expect(t.props!.height).toBe(START_TILE_HEIGHT);
      expect(t.props!.stage).toBeUndefined();
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

  it("a build that can: the bot keeps the top of the card and the card grows down for his name and three lines", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const tiles = walk((await build(client)).root!).filter((n) => n.type === "BotTiles");
      expect(tiles.length).toBeGreaterThan(0);
      for (const t of tiles) {
        expect(t.props!.stage).toBe(START_STAGE);
        expect(t.props!.subLines).toBe(START_SUB_LINES);
        expect(t.props!.height).toBe(START_STAGE_HEIGHT);
        // Room under the bot for the name and every line, and padding below.
        expect(START_STAGE_HEIGHT - START_STAGE).toBeGreaterThanOrEqual(21 + 3 + START_SUB_LINES * 16 + 22);
      }
    }
  });

  it("every line says what the bot is, then what it does, and fits three lines of a tile", () => {
    for (const [slug, line] of [...Object.entries(START_LINES), ["cinema (films off)", CINEMA_3D_LINE] as const]) {
      expect(line.length, slug).toBeLessThanOrEqual(116);
      expect(line, slug).toMatch(/^An? [^.]+\. \S/);
    }
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
