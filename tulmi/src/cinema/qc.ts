/**
 * THE EYE: every still and every take is looked at before the person sees it, and a bad one is made again before they ever pay attention
 * to it. This is the part the big tools leave to the person (generate, look, sigh, pay, generate again).
 *
 * A vision model is shown the shot's card, who is in it, the approved still and frames from the take (and, for a shot that continues the
 * one before, that shot's last frame), and answers in JSON (`parseVerdict`): five scores from 0 to 10, the problems it saw, and one line
 * that would fix them. The rules on what passes and what happens next are here, in code, not in the model's hands:
 *
 *   PASS      no major problem, nothing under 6, and a weighted mean of 7 or more
 *   EDIT      every problem is a local one on an otherwise good take - a warped sign, a sixth finger, a smear, the wrong shirt - so the
 *             take is MENDED rather than filmed again: the clip and the fix line go to an edit model (three cents a second against forty
 *             for a second of Veo), and what comes back is checked like any other take. Tried once per take and only while
 *             there are tries left, so a mend that fails falls through to a retake rather than looping
 *   RETAKE    a problem the prompt can fix (the action, the camera, the framing, the words in frame) goes back with the fix line added; a
 *             problem of the model's own making (bodies, hands, melting, physics, a face that turns into someone else) blames the model, and
 *             the retake goes to the next model in the router's list
 *   BEST OF   after MAX_TRIES checked takes, the best one is kept with a note to the person, rather than spending without end, as long as it
 *             is not unsafe and nothing in it is under KEEP_FLOOR; otherwise the shot waits for the person (Film.hold = "shot")
 *
 * A retake is only made when the film's money allows it; otherwise the best take so far is kept, with a note.
 */
import { ISSUE_KINDS, type Bible, type Issue, type IssueKind, type ShotCard, type ShotState, type Take, type Verdict } from "./types.js";

export const MAX_TRIES = 3;
export const PASS_MIN = 6;
export const PASS_MEAN = 7;
export const KEEP_FLOOR = 4;
/** A take that failed at the provider (an error, not a bad picture) is tried again this often before the model is blamed. */
export const PROVIDER_FAILS = 2;

/** Problems a better prompt does not fix: they are the model's. */
const MODEL_FAULTS = new Set<IssueKind>(["anatomy", "artifact", "morph", "physics", "identity", "lipsync"]);

/** A take good enough to be worth mending: nothing in it below this, or it is filmed again from the still. */
export const MEND_FLOOR = 6;

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null);

/** The weighted mean of a verdict's scores. A shot with nobody in it is not marked on identity. */
export function mean(v: Pick<Verdict, "scores">, people = true): number {
  const s = v.scores;
  const w = people ? { identity: 0.3, action: 0.25, quality: 0.25, camera: 0.1, continuity: 0.1 } : { identity: 0, action: 0.35, quality: 0.35, camera: 0.15, continuity: 0.15 };
  const sum = s.identity * w.identity + s.action * w.action + s.quality * w.quality + s.camera * w.camera + s.continuity * w.continuity;
  return Math.round(sum * 10) / 10;
}

export function passes(v: Pick<Verdict, "scores" | "issues">, people = true): boolean {
  if (v.issues.some((i) => i.major)) return false;
  const s = v.scores;
  const marked = people ? [s.identity, s.action, s.quality] : [s.action, s.quality];
  return Math.min(...marked) >= PASS_MIN && mean(v, people) >= PASS_MEAN;
}

