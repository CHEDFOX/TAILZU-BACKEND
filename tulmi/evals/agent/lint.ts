/**
 * THE SET'S SHAPE, CHECKED: what makes 195 tasks a benchmark rather than a pile.
 *
 *   counts      FAMILY_COUNTS and ATTACK_COUNTS, split evenly across the three
 *               languages, so a number by language compares like with like
 *   ids         unique, in the scheme (calendar-hi-004, adv-delete-en-002),
 *               agreeing with the task's own family, attack and language
 *   held        HELD_SHARE of each family and attack in each language, give
 *               or take the rounding (one of five, one or two of eight), and
 *               of each family and attack overall
 *   scripted    every task has its reference answer; a control names graders
 *   languages   Hindi in Devanagari, English and Hinglish in Latin letters, and
 *               in each family at least one Hindi task that names its app in
 *               Latin letters ("Google Calendar में..."), so routing in mixed
 *               script is exercised
 *   times       absolute: a task's `now` and its checks' times carry their
 *               offset, its dates are YYYY-MM-DD
 *
 * Returns one line per problem; an empty list is a set that may be run.
 */
import { GRADER_IDS } from "./graders/index.js";
import { ATTACK_COUNTS, FAMILY_COUNTS, HELD_SHARE, type Attack, type Family, type Lang, type Task } from "./types.js";

const LANGS: Lang[] = ["en", "hinglish", "hi"];
const DEVANAGARI = /\p{Script=Devanagari}/u;
const ABSOLUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The held count allowed for n tasks: 20% rounded down or up. */
const heldRange = (n: number): [number, number] => [Math.floor(n * HELD_SHARE), Math.ceil(n * HELD_SHARE)];

export function lintTasks(tasks: Task[]): string[] {
  const problems: string[] = [];
  const say = (t: Task | string, why: string) => problems.push(`${typeof t === "string" ? t : t.id}: ${why}`);

  // ids
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) say(t, "id used twice");
    seen.add(t.id);
    const want = t.family === "adversarial" ? `adv-${t.attack ?? "?"}-${t.lang}-` : `${t.family}-${t.lang}-`;
    if (!t.id.startsWith(want) || !/-\d{3}$/.test(t.id) || t.id.length !== want.length + 3) say(t, `id is not ${want}nnn`);
    if (t.family === "adversarial" && !t.attack) say(t, "an adversarial task needs its attack");
    if (t.family !== "adversarial" && t.attack) say(t, "only an adversarial task has an attack");
  }

  // counts and held, per family or attack, per language
  const groups: Array<{ name: string; total: number; of: (t: Task) => boolean }> = [
    ...(Object.keys(FAMILY_COUNTS) as Family[]).map((f) => ({ name: f, total: FAMILY_COUNTS[f], of: (t: Task) => t.family === f })),
    ...(Object.keys(ATTACK_COUNTS) as Attack[]).map((a) => ({ name: `adv-${a}`, total: ATTACK_COUNTS[a], of: (t: Task) => t.family === "adversarial" && t.attack === a })),
  ];
  for (const g of groups) {
    const all = tasks.filter(g.of);
    const per = g.total / LANGS.length;
    for (const lang of LANGS) {
      const mine = all.filter((t) => t.lang === lang);
      if (mine.length !== per) say(g.name, `${mine.length} ${lang} tasks, not ${per}`);
      const held = mine.filter((t) => t.split === "held").length;
      const [lo, hi] = heldRange(mine.length);
      if (held < lo || held > hi) say(g.name, `${held} of ${mine.length} ${lang} tasks held, not ${lo === hi ? lo : `${lo} or ${hi}`}`);
    }
    const held = all.filter((t) => t.split === "held").length;
    const [lo, hi] = heldRange(all.length);
    if (held < lo || held > hi) say(g.name, `${held} of ${all.length} held overall, not ${lo === hi ? lo : `${lo} to ${hi}`}`);
  }
  const known = new Set<string>([...Object.keys(FAMILY_COUNTS), "adversarial"]);
  for (const t of tasks) if (!known.has(t.family)) say(t, `no family called ${t.family}`);

  // the reference answer and the controls
  for (const t of tasks) {
    if (!t.scripted?.calls?.length) say(t, "no scripted calls: every task carries its reference answer");
    if (t.xfail && t.xfail.until !== "M2") say(t, "xfail is until M2");
    for (const c of t.controls ?? []) {
      if (!c.mustFail.length) say(t, `control "${c.name}" names no grader it must fail`);
      for (const id of c.mustFail) if (!GRADER_IDS.includes(id)) say(t, `control "${c.name}" names no grader called ${id}`);
      if (!c.scripted.calls.length) say(t, `control "${c.name}" has no calls`);
    }
  }

  // languages
  for (const t of tasks) {
    const deva = DEVANAGARI.test(t.said);
    if (t.lang === "hi" && !deva) say(t, "a Hindi task is said in Devanagari");
    if (t.lang !== "hi" && deva) say(t, `a ${t.lang} task is said in Latin letters`);
  }
  for (const f of Object.keys(FAMILY_COUNTS) as Family[]) {
    const hindi = tasks.filter((t) => t.family === f && t.lang === "hi");
    if (hindi.length && !hindi.some((t) => /[A-Za-z]{3,}/.test(t.said))) say(f, "no Hindi task names its app in Latin letters");
  }

  // times
  for (const t of tasks) {
    if (t.now !== undefined && !ABSOLUTE.test(t.now)) say(t, `now "${t.now}" has no offset`);
    for (const c of t.expect.world ?? []) {
      for (const k of ["start", "end"] as const) {
        const v = (c as { start?: unknown; end?: unknown })[k];
        if (typeof v === "string" && !ABSOLUTE.test(v) && !DATE.test(v)) say(t, `${c.kind} ${k} "${v}" is neither a time with its offset nor a date`);
      }
      if (c.kind === "task" && typeof c.due === "string" && !DATE.test(c.due)) say(t, `task due "${c.due}" is not YYYY-MM-DD`);
    }
    for (const e of t.world.google?.events ?? []) {
      for (const v of [e.start, e.end]) if (typeof v === "string" && !ABSOLUTE.test(v) && !DATE.test(v)) say(t, `seeded event "${e.title}" time "${v}" has no offset`);
    }
  }
  return problems;
}
