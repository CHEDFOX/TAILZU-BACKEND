/**
 * CONNECTED APPS AND THE ASSISTANT'S TASKS, over HTTP.
 *
 *   GET    /v1/connectors              the apps that are switched on, with this person's state
 *   POST   /v1/connectors/:id/connect  oauth: -> { authorizeUrl }.  url: body { url } -> { connected }
 *   GET    /v1/connectors/callback     the vendor sends the browser back here; no session, the signed state says who
 *   POST   /v1/connectors/:id/level    { level: look | draft | send }
 *   POST   /v1/connectors/:id/auto     { tool, on }  let it do this tool without asking (or stop)
 *   DELETE /v1/connectors/:id          disconnect and forget the token
 *   GET    /v1/tasks                   the assistant's recent tasks, newest first
 *   POST   /v1/tasks/:id/approve       yes: run the waiting call once -> { ok, result | error, task }
 *   POST   /v1/tasks/:id/deny          no: nothing is called
 *
 * Every route but the callback authenticates exactly like the rest of /v1.
 * With CONNECTORS off the list says so ({ enabled: false }) and everything
 * else answers 404, so a client can ask once and stop.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AssistantTask } from "../../../shared/types/api.js";
import { resolveUser } from "../auth/supabase.js";
import { NoTokenKey, encrypt } from "../connectors/crypto.js";
import { checkSecretUrl, type Connectors } from "../connectors/index.js";
import { connectorList } from "../connectors/list.js";
import { beginOAuth, completeOAuth, ConnectorError } from "../connectors/oauth.js";
import type { Level } from "../connectors/risk.js";
import { ConnectorsNeedAccount } from "../connectors/store.js";
import type { TaskView } from "../connectors/tasks.js";

export interface ConnectorRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when CONNECTORS is off. */
  connectors: Connectors | null;
}