/** The model's answer into a verdict, or null when it is not one (the caller counts that as no check, and asks once more). */
export function parseVerdict(raw: unknown, people = true): Verdict | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try {
      o = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const sc = (r.scores && typeof r.scores === "object" ? r.scores : r) as Record<string, unknown>;
  const scores = {
    identity: clamp(sc.identity) ?? (people ? null : 10),
    action: clamp(sc.action),
    camera: clamp(sc.camera) ?? 7,
    quality: clamp(sc.quality),
    continuity: clamp(sc.continuity) ?? 8,
  };
  if (scores.identity === null || scores.action === null || scores.quality === null) return null;
  const issues: Issue[] = [];
  if (Array.isArray(r.issues)) {
    for (const it of r.issues.slice(0, 8)) {
      if (!it || typeof it !== "object") continue;
      const i = it as Record<string, unknown>;
      const kind = typeof i.kind === "string" && (ISSUE_KINDS as readonly string[]).includes(i.kind) ? (i.kind as IssueKind) : "artifact";
      const note = typeof i.note === "string" ? i.note.slice(0, 200) : "";
      issues.push({ kind, major: i.major === true || i.severity === "major", note });
    }
  }
  const fix = typeof r.fix === "string" && r.fix.trim() ? r.fix.trim().slice(0, 240) : null;
  const v = { scores: scores as Verdict["scores"], issues, fix };
  return { ...v, pass: passes(v, people) };
}

export type AfterCheck =
  | { kind: "keep"; take: string }
  | { kind: "edit"; take: string; fix: string }
  | { kind: "retake"; fix: string | null; blame: string | null }
  | { kind: "best"; take: string; note: string }
  | { kind: "wait"; why: string };

/**
 * What to do once a take of a shot has been checked. `takes` are the shot's takes for its card as it is now, the new one among them;
 * `canAfford` says whether one more take fits in what the film may still spend. `canMend` is told by the caller, which knows whether we
 * have an edit model today and whether this take's faults are the kind it is trusted with (route.ts editable).
 */
export function afterCheck(
  card: ShotCard,
  shot: Pick<ShotState, "blamed">,
  takes: readonly Take[],
  latest: Take,
  canAfford: boolean,
  canMend = false,
): AfterCheck {
  const people = card.cast.length > 0;
  const v = latest.verdict;
  if (v && v.pass) return { kind: "keep", take: latest.id };
  const checked = takes.filter((t) => t.verdict);
  const best = bestTake(checked, people);
  const unsafe = v?.issues.some((i) => i.kind === "safety") ?? false;
  // A mend counts as one of the tries and is only offered while there are tries left: past that the best take is kept, which may not be
  // this one, and mending the wrong take would be worse than keeping the right one.
  if (v && canMend && !unsafe && !latest.from && checked.length < MAX_TRIES && mendable(v, people)) return { kind: "edit", take: latest.id, fix: mendLine(v) };
  if (checked.length < MAX_TRIES && canAfford && !unsafe) {
    const faults = v?.issues.filter((i) => MODEL_FAULTS.has(i.kind)) ?? [];
    const sameAgain = v ? repeated(checked, v) : false;
    const blame = faults.some((i) => i.major) || faults.length >= 2 || sameAgain ? latest.model : null;
    return { kind: "retake", fix: v?.fix ?? null, blame: blame && !shot.blamed.includes(blame) ? blame : null };
  }
  if (best && keepable(best, people)) {
    const why = checked.length >= MAX_TRIES ? `kept the best of ${checked.length} takes` : "kept the best take so far";
    return { kind: "best", take: best.id, note: `Shot ${card.n}: ${why}${best.verdict?.issues[0] ? ` (${best.verdict.issues[0].note})` : ""}.` };
  }
  return { kind: "wait", why: unsafe ? "That shot came out as something we won't use. Change its words and try again." : `Shot ${card.n} did not come out right in ${checked.length} takes. Change its words and try again.` };
}

/** Whether a take is worth mending rather than filming again: good everywhere else, and something to say about what is wrong. */
export function mendable(v: Verdict, people: boolean): boolean {
  if (!v.issues.length) return false;
  const s = v.scores;
  const marked = people ? [s.identity, s.action, s.quality, s.camera] : [s.action, s.quality, s.camera];
  return Math.min(...marked) >= MEND_FLOOR;
}

/** What to tell the edit model: the fix line the eye wrote, else what it saw, as one instruction about the picture. */
export function mendLine(v: Verdict): string {
  const notes = v.issues.map((i) => i.note.trim()).filter(Boolean);
  const said = v.fix?.trim() || notes.join("; ");
  const line = said || "Remove the flaw in the picture.";
  return `${line.replace(/\s+/g, " ").slice(0, 400).replace(/[.;]$/, "")}. Change nothing else: the same people, clothes, place, light, framing and camera move.`;
}

