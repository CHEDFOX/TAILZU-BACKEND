/**
 * GET /v1/widgets/now, BUILT: both widgets' rows, already worded, each with where its tap goes and (Needs you) its buttons, and
 * everything the widgets draw them with. Pure: what the person's records say arrives in `NowInput` (routes/widgets.ts reads them),
 * every decision is a knob of the "widgets" surface (defaults.ts), and the answer is plain JSON the app writes to the App Group /
 * SharedPreferences as it is.
 *
 * PRIVATE BY DESIGN. A row carries what the person's own app would show them, no more: no amounts, no ids but the row's own (an
 * opaque item id and a link), a message's words only when the server says so and marked `private` (the widgets redact a private
 * row while the phone is locked, and the Lock Screen shows only the count line).
 */
import { createHash } from "node:crypto";
import type { JobLite } from "../experience/bots/live.js";
import { WIDGETS_VERSION, type WidgetsPayload } from "./defaults.js";
import { itemId, questionMark } from "./items.js";

// ------------------------------------------------------------------ what the route reads

/** The newest message in a chat that was not the person's own. */
export interface PeopleMessage { threadId: string; messageId: string; chat: string; chatKind: "direct" | "group" | "space"; from: string; text: string; at: number; unread: boolean }
/** Something shared in one of the person's spaces by someone else. */
export interface PeopleShared { itemId: string; spaceId: string | null; spaceName: string; by: string; title: string; at: number }
/** A task or plan someone in a space gave the person, still theirs to do. */
export interface PeopleTask { taskId: string; spaceId: string; spaceName: string; by: string; title: string; kind: "task" | "plan"; at: number; due: number | null }
/** A connected app's call waiting for the person's yes. `bot`: whose it is (the built-in whose skills name the app, else "tailzu"). */
export interface PendingApproval { taskId: string; approvalId: string; title: string; preview: string; risk: string; who: string; at: number; bot?: string }

export interface NowInput {
  now: number;
  tzOffsetMinutes: number;
  /** The person is in at least one space (the empty state says what to do either way). */
  inSpaces: boolean;
  people: { messages: PeopleMessage[]; shared: PeopleShared[]; tasks: PeopleTask[] };
  needs: { jobs: JobLite[]; approvals: PendingApproval[]; tasks: PeopleTask[]; codeBotName: string };
  /** The narrow token can be had (widgets.token.enabled, and a store to keep it in). */
  tokenReady: boolean;
}

// ------------------------------------------------------------------ what the widgets get

export interface NowAction {
  id: string;
  label: string;
  style: string;
  /** "inPlace": the widget posts it with its own token. "open": the button opens `url` in the app. */
  mode: "inPlace" | "open";
  url?: string;
  icon?: string;
  androidIcon?: string;
}

export interface NowRow {
  /** The item a button acts on (items.ts); opaque to the apps. */
  id: string;
  kind: string;
  /** Who it is from: "Riya", "Plan bot". */
  who: string;
  /** Their first letter, for a widget that draws a mark. */
  initial: string;
  /** What: "Weekend plan", "Move dinner to 7:30?". Empty for a message whose words are not shown. */
  text: string;
  /** The whole line, as one sentence: "Riya shared Weekend plan". */
  line: string;
  /** A short word after it ("task"), or nothing. */
  tag: string;
  /** Under the text: the space, what a yes would do. */
  detail: string;
  at: number;
  /** The time in words as of this answer (the "server" time style). */
  when: string;
  url: string;
  /** Words a Lock Screen must not show (iOS .privacySensitive(); Android hides them on the lock screen). */
  private: boolean;
  new: boolean;
  icon: string;
  androidIcon: string;
  color?: string;
  /**
   * Whose bot the row is, for a bot's row (a question, a yes): a built-in's key ("code", "keybot", "plan", "travel"; "tailzu" is
   * X0 itself) or a person's own bot's palette name. The widgets ring its avatar in that bot's own colour (bots/art.ts BOT_INK,
   * bots/palette.ts PALETTE_HEX; X0's is the ink). Absent on a person's row.
   */
  bot?: string;
  actions?: NowAction[];
}

export interface NowSection {
  on: boolean;
  title: string;
  url: string;
  icon: string;
  androidIcon: string;
  /** Rows each size draws. */
  limits: Record<string, number>;
  rows: NowRow[];
  count: number;
  newCount: number;
  lock: { line: string };
  empty: { title: string; body: string; cta: string; url: string };
  /** The words a button's moment needs (Needs you): done, sent, working, failed, gone, and answer (a row's one button to open it). */
  words?: Record<string, string>;
}

