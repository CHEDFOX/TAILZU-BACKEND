/**
 * QUICK ACCESS FROM OUTSIDE THE APP: the Home Screen and Lock Screen widgets, a notification's buttons and the reply typed into
 * one (src/widgets; docs/widgets.md). Registered by routes/botsBots.ts, beside Spaces, whose parts it reads.
 *
 *   GET    /v1/widgets/now?tz=&platform=     -> NowDoc   both widgets' rows, already worded, with links and buttons, and the look
 *                                             (session). The app writes it to the App Group / SharedPreferences as it is.
 *   POST   /v1/widgets/token { device }      -> { token, expiresAt, scopes, path } | { token: null }   the widget's own narrow
 *                                             token for this phone, replacing its last (session). Off: { token: null }.
 *   DELETE /v1/widgets/token { device? }     -> { revoked }   this phone's token, or every one (session; sign-out sends it)
 *   POST   /v1/widgets/act { item, action, text?, key? }   -> { ok, state, repeat? }   an answer (src/widgets/act.ts): with the
 *                                             widget's `X-Widget-Token` (needs-you answers and Done only), or the session
 *                                             (a notification's buttons and its reply)
 *
 * Every read and write is the person's own and goes through the services the app's own routes use, with their checks. The rows say
 * nothing the person's app would not (no amounts, a message's words only as the server allows, marked private).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { jobLite } from "../experience/bots/deps.js";
import { CONNECTOR_BOT, type JobLite } from "../experience/bots/live.js";
import { QuickActs, type ActParts, type ActPolicy, type ActVia } from "../widgets/act.js";
import { widgetsConfig, type WidgetsConfigFor } from "../widgets/config.js";
import { buildNow, widgetKnobs, type NowInput, type PendingApproval, type PeopleShared, type PeopleTask } from "../widgets/now.js";
import { DEVICE_RE, WidgetTokens, widgetTokenStore } from "../widgets/token.js";
import { parseItem } from "../widgets/items.js";
import { livePublish } from "../live/writes.js";
import { TOPIC, jobTopic } from "../live/topics.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { SpaceParts } from "./botsSpaces.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const queryOf = (req: FastifyRequest): Record<string, unknown> => (req.query as Record<string, unknown> | undefined) ?? {};
const header = (req: FastifyRequest, k: string): string => { const v = req.headers[k]; return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : ""; };
const platformOf = (v: unknown): string | undefined => (v === "ios" || v === "android" ? v : undefined);
const tzOf = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-720, Math.min(840, n)) : 0; };

export interface WidgetRouteOptions {
  tokens?: WidgetTokens;
  acts?: QuickActs;
  config?: WidgetsConfigFor;
  now?: () => number;
}

/** The services an answer goes through, from what the server runs (any may be off). */
export function actPartsOf(deps: BotsAreaDeps, parts: Pick<SpaceParts, "tasks" | "threads">): ActParts {
  const c = deps.connectors;
  const jobs = deps.jobs;
  const agent = deps.agent ?? null;
  return {
    spaceTasks: parts.tasks,
    threads: parts.threads,
    approvals: c ? {
      async risk(userId, taskId) {
        const t = await c.store.getTask(userId, taskId);
        if (!t) return null;
        return { risk: t.approval?.risk ?? "", approvalId: t.approval?.id ?? "", waiting: t.state === "waiting" && !!t.approval };
      },
      approve: (userId, taskId, approvalId) => c.tasks.approve(userId, taskId, approvalId),
      deny: (userId, taskId) => c.tasks.deny(userId, taskId),
    } : null,
    jobs: jobs && agent ? {
      async question(userId, jobId) {
        const j = jobLite(await jobs.job(userId, jobId));
        if (j.state !== "waiting_for_you" || j.waitingOn !== "answer" || !j.question) return null;
        return { text: j.question.text, options: j.question.options ?? [] };
      },
      answer: (userId, jobId, answer) => agent.answer(userId, jobId, answer),
    } : null,
  };
}

