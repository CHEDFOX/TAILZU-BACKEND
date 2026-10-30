/**
 * GET /v1/shell/glance?v=2, BUILT: the X0 widget's one document (docs/widget-glance-v2.md section 2). The whole app at a glance, and what
 * matters most right now (`case`): something needs the person, else a bot finished something they have not seen, else bots are working,
 * else quiet.
 *
 * Pure: routes/botsShell.ts reads the records (the Code bot's jobs, the connected apps' tasks, the bots, the week's minutes, what the person
 * has seen) and hands them in; every word and limit is a knob of the "widgets" surface (defaults.ts, x0.*), in English or Hinglish. It is the
 * same live state Home draws (experience/bots/live.ts liveFrom), so the widget and Home never disagree about who is working or what waits.
 *
 * WHAT NEEDS THE PERSON is answered from the widget through the existing door: an item's `id` and `kind` are exactly a /v1/widgets/now row's
 * (items.ts: job:<id>:<q> "question", task:<id>:<approval> "approval"), and a choice's `id` is the action POST /v1/widgets/act takes (a0, a1,
 * a2 for a question's answers in order; yes / no for a connected app's call). An item that cannot be answered in place (more answers than
 * fit, a risk the server keeps in the app, a yes to a Code bot's plan) has no choices and `answerable: false`: the widget opens decideLink.
 *
 * PRIVATE-SAFE. A question the bot marked private, and every kind in x0.needs.private (a connected app's yes, by default), never puts its
 * words where a locked phone shows them: `lock` says only that a bot needs the person, and the AI digest is never given them (digest.ts).
 */
import { CONNECTOR_BOT, liveFrom, type BotLite, type JobLite } from "../experience/bots/live.js";
import { BOT_INK, headUrl } from "../experience/bots/art.js";
import { dayLineAfterGreeting } from "../experience/settingsWords.js";
import { dayPart } from "../experience/touches.js";
import { dayStartOf, STAGES, stageOf } from "../shell/feed.js";
import { clauseOf, cutAtWord, eventLine, FILL_INS, oneLineOf, WIDGET_LIMITS, type FillIns, type NeedsWords } from "./botWords.js";
import type { WidgetsPayload } from "./defaults.js";
import type { GlanceState } from "./glanceStore.js";
import { unseen } from "./glanceStore.js";
import { itemId, questionMark } from "./items.js";
import { linkOf, widgetKnobs, type WidgetKnobs } from "./now.js";
import { situationLine, situationOf, templateFor, type SituationFacts } from "./situation.js";

const MIN = 60_000, DAY = 24 * 60 * MIN;
const ACTIVE = new Set<JobLite["state"]>(["queued", "running", "waiting_for_compute"]);

// ------------------------------------------------------------------ what the route reads

/** A connected app's task (connectors/tasks.ts TaskView, narrowed): its yes, with the call's risk and the asking bot's own words. */
export interface GlanceTask {
  id: string;
  state: "running" | "waiting" | "done" | "failed" | "cancelled";
  title: string;
  approval: { id: string; connector: string; preview: string; risk?: string; widget?: NeedsWords } | null;
  createdAt: number;
  updatedAt: number;
}

export interface GlanceInput {
  now: number;
  tz: number;
  /** Hinglish words (the app's language). */
  hg: boolean;
  /** The person's first name, or "". */
  name: string;
  bots: BotLite[];
  jobs: JobLite[];
  tasks: GlanceTask[];
  /** Minutes writing by voice saved this week (history stats, as Home's week reads it). */
  minutesSaved: number;
  /** What they have seen, and where their last look ended (glanceStore.ts, already moved on by this glance). */
  state: Pick<GlanceState, "seen" | "all" | "sinceAt">;
  /** The AI digest's line, when there is one (digest.ts). */
  digest?: string | null;
}

// ------------------------------------------------------------------ what the widget gets

export type GlanceCase = "needs" | "working" | "done" | "quiet";
export type GlanceBotState = "needs" | "working" | "done" | "failed" | "idle";

export interface GlanceChoice { id: string; label: string; primary?: boolean }

export interface GlanceBot {
  slug: string; name: string; color: string;
  /** A head the app ships (code, keybot, plan, travel, tailzu), or null for a person's own bot. */
  face: string | null;
  faceUrl: string | null;
  state: GlanceBotState;
  needs: number;
  working: boolean;
  line: string;
  link: string;
}