export interface NowDoc {
  v: number;
  /** A fingerprint of everything but `at`: the app skips a write that changes nothing. */
  rev: string;
  at: number;
  refreshSec: number;
  fetchSec: number;
  /** How a row's time is written (widgets.time): "minutes", "relative", "clock" or "server". */
  time: string;
  /** The words a widget writes a time in, whole minutes at the finest ("minutes"): now, min, hour, day; {n} the count. */
  timeWords: Record<string, string>;
  look: Record<string, unknown>;
  act: { path: string; inPlace: boolean };
  people: NowSection;
  needs: NowSection;
}

// ------------------------------------------------------------------ reading the knobs

export interface WidgetKnobs {
  flag<T extends number | boolean | string>(key: string, fallback: T): T;
  list(key: string, fallback: string[]): string[];
  obj<T extends Record<string, unknown>>(key: string, fallback: T): T;
  label(key: string, fallback: string, vars?: Record<string, string | number>): string;
}

export function widgetKnobs(p: WidgetsPayload): WidgetKnobs {
  return {
    flag(key, fallback) {
      const v = p.flags?.[key];
      if (typeof fallback === "number") return (typeof v === "number" && Number.isFinite(v) ? v : fallback) as typeof fallback;
      return (typeof v === typeof fallback ? v : fallback) as typeof fallback;
    },
    list(key, fallback) {
      const v = p.flags?.[key];
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;
    },
    obj(key, fallback) {
      const v = p.flags?.[key];
      return (v && typeof v === "object" && !Array.isArray(v) ? v : fallback) as typeof fallback;
    },
    label(key, fallback, vars) {
      const v = p.labels?.[key];
      const s = typeof v === "string" ? v : fallback;
      return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
    },
  };
}

// ------------------------------------------------------------------ small parts

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? "").toUpperCase();
const nonNeg = (n: number, fallback: number) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback);

/** "now", "4m", "3h", "2d": a time as of `now`, in the server's words. */
export function whenWords(at: number, now: number, k: WidgetKnobs): string {
  const ago = Math.max(0, now - at);
  if (ago < MIN) return k.label("widgets.time.now", "now");
  if (ago < HOUR) return k.label("widgets.time.min", "{n}m", { n: Math.floor(ago / MIN) });
  if (ago < DAY) return k.label("widgets.time.hour", "{n}h", { n: Math.floor(ago / HOUR) });
  return k.label("widgets.time.day", "{n}d", { n: Math.floor(ago / DAY) });
}

/** A kind's link: the base and its screen, each {field} filled (URL-encoded) from `vars`. Empty when a field is missing. */
export function linkOf(k: WidgetKnobs, key: string, vars: Record<string, string> = {}): string {
  const links = k.obj<Record<string, unknown>>("widgets.links", {});
  const tpl = typeof links[key] === "string" ? (links[key] as string) : "";
  if (!tpl) return "";
  let missing = false;
  const path = tpl.replace(/\{(\w+)\}/g, (_m, f: string) => {
    const v = vars[f];
    if (typeof v !== "string" || !v) { missing = true; return ""; }
    return encodeURIComponent(v);
  });
  return missing ? "" : `${k.flag("widgets.link.base", "tulmi://screen/")}${path}`;
}

/** A kind's symbol, drawable and colour, from the look. */
function kindLook(k: WidgetKnobs, kind: string): { icon: string; androidIcon: string; color?: string } {
  const kinds = (k.obj<Record<string, unknown>>("widgets.look", {}).kinds ?? {}) as Record<string, { icon?: unknown; androidIcon?: unknown; color?: unknown }>;
  const l = kinds[kind] ?? {};
  return {
    icon: typeof l.icon === "string" ? l.icon : "circle.fill",
    androidIcon: typeof l.androidIcon === "string" ? l.androidIcon : "tailzu_widget_mark",
    ...(typeof l.color === "string" && l.color ? { color: l.color } : {}),
  };
}

function sectionLook(k: WidgetKnobs, which: "people" | "needs"): { icon: string; androidIcon: string } {
  const l = (k.obj<Record<string, unknown>>("widgets.look", {})[which] ?? {}) as { icon?: unknown; androidIcon?: unknown };
  return { icon: typeof l.icon === "string" ? l.icon : "circle.fill", androidIcon: typeof l.androidIcon === "string" ? l.androidIcon : "tailzu_widget_mark" };
}

