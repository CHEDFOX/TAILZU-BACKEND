/**
 * THE SHELL'S READS, FOR ONE SIGNED-IN PERSON: each part's own records, read the way that part keeps them, for the feed, search,
 * Today, Tasks, the routing preview and the glance (routes/botsShell.ts). Every read may fail or its part may be off: it is then
 * empty, and the screen draws what is true.
 */
import type { AuthedUser } from "../auth/supabase.js";
import { botStore } from "../bots/store.js";
import { scoreBots } from "../bots/door.js";
import { stateOf } from "../code/agent/types.js";
import { threadStore } from "../code/chat/threads.js";
import type { CodeJob } from "../code/jobs/types.js";
import { readByRules } from "../front/rules.js";
import { defaultGuard } from "../guard/index.js";
import { listHistory } from "../history/store.js";
import { attachmentKindOf } from "../media/index.js";
import { listNotes } from "../notes/store.js";
import { botLook } from "../experience/bots/palette.js";
import type { BotsAreaDeps } from "../routes/botsArea.js";
import { calendarOf, googleTasksOf, type CalEvent, type GoogleTodo } from "./parse.js";
import { dayKeyOf, type FeedJob, type FeedTask, type FeedWords } from "./feed.js";
import { fileLine, turnOf, type Findable, type SearchSources } from "./search.js";

const safe = <T>(p: Promise<T> | undefined, empty: T): Promise<T> => (p ?? Promise.resolve(empty)).catch(() => empty);

/** A job as the feed reads it: its agent's phase read out of its checkpoint. */
export function feedJob(j: CodeJob): FeedJob {
  const phase = stateOf(j.checkpoint)?.phase;
  return {
    id: j.id, task: j.task, state: j.state, spentPaise: j.spentPaise, createdAt: j.createdAt, updatedAt: j.updatedAt, projectId: j.projectId,
    ...(phase ? { phase } : {}),
  };
}

export async function readJobs(d: BotsAreaDeps, userId: string, limit = 50): Promise<CodeJob[]> {
  return d.jobs ? safe(d.jobs.listJobs(userId, limit), []) : [];
}

export async function readTasks(d: BotsAreaDeps, userId: string, limit = 30): Promise<FeedTask[]> {
  if (!d.connectors) return [];
  return (await safe(d.connectors.tasks.list(userId, limit), [])).map((t) => ({
    id: t.id, state: t.state, title: t.title, steps: t.steps, createdAt: t.createdAt, updatedAt: t.updatedAt,
    approval: t.approval ? { id: t.approval.id, connector: t.approval.connector, preview: t.approval.preview } : null,
  }));
}

/** project id -> "Salon booking app": the repo's name, its dashes as spaces, first letter up. */
export async function readProjects(d: BotsAreaDeps, userId: string): Promise<Array<{ id: string; name: string; fullName: string; createdAt: number }>> {
  if (!d.code) return [];
  return (await safe(d.code.store.listProjects(userId), [])).map((p) => ({ id: p.id, name: projectName(p.fullName), fullName: p.fullName, createdAt: p.createdAt }));
}

export function projectName(fullName: string): string {
  const repo = (fullName.split("/").pop() ?? fullName).replace(/[-_.]+/g, " ").trim();
  return repo ? repo.charAt(0).toUpperCase() + repo.slice(1) : fullName;
}

/** Keybot's spoken words since `since`, newest first: a few pages of history at most. */
export async function readVoiceRows(user: AuthedUser, since: number): Promise<Array<{ at: number; words: number; app?: string }>> {
  const out: Array<{ at: number; words: number; app?: string }> = [];
  let before: string | undefined;
  let beforeId: string | undefined;
  for (let page = 0; page < 5; page++) {
    const r = await safe(listHistory(user, { limit: 200, kind: "voice", ...(before ? { before } : {}), ...(beforeId ? { beforeId } : {}) }), { entries: [] });
    let older = false;
    for (const e of r.entries) {
      const at = Date.parse(e.createdAt);
      if (!(at >= since)) { older = true; continue; }
      out.push({ at, words: e.wordsOut ?? 0, ...(e.targetApp ? { app: String(e.targetApp) } : {}) });
    }
    if (older || !r.nextBefore) break;
    before = r.nextBefore;
    beforeId = r.nextBeforeId;
  }
  return out;
}

/** The words by day, for the feed. */
export function wordsByDay(rows: ReadonlyArray<{ at: number; words: number; app?: string }>, tzOffsetMinutes: number, appName: (a?: string) => string): FeedWords[] {
  const days = new Map<string, FeedWords & { counts: Map<string, number> }>();
  for (const r of rows) {
    const day = dayKeyOf(r.at, tzOffsetMinutes);
    const d = days.get(day) ?? { day, at: r.at, words: 0, apps: [], counts: new Map<string, number>() };
    d.words += Math.max(0, r.words);
    d.at = Math.max(d.at, r.at);
    const app = appName(r.app);
    if (app) d.counts.set(app, (d.counts.get(app) ?? 0) + r.words);
    days.set(day, d);
  }
  return [...days.values()].map(({ counts, ...d }) => ({ ...d, apps: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a) }));
}

