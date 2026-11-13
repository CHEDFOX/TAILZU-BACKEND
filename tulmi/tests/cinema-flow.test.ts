/**
 * THE CINEMA BOT'S EYE AND ITS ORDER OF WORK (src/cinema/qc.ts, src/cinema/flow.ts):
 *
 *   - a verdict is read from the model's JSON, tolerant of prose around it; what passes is decided in code
 *   - a problem the prompt can fix is retaken with the fix; a problem of the model's own is retaken on another model; after three takes
 *     the best is kept with a note, unless it is unsafe or too poor, and then the shot waits for the person
 *   - nothing is made before the script is approved, no video before the price is; sheets before stills
 *   - a take is started only when the money left covers it; a continued shot waits for the shot before it
 *   - a changed card makes again only what it touches, and the cut is made again when a take in it changed
 */
import { describe, expect, it } from "vitest";
import { voicePrint } from "../src/cinema/compile.js";
import { prints, refresh, steps, type Step } from "../src/cinema/flow.js";
import { afterCheck, bestTake, mean, parseVerdict, passes } from "../src/cinema/qc.js";
import type { Film } from "../src/cinema/types.js";
import { card, film, take, verdict } from "./cinema-rig.js";

const none = new Set<string>();
const kinds = (s: Step[]) => s.map((x) => (x.kind === "move" ? `move:${x.status}:${x.hold ?? ""}` : x.kind === "sheet" ? `sheet:${x.key}` : "n" in x ? `${x.kind}:${x.n}` : x.kind));
const flat = (paise: number) => () => paise;
const rich = { budgetPaise: 1_000_000 };

/** A film whose look frame, sheets, stills and voice-over are all made, as of now. */
function boarded(over: Partial<Film> = {}): Film {
  const f = film(over);
  const b = f.script!.bible;
  b.lookRef = "look";
  b.characters.forEach((c) => (c.ref = `sheet-${c.key}`));
  b.places.forEach((p) => (p.ref = `sheet-${p.key}`));
  const p = prints(f);
  f.shots = f.shots.map((s) => {
    const card = f.script!.shots.find((c) => c.n === s.n)!;
    const vo = voicePrint(card, b, f.voice);
    return { ...s, still: `still-${s.n}`, stillOf: p.still.get(s.n)!, ...(vo ? { voice: `vo-${s.n}`, voiceOf: vo, voiceSeconds: 3 } : {}) };
  });
  return f;
}

/** Every shot has a chosen take for its card as it is now. */
function filmed(f: Film): Film {
  for (const s of f.shots) {
    const p = prints(f);
    const t = take(s.n, p.take.get(s.n)!, { status: "done", video: `v${s.n}`, lastFrame: `lf${s.n}`, verdict: verdict(9) });
    f.takes.push(t);
    s.take = t.id;
    s.takeOf = t.of;
  }
  return f;
}

describe("the eye's verdict", () => {
  it("is read from JSON with prose around it", () => {
    const v = parseVerdict('Here you go: {"scores":{"identity":8,"action":9,"camera":7,"quality":8,"continuity":9},"issues":[],"fix":null} done');
    expect(v?.pass).toBe(true);
  });

  it("fails on a major problem whatever the scores", () => {
    const v = parseVerdict({ scores: { identity: 9, action: 9, camera: 9, quality: 9, continuity: 9 }, issues: [{ kind: "anatomy", major: true, note: "six fingers" }] });
    expect(v?.pass).toBe(false);
  });

  it("fails a low score even when the mean is fine", () => {
    expect(passes({ scores: { identity: 5, action: 10, camera: 10, quality: 10, continuity: 10 }, issues: [] })).toBe(false);
  });

  it("does not mark a shot with nobody in it on identity", () => {
    const v = parseVerdict({ scores: { action: 8, quality: 8 } }, false);
    expect(v?.pass).toBe(true);
    expect(mean(v!, false)).toBeGreaterThanOrEqual(7);
  });

  it("is null when it is not a verdict", () => {
    expect(parseVerdict("I cannot see the image")).toBeNull();
    expect(parseVerdict({ scores: { identity: 8 } })).toBeNull();
  });

  it("files an unknown kind of problem as an artifact", () => {
    expect(parseVerdict({ scores: { identity: 8, action: 8, quality: 8 }, issues: [{ kind: "weird", note: "x" }] })?.issues[0]!.kind).toBe("artifact");
  });
});