function limitsOf(k: WidgetKnobs, key: string, fallback: Record<string, number>): Record<string, number> {
  const raw = k.obj<Record<string, unknown>>(key, fallback);
  const out: Record<string, number> = {};
  for (const [size, n] of Object.entries({ ...fallback, ...raw })) out[size] = nonNeg(Number(n), fallback[size] ?? 0);
  return out;
}

/** Rows in the order the knobs say: by kind (in `kinds` order), then newest; or newest first. Kinds not listed are left out. */
function ordered(rows: NowRow[], kinds: string[], sort: string, max: number): NowRow[] {
  const rank = (r: NowRow) => kinds.indexOf(r.kind);
  return rows.filter((r) => rank(r) >= 0)
    .sort((a, b) => (sort === "kind" ? rank(a) - rank(b) : 0) || b.at - a.at)
    .slice(0, max);
}

function lockLine(k: WidgetKnobs, which: "people" | "needs", n: number): string {
  if (n <= 0) return k.label(`widgets.${which}.lockNone`, which === "people" ? "Nothing new from your people" : "Nothing needs you");
  if (n === 1) return k.label(`widgets.${which}.lockOne`, which === "people" ? "1 new from your people" : "1 thing needs you");
  return k.label(`widgets.${which}.lock`, which === "people" ? "{n} new from your people" : "{n} things need you", { n });
}

// ------------------------------------------------------------------ from your people

export function peopleRows(i: NowInput, k: WidgetKnobs): NowRow[] {
  const since = i.now - Math.max(1, k.flag("widgets.people.windowDays", 14)) * DAY;
  const fresh = i.now - Math.max(0, k.flag("widgets.people.newHours", 24)) * HOUR;
  const showWords = k.flag("widgets.people.messageText", true);
  const secret = new Set(k.list("widgets.people.private", ["message"]));
  const out: NowRow[] = [];
  const base = (kind: string, who: string, at: number) => ({
    kind, who: oneLine(who, 40) || "Someone", initial: initialOf(who), at, when: whenWords(at, i.now, k), ...kindLook(k, kind),
  });
  for (const m of i.people.messages) {
    if (m.at < since) continue;
    const words = oneLine(m.text, 140);
    const shown = showWords && !!words;
    out.push({
      ...base("message", m.from, m.at),
      id: itemId({ kind: "msg", threadId: m.threadId, messageId: m.messageId }),
      text: shown ? words : "",
      line: shown ? k.label("widgets.people.line.message", "{name}: {text}", { name: oneLine(m.from, 40), text: words })
        : k.label("widgets.people.line.messageHidden", "{name} sent a message", { name: oneLine(m.from, 40) }),
      tag: k.label("widgets.people.tag.message", ""),
      detail: m.chatKind === "direct" ? "" : oneLine(m.chat, 40),
      url: linkOf(k, "message", { threadId: m.threadId, messageId: m.messageId }),
      private: shown && secret.has("message"),
      new: m.unread || m.at >= fresh,
    });
  }
  for (const s of i.people.shared) {
    if (s.at < since) continue;
    const title = oneLine(s.title, 80);
    out.push({
      ...base("shared", s.by, s.at),
      id: itemId({ kind: "item", itemId: s.itemId }),
      text: title,
      line: k.label("widgets.people.line.shared", "{name} shared {title}", { name: oneLine(s.by, 40), title }),
      tag: k.label("widgets.people.tag.shared", ""),
      detail: oneLine(s.spaceName, 40),
      url: linkOf(k, "shared", { itemId: s.itemId, spaceId: s.spaceId ?? "" }),
      private: secret.has("shared"),
      new: s.at >= fresh,
    });
  }
  for (const t of i.people.tasks) {
    if (t.at < since) continue;
    const title = oneLine(t.title, 80);
    out.push({
      ...base(t.kind, t.by, t.at),
      id: itemId({ kind: "stask", spaceId: t.spaceId, taskId: t.taskId }),
      text: title,
      line: k.label(`widgets.people.line.${t.kind}`, "{name}: {title}", { name: oneLine(t.by, 40), title }),
      tag: k.label(`widgets.people.tag.${t.kind}`, t.kind),
      detail: oneLine(t.spaceName, 40),
      url: linkOf(k, t.kind, { spaceId: t.spaceId, taskId: t.taskId }),
      private: secret.has(t.kind),
      new: t.at >= fresh,
    });
  }
  return ordered(out, k.list("widgets.people.kinds", ["message", "task", "plan", "shared"]), k.flag("widgets.people.sort", "time"),
    nonNeg(k.flag("widgets.people.max", 8), 8));
}

