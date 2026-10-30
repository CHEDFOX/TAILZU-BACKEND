/**
 * Bots app · you area (screens/you.ts): what the You tab and its settings read and write beyond the existing routes. Everything is the signed-in
 * person's own; another person's anything is never named. `tz` (minutes from UTC) is the person's own day, as the screens send it.
 *
 *   GET    /v1/you?tz=                  -> the You page: plan, the usage meter, connected apps, computers, settings, the download link
 *   GET    /v1/you/usage?tz=            -> { usage, near, out, how }  the Usage page: this stretch and this month as fractions used, when each
 *                                          resets, the line near or at the limit, how the stretches work (src/you/usage.ts). Never an amount
 *   GET    /v1/you/live?tz=             -> { limitPaise, monthPaise, usage }  the tab ring's numbers (live.ts SpendSource), from a 30 s cache
 *   GET    /v1/you/spend?tz=            -> { report, settings }  ours: the month's costs by bot and by day, the biggest jobs (src/you/spend.ts).
 *                                          No screen shows it any more
 *   GET    /v1/you/settings             -> { settings }
 *   GET    /v1/you/notify?tz=           -> { settings, today: { done, needs, spentPaise }, line }  "What pings you", with today's summary as it would read
 *   PUT    /v1/you/settings { monthLimitPaise? | monthLimitRupees?, stopAtLimit?, notify?: { done?, summary?, summaryAt?, quiet?, quietFrom?,
 *                                         quietTo?, bot?, on? }, privacy?: { screenPictures? } }  -> { settings }  only what was sent changes
 *   GET    /v1/you/billing              -> { plan, invoices, usage }  (src/you/billing.ts; the screens show no price and no amount)
 *   GET    /v1/you/computers            -> { online, offline, helped }  the person's computers (runner presence, and the ones seen before)
 *   DELETE /v1/you/computers/:id        -> { ok }  forgets an offline computer (it comes back if it sends a heartbeat again)
 *   GET    /v1/you/apps                 -> { enabled, connected, more, github }  the connected apps with the bots that use each and when last used
 *   GET    /v1/you/apps/:id             -> { app, bots, can, cant }  one app, for Connect
 *   GET    /v1/you/account              -> what deleting the account takes: bots, projects, notes, keys, the plan
 *   GET    /v1/you/export               -> the person's data, one JSON file (src/you/data.ts)
 *   GET    /v1/you/export/file?t=       -> the same, for the browser: the signed link from GET /v1/you (no session; 30 minutes)
 *   POST   /v1/you/data/delete          -> { ok, cleared }  chats, notes and files go; the account, plan, bots and projects stay
 *
 * Plugged in here too, on the services the server already made (src/you/limits.ts, push.ts): the usage limits on the Code bot's job routes, on
 * the bots platform's answers and on Keybot and Ask (metering.setUsageGate), every bot answer's cost written down, and what Keybot, Ask and
 * notes really cost (usage/cost.ts setCostSink), the push engine's gate for
 * "What pings you" and the daily summary, a computer remembered when it sends a heartbeat, and the tab ring's numbers (live.ts setSpendSource).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { getEntitlement } from "../billing/entitlements.js";
import { setSpendSource, type UsageLive as LiveUsage } from "../experience/bots/live.js";
import { listNotes } from "../notes/store.js";
import { setPushGate } from "../push/engine.js";
import { billingView } from "../you/billing.js";
import { deleteMyData, exportLink, exportLinkUser, gatherExport } from "../you/data.js";
import { holdJobsToUsage, Spending, wrapBots } from "../you/limits.js";
import { setUsageGate } from "../usage/metering.js";
import { setCostSink } from "../usage/cost.js";
import { setUsageSpan } from "../you/span.js";
import { howLine, nearLine, outLine, type UsageNow } from "../you/usage.js";
import { getProfile } from "../profile/store.js";
import { dayOf, pushGate, startSummaries, summaryLine } from "../you/push.js";
import { applyPatch } from "../you/settings.js";
import { youStore } from "../you/store.js";
import type { BotsAreaDeps } from "./botsArea.js";

/** The bots each app is for when the person made no bot of their own that uses it (builtin.ts skills). None today: the Plan bot runs on
 *  Tailzu's own calendar and to-dos (src/calendar), which are not connected apps. */
const BUILTIN_APPS: Record<string, string[]> = {};

/**
 * Not offered in the Bots app: Tailzu keeps its own calendar and to-dos. Someone who connected one before still sees it (to switch it off);
 * nobody is asked to connect it.
 */