/** Whether the person has this app connected (signed in). */
export async function hasApp(d: BotsAreaDeps, userId: string, connectorId: string): Promise<boolean> {
  if (!d.connectors) return false;
  const conns = await safe(d.connectors.store.listConnections(userId), []);
  return conns.some((c) => c.connectorId === connectorId && !!c.tokensEnc);
}

/** A read of a connected Google app, answered in its own words, or null when it is not connected or did not answer in time. */
async function readApp(d: BotsAreaDeps, userId: string, app: string, tool: string, args: Record<string, unknown>, waitMs: number): Promise<string | null> {
  if (!d.connectors || !(await hasApp(d, userId, app))) return null;
  const call = d.connectors.hub.call(userId, app, tool, args).then((r) => (r.ok ? r.text : null), () => null);
  const late = new Promise<null>((res) => { const t = setTimeout(() => res(null), waitMs); t.unref?.(); });
  return Promise.race([call, late]);
}

/** Today's calendar: { connected, events } (events null when it could not be read). */
export async function readCalendar(d: BotsAreaDeps, userId: string, waitMs = 5000): Promise<{ connected: boolean; events: CalEvent[] | null }> {
  const connected = await hasApp(d, userId, "google-calendar");
  if (!connected) return { connected, events: null };
  const text = await readApp(d, userId, "google-calendar", "list_events", { max: 25 }, waitMs);
  return { connected, events: text === null ? null : calendarOf(text) };
}

/** Open Google Tasks for the coming week (and overdue): { connected, todos }. */
export async function readGoogleTasks(d: BotsAreaDeps, userId: string, waitMs = 5000): Promise<{ connected: boolean; todos: GoogleTodo[] | null }> {
  const connected = await hasApp(d, userId, "google-tasks");
  if (!connected) return { connected, todos: null };
  const text = await readApp(d, userId, "google-tasks", "list_tasks", {}, waitMs);
  return { connected, todos: text === null ? null : googleTasksOf(text) };
}

// ------------------------------------------------------------------ search

/** Everything search looks through, read at once. */
export async function readSearchSources(d: BotsAreaDeps, user: AuthedUser, tzOffsetMinutes: number): Promise<SearchSources> {
  const [projects, bots, notes, files] = await Promise.all([
    readProjects(d, user.id),
    d.bots ? safe(d.bots.list(user.id), []) : Promise.resolve([]),
    safe(listNotes(user, 100), []),
    d.media ? safe(d.media.store.list(user.id, 50), []) : Promise.resolve([]),
  ]);

  // The talk about each project's code (the newest few projects), and what each bot and the person last said.
  const codeChats = (await Promise.all(projects.slice(0, 6).map(async (p) =>
    (await safe(threadStore().list(user.id, p.id, 10), [])).map((t): Findable => ({
      id: `code:${t.id}`, title: t.lastQuestion || t.summary.split("\n")[0] || p.name, sub: `Code bot · ${p.name} · ${shortDay(t.updatedAt, tzOffsetMinutes)}`,
      text: t.summary, at: t.updatedAt, bot: "code",
      open: { screenId: "bots.chat", params: { slug: "code", project: p.id, thread: t.id } },
      preview: { lines: t.lastQuestion ? [{ who: "you", text: t.lastQuestion }] : [], body: t.summary, at: shortDay(t.updatedAt, tzOffsetMinutes) },
    }))))).flat();
  const botChats = (await Promise.all(bots.map(async (b) => {
    const t = await safe(botStore().getThread(user.id, b.id), null);
    if (!t || !t.buffer.length) return [];
    const lines = t.buffer.flatMap(turnOf);
    const said = lines.filter((l) => l.who === "you").map((l) => l.text);
    return [{
      id: `bot:${b.slug}`, title: said[said.length - 1] ?? lines[0]?.text ?? b.name, sub: `${b.name} · ${shortDay(t.updatedAt, tzOffsetMinutes)}`,
      text: `${lines.map((l) => l.text).join(" ")} ${t.summary}`, at: t.updatedAt, bot: b.slug,
      open: { screenId: "bots.chat", params: { slug: b.slug } },
      preview: { lines: lines.slice(-6), at: shortDay(t.updatedAt, tzOffsetMinutes) },
    } satisfies Findable];
  }))).flat();

  return {
    projects: projects.map((p) => ({
      id: `project:${p.id}`, title: p.name, sub: p.fullName, text: p.fullName, at: p.createdAt, bot: "code",
      open: { screenId: "bots.code", params: { project: p.id } }, preview: { body: `A Code bot project on GitHub: ${p.fullName}.` },
    })),
    chats: [...codeChats, ...botChats],
    notes: notes.map((n) => ({
      id: `note:${n.id}`, title: n.title || "Untitled note", sub: `Your note · ${n.summary ? n.summary.split(/[.\n]/)[0]!.slice(0, 60) : shortDay(Date.parse(n.startedAt), tzOffsetMinutes)}`,
      text: `${n.summary} ${n.people.map((p) => p.name ?? "").join(" ")}`, at: Date.parse(n.startedAt),
      open: { screenId: "bots.note", params: { id: n.id } }, preview: { body: n.summary, at: shortDay(Date.parse(n.startedAt), tzOffsetMinutes) },
    })),
    files: files.map((f) => ({
      id: `file:${f.id}`, title: f.name, sub: fileLine({ bytes: f.bytes, ...(f.meta.pages ? { pages: f.meta.pages } : {}), createdAt: f.createdAt }, tzOffsetMinutes),
      text: f.format, at: f.createdAt,
      open: { screenId: "bots.ask", params: { file: f.id, fileName: f.name } },
      preview: { body: f.meta.notes?.join(" ") ?? "" },
      attachment: { id: f.id, kind: attachmentKindOf(f.kind), mime: f.mime, bytes: f.bytes, sha256: f.sha256, name: f.name },
    })),
    bots: bots.map((b) => ({
      id: `botpage:${b.slug}`, title: b.name, sub: b.purpose, text: b.purpose, bot: b.slug,
      open: b.builtin ? { screenId: `bots.${b.slug === "keybot" ? "keybot" : b.slug}` } : { screenId: "bots.bot", params: { slug: b.slug } },
      preview: { body: b.purpose },
    })),
  };
}