describe("after a take is checked", () => {
  const c = card(2);
  const bad = (issues: { kind: string; major: boolean }[], fix: string | null = "keep the kettle still") =>
    verdict(5, { pass: false, issues: issues.map((i) => ({ ...i, note: i.kind })) as never, fix });

  it("keeps a take that passes", () => {
    const t = take(2, "x", { status: "done", verdict: verdict(9) });
    expect(afterCheck(c, { blamed: [] }, [t], t, true)).toEqual({ kind: "keep", take: t.id });
  });

  it("retakes with the fix when the prompt is to blame", () => {
    const t = take(2, "x", { status: "done", verdict: bad([{ kind: "action", major: false }]) });
    expect(afterCheck(c, { blamed: [] }, [t], t, true)).toEqual({ kind: "retake", fix: "keep the kettle still", blame: null });
  });

  it("blames the model for melting and broken hands", () => {
    const t = take(2, "x", { status: "done", model: "m1", verdict: bad([{ kind: "morph", major: true }]) });
    expect(afterCheck(c, { blamed: [] }, [t], t, true)).toMatchObject({ kind: "retake", blame: "m1" });
  });

  it("blames the model when the same problem comes back from it", () => {
    const a = take(2, "x", { status: "done", model: "m1", verdict: bad([{ kind: "camera", major: false }]) });
    const b = take(2, "x", { status: "done", model: "m1", verdict: bad([{ kind: "camera", major: false }]) });
    expect(afterCheck(c, { blamed: [] }, [a, b], b, true)).toMatchObject({ kind: "retake", blame: "m1" });
  });

  it("keeps the best of three with a note", () => {
    const ts = [6, 5.5, 5].map((s) => take(2, "x", { status: "done", verdict: verdict(s, { pass: false }) }));
    const r = afterCheck(c, { blamed: [] }, ts, ts[2]!, true);
    expect(r).toMatchObject({ kind: "best", take: ts[0]!.id });
    expect(r.kind === "best" && r.note).toMatch(/best of 3/);
  });

  it("keeps the best so far when the money would not cover another take", () => {
    const t = take(2, "x", { status: "done", verdict: verdict(6, { pass: false }) });
    expect(afterCheck(c, { blamed: [] }, [t], t, false)).toMatchObject({ kind: "best", take: t.id });
  });

  it("waits for the person when every take is too poor, or unsafe", () => {
    const ts = [3, 2, 3].map((s) => take(2, "x", { status: "done", verdict: verdict(s, { pass: false }) }));
    expect(afterCheck(c, { blamed: [] }, ts, ts[2]!, true).kind).toBe("wait");
    const unsafe = take(2, "x", { status: "done", verdict: bad([{ kind: "safety", major: true }]) });
    expect(afterCheck(c, { blamed: [] }, [unsafe], unsafe, true).kind).toBe("wait");
    expect(bestTake([unsafe], true)).toBeNull();
  });
});