export interface GlanceNeedsItem {
  id: string;
  kind: "question" | "approval";
  bot: string; botName: string; face: string | null;
  question: string;
  choices: GlanceChoice[];
  decideLink: string;
  private: boolean;
  answerable: boolean;
  link: string;
  /** When it started waiting (ms): the widget may say "4m". */
  at: number;
}

export interface GlanceJob {
  id: string; bot: string; task: string;
  stage: number; of: number; stageName: string; stages: string[];
  startedAt: number; link: string;
  /** "working", or "needs" while it waits for the person (its question is in needs.items). */
  phase: "working" | "needs";
}

export interface GlanceDone {
  id: string; bot: string; botName: string; face: string | null;
  result: string; endedAt: number; minutes: number;
  pr?: { number: number; url: string };
  link: string;
  /** It stopped with a problem: `result` is the problem's line. */
  failed?: true;
}

export interface GlanceV2 {
  v: 2;
  at: number;
  refreshAfterSec: number;
  case: GlanceCase;
  greeting: { hello: string; line: string; part: string };
  summary?: string;
  week: { done: number; minutesSaved: number; dots: number; line: string };
  bots: GlanceBot[];
  more: number;
  needs: { count: number; items: GlanceNeedsItem[] };
  job: GlanceJob | null;
  lastDone?: GlanceDone;
  counts: { working: number; needs: number };
  lock: { inline: string; title: string; line: string };
  links: { ask: string; home: string; mic: string };
  words: Record<string, string>;
}

/** Something that changed since the person last looked: what the summary counts and the AI digest is told. `words` null when private. */
export interface GlanceChange { id: string; kind: "needs" | "done" | "failed" | "started"; bot: string; botName: string; words: string | null }

// ------------------------------------------------------------------ the words

export interface X0Words {
  k: WidgetKnobs;
  hg: boolean;
  /** A knob's words in the person's language (key + ".hg" for Hinglish, else the English), slots filled. */
  word(key: string, fallback: string, vars?: Record<string, string | number>): string;
  fill: FillIns;
}

export function x0Words(payload: WidgetsPayload, hg: boolean): X0Words {
  const k = widgetKnobs(payload);
  const word = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    const en = k.label(key, fallback, vars);
    return hg ? k.label(`${key}.hg`, en, vars) : en;
  };
  const f = hg ? FILL_INS.hg : FILL_INS.en;
  const fill: FillIns = {
    needs: word("x0.fill.needs", f.needs), working: word("x0.fill.working", f.working), done: word("x0.fill.done", f.done),
    failed: word("x0.fill.failed", f.failed), idle: word("x0.fill.idle", f.idle),
  };
  return { k, hg, word, fill };
}

/** "Fix cart total rounding. Also the tax" → "Fix cart total rounding": a job's task as the widget names it (40 at most, at a word). */
export function taskLine(task: string): string {
  const first = oneLineOf(task.split(/[.\n]/)[0] ?? "");
  return cutAtWord(first, WIDGET_LIMITS.result) || cutAtWord(oneLineOf(task), WIDGET_LIMITS.result);
}

/** A bot's head key, when the app ships one. */
export const faceOf = (slug: string): string | null => (slug in BOT_INK ? slug : null);

/** The person's own name for a bot: the list's, else the built-in's words. */
function namer(bots: readonly BotLite[], w: X0Words): (slug: string) => string {
  return (slug) => bots.find((b) => b.slug === slug)?.name ?? w.k.label(`widgets.who.${slug}`, slug === "tailzu" ? "X0" : slug);
}

/** Whether the server lets a kind be answered in place from a widget now. */
function inPlace(k: WidgetKnobs, kind: string): boolean {
  if (!k.flag("widgets.enabled", true) || !k.flag("widgets.token.enabled", true)) return false;
  return k.obj<Record<string, unknown>>("widgets.needs.modes", {})[kind] !== "open";
}

/**
 * A Code bot job's question or yes as a needs item, or null when it waits for neither. The id is the /v1/widgets row's (a question's
 * fingerprint, so a stale button never answers the next one); a yes to a plan has no row there, and is open-only here.
 */