const LEVELS: readonly Level[] = ["look", "draft", "send"];
const AUTO_MAX = 100;

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'";
/** Where the phone's app is opened from this page: its Connected apps screen (it refreshes itself on the way in). */
const OPEN_APP = "tulmi://screen/assistant_apps?entry=link";
const page = (title: string, line: string, openApp = true) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>body{font:18px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center;color:#1b1b1f;background:#faf8f5}` +
  `@media(prefers-color-scheme:dark){body{color:#f2f0ed;background:#16161a}}h1{font-size:22px;margin:0 0 8px}p{margin:0;opacity:.7}` +
  `a{display:inline-block;margin-top:22px;padding:12px 26px;border-radius:999px;background:#1b1b1f;color:#faf8f5;font-weight:600;text-decoration:none}` +
  `@media(prefers-color-scheme:dark){a{background:#f2f0ed;color:#16161a}}</style>` +
  `<main><h1>${title}</h1><p>${line}</p>${openApp ? `<a href="${OPEN_APP}">Open Tailzu</a>` : ""}</main>`;

/** A task as the API sends it: its approval is the plain-words card, never the call's arguments. */
const taskOut = (t: TaskView): AssistantTask => t as AssistantTask;

export function registerConnectorRoutes(app: FastifyInstance, deps: ConnectorRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const c = deps.connectors;

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "connectors_off", message: "Connected apps are not switched on." });
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ConnectorsNeedAccount) return reply.code(403).send({ code: "needs_account", message: err.message });
    if (err instanceof NoTokenKey) return reply.code(503).send({ code: "not_configured", message: err.message });
    if (err instanceof ConnectorError) return reply.code(err.code === "bad_state" ? 400 : 502).send({ code: err.code, message: err.message });
    throw err;
  };
  const noSession = (reply: FastifyReply) =>
    reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

  app.get("/v1/connectors", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return reply.send({ enabled: false, connectors: [] });
    try {
      const connectors = await connectorList(c, user.id);
      return reply.send({ enabled: true, connectors });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { url?: unknown } }>("/v1/connectors/:id/connect", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    const def = c.hub.def(req.params.id);
    if (!def) return reply.code(404).send({ code: "not_found", message: "No such app" });
    try {
      if (def.auth === "oauth") {
        const authorizeUrl = await beginOAuth({ store: c.store, redirectUrl: c.redirectUrl }, user.id, def);
        return reply.send({ authorizeUrl });
      }
      const url = checkSecretUrl(def, (req.body ?? {}).url);
      if (!url) {
        return reply.code(400).send({ code: "bad_request", message: `Paste the link ${def.name} gave you (it starts with https://${new URL(def.url).hostname}).` });
      }
      await c.hub.forget(user.id, def.id);
      await c.store.upsertConnection(user.id, def.id, { tokensEnc: encrypt(JSON.stringify({ url: url.toString() })) });
      // Prove the link works before saying so; a link that doesn't is not kept.
      try {
        await c.hub.tools(user.id, def.id);
      } catch (err) {
        await c.store.upsertConnection(user.id, def.id, { tokensEnc: null });
        const f = err instanceof ConnectorError ? err : new ConnectorError("failed", `${def.name} didn't accept that link.`);
        return reply.code(400).send({ code: f.code, message: f.message });
      }
      return reply.send({ connected: true });
    } catch (err) { return fail(reply, err); }
  });

  // The vendor's redirect. A browser, no session: who this is for is in the signed state.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/v1/connectors/callback", RL, async (req, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("content-security-policy", PAGE_CSP).header("content-type", "text/html; charset=utf-8");
    if (!c) return reply.code(404).send(page("Not available", "Connected apps are not switched on.", false));
    const { code, state, error } = req.query ?? {};
    if (error) return reply.code(400).send(page("Nothing was connected", "You can go back to Tailzu and try again any time."));
    if (typeof code !== "string" || typeof state !== "string" || !code || code.length > 4096 || state.length > 4096) {
      return reply.code(400).send(page("That link didn't work", "Go back to Tailzu and start connecting again."));
    }
    try {
      const { userId, def } = await completeOAuth({ store: c.store, redirectUrl: c.redirectUrl }, (id) => c.hub.def(id), code, state);
      await c.hub.forget(userId, def.id);
      return reply.send(page("You're connected", `${def.name} is ready. You can go back to Tailzu.`));
    } catch (err) {
      req.log.warn({ code: (err as { code?: string })?.code }, "connector callback failed");
      return reply.code(400).send(page("That didn't work", "Go back to Tailzu and try connecting again."));
    }
  });

  app.post<{ Params: { id: string }; Body: { level?: unknown } }>("/v1/connectors/:id/level", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    const level = (req.body ?? {}).level;
    if (!LEVELS.includes(level as Level)) return reply.code(400).send({ code: "bad_request", message: "level is look, draft or send" });
    try {
      const cur = await c.store.getConnection(user.id, req.params.id);
      if (!cur?.tokensEnc) return reply.code(404).send({ code: "not_connected", message: "That app isn't connected." });
      await c.store.upsertConnection(user.id, req.params.id, { level: level as Level });
      return reply.send({ ok: true, level });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { tool?: unknown; on?: unknown } }>("/v1/connectors/:id/auto", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    const { tool, on } = req.body ?? {};
    if (typeof tool !== "string" || !tool || tool.length > 128 || typeof on !== "boolean") {
      return reply.code(400).send({ code: "bad_request", message: "tool is text and on is true or false" });
    }
    try {
      const cur = await c.store.getConnection(user.id, req.params.id);
      if (!cur?.tokensEnc) return reply.code(404).send({ code: "not_connected", message: "That app isn't connected." });
      const rest = cur.autoOk.filter((t) => t !== tool);
      if (on && rest.length >= AUTO_MAX) return reply.code(400).send({ code: "too_many", message: "That's more automatic tools than I can keep." });
      const autoOk = on ? [...rest, tool] : rest;
      await c.store.upsertConnection(user.id, req.params.id, { autoOk });
      return reply.send({ ok: true, auto: autoOk });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/connectors/:id", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    try {
      await c.store.deleteConnection(user.id, req.params.id);
      await c.hub.forget(user.id, req.params.id);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/tasks", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    try {
      return reply.send({ tasks: (await c.tasks.list(user.id)).map(taskOut) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { approvalId?: unknown } }>("/v1/tasks/:id/approve", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    try {
      const approvalId = typeof (req.body ?? {}).approvalId === "string" ? (req.body as { approvalId: string }).approvalId : undefined;
      const r = await c.tasks.approve(user.id, req.params.id, approvalId);
      if (r.status === "not_found") return reply.code(404).send({ code: "not_found", message: "No such task" });
      if (r.status === "not_waiting") return reply.code(409).send({ code: "not_waiting", message: "That isn't waiting for an answer any more." });
      if (r.status === "expired") return reply.code(410).send({ code: "expired", message: "That request expired. Ask me again.", task: taskOut(r.task!) });
      return reply.send({ ok: r.status === "ok", ...(r.result !== undefined ? { result: r.result } : {}), ...(r.error ? { error: r.error } : {}), task: taskOut(r.task!) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/tasks/:id/deny", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    try {
      const r = await c.tasks.deny(user.id, req.params.id);
      if (r.status === "not_found") return reply.code(404).send({ code: "not_found", message: "No such task" });
      if (r.status === "not_waiting") return reply.code(409).send({ code: "not_waiting", message: "That isn't waiting for an answer any more." });
      return reply.send({ ok: true, task: taskOut(r.task!) });
    } catch (err) { return fail(reply, err); }
  });
}