describe("the order of work", () => {
  it("makes nothing before the script is approved", () => {
    expect(steps(film({ status: "script" }), { now: 0, busy: none, cost: flat(10) })).toEqual([]);
    expect(steps(film({ status: "writing" }), { now: 0, busy: none, cost: flat(10) })).toEqual([]);
  });

  it("makes the look frame and the reference sheets first, and records the voice-over meanwhile", () => {
    const k = kinds(steps(film(rich), { now: 0, busy: none, cost: flat(10) }));
    expect(k.filter((x) => x.startsWith("sheet:"))).toEqual(["sheet:look", "sheet:ravi", "sheet:meera"]);
    expect(k.filter((x) => x.startsWith("still:"))).toEqual([]);
    expect(k).toContain("voice:1");
  });

  it("does not show the storyboard until the voice-over is recorded", () => {
    const f = boarded(rich);
    f.shots[0]!.voice = null;
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(10) }))).toEqual(["voice:1"]);
  });

  it("makes a still once the sheets it needs are there", () => {
    const f = film(rich);
    f.script!.bible.lookRef = "look";
    f.script!.bible.places.find((p) => p.key === "street")!.ref = "s";
    const k = kinds(steps(f, { now: 0, busy: new Set(["sheet:character:ravi", "sheet:character:meera", "sheet:place:stall"]), cost: flat(10) }));
    expect(k).toContain("still:1");
    expect(k).not.toContain("still:2");
  });

  it("holds the storyboard for more money when the stills would cost more than was agreed", () => {
    const k = kinds(steps(film({ budgetPaise: 25 }), { now: 0, busy: none, cost: flat(10) }));
    expect(k).toEqual(["sheet:look", "sheet:ravi", "move:boarding:budget"]);
  });

  it("counts what the running steps will spend", () => {
    const k = kinds(steps(film(rich), { now: 0, busy: none, cost: flat(10), left: 15 }));
    expect(k.filter((x) => x.startsWith("sheet:"))).toEqual(["sheet:look"]);
  });

  it("shows the storyboard once every still is made, and starts no video before the price is approved", () => {
    const k = kinds(steps(boarded(), { now: 0, busy: none, cost: flat(10) }));
    expect(k).toEqual(["move:board:"]);
    expect(steps(boarded({ status: "board" }), { now: 0, busy: none, cost: flat(10) })).toEqual([]);
  });

  it("starts takes up to the limit, in film order", () => {
    const f = boarded({ status: "rendering", budgetPaise: 10_000 });
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(100) }))).toEqual(["render:1", "render:2", "render:3"]);
  });

  it("starts only the takes the money left covers, and holds for more", () => {
    const f = boarded({ status: "rendering", budgetPaise: 250, spentPaise: 0 });
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(100) }))).toEqual(["render:1", "render:2", "move:rendering:budget"]);
  });

  it("waits for the shot before when a shot continues it", () => {
    const f = boarded({ status: "rendering", budgetPaise: 10_000 });
    f.script!.shots[1]!.link = "continue";
    const p = prints(f);
    f.shots = f.shots.map((s) => ({ ...s, stillOf: p.still.get(s.n)! }));
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(100) }))).toEqual(["render:1", "render:3", "render:4"]);
  });

  it("polls a running take only every so often, and checks a finished one", () => {
    const f = boarded({ status: "rendering", budgetPaise: 10_000 });
    const p = prints(f);
    f.takes.push(take(1, p.take.get(1)!, { polledAt: 1_000 }), take(2, p.take.get(2)!, { status: "done", video: "v" }));
    const early = steps(f, { now: 5_000, busy: none, cost: flat(100) });
    expect(early.some((s) => s.kind === "poll")).toBe(false);
    expect(early.some((s) => s.kind === "check")).toBe(true);
    expect(steps(f, { now: 30_000, busy: none, cost: flat(100) }).some((s) => s.kind === "poll")).toBe(true);
  });

  it("holds for the person when a shot gave up, and carries on with the others", () => {
    const f = boarded({ status: "rendering", budgetPaise: 10_000 });
    const p = prints(f);
    f.shots[0]!.failedOf = p.take.get(1)!;
    const k = kinds(steps(f, { now: 0, busy: none, cost: flat(100) }));
    expect(k).toEqual(["render:2", "render:3", "render:4", "move:rendering:shot"]);
  });

  it("cuts the film once every shot has its take, and is done once the cut is of these takes", () => {
    const f = filmed(boarded({ status: "rendering", budgetPaise: 10_000 }));
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(100) }))).toEqual(["cut", "move:cutting:"]);
    f.status = "cutting";
    f.cut = { video: "cut.mp4", srt: null, seconds: 20, of: prints(f).cut };
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(100) }))).toEqual(["move:done:"]);
  });

  it("makes a new take, and then a new cut, when one line changes; the still stays", () => {
    const f = filmed(boarded({ status: "done", budgetPaise: 10_000 }));
    f.cut = { video: "cut.mp4", srt: null, seconds: 20, of: prints(f).cut };
    f.script!.shots[3]!.lines = [{ who: "ravi", text: "Garam chai, beta." }];
    const after = refresh(f);
    expect(after.shots[3]!.status).toBe("queued");
    expect(after.shots[0]!.status).toBe("ok");
    expect(kinds(steps(f, { now: 0, busy: none, cost: flat(100) }))).toEqual(["render:4", "move:rendering:"]);
  });

  it("makes a new still, then a new take, when a wardrobe changes, for every shot the person is in", () => {
    const f = filmed(boarded({ status: "done", budgetPaise: 10_000 }));
    f.script!.bible.characters[1]!.wardrobe = "a red raincoat";
    const k = kinds(steps(f, { now: 0, busy: none, cost: flat(100) }));
    expect(k).toContain("still:3");
    expect(k).toContain("still:4");
    expect(k).not.toContain("still:2");
  });
});