export function jobNeedsItem(j: JobLite, w: X0Words, botName: string, link: string): GlanceNeedsItem | null {
  if (j.state !== "waiting_for_you") return null;
  const k = w.k;
  const decideLink = linkOf(k, "question", { jobId: j.id });
  const secret = new Set(k.list("x0.needs.private", ["approval"]));
  if (j.waitingOn === "answer" && j.question?.text) {
    const own = j.question.widget;
    const options = (j.question.options ?? []).map((o) => o.trim()).filter(Boolean);
    const labels = options.map((o, i) => own?.choices?.[i] || cutAtWord(o, WIDGET_LIMITS.choice));
    const max = Math.max(0, Math.min(WIDGET_LIMITS.choices, k.flag("x0.needs.choicesMax", 3)));
    const answerable = options.length > 0 && options.length <= max && labels.every(Boolean) && inPlace(k, "question");
    return {
      id: itemId({ kind: "job", jobId: j.id, q: questionMark(j.question.text) }), kind: "question",
      bot: "code", botName, face: faceOf("code"),
      question: eventLine("needs", own?.question || j.question.text, { bot: botName }, w.fill),
      choices: answerable ? labels.map((label, i) => ({ id: `a${i}`, label, ...(i === 0 ? { primary: true } : {}) })) : [],
      decideLink, private: own?.private === true || secret.has("question"), answerable, link, at: j.updatedAt,
    };
  }
  if (j.waitingOn === "approval" && j.approval) {
    return {
      id: itemId({ kind: "job", jobId: j.id, q: questionMark(j.approval.summary) }), kind: "question",
      bot: "code", botName, face: faceOf("code"),
      question: eventLine("needs", j.approval.summary, { bot: botName }, w.fill),
      choices: [], decideLink, private: secret.has("question"), answerable: false, link, at: j.updatedAt,
    };
  }
  return null;
}

/** A connected app's call waiting for a yes, as a needs item. */
function taskNeedsItem(t: GlanceTask, w: X0Words, botName: string, bot: string, link: string): GlanceNeedsItem | null {
  const a = t.approval;
  if (t.state !== "waiting" || !a) return null;
  const k = w.k;
  const risks = k.list("widgets.needs.inPlaceRisks", ["read", "write", "send"]);
  const answerable = !!a.risk && risks.includes(a.risk) && inPlace(k, "approval");
  const yes = cutAtWord(w.word("x0.choice.yes", "Yes"), WIDGET_LIMITS.choice) || "Yes";
  const no = cutAtWord(w.word("x0.choice.no", "No"), WIDGET_LIMITS.choice) || "No";
  return {
    id: itemId({ kind: "task", taskId: t.id, approvalId: a.id }), kind: "approval",
    bot, botName, face: faceOf(bot),
    question: eventLine("needs", a.widget?.question || a.preview || t.title, { bot: botName }, w.fill),
    choices: answerable ? [{ id: "yes", label: yes, primary: true }, { id: "no", label: no }] : [],
    decideLink: linkOf(k, "approval", { taskId: t.id }),
    private: a.widget?.private === true || new Set(k.list("x0.needs.private", ["approval"])).has("approval"),
    answerable, link, at: t.updatedAt,
  };
}

/** A bot's own page. */
function botLink(k: WidgetKnobs, slug: string, builtin: boolean): string {
  if (slug === "tailzu") return linkOf(k, "needsEmpty");
  return builtin ? linkOf(k, "botBuiltin", { slug }) : linkOf(k, "bot", { slug });
}

/** A finished job's line: its own words, else the fill-in; a failed one's problem, its reason cut at a word, else the fill-in. */
function doneLine(j: JobLite, w: X0Words, botName: string): string {
  return j.state === "failed"
    ? eventLine("failed", j.reason, { bot: botName }, w.fill)
    : eventLine("done", j.result, { bot: botName, task: clauseOf(j.task) }, w.fill);
}

// ------------------------------------------------------------------ the whole answer