const NOT_OFFERED = new Set(["google-calendar", "google-tasks"]);

/** What one app may do, in the person's words: what it can, and what it can't. Apps not named here say their own line. */
const APP_WORDS: Record<string, { can: string[]; cant: string[] }> = {
  "google-calendar": { can: ["Read your events and free time", "Add or move events, asking you first"], cant: ["Share your calendar", "Change anything you didn't allow"] },
  "google-tasks": { can: ["Read your to-do lists", "Add and tick off tasks, asking you first"], cant: ["Read your other Google data"] },
  "google-docs": { can: ["Make new Docs from your words"], cant: ["Open your other Drive files"] },
  "google-sheets": { can: ["Make sheets and add rows to them"], cant: ["Open sheets X0 Bot didn't make"] },
  "google-forms": { can: ["Make forms and read who answered"], cant: ["Open your other Drive files"] },
  "google-classroom": { can: ["Read classes, homework and due dates"], cant: ["Turn in or change anything"] },
  github: { can: ["Read code and issues you can see", "Open pull requests, asking you first"], cant: ["Merge anything by itself"] },
};


/** The You routes, and the meter they keep (server.ts hands the front door's own costs to it). */
export function registerBotsYouRoutes(app: FastifyInstance, deps: BotsAreaDeps): { spending: Spending } {
  const RL = { config: deps.rateLimit };
  const store = youStore();
  const spending = new Spending({ store, jobs: deps.jobs });

  // ------------------------------------------------------------ plugged in

  if (deps.bots) wrapBots(deps.bots, spending);
  if (deps.jobs) holdJobsToUsage(app, spending, deps.jobs);
  setUsageGate(async (userId) => (await spending.refusal(userId))?.message ?? null);
  // What Keybot, Ask and notes really cost (usage/cost.ts), written down for the meter.
  setCostSink((userId, usd, bot) => spending.recordUsd(userId, bot, usd));
  // Whether a person's month is used in stretches, for a Code bot job's pause ("this month" on the free plan).
  setUsageSpan(async (userId) => (await spending.usage(userId)).plan.windows);
  setPushGate(pushGate(spending));
  setSpendSource(async (botsDeps, tz) => botsDeps.api<{ limitPaise: number; monthPaise: number; usage?: LiveUsage }>("GET", `/v1/you/live?tz=${Math.round(tz)}`));
  const stopSummaries = startSummaries({ spending, jobs: deps.jobs, connectors: deps.connectors, log: app.log });
  app.addHook("onClose", async () => { stopSummaries(); setUsageGate(null); setCostSink(null); setUsageSpan(null); });

  // A computer's heartbeat: remembered (name, when last seen) at most every ten minutes, so an offline one can still be listed.
  const seen = new Map<string, number>();
  app.addHook("onResponse", async (req, reply) => {
    if (req.method !== "POST" || reply.statusCode !== 200 || req.url.split("?")[0] !== "/v1/code/runner/heartbeat") return;
    const b = (req.body ?? {}) as { deviceId?: unknown; name?: unknown; capabilities?: { os?: unknown } };
    if (typeof b.deviceId !== "string" || !b.deviceId) return;
    const key = `${String(req.headers["authorization"] ?? "").slice(-24)}|${b.deviceId}`;
    const now = Date.now();
    if (now - (seen.get(key) ?? 0) < 10 * 60_000) return;
    seen.set(key, now);
    if (seen.size > 5000) seen.clear();
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return;
    await store.seeComputer(user.id, { deviceId: b.deviceId, name: typeof b.name === "string" ? b.name : "", os: typeof b.capabilities?.os === "string" ? b.capabilities.os : "" }, now).catch(() => undefined);
  });

  // ------------------------------------------------------------ helpers

  const who = async (authorization: unknown, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(typeof authorization === "string" ? authorization : undefined);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Sign in first." }); return null; }
    return user;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    app.log.error({ err: (err as Error)?.message }, "you: route failed");
    return reply.code(500).send({ code: "internal", message: "That didn't work. Try again." });
  };
  const tzOf = (userId: string, q: unknown) => spending.noteTz(userId, (q as { tz?: unknown } | undefined)?.tz);
  /** The meter as the screens get it: fractions used and when each resets, the plan's name. None of our amounts. */
  const meterOf = (u: UsageNow) => ({ plan: u.plan, stretch: u.stretch, month: u.month, state: u.state });
  const liveOf = (u: UsageNow): LiveUsage => ({ used: u.stretch.used, month: u.month.used, state: u.state, resetsAt: u.stretch.resetsAt, windows: u.plan.windows });

  /** Which bots use which app: the person's own bots' skills, and the built-ins'. */
  const usedBy = async (userId: string): Promise<Map<string, string[]>> => {
    const m = new Map<string, string[]>();
    for (const [app, names] of Object.entries(BUILTIN_APPS)) m.set(app, [...names]);
    const defs = deps.bots ? await deps.bots.defs(userId).catch(() => []) : [];
    for (const d of defs) {
      if (d.ownerId === null) continue;
      for (const c of d.skills.connectors) m.set(c, [...(m.get(c) ?? []), d.name]);
    }
    return m;
  };

  const appsView = async (user: AuthedUser) => {
    const c = deps.connectors;
    if (!c) return { enabled: false, connected: [], more: [], github: null as null | { repos: number }, alone: 0 };
    const [conns, own, uses, projects] = await Promise.all([
      c.store.listConnections(user.id), c.hub.customApps(user.id).catch(() => []), usedBy(user.id),
      deps.code ? deps.code.store.listProjects(user.id).catch(() => []) : Promise.resolve([]),
    ]);
    const byId = new Map(conns.map((x) => [x.connectorId, x]));
    const defs = [...c.hub.catalog.filter((d) => !d.hidden && d.kind !== "device"), ...own];
    const connected = defs.filter((d) => byId.get(d.id)?.tokensEnc).map((d) => {
      const conn = byId.get(d.id)!;
      return {
        id: d.id, name: d.name, category: d.category, level: conn.level, lastUsedAt: conn.lastUsedAt, usedBy: uses.get(d.id) ?? [],
        ...(c.hub.needsSignIn(user.id, d.id) ? { needsSignIn: true } : {}),
      };
    }).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name));
    // Connect more: the apps the person's bots name first, then Google's, then the rest; three at most.
    const rank = (id: string) => (uses.has(id) ? 0 : id.startsWith("google-") ? 1 : 2);
    const more = defs.filter((d) => !byId.get(d.id)?.tokensEnc && !d.custom && !NOT_OFFERED.has(d.id)).sort((a, b) => rank(a.id) - rank(b.id))
      .slice(0, 6).map((d) => ({ id: d.id, name: d.name, category: d.category, oneLine: d.oneLine, usedBy: uses.get(d.id) ?? [] }));
    // What bots may do alone: the changes the person let an app make without asking (connectors' "auto").
    const alone = conns.filter((x) => x.tokensEnc).reduce((n, x) => n + x.autoOk.length, 0);
    return { enabled: true, connected, more, github: projects.length ? { repos: projects.length } : null, alone };
  };

  const computersView = async (user: AuthedUser) => {
    const now = Date.now();
    const online = deps.jobs ? deps.jobs.devices.onlineFor(user.id, now) : [];
    for (const d of online) await store.seeComputer(user.id, { deviceId: d.deviceId, name: d.name, os: d.capabilities.os }, now).catch(() => undefined);
    const known = await store.listComputers(user.id).catch(() => []);
    const on = new Set(online.map((d) => d.deviceId));
    // What computers did this month: the jobs with a step that ran on one, and the minutes those steps took.
    let jobs = 0, minutes = 0;
    if (deps.jobs) {
      const { report } = await spending.report(user.id).catch(() => ({ report: null }));
      const since = report?.monthStart ?? now - 31 * 86_400_000;
      const recent = (await deps.jobs.listJobs(user.id, 60).catch(() => [])).filter((j) => j.updatedAt >= since).slice(0, 30);
      for (const j of recent) {
        const steps = await deps.jobs.jobWithSteps(user.id, j.id).then((r) => r.steps, () => []);
        const mine = steps.filter((s) => s.placement === "desktop" && s.status !== "pending");
        if (mine.length) { jobs += 1; minutes += mine.reduce((n, s) => n + (s.minutes || 0), 0); }
      }
    }
    return {
      online: online.map((d) => ({
        deviceId: d.deviceId, name: d.name || "Your computer", os: d.capabilities.os, allowRun: d.allowRun, busy: d.busy,
        projects: d.projects === "all" ? "all" : Array.isArray(d.projects) ? (d.projects as readonly string[]).length : "most",
        liveOnly: d.capabilities.liveOnly, container: d.capabilities.container,
      })),
      offline: known.filter((k) => !on.has(k.deviceId)).map((k) => ({ deviceId: k.deviceId, name: k.name || "A computer", os: k.os, lastSeen: k.lastSeen })),
      helped: { jobs, minutes },
    };
  };

  // ------------------------------------------------------------ the You page

  app.get("/v1/you", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const tz = tzOf(user.id, req.query);
      const [{ report, settings }, usage, ent, apps, computers, profile] = await Promise.all([
        spending.report(user.id, tz),
        spending.usage(user.id, { tz, fresh: true }).catch(() => null),
        getEntitlement(user).catch(() => null),
        appsView(user).catch(() => null),
        computersView(user).catch(() => null),
        getProfile(user).catch(() => null),
      ]);
      return reply.header("cache-control", "no-store").send({
        plan: { name: ent?.active ? "Pro" : "Free", active: !!ent?.active },
        spend: {
          monthPaise: report.monthPaise, limitPaise: report.limitPaise, leftPaise: report.leftPaise, perDayPaise: report.perDayPaise,
          resetsAt: report.resetsAt, byBot: report.byBot, stopAtLimit: report.stopAtLimit,
        },
        usage: usage ? meterOf(usage) : null,
        apps: apps ? { enabled: apps.enabled, connected: apps.connected.map((a) => ({ id: a.id, name: a.name, usedBy: a.usedBy, lastUsedAt: a.lastUsedAt })), github: apps.github, alone: apps.alone } : null,
        language: profile?.language ?? null,
        computers: computers ? { online: computers.online.map((c) => ({ name: c.name, busy: c.busy, allowRun: c.allowRun })), offline: computers.offline.length, helped: computers.helped } : null,
        settings,
        exportUrl: exportLink(user.id, Date.now())?.url ?? null,
      });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/you/live", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    tzOf(user.id, req.query);
    try {
      const [{ report, settings }, usage] = await Promise.all([spending.month(user.id), spending.usage(user.id).catch(() => null)]);
      return reply.send({ limitPaise: settings.monthLimitPaise, monthPaise: report.monthPaise, ...(usage ? { usage: liveOf(usage) } : {}) });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------ usage

  app.get("/v1/you/usage", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const tz = tzOf(user.id, req.query);
      const u = await spending.usage(user.id, { tz, fresh: true });
      const now = spending.now();
      return reply.header("cache-control", "no-store").send({
        usage: meterOf(u), near: nearLine(u, now, tz), out: u.state === "out" ? outLine(u, now, tz) : null, how: howLine(u),
      });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------ budget and settings

  app.get("/v1/you/spend", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      return reply.header("cache-control", "no-store").send(await spending.report(user.id, tzOf(user.id, req.query)));
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/you/settings", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try { return reply.send({ settings: await store.getSettings(user.id) }); } catch (err) { return fail(reply, err); }
  });

  app.put("/v1/you/settings", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const next = applyPatch(await store.getSettings(user.id), req.body);
      if (!next.ok) return reply.code(400).send({ code: "bad_request", message: next.message });
      const settings = await store.putSettings(user.id, next.settings, Date.now());
      spending.forget(user.id);
      return reply.send({ settings });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/you/notify", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const tz = tzOf(user.id, req.query);
      const [settings, today] = await Promise.all([
        store.getSettings(user.id),
        dayOf(user.id, { spending, jobs: deps.jobs, connectors: deps.connectors, now: Date.now(), tz }).catch(() => null),
      ]);
      return reply.header("cache-control", "no-store").send({ settings, today, line: today ? summaryLine(today) : null });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------ billing

  app.get("/v1/you/billing", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const tz = tzOf(user.id, req.query);
      const [view, usage] = await Promise.all([billingView(user), spending.usage(user.id, { tz }).catch(() => null)]);
      return reply.header("cache-control", "no-store").send({ ...view, usage: usage ? meterOf(usage) : null, email: user.email ?? null });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------ computers

  app.get("/v1/you/computers", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try { return reply.header("cache-control", "no-store").send(await computersView(user)); } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/you/computers/:id", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const id = String(req.params.id ?? "").slice(0, 128);
      if (deps.jobs?.devices.online(user.id, id, Date.now())) {
        return reply.code(409).send({ code: "online", message: "This computer is online. Turn off This computer helps on it first." });
      }
      return reply.send({ ok: await store.removeComputer(user.id, id) });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------ connected apps

  app.get("/v1/you/apps", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try { return reply.header("cache-control", "no-store").send(await appsView(user)); } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/you/apps/:id", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    const c = deps.connectors;
    if (!c) return reply.code(404).send({ code: "connectors_off", message: "Connected apps aren't on here." });
    try {
      const def = await c.hub.resolve(user.id, req.params.id).catch(() => undefined);
      if (!def || def.hidden || def.kind === "device") return reply.code(404).send({ code: "not_found", message: "No such app." });
      const conn = await c.store.getConnection(user.id, def.id);
      if (NOT_OFFERED.has(def.id) && !conn?.tokensEnc) return reply.code(404).send({ code: "not_offered", message: "X0 Bot has its own calendar and to-dos: they're on your Plan." });
      const defs = deps.bots ? await deps.bots.defs(user.id).catch(() => []) : [];
      const bots = defs.filter((d) => d.skills.connectors.includes(def.id))
        .map((d) => ({ slug: d.slug, name: d.name, colour: d.colour, purpose: d.purpose, builtin: d.ownerId === null, linked: true }));
      // The person's own bots that could use it, switched off for now.
      for (const d of defs) if (d.ownerId !== null && !d.skills.connectors.includes(def.id) && bots.length < 6) bots.push({ slug: d.slug, name: d.name, colour: d.colour, purpose: d.purpose, builtin: false, linked: false });
      const words = APP_WORDS[def.id] ?? { can: [def.oneLine.replace(/\.$/, "")], cant: ["Change anything without asking you first"] };
      return reply.send({
        app: {
          id: def.id, name: def.name, category: def.category, oneLine: def.oneLine, auth: def.auth === "url" ? "url" : "oauth", provider: def.provider ?? null,
          connected: !!conn?.tokensEnc, level: conn?.level ?? "look", lastUsedAt: conn?.lastUsedAt ?? null,
        },
        bots, can: words.can, cant: words.cant,
      });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------ account and data

  app.get("/v1/you/account", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const [ent, bots, projects, notes, keys] = await Promise.all([
        getEntitlement(user).catch(() => null),
        deps.bots ? deps.bots.list(user.id).catch(() => []) : Promise.resolve([]),
        deps.code ? deps.code.store.listProjects(user.id).catch(() => []) : Promise.resolve([]),
        listNotes(user, 500).catch(() => []),
        deps.bots ? deps.bots.exportAll(user.id).then((e) => e.keys.filter((k) => k.active).length, () => 0) : Promise.resolve(0),
      ]);
      return reply.header("cache-control", "no-store").send({
        bots: bots.map((b) => ({ slug: b.slug, name: b.name, colour: b.colour, builtin: b.builtin })),
        projects: projects.map((p) => p.fullName.split("/").pop() ?? p.fullName),
        notes: notes.length, keys,
        plan: { active: !!ent?.active, store: ent?.store ?? null, renews: !!ent?.active && ent?.renews !== false, until: ent?.expiresAt ? Date.parse(ent.expiresAt) || null : null },
        exportUrl: exportLink(user.id, Date.now())?.url ?? null,
      });
    } catch (err) { return fail(reply, err); }
  });

  const dataDeps = { bots: deps.bots, code: deps.code, jobs: deps.jobs, connectors: deps.connectors, media: deps.media, store };
  const sendExport = async (user: AuthedUser, reply: FastifyReply) => {
    const body = await gatherExport(user, dataDeps, Date.now());
    const day = new Date().toISOString().slice(0, 10);
    return reply.header("cache-control", "no-store").header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="tailzu-data-${day}.json"`).send(JSON.stringify(body, null, 2));
  };

  app.get("/v1/you/export", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try { return await sendExport(user, reply); } catch (err) { return fail(reply, err); }
  });

  app.get<{ Querystring: { t?: unknown } }>("/v1/you/export/file", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (req, reply) => {
    const userId = exportLinkUser(req.query.t, Date.now());
    if (!userId) {
      return reply.code(410).header("content-type", "text/plain; charset=utf-8")
        .send("This download link has run out. Open Privacy in X0 Bot and tap Download my data again.");
    }
    try { return await sendExport({ id: userId }, reply); } catch (err) { return fail(reply, err); }
  });

  app.post("/v1/you/data/delete", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const r = await deleteMyData(user.id, { media: deps.media }, app.log);
      if (!r.ok) return reply.code(503).send({ code: "delete_unavailable", message: "Deleting isn't available right now. Try again shortly." });
      return reply.send({ ok: true, cleared: r.cleared });
    } catch (err) { return fail(reply, err); }
  });

  return { spending };
}