// ------------------------------------------------------------------ needs you

interface ActionTemplate { id?: unknown; label?: unknown; style?: unknown; icon?: unknown; androidIcon?: unknown }

/** A kind's buttons, from widgets.needs.actions: labels filled, the mode the server set for the kind. */
function actionsFor(k: WidgetKnobs, kind: string, url: string, o: { options?: string[]; inPlace: boolean }): NowAction[] {
  const all = k.obj<Record<string, unknown>>("widgets.needs.actions", {});
  const list = Array.isArray(all[kind]) ? (all[kind] as ActionTemplate[]) : [];
  const out: NowAction[] = [];
  for (const t of list) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !/^[a-z0-9_]{1,24}$/.test(t.id)) continue;
    const opt = /^a(\d+)$/.exec(t.id);
    let label = typeof t.label === "string" && t.label ? t.label : "";
    if (opt) {
      const said = o.options?.[Number(opt[1])];
      if (!said) continue;
      label ||= oneLine(said, 24);
    }
    label ||= k.label(`widgets.action.${t.id}`, t.id);
    out.push({
      id: t.id, label, style: typeof t.style === "string" ? t.style : "secondary",
      mode: o.inPlace ? "inPlace" : "open", ...(o.inPlace ? {} : { url }),
      ...(typeof t.icon === "string" && t.icon ? { icon: t.icon } : {}),
      ...(typeof t.androidIcon === "string" && t.androidIcon ? { androidIcon: t.androidIcon } : {}),
    });
  }
  return out;
}

/** Whether the server lets this kind answer in place right now. */
function inPlaceFor(i: NowInput, k: WidgetKnobs, kind: string): boolean {
  if (!i.tokenReady || !k.flag("widgets.token.enabled", true)) return false;
  return k.obj<Record<string, unknown>>("widgets.needs.modes", {})[kind] !== "open";
}

/** One button that opens the row: for a row nothing may be answered on. */
const openOnly = (k: WidgetKnobs, url: string): NowAction[] =>
  url ? [{ id: "open", label: k.label("widgets.action.open", "Open"), style: "secondary", mode: "open", url }] : [];

export function needsRows(i: NowInput, k: WidgetKnobs): NowRow[] {
  const out: NowRow[] = [];
  const optionsMax = nonNeg(k.flag("widgets.needs.optionsMax", 2), 2);
  const risks = k.list("widgets.needs.inPlaceRisks", ["read", "write", "send"]);
  const secret = new Set(k.list("widgets.needs.private", ["question", "approval", "task", "plan"]));
  for (const j of i.needs.jobs) {
    if (j.state !== "waiting_for_you" || j.waitingOn !== "answer" || !j.question?.text) continue;
    const text = oneLine(j.question.text, 140);
    const url = linkOf(k, "question", { jobId: j.id });
    const options = (j.question.options ?? []).map((o) => o.trim()).filter(Boolean);
    const answerable = options.length > 0 && options.length <= optionsMax;
    out.push({
      id: itemId({ kind: "job", jobId: j.id, q: questionMark(j.question.text) }), kind: "question",
      who: i.needs.codeBotName, initial: initialOf(i.needs.codeBotName), text, line: `${i.needs.codeBotName}: ${text}`, tag: "",
      detail: oneLine(j.task, 60), at: j.updatedAt, when: whenWords(j.updatedAt, i.now, k), url, private: secret.has("question"), new: true,
      ...kindLook(k, "question"), bot: "code",
      actions: answerable ? actionsFor(k, "question", url, { options, inPlace: inPlaceFor(i, k, "question") }) : openOnly(k, url),
    });
  }
  for (const a of i.needs.approvals) {
    const url = linkOf(k, "approval", { taskId: a.taskId });
    const text = oneLine(a.title, 140);
    out.push({
      id: itemId({ kind: "task", taskId: a.taskId, approvalId: a.approvalId }), kind: "approval",
      who: oneLine(a.who, 40), initial: initialOf(a.who), text, line: `${oneLine(a.who, 40)}: ${text}`, tag: "",
      detail: oneLine(a.preview, 120), at: a.at, when: whenWords(a.at, i.now, k), url, private: secret.has("approval"), new: true,
      ...kindLook(k, "approval"), ...(a.bot ? { bot: a.bot } : {}),
      actions: risks.includes(a.risk) ? actionsFor(k, "approval", url, { inPlace: inPlaceFor(i, k, "approval") }) : openOnly(k, url),
    });
  }
  for (const t of i.needs.tasks) {
    const url = linkOf(k, t.kind, { spaceId: t.spaceId, taskId: t.taskId });
    const title = oneLine(t.title, 120);
    const by = oneLine(t.by, 40);
    out.push({
      id: itemId({ kind: "stask", spaceId: t.spaceId, taskId: t.taskId }), kind: t.kind,
      // Under it, where it is from (the space): who gave it is the row's name already.
      who: by, initial: initialOf(by), text: title, line: `${by}: ${title}`, tag: k.label(`widgets.people.tag.${t.kind}`, t.kind),
      detail: oneLine(t.spaceName, 40), at: t.at, when: whenWords(t.at, i.now, k), url,
      private: secret.has(t.kind), new: true, ...kindLook(k, t.kind),
      actions: actionsFor(k, t.kind, url, { inPlace: inPlaceFor(i, k, t.kind) }),
    });
  }
  return ordered(out, k.list("widgets.needs.kinds", ["question", "approval", "task", "plan"]), k.flag("widgets.needs.sort", "kind"),
    nonNeg(k.flag("widgets.needs.max", 6), 6));
}