export function glanceV2Of(i: GlanceInput, payload: WidgetsPayload): GlanceV2 {
  const w = x0Words(payload, i.hg);
  const { k, word } = w;
  const on = k.flag("x0.enabled", true);
  const bots = on ? i.bots : [];
  const jobs = on ? i.jobs : [];
  const tasks = on ? i.tasks : [];
  const live = liveFrom({
    bots, jobs, now: i.now, tzOffsetMinutes: i.tz, minutesSaved: i.minutesSaved, budgetPaise: 0,
    tasks: tasks.map((t) => ({ id: t.id, state: t.state, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.approval ? { approval: { id: t.approval.id, connector: t.approval.connector, preview: t.approval.preview } } : {}) })),
  });
  const nameOf = namer(bots, w);
  const builtinOf = (slug: string) => live.bots.find((b) => b.slug === slug)?.builtin ?? true;
  const linkFor = (slug: string) => botLink(k, slug, builtinOf(slug));

  // What needs the person: every one, oldest first (the widget shows the first few).
  const allNeeds: GlanceNeedsItem[] = [
    ...jobs.map((j) => jobNeedsItem(j, w, nameOf("code"), linkFor("code"))),
    ...tasks.map((t) => {
      const bot = t.approval ? (CONNECTOR_BOT[t.approval.connector] ?? "tailzu") : "tailzu";
      return taskNeedsItem(t, w, nameOf(bot), bot, linkFor(bot));
    }),
  ].filter((x): x is GlanceNeedsItem => !!x).sort((a, b) => a.at - b.at);
  const items = allNeeds.slice(0, Math.max(0, k.flag("x0.needs.max", 3)));

  // The newest finished job the person has not seen, within the window.
  const window = Math.max(0, k.flag("x0.done.windowMin", 120)) * MIN;
  const finished = jobs.filter((j) => !j.helper && (j.state === "done" || j.state === "failed") && i.now - j.updatedAt <= window && unseen(i.state, j.id, j.updatedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const last = finished[0];
  const codeName = nameOf("code");
  const lastDone: GlanceDone | undefined = last ? {
    id: last.id, bot: "code", botName: codeName, face: faceOf("code"), result: doneLine(last, w, codeName), endedAt: last.updatedAt,
    minutes: Math.max(1, Math.round((last.updatedAt - (last.startedAt ?? last.createdAt)) / MIN)),
    ...(last.pr ? { pr: last.pr } : {}), link: linkOf(k, "question", { jobId: last.id }), ...(last.state === "failed" ? { failed: true as const } : {}),
  } : undefined;

  // The Code bot job a person follows now: one at work, else one waiting for them.
  const open = jobs.filter((j) => !j.helper && (ACTIVE.has(j.state) || j.state === "waiting_for_you")).sort((a, b) => b.updatedAt - a.updatedAt);
  const now = open.find((j) => ACTIVE.has(j.state)) ?? open[0];
  const stage = now ? stageOf(now.phase) : null;
  const job: GlanceJob | null = now && stage ? {
    id: now.id, bot: "code", task: taskLine(now.task) || eventLine("working", undefined, { bot: codeName }, w.fill), stage: stage.at + 1, of: stage.of, stageName: stage.name,
    stages: [...STAGES], startedAt: now.startedAt ?? now.createdAt, link: linkOf(k, "question", { jobId: now.id }),
    phase: now.state === "waiting_for_you" ? "needs" : "working",
  } : null;

  // The bots, in Home's order: what needs them, then working, then a finish not seen yet, then the rest.
  const finishedBy = new Map<string, JobLite>(last ? [["code", last]] : []);
  const rows = live.bots.map((b, order): GlanceBot & { rank: number; order: number } => {
    const fin = finishedBy.get(b.slug);
    const state: GlanceBotState = b.state === "needs" ? "needs" : b.state === "working" ? "working" : fin ? (fin.state === "failed" ? "failed" : "done") : "idle";
    const first = allNeeds.find((n) => n.bot === b.slug);
    const line = b.working ? (b.doing || eventLine("working", undefined, { bot: b.name }, w.fill))
      : state === "needs" ? (first && !first.private ? first.question : eventLine("needs", undefined, { bot: b.name }, w.fill))
        : fin ? doneLine(fin, w, b.name)
          : eventLine("idle", undefined, { bot: b.name }, w.fill);
    const face = faceOf(b.slug);
    return {
      slug: b.slug, name: b.name, color: b.color, face, faceUrl: face ? headUrl(face) ?? null : null, state, needs: b.needs, working: b.working,
      line, link: linkFor(b.slug), rank: state === "needs" ? 0 : state === "working" ? 1 : state === "done" || state === "failed" ? 2 : 3, order,
    };
  }).sort((a, b) => a.rank - b.rank || a.order - b.order);
  const botsMax = Math.max(0, k.flag("x0.bots.max", 8));
  const shown: GlanceBot[] = rows.slice(0, botsMax).map((r) => ({
    slug: r.slug, name: r.name, color: r.color, face: r.face, faceUrl: r.faceUrl, state: r.state, needs: r.needs, working: r.working, line: r.line, link: r.link,
  }));

  const counts = { working: live.working.length, needs: live.needs.length };
  const kase: GlanceCase = counts.needs > 0 ? "needs" : lastDone ? "done" : counts.working > 0 || job ? "working" : "quiet";

  // The greeting, as Home writes it, and the line under it.
  const part = dayPart(i.tz, i.now);
  const day = dayLineAfterGreeting(part);
  const greeting = { hello: i.name ? `${live.greeting}, ${i.name}` : live.greeting, line: i.hg ? day.hg : day.en, part };

  // The week, as Home's week row counts it.
  const saved = Math.max(0, Math.round(i.minutesSaved));
  const doneN = live.week.done;
  const doneWords = doneN > 1 ? word("x0.week.many", "{n} things done this week", { n: doneN }) : doneN === 1 ? word("x0.week.one", "1 thing done this week") : "";
  const savedWords = saved >= 60 ? word("x0.week.savedH", "{n} h saved", { n: Math.round(saved / 60) }) : saved > 0 ? word("x0.week.savedMin", "{n} min saved", { n: saved }) : "";
  const week = {
    done: doneN, minutesSaved: saved, dots: Math.min(5, doneN),
    line: [doneWords, savedWords].filter(Boolean).join(" · ") || word("x0.week.none", "A fresh week"),
  };

  // The summary: the AI digest when there is one, else the situation line.
  const changes = changesOf(i, allNeeds, w, nameOf);
  const summary = (i.digest && oneLineOf(i.digest)) || situationSummary(i, w, { lastDone, job, counts, changes: changes.length, part, codeName });

  // The Lock Screen's lines: never a private question's words.
  const firstItem = items[0];
  const lock = kase === "needs" && firstItem ? {
    title: counts.needs > 1 ? word("x0.lock.needsMany", "{n} things need you", { n: counts.needs }) : eventLine("needs", undefined, { bot: firstItem.botName }, w.fill),
    line: firstItem.private ? word("x0.lock.answer", "Open X0 to answer") : cutAtWord(firstItem.question, WIDGET_LIMITS.result),
  } : kase === "done" && lastDone ? {
    title: lastDone.result,
    line: lastDone.pr ? word("x0.lock.pr", "PR #{n} is ready", { n: lastDone.pr.number }) : lastDone.botName,
  } : kase === "working" ? {
    title: counts.working > 1 ? word("x0.lock.workingMany", "{n} bots working", { n: counts.working })
      : eventLine("working", undefined, { bot: shown.find((b) => b.working)?.name ?? codeName }, w.fill),
    line: job ? `${word("x0.word.step", "Step {stage} of {of}", { stage: job.stage, of: job.of })} · ${job.stageName}` : (shown.find((b) => b.working)?.line ?? ""),
  } : { title: word("x0.word.brand", "X0"), line: summary || greeting.line };
  const lockOut = { inline: kase === "quiet" ? word("x0.word.ready", "Ready") : lock.title, title: lock.title, line: lock.line };

  const links = k.obj<Record<string, unknown>>("x0.links", {});
  const link = (key: "ask" | "home" | "mic", fallback: string) => (typeof links[key] === "string" ? (links[key] as string) : fallback);

  const working = counts.working > 0 || job?.phase === "working";
  return {
    v: 2, at: i.now,
    refreshAfterSec: Math.max(60, Math.round(working ? k.flag("x0.refreshSec.working", 300) : k.flag("x0.refreshSec", 900))),
    case: kase, greeting, ...(summary ? { summary } : {}), week,
    bots: shown, more: Math.max(0, rows.length - shown.length),
    needs: { count: counts.needs, items },
    job, ...(lastDone ? { lastDone } : {}), counts, lock: lockOut,
    links: { ask: link("ask", "tulmi://screen/bots.ask"), home: link("home", "tulmi://"), mic: link("mic", "tulmi://screen/bots.ask?voice=1") },
    words: {
      needsYou: word("x0.word.needsYou", "Needs you"), ready: word("x0.word.ready", "Ready"), ask: word("x0.word.ask", "Ask any bot…"),
      brand: word("x0.word.brand", "X0"), youDecide: word("x0.word.youDecide", "You decide"),
      // working, step, minIn, min and pr keep their slots: the widget fills them.
      working: word("x0.word.working", "{n} working"), step: word("x0.word.step", "Step {stage} of {of}"),
      minIn: word("x0.word.minIn", "{n} min in"), seePr: word("x0.word.seePr", "See the PR"), done: word("x0.word.done", "Done"),
      answered: word("x0.word.answered", "Answered"), finish: word("x0.word.finish", "Open X0 to finish"), doneSeePr: word("x0.word.doneSeePr", "Done · See the PR"),
      min: word("x0.word.min", "{n} min"), pr: word("x0.word.pr", "PR #{n}"), sending: word("x0.word.sending", "Sending…"),
      gone: word("x0.word.gone", "Already answered"), failed: word("x0.word.failed", "Open X0 to finish"),
    },
  };
}

/** What changed since the person's last look ended: what needs them, what finished, what started. Empty on a first look ever. */
export function changesOf(i: GlanceInput, needs: readonly GlanceNeedsItem[], w: X0Words, nameOf: (slug: string) => string): GlanceChange[] {
  const since = i.state.sinceAt;
  if (since === null) return [];
  const out: GlanceChange[] = [];
  for (const n of needs) if (n.at > since) out.push({ id: n.id, kind: "needs", bot: n.bot, botName: n.botName, words: n.private ? null : n.question });
  const code = nameOf("code");
  for (const j of i.jobs) {
    if (j.helper) continue;
    if ((j.state === "done" || j.state === "failed") && j.updatedAt > since) out.push({ id: `job:${j.id}`, kind: j.state, bot: "code", botName: code, words: doneLine(j, w, code) });
    // One that started and already waits for the person is counted once, as what it is now.
    else if (j.createdAt > since && ACTIVE.has(j.state)) out.push({ id: `start:${j.id}`, kind: "started", bot: "code", botName: code, words: taskLine(j.task) });
  }
  for (const t of i.tasks) {
    const bot = t.approval ? (CONNECTOR_BOT[t.approval.connector] ?? "tailzu") : "tailzu";
    // A connected app's words are the person's own business: the change is counted, never said.
    if ((t.state === "done" || t.state === "failed") && t.updatedAt > since) out.push({ id: `task:${t.id}`, kind: t.state, bot, botName: nameOf(bot), words: null });
    else if (t.state === "running" && t.createdAt > since) out.push({ id: `start:${t.id}`, kind: "started", bot, botName: nameOf(bot), words: null });
  }
  return out;
}

/** The changes, for the AI digest: what they are worth asking a model about. */
export function glanceChanges(i: GlanceInput, payload: WidgetsPayload): GlanceChange[] {
  const w = x0Words(payload, i.hg);
  const nameOf = namer(i.bots, w);
  const needs = [
    ...i.jobs.map((j) => jobNeedsItem(j, w, nameOf("code"), "")),
    ...i.tasks.map((t) => { const bot = t.approval ? (CONNECTOR_BOT[t.approval.connector] ?? "tailzu") : "tailzu"; return taskNeedsItem(t, w, nameOf(bot), bot, ""); }),
  ].filter((x): x is GlanceNeedsItem => !!x);
  return changesOf(i, needs, w, nameOf);
}

function situationSummary(i: GlanceInput, w: X0Words, o: {
  lastDone: GlanceDone | undefined; job: GlanceJob | null; counts: { working: number }; changes: number; part: SituationFacts["part"]; codeName: string;
}): string {
  const { k } = w;
  const local = new Date(i.now + i.tz * MIN);
  const newest = Math.max(0, ...i.jobs.map((j) => j.updatedAt), ...i.tasks.map((t) => t.updatedAt));
  const lastJob = o.lastDone ? i.jobs.find((j) => j.id === o.lastDone!.id) : undefined;
  const facts: SituationFacts = {
    part: o.part, weekend: local.getUTCDay() === 0 || local.getUTCDay() === 6,
    firstLook: i.state.sinceAt === null || i.state.sinceAt < dayStartOf(i.now, i.tz),
    moved: o.changes,
    // What it finished: its own words when it gave them ("Cart fix is ready"), else what it was asked.
    ...(o.lastDone && !o.lastDone.failed && lastJob ? { justFinished: { bot: o.lastDone.botName, task: lastJob.result || clauseOf(lastJob.task) } } : {}),
    working: o.counts.working,
    ...(o.job && o.job.phase === "working" ? { longJob: { bot: o.codeName, task: clauseOf(o.job.task), minutes: Math.floor((i.now - o.job.startedAt) / MIN) } } : {}),
    quietDays: newest > 0 ? Math.floor((i.now - newest) / DAY) : Number.POSITIVE_INFINITY,
    name: i.name,
  };
  const chosen = situationOf(facts, {
    movedMin: k.flag("x0.situation.movedMin", 2), longJobMin: k.flag("x0.situation.longJobMin", 30), quietDays: k.flag("x0.situation.quietDays", 3),
  });
  if (!chosen) return "";
  const labels = (key: string) => { const v = k.label(key, "\u0000"); return v === "\u0000" ? undefined : v; };
  return situationLine(templateFor(labels, chosen.situation, o.part, w.hg), chosen.vars);
}