export function registerWidgetRoutes(app: FastifyInstance, deps: BotsAreaDeps, parts: SpaceParts, o: WidgetRouteOptions = {}): void {
  const now = o.now ?? Date.now;
  const config = o.config ?? widgetsConfig;
  const tokens = o.tokens ?? new WidgetTokens(widgetTokenStore(), now);
  const acts = o.acts ?? new QuickActs(actPartsOf(deps, parts), undefined, now);
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return user;
  };
  const cfgFor = (req: FastifyRequest, userId: string) => config({
    userId, platform: platformOf(queryOf(req).platform) ?? platformOf(bodyOf(req.body).platform),
    locale: header(req, "x-app-language") || undefined, signedIn: true, now: now(),
  });

  /** What the person's records say, for buildNow. Every read may fail: it is then empty, and the widget says what is true. */
  async function gather(user: AuthedUser, tz: number, payload: ReturnType<WidgetsConfigFor>): Promise<NowInput> {
    const k = widgetKnobs(payload);
    const on = k.flag("widgets.enabled", true);
    const peopleOn = on && k.flag("widgets.people.enabled", true);
    const needsOn = on && k.flag("widgets.needs.enabled", true);
    const safe = <T>(p: Promise<T>, empty: T): Promise<T> => p.catch(() => empty);
    const mine = await safe(parts.spaces.mine(user.id), []);
    const names = new Map(mine.map((s) => [s.id, s.name]));
    const [messages, shared, given, jobs, waiting] = await Promise.all([
      peopleOn ? safe(parts.threads.recentFrom(user.id, { chats: k.flag("widgets.people.chats", 8), includeMuted: k.flag("widgets.people.includeMuted", false) }), []) : Promise.resolve([]),
      peopleOn ? Promise.all(mine.map((s) => safe(parts.items.list(user.id, s.id), []).then((items) => items.filter((i) => !i.byYou).slice(0, 10)
        .map((i): PeopleShared => ({ itemId: i.id, spaceId: i.spaceId, spaceName: names.get(i.spaceId ?? "") ?? "", by: i.by, title: i.title, at: i.at }))))).then((x) => x.flat())
        : Promise.resolve([] as PeopleShared[]),
      safe(parts.tasks.givenTo(user.id), []),
      needsOn && deps.jobs ? safe(deps.jobs.listJobs(user.id, 50).then((js) => js.map(jobLite)), [] as JobLite[]) : Promise.resolve([] as JobLite[]),
      needsOn && deps.connectors ? safe(deps.connectors.tasks.list(user.id, 20), []) : Promise.resolve([]),
    ]);
    const theirs: PeopleTask[] = given.filter((t) => !t.byYou && t.mine?.status === "todo").map((t) => ({
      taskId: t.id, spaceId: t.spaceId, spaceName: t.spaceName, by: t.setBy, title: t.title, kind: t.kind, at: t.givenAt ?? t.at ?? now(), due: t.at,
    }));
    const approvals: PendingApproval[] = waiting.filter((t) => t.state === "waiting" && t.approval).map((t) => {
      const bot = CONNECTOR_BOT[t.approval!.connector] ?? "tailzu";
      return {
        taskId: t.id, approvalId: t.approval!.id, title: t.title, preview: t.approval!.preview, risk: t.approval!.risk, at: t.updatedAt,
        who: k.label(`widgets.who.${bot}`, bot === "tailzu" ? "X0" : bot),
      };
    });
    return {
      now: now(), tzOffsetMinutes: tz, inSpaces: mine.length > 0,
      people: { messages, shared, tasks: peopleOn ? theirs : [] },
      needs: { jobs, approvals, tasks: needsOn ? theirs : [], codeBotName: k.label("widgets.who.code", "Code bot") },
      tokenReady: k.flag("widgets.token.enabled", true),
    };
  }

  app.get("/v1/widgets/now", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const payload = cfgFor(req, user.id);
    try {
      const doc = buildNow(await gather(user, tzOf(queryOf(req).tz), payload), payload);
      return reply.header("cache-control", "private, no-store").send(doc);
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "widgets: now failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't read that just now." });
    }
  });

  app.post("/v1/widgets/token", tight(20), async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const k = widgetKnobs(cfgFor(req, user.id));
    const device = bodyOf(req.body).device;
    if (typeof device !== "string" || !DEVICE_RE.test(device)) return reply.code(400).send({ code: "bad_request", message: "device is this phone's install id." });
    // Off: no token, and none of the phone's old ones stands either.
    if (!k.flag("widgets.enabled", true) || !k.flag("widgets.token.enabled", true)) {
      await tokens.revoke(user.id, device).catch(() => 0);
      return reply.send({ token: null });
    }
    try {
      const t = await tokens.issue(user.id, device, {
        ttlMs: Math.max(5, k.flag("widgets.token.ttlMin", 1440)) * 60_000,
        maxPerUser: Math.max(1, k.flag("widgets.token.maxPerUser", 5)),
      });
      return reply.header("cache-control", "no-store").send({ ...t, renewAt: k.flag("widgets.token.renewAt", 0.5), path: k.flag("widgets.act.path", "/v1/widgets/act") });
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "widgets: token failed");
      return reply.code(503).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });

  app.delete("/v1/widgets/token", tight(20), async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const device = bodyOf(req.body).device ?? queryOf(req).device;
    try {
      return reply.send({ revoked: await tokens.revoke(user.id, typeof device === "string" && DEVICE_RE.test(device) ? device : undefined) });
    } catch {
      return reply.code(503).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });

  app.post("/v1/widgets/act", tight(60), async (req, reply) => {
    // The widget's own token, or the session; never both read as one. A widget token is not a session anywhere else.
    const widgetToken = header(req, "x-widget-token");
    let userId: string;
    let via: ActVia;
    if (widgetToken) {
      const v = await tokens.verify(widgetToken).catch(() => null);
      if (!v) return reply.code(401).send({ code: "widget_token", message: "Open X0 Bot to finish." });
      userId = v.userId;
      via = { kind: "widget", scopes: v.scopes };
    } else {
      const user = await who(req, reply);
      if (!user) return reply;
      userId = user.id;
      via = { kind: "session" };
    }
    const k = widgetKnobs(cfgFor(req, userId));
    if (!k.flag("widgets.enabled", true) && via.kind === "widget") return reply.code(403).send({ code: "open_app", message: "Open X0 Bot to answer." });
    const policy: ActPolicy = {
      inPlaceRisks: k.list("widgets.needs.inPlaceRisks", ["read", "write", "send"]),
      modes: k.obj<Record<string, unknown>>("widgets.needs.modes", {}),
      tokenEnabled: k.flag("widgets.token.enabled", true),
    };
    const b = bodyOf(req.body);
    const out = await acts.run(userId, { item: b.item, action: b.action, text: b.text, key: b.key }, via, policy);
    // The person's open screens follow (a widget's call has no session for the write hook to find, so it is said here). Spaces and
    // chats publish their own.
    const item = parseItem(b.item);
    if (out.status === 200 && item && (item.kind === "task" || item.kind === "job")) {
      livePublish(userId, item.kind === "job" ? [jobTopic(item.jobId), TOPIC.code, TOPIC.home, TOPIC.activity] : [TOPIC.tasks, TOPIC.activity, TOPIC.home]);
    }
    return reply.code(out.status).header("cache-control", "no-store").send(out.body);
  });
}