/** The best checked take: the highest mean, never an unsafe one. */
export function bestTake(takes: readonly Take[], people: boolean): Take | null {
  let best: Take | null = null;
  for (const t of takes) {
    if (!t.verdict || t.verdict.issues.some((i) => i.kind === "safety")) continue;
    if (!best || mean(t.verdict, people) > mean(best.verdict!, people)) best = t;
  }
  return best;
}

const keepable = (t: Take, people: boolean): boolean => {
  const s = t.verdict!.scores;
  return Math.min(...(people ? [s.identity, s.action, s.quality] : [s.action, s.quality])) >= KEEP_FLOOR;
};

/** The same kind of problem from the same model twice running: the prompt is not the cause. */
function repeated(checked: readonly Take[], v: Verdict): boolean {
  const kinds = new Set(v.issues.map((i) => i.kind));
  const before = checked.slice(0, -1).at(-1);
  return !!before?.verdict && before.model === checked.at(-1)?.model && before.verdict.issues.some((i) => kinds.has(i.kind));
}

/** What the eye is told about a shot, as the words beside the pictures. `kind` says whether it looks at a still or at a take's frames. */
export function checkBrief(card: ShotCard, bible: Bible, kind: "still" | "take"): string {
  const cast = card.cast.map((k) => bible.characters.find((c) => c.key === k)).filter(Boolean).map((c) => `- ${c!.name}: ${c!.look}; wearing ${c!.wardrobe}`);
  const lines = card.lines.map((l) => `${bible.characters.find((c) => c.key === l.who)?.name ?? l.who}: "${l.text}"`);
  return [
    kind === "still"
      ? "You are checking one storyboard still for a film before it is animated. Image 1 is the still; any images after it are the reference sheets of the people and the place, in the order listed."
      : "You are checking one generated video take for a film. Image 1 is the approved still the take started from; the next images are frames from the take, in time order. If a final image is labelled as the previous shot's last frame, check continuity against it.",
    `Shot ${card.n}: ${card.size}, ${card.angle} angle, ${card.move} camera, ${card.lens}mm, ${card.seconds}s.`,
    card.intent ? `What the shot is for: ${card.intent}` : "",
    `It should show: ${card.frame}${card.composition ? ` Composition: ${card.composition}` : ""}`,
    kind === "take" ? `What happens: ${card.action}` : "",
    kind === "take" && card.performance ? `The acting to look for: ${card.performance}` : "",
    kind === "take" && card.camera ? `The camera: ${card.camera}` : "",
    kind === "take" && card.end ? `How it should end: ${card.end}` : "",
    cast.length ? `People who must look exactly like this:\n${cast.join("\n")}` : "Nobody should be in frame unless the action says so.",
    card.text ? `These words must be readable and spelled exactly: "${card.text}".` : "There must be no text, captions or watermarks.",
    lines.length && kind === "take" ? `Lines spoken (lips should move with them): ${lines.join(" ")}` : "",
    `Look of the film: ${bible.look.palette}; ${bible.look.light}; ${bible.look.stock}.`,
    'Answer with JSON only: {"scores":{"identity":0-10,"action":0-10,"camera":0-10,"quality":0-10,"continuity":0-10},"issues":[{"kind":"identity|wardrobe|action|camera|anatomy|artifact|morph|text|continuity|physics|framing|lipsync|safety","major":true|false,"note":"a few words"}],"fix":"one short instruction for the next attempt, or null"}',
    "Score action on whether the take delivers what the shot is for: the action, the acting and the ending as described. Score camera on the move, its speed and the focus.",
    "Be strict about faces, hands, bodies, melting or morphing, and anything that contradicts the shot. Mark a problem major only if a viewer would notice it at once. The fix is one concrete instruction about what must be seen (\"his right hand stays on the kettle handle\"), not a general wish.",
  ].filter(Boolean).join("\n");
}