function shortDay(at: number, tz: number): string {
  const d = new Date(at + tz * 60_000);
  const now = new Date(Date.now() + tz * 60_000);
  if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) {
    const h = d.getUTCHours();
    return `today, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]!;
}

// ------------------------------------------------------------------ who will answer

export interface RoutePreview {
  /** The bot's slug, or "tailzu" when no bot fits and the front door answers. */
  slug: string;
  name: string;
  /** Its colour (hex). */
  color: string;
  /** "Travel bot will take this". */
  say: string;
  /** "Tap to send · Travel bot shows the plan before it books". */
  hint: string;
  by: "name" | "rules" | "model" | "chosen" | "none";
  confidence: number;
}

/** What each built-in says it will do first, before it acts (STYLE.md: say what a bot will and won't do). */
export function firstWords(slug: string, name: string): string {
  switch (slug) {
    case "travel": return "Travel bot shows the plan before it books";
    case "plan": return "Plan bot asks before it changes your calendar";
    case "code": return "Code bot shows the plan before it changes code";
    case "keybot": return "Keybot writes it, you send it";
    case "tailzu": return "Tailzu answers, or hands it to the right bot";
    default: return `${name} asks before it does anything`;
  }
}

export function previewOf(slug: string, name: string, by: RoutePreview["by"], confidence: number): RoutePreview {
  return {
    slug, name, color: botLook(slug).color, say: `${name} will take this`, hint: `Tap to send · ${firstWords(slug, name)}`,
    by, confidence,
  };
}

/**
 * Who will answer a message, without answering it: "Ask any bot"'s own pick (bots/door.ts, the front door's decide step for
 * bots: the rules for nothing, the tiny tier once when they are not sure), counted against the person's front-door day like the
 * ask itself. With the day spent, or the bots platform off, the rules alone. `chosen`: the person picked; nothing is asked.
 */
export async function routeOf(d: BotsAreaDeps, userId: string, message: string, chosen?: string, signal?: AbortSignal): Promise<RoutePreview> {
  const ctx = { attachments: [], recent: [], mode: "text" as const };
  if (!d.bots) {
    const rules = readByRules(message, ctx);
    return rules.intent === "code_task" || rules.intent === "code_question"
      ? previewOf("code", "Code bot", "rules", rules.confidence) : previewOf("tailzu", "Tailzu", "none", rules.confidence);
  }
  if (chosen && chosen !== "any" && chosen !== "tailzu") {
    const b = await d.bots.get(userId, chosen).catch(() => null);
    if (b) return previewOf(b.slug, b.name, "chosen", 1);
  }
  if (chosen === "tailzu") return previewOf("tailzu", "Tailzu", "chosen", 1);
  const daily = defaultGuard().daily;
  if (daily.leftPaise(userId) > 0) {
    const t = await d.bots.target(userId, "any", message, ctx, signal);
    daily.add(userId, t.paise);
    return t.bot ? previewOf(t.bot.slug, t.bot.name, t.by, t.confidence) : previewOf("tailzu", "Tailzu", "none", t.confidence);
  }
  const [best] = scoreBots(message, await d.bots.defs(userId), ctx);
  return best && best.points >= 2 ? previewOf(best.bot.slug, best.bot.name, "rules", 0.6) : previewOf("tailzu", "Tailzu", "none", 0);
}