// ------------------------------------------------------------------ the whole answer

function section(k: WidgetKnobs, which: "people" | "needs", rows: NowRow[], on: boolean, emptyUrl: string): NowSection {
  const isPeople = which === "people";
  const newCount = rows.filter((r) => r.new).length;
  return {
    on,
    title: k.label(`widgets.${which}.title`, isPeople ? "From your people" : "Needs you"),
    url: linkOf(k, which),
    ...sectionLook(k, which),
    limits: limitsOf(k, `widgets.${which}.limits`, isPeople
      ? { small: 2, medium: 3, large: 6, lock: 0, android: 4 } : { small: 1, medium: 2, large: 4, lock: 0, android: 3 }),
    rows: on ? rows : [],
    count: on ? rows.length : 0,
    newCount: on ? newCount : 0,
    lock: { line: lockLine(k, which, on ? (isPeople ? newCount : rows.length) : 0) },
    empty: {
      title: k.label(`widgets.${which}.empty.title`, isPeople ? "Your people, here" : "All clear"),
      body: k.label(`widgets.${which}.empty.body`, isPeople ? "Make a space for family and friends. What they share shows up here." : "Nothing needs you right now."),
      cta: k.label(`widgets.${which}.empty.cta`, isPeople ? "Make a space" : "Open X0"),
      url: emptyUrl,
    },
  };
}

/** The answer for one person, now. */
export function buildNow(i: NowInput, payload: WidgetsPayload): NowDoc {
  const k = widgetKnobs(payload);
  const all = k.flag("widgets.enabled", true);
  const peopleOn = all && k.flag("widgets.people.enabled", true);
  const needsOn = all && k.flag("widgets.needs.enabled", true);
  const people = section(k, "people", peopleOn ? peopleRows(i, k) : [], peopleOn, linkOf(k, i.inSpaces ? "people" : "peopleEmpty"));
  const needs = section(k, "needs", needsOn ? needsRows(i, k) : [], needsOn, linkOf(k, "needsEmpty"));
  needs.words = {
    done: k.label("widgets.needs.done", "Done"),
    sent: k.label("widgets.needs.sent", "Sent"),
    working: k.label("widgets.needs.working", "Sending…"),
    failed: k.label("widgets.needs.failed", "Open X0 to finish"),
    gone: k.label("widgets.needs.gone", "Already answered"),
    answer: k.label("widgets.needs.answer", "Answer"),
  };
  const body = {
    v: WIDGETS_VERSION,
    refreshSec: Math.max(60, nonNeg(k.flag("widgets.refreshSec", 900), 900)),
    fetchSec: Math.max(0, nonNeg(k.flag("widgets.fetchSec", 60), 60)),
    time: k.flag("widgets.time", "minutes"),
    timeWords: {
      now: k.label("widgets.time.now", "now"),
      min: k.label("widgets.time.min", "{n}m"),
      hour: k.label("widgets.time.hour", "{n}h"),
      day: k.label("widgets.time.day", "{n}d"),
    },
    look: k.obj<Record<string, unknown>>("widgets.look", {}),
    act: { path: k.flag("widgets.act.path", "/v1/widgets/act"), inPlace: i.tokenReady && k.flag("widgets.token.enabled", true) },
    people,
    needs,
  };
  const rev = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return { ...body, rev, at: i.now };
}
