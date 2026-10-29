/**
 * Bots app · shell area: what Home, Activity, Ask, Search, Tasks, Approve, Today and Meeting notes need beyond the existing routes,
 * and the glance the phone's widgets and live activity read (docs/bots-app.md).
 *
 *   GET  /v1/shell/activity?tz=&bot=&type=   one feed across Code bot jobs, answers bots gave, payments, Keybot's words and connected-app
 *                                            tasks (src/shell/feed.ts), newest first, money per row; and the week (done, spent, saved)
 *   GET  /v1/shell/search?q=&tz=             projects, chats, notes, files and bots that match (src/shell/search.ts)
 *   POST /v1/shell/route { message, bot? }   who will answer, WITHOUT answering: "Ask any bot"'s own pick (the rules, the tiny tier only
 *                                            when unsure, counted on the person's front-door day); `bot` the person chose: echoed back
 *   POST /v1/shell/ask { message, bot?, device?, mode?, attachments?, projectId?, clientId?, typedAt? }
 *                                            POST /v1/ask as the person (same guard, same money), and the answer written down for Activity.
 *                                            With a clientId (an ask from the apps' outbox, typed offline at typedAt) it is answered ONCE:
 *                                            a retry gets the first answer (idempotent-replayed), one still out is 409 ask_in_flight
 *   POST /v1/shell/receipts { upi, bot?, title? }   the person says they pressed pay in their UPI app: a receipt for Activity. Nothing is paid
 *   GET  /v1/shell/receipts/:id              one receipt
 *   GET  /v1/shell/tasks?tz=                 today's work by bots and what needs the person, and their own open to-dos for the week (src/calendar)
 *   GET  /v1/shell/today?tz=                 today's calendar (their own, src/calendar), Keybot's words by hour and app, the day's work
 *   GET  /v1/shell/started                   whether the person has done anything yet (Home shows the empty home until they have)
 *   GET  /v1/shell/glance?tz=                for the natives (iOS widgets, the live activity): bots and their live state, what needs the
 *                                            person, Keybot's words today, the current Code bot job's stage. Small, no words to translate
 *
 * Every route is the signed-in person's own (401 without a session). A part that is off reads as empty.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { jobLite } from "../experience/bots/deps.js";
import { liveFrom, weekAndMonthStart, type BotLite } from "../experience/bots/live.js";
import { listHistory, statsForUser } from "../history/store.js";
import { eventStore, type EventStore } from "../shell/events.js";
import {
  appName, dayStartOf, feedOf, filterFeed, stageOf, weekOf, wordsDay, type FeedRow,
} from "../shell/feed.js";
import { upiOf } from "../shell/parse.js";
import {
  feedJob, previewOf, readJobs, readProjects, readSearchSources, readTasks, readVoiceRows, routeOf, wordsByDay,
} from "../shell/read.js";
import { searchAll } from "../shell/search.js";
import { CLIENT_ID, sentAskStore, type Claim, type SentAskStore } from "../shell/sentAsks.js";
import type { BotsAreaDeps } from "./botsArea.js";
import { calendar, todayForShell, upcomingForShell } from "../calendar/index.js";

/** Words a minute a person types: the product's standing figure (experience/desk.ts, history/store.ts). */
const TYPING_WPM = 40;
const MESSAGE_MAX = 2000;
const SLUG = /^(?:any|tailzu|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface ShellRoutesOptions {
  events?: EventStore;
  now?: () => number;
  /** Minutes writing by voice saved this week (history stats); tests hand in their own. */
  minutesSaved?: (user: AuthedUser, tz: number) => Promise<number>;
  /** Keybot's spoken words since a time (history); tests hand in their own. */
  voiceRows?: (user: AuthedUser, since: number) => Promise<Array<{ at: number; words: number; app?: string }>>;
  /** The client ids of asks sent from the apps' outbox (src/shell/sentAsks.ts); tests hand in their own. */
  sentAsks?: SentAskStore;
}

/** When an outbox ask was typed (ms), if it is a time that can be true: the last 30 days, and not later than now. */
const typedAtOf = (v: unknown, t: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v <= t + 5 * 60_000 && v >= t - 30 * 86_400_000 ? Math.round(v) : undefined;

const tzOf = (q: unknown): number => {
  const n = Number((q as { tz?: unknown } | null)?.tz);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0;
};

export function registerBotsShellRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: ShellRoutesOptions = {}): void {
  const RL = { config: deps.rateLimit };
  const now = o.now ?? Date.now;
  const events = (): EventStore => o.events ?? eventStore();
  const sent = (): SentAskStore => o.sentAsks ?? sentAskStore();
  const saved = o.minutesSaved ?? ((u: AuthedUser, tz: number) => statsForUser(u, "week", tz).then((s) => s.minutesSaved));
  const voice = o.voiceRows ?? readVoiceRows;
  const wroteAny = (u: AuthedUser): Promise<boolean> =>
    o.voiceRows ? voice(u, 0).then((v) => v.length > 0) : listHistory(u, { limit: 1 }).then((r) => r.entries.length > 0);
  const started = new Set<string>();

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return user;
  };
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    req.log.error(err);
    return reply.code(500).send({ code: "shell_failed", message: "Couldn't read that. Try again." });
  };

  /** The feed for one person: the last `days` days. */
  const feedFor = async (user: AuthedUser, tz: number, days = 7): Promise<{ rows: FeedRow[]; voiceRows: Array<{ at: number; words: number; app?: string }> }> => {
    const t = now();
    const since = dayStartOf(t, tz) - (days - 1) * 86_400_000;
    const [jobs, tasks, evs, projects, voiceRows] = await Promise.all([
      readJobs(deps, user.id), readTasks(deps, user.id), events().list(user.id, since).catch(() => []), readProjects(deps, user.id),
      voice(user, since).catch(() => []),
    ]);
    const rows = feedOf({
      now: t, tzOffsetMinutes: tz, days, jobs: jobs.map(feedJob), tasks, events: evs, words: wordsByDay(voiceRows, tz, appName),
      projects: Object.fromEntries(projects.map((p) => [p.id, p.name])),
    });
    return { rows, voiceRows };
  };

  app.get("/v1/shell/activity", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const tz = tzOf(req.query);
    const q = (req.query ?? {}) as { bot?: unknown; type?: unknown };
    try {
      const [{ rows }, minutes] = await Promise.all([feedFor(user, tz), saved(user, tz).catch(() => 0)]);
      const week = weekOf(rows, weekAndMonthStart(now(), tz).week, minutes);
      const shown = filterFeed(rows, { ...(typeof q.bot === "string" ? { bot: q.bot } : {}), ...(typeof q.type === "string" ? { kind: q.type } : {}) });
      return reply.send({ now: now(), week, rows: shown.slice(0, 80) });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/shell/search", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const q = String((req.query as { q?: unknown } | null)?.q ?? "").slice(0, 200);
    try {
      if (!q.trim()) return reply.send(searchAll("", {}));
      return reply.send(searchAll(q, await readSearchSources(deps, user, tzOf(req.query))));
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/shell/route", { config: { rateLimit: { max: Math.min(60, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } }, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as { message?: unknown; bot?: unknown };
    const message = typeof b.message === "string" ? b.message.trim() : "";
    if (!message) return reply.code(400).send({ code: "bad_request", message: "message is what the person said." });
    if (message.length > MESSAGE_MAX) return reply.code(413).send({ code: "bad_request", message: `A message may be ${MESSAGE_MAX} characters at most.` });
    const bot = typeof b.bot === "string" && SLUG.test(b.bot) ? b.bot : undefined;
    try {
      return reply.send(await routeOf(deps, user.id, message.slice(0, MESSAGE_MAX), bot));
    } catch {
      // Nobody could be asked: the front door answers it, as it always has.
      return reply.send(previewOf("tailzu", "Tailzu", "none", 0));
    }
  });

  app.post("/v1/shell/ask", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof b.message === "string" ? b.message.trim() : "";
    if (!message) return reply.code(400).send({ code: "bad_request", message: "message is what the person said." });
    const bot = typeof b.bot === "string" && SLUG.test(b.bot) ? b.bot : "any";
    const body: Record<string, unknown> = {
      message, device: b.device === "desktop" ? "desktop" : "phone", mode: b.mode === "voice" ? "voice" : "text",
      // A bot only while the bots platform is on; "tailzu" is the front door's own road.
      ...(deps.bots && bot !== "tailzu" ? { bot } : {}),
      ...(Array.isArray(b.attachments) && b.attachments.length ? { attachments: b.attachments.slice(0, 8) } : {}),
      // The Code bot's own page asks about one project (screens/code.ts codeAsk); POST /v1/ask checks the id.
      ...(typeof b.projectId === "string" && b.projectId ? { projectId: b.projectId } : {}),
      // The app's stream id: the words go to it as they come (POST /v1/ask checks it; live/askStream.ts).
      ...(typeof b.streamId === "string" && b.streamId ? { streamId: b.streamId } : {}),
    };
    // An ask from the apps' outbox (typed offline) carries the id it got when it was typed: it is answered once, however often it is sent
    // (src/shell/sentAsks.ts). A retry of one that was answered gets that answer; one still out is told so (409) and tries again later.
    const clientId = typeof b.clientId === "string" ? b.clientId : undefined;
    if (b.clientId !== undefined && !(clientId && CLIENT_ID.test(clientId))) return reply.code(400).send({ code: "bad_request", message: "clientId is 8 to 64 letters, digits, - or _." });
    const typedAt = typedAtOf(b.typedAt, now());
    if (clientId) {
      let c: Claim;
      try { c = await sent().claim(user.id, clientId, now(), typedAt); } catch (err) {
        req.log.error(err);
        return reply.code(503).send({ code: "try_again", message: "Couldn't send that yet. It goes again soon." });
      }
      if (c.state === "sent") return reply.header("idempotent-replayed", "true").send(c.reply);
      if (c.state === "sending") return reply.code(409).send({ code: "ask_in_flight", message: "That ask is already on its way." });
    }
    const letGo = async (): Promise<void> => { if (clientId) await sent().release(user.id, clientId).catch((err) => req.log.warn({ err }, "shell: ask id not let go")); };
    const key = req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]) : clientId ? `ask:${clientId}` : "";
    let r: Awaited<ReturnType<typeof app.inject>>;
    try {
      r = await app.inject({
        method: "POST", url: "/v1/ask", payload: body,
        headers: { authorization: String(req.headers["authorization"] ?? ""), "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      });
    } catch (err) { await letGo(); throw err; }
    let j: AskReply;
    try { j = JSON.parse(r.body) as AskReply; } catch { await letGo(); return reply.code(r.statusCode >= 400 ? r.statusCode : 502).send({ code: "ask_failed", message: "Couldn't answer that" }); }
    if (r.statusCode < 200 || r.statusCode >= 300) { await letGo(); return reply.code(r.statusCode).send(j); }
    const slug = j.bot?.slug ?? (j.result?.job || j.decision?.route === "code" ? "code" : "tailzu");
    const name = j.bot?.name ?? (slug === "code" ? "Code bot" : "Tailzu");
    const upi = (j.answer?.opens ?? []).map((x) => upiOf(x.url)).find((x) => !!x);
    await events().add(user.id, { kind: "ask", bot: slug, title: message, paise: Math.max(0, Math.round(j.result?.paise ?? 0)), amountPaise: 0, payee: "" }, now()).catch((err) => req.log.warn({ err }, "shell: ask not written down"));
    started.add(user.id);
    const out = {
      ...j,
      shell: {
        bot: { slug, name, color: previewOf(slug, name, "chosen", 1).color }, text: j.result?.text ?? "", paise: j.result?.paise ?? 0,
        needs: j.answer?.approvals?.length ?? 0, ...(upi ? { upi: upi.link } : {}),
        ...(typeof (j.result?.job as { id?: unknown } | undefined)?.id === "string" ? { job: (j.result!.job as { id: string }).id } : {}),
        ...(clientId ? { clientId, ...(typedAt ? { typedAt } : {}) } : {}),
      },
    };
    if (clientId) await sent().done(user.id, clientId, out, now()).catch((err) => req.log.warn({ err }, "shell: sent ask not kept"));
    return reply.send(out);
  });

  app.post("/v1/shell/receipts", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as { upi?: unknown; bot?: unknown; title?: unknown };
    const upi = upiOf(b.upi);
    if (!upi) return reply.code(400).send({ code: "bad_request", message: "upi is the payment link the bot filled in." });
    const bot = typeof b.bot === "string" && SLUG.test(b.bot) && b.bot !== "any" ? b.bot : "tailzu";
    const title = (typeof b.title === "string" && b.title.trim()) || upi.note || `Payment to ${upi.name}`;
    try {
      const receipt = await events().add(user.id, { kind: "paid", bot, title, paise: 0, amountPaise: upi.amountPaise, payee: upi.name }, now());
      started.add(user.id);
      return reply.code(201).send({ receipt });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/shell/receipts/:id", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    try {
      const e = await events().get(user.id, req.params.id);
      return e && e.kind === "paid" ? reply.send({ receipt: e }) : reply.code(404).send({ code: "not_found", message: "No such receipt" });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/shell/tasks", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const tz = tzOf(req.query);
    try {
      const today = dayStartOf(now(), tz);
      const [{ rows, voiceRows }, upcoming] = await Promise.all([feedFor(user, tz, 1), upcomingForShell(calendar(), user.id, now(), tz)]);
      const mine = rows.filter((r) => r.type !== "words" && (r.at >= today || r.mark === "needs" || r.mark === "working"));
      const words = voiceRows.filter((v) => v.at >= today).reduce((n, v) => n + v.words, 0);
      const dueToday = (upcoming.todos ?? []).filter((t) => t.overdue || /^today\b/i.test(t.due ?? "")).length;
      const took = mine.filter((r) => r.mark === "done" || r.mark === "working").length;
      return reply.send({
        rows: mine, upcoming, took, total: mine.length + dueToday, minutesSaved: Math.round(words / TYPING_WPM),
      });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/shell/today", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const tz = tzOf(req.query);
    try {
      const today = dayStartOf(now(), tz);
      const [{ rows, voiceRows }, days] = await Promise.all([feedFor(user, tz, 1), todayForShell(calendar(), user.id, now(), tz)]);
      const day = wordsDay(voiceRows.filter((v) => v.at >= today), tz);
      return reply.send({
        calendar: days, rows: rows.filter((r) => r.type !== "words"),
        keybot: { ...day, minutesSaved: Math.round(day.words / TYPING_WPM) },
      });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/shell/started", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    if (started.has(user.id)) return reply.send({ started: true });
    try {
      const yes = await anyOf([
        readJobs(deps, user.id, 1).then((j) => j.length > 0),
        readTasks(deps, user.id, 1).then((t) => t.length > 0),
        events().any(user.id),
        deps.bots ? deps.bots.list(user.id).then((l) => l.some((b) => !b.builtin)) : Promise.resolve(false),
        wroteAny(user),
      ]);
      if (yes) started.add(user.id);
      return reply.send({ started: yes });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/shell/glance", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const tz = tzOf(req.query);
    try {
      const t = now();
      const [jobs, tasks, list, words] = await Promise.all([
        readJobs(deps, user.id), readTasks(deps, user.id),
        deps.bots ? deps.bots.list(user.id).catch(() => []) : Promise.resolve([]),
        voice(user, dayStartOf(t, tz)).catch(() => []),
      ]);
      return reply.send(glanceOf({ now: t, tz, jobs, tasks, bots: list, words: words.reduce((n, w) => n + w.words, 0) }));
    } catch (err) { return fail(req, reply, err); }
  });
}

/** The parts of POST /v1/ask's answer the shell reads. */
interface AskReply {
  decision?: { route?: string };
  result?: { text?: string; paise?: number; job?: unknown };
  bot?: { slug: string; name: string };
  answer?: { opens?: Array<{ label: string; url: string }>; approvals?: unknown[] };
}

/** True as soon as one of them is (a failed one counts as no). */
async function anyOf(checks: Array<Promise<boolean>>): Promise<boolean> {
  return (await Promise.all(checks.map((c) => c.catch(() => false)))).some(Boolean);
}

export interface Glance {
  v: 1;
  at: number;
  /** The person's bots, in Home's order: needs-you first, then working, then the rest. */
  bots: Array<{ slug: string; name: string; color: string; state: "needs" | "working" | "idle"; doing?: string }>;
  needs: number;
  /** The first thing waiting on them, in a line. */
  ask?: { bot: string; question: string };
  keybot: { wordsToday: number };
  /** The Code bot job that is working now, and where it is. */
  job: { id: string; task: string; stage: number; of: number; stageName: string; spentPaise: number } | null;
}

/** The glance, from the same live state Home draws (experience/bots/live.ts). Pure. */
export function glanceOf(i: {
  now: number; tz: number; jobs: Parameters<typeof jobLite>[0][]; tasks: Array<{ id: string; state: "running" | "waiting" | "done" | "failed" | "cancelled"; title: string; approval: { id: string; connector: string; preview: string } | null; createdAt: number; updatedAt: number }>;
  bots: Array<{ slug: string; name: string; colour: string; purpose: string; builtin: boolean }>; words: number;
}): Glance {
  const live = liveFrom({
    bots: i.bots as BotLite[], jobs: i.jobs.map(jobLite), now: i.now, tzOffsetMinutes: i.tz, minutesSaved: 0, budgetPaise: 0,
    tasks: i.tasks.map((t) => ({ id: t.id, state: t.state, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.approval ? { approval: t.approval } : {}) })),
  });
  const working = i.jobs.filter((j) => j.state === "running" || j.state === "queued" || j.state === "waiting_for_compute").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const stage = working ? stageOf(feedJob(working).phase) : null;
  const first = live.needs[0];
  return {
    v: 1, at: i.now,
    bots: live.bots.map((b) => ({ slug: b.slug, name: b.name, color: b.color, state: b.state, ...(b.doing ? { doing: b.doing } : {}) })),
    needs: live.needs.length,
    ...(first ? { ask: { bot: first.botName, question: first.question } } : {}),
    keybot: { wordsToday: Math.max(0, Math.round(i.words)) },
    job: working && stage ? { id: working.id, task: working.task, stage: stage.at + 1, of: stage.of, stageName: stage.name, spentPaise: working.spentPaise } : null,
  };
}
