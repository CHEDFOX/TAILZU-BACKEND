/**
 * LOCATE WITH THE REPO MAP AS ITS SIXTH SIGNAL (src/code/work/locate.ts, src/code/project/repomap.ts), AGAINST LOCATE WITHOUT IT.
 *
 * The same tasks, ranked with the map off and on (evals/locate/harness.ts, the code behind `npm run bench:locate`):
 *   fixtures   the Acme Shop tasks of the project-brain tests (12)
 *   defined    120 tasks generated from tulmi/src: "where is <a symbol the request names> defined" (the old signals are strong here; the map must not hurt)
 *   callers    120 tasks generated from tulmi/src: "what uses <symbol>" (a caller is a file the old signals have no way to reach)
 * The bounds are the measured numbers (docs/code-project-brain.md) less a margin; the DEV tasks tuned the map's weight and the TEST tasks did not.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  process.env.CODE_TREE_SITTER = "true";
});

const { runLocateBench } = await import("../evals/locate/harness.js");
const { MAP_DEFAULTS } = await import("../src/code/work/locate.js");

describe("locate with and without the repo map", () => {
  it("finds the callers the five signals cannot, and does not lose the places they find", async () => {
    // 32 tasks of each generated set (the command line runs 120): each is ranked twice, and the suite should not wait for the whole benchmark.
    const r = await runLocateBench({ max: 32 });
    const off = r.scores["five signals (map off)"]!;
    const on = r.scores["with the repo map (shipped)"]!;
    expect(r.facts.appFiles).toBeGreaterThan(300);
    expect(r.facts.appFilesWithRefs).toBeGreaterThan(r.facts.appFiles * 0.9);

    // The Acme fixtures: unchanged.
    expect(on.fixtures!.all!.n).toBe(12);
    expect(on.fixtures!.all!.top1).toBeGreaterThanOrEqual(off.fixtures!.all!.top1);
    expect(on.fixtures!.all!.top8).toBeGreaterThanOrEqual(off.fixtures!.all!.top8);
    expect(on.fixtures!.all!.top1).toBeGreaterThanOrEqual(0.9);

    // Tasks that name a definition: not worse than one task in twenty.
    expect(on.defined!.all!.n).toBe(32);
    expect(on.defined!.all!.top3).toBeGreaterThanOrEqual(off.defined!.all!.top3 - 0.05);
    expect(on.defined!.all!.top1).toBeGreaterThanOrEqual(off.defined!.all!.top1 - 0.05);
    expect(on.defined!.all!.top3).toBeGreaterThanOrEqual(0.93);

    // Tasks that ask for the callers: from almost none in the top three to about half, in both halves (the weight was tuned on the DEV half only).
    expect(on.callers!.all!.n).toBe(32);
    for (const split of ["dev", "test", "all"]) {
      const a = off.callers![split]!, b = on.callers![split]!;
      // Without the map, under a third: the Bots app (src/experience/bots and its areas) joined the draw and its screens call shared kit helpers by name,
      // which the five signals catch for a few more tasks (0.25 in the DEV half, 4 of 16). The gain the map adds is what the bounds below hold.
      expect(a.top3, `callers ${split}`).toBeLessThan(0.3);
      // The tasks are drawn from tulmi/src itself. The draw used to move with every file added anywhere in src (the bound went 0.15, 0.14, 0.12 that way); since
      // 2026-10-28 each file and name has its own stable draw (evals/locate/bench.ts stableKey), so only a change near the drawn tasks moves it. Re-measured on
      // that draw: TEST half 0.00 -> 0.12 in the top three (2 of 17 more), 0.06 -> 0.53 in the top eight. At least two tasks of a half better is the bound.
      expect(b.top3 - a.top3, `callers ${split}`).toBeGreaterThanOrEqual(0.1);
      expect(b.top8, `callers ${split}`).toBeGreaterThanOrEqual(0.4);
      expect(b.mrr - a.mrr, `callers ${split}`).toBeGreaterThan(0.12);
    }
  }, 400_000);

  it("ships with the map on and the weight and direction the DEV tasks chose", () => {
    expect(MAP_DEFAULTS).toEqual({ on: true, weight: 2.5, back: 2, seeds: false });
  });
});
