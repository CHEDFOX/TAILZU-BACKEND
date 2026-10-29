/**
 * APPS A PERSON ADDS THEMSELVES, BY LINK, over HTTP.
 *
 *   POST   /v1/connectors/custom            { name, url, clientId?, clientSecret?, from? }
 *            -> { id, authorizeUrl, signInHost }  its server asked for a sign-in (a 401): open the page,
 *                                                 and say "You'll sign in at {signInHost}" before it opens
 *            -> { id, connected: true }           it needs no sign-in, and its tools listed
 *            -> { refused: { code, message } }    it was not added, and why (still a 200: see below)
 *   DELETE /v1/connectors/custom/:id        removes it, with its connection, pins and tool settings
 *   GET    /v1/connectors/:id/tools         every tool, with its risk, its policy and whether it changed
 *                                           (any connected app; an added one also gets `version`)
 *   POST   /v1/connectors/:id/tools/policy  { tool, policy: allow | ask | off }; a delete or a payment: ask or off
 *   POST   /v1/connectors/:id/tools/accept  { version? } the person looked at the changed tools: let them back in
 *   GET    /v1/connectors/directory?q=&cursor=  More apps: our own apps that match, then the MCP Registry's
 *            -> { apps: DirectoryApp[], count, q, nextCursor? }   (registry.ts; 20 a page). Adding one is the
 *                                                 POST above with `from` = its registry name and its own url
 *
 * Adding one is refused, in plain words, before anything is kept. The refusal
 * is answered 200 { refused: { code, message } }, not as an HTTP error: the
 * phone and the desk run a call's onError with nothing from the answer, so
 * only a 2xx lets the screen say the server's reason (afterAdd in
 * experience/assistant.ts, addByLink in experience/desk.ts). The codes:
 *   - custom_off: apps added by link are switched off (CUSTOM_CONNECTORS);
 *   - too_many_tries: this person tried ten times in the last hour (every try
 *     costs a request to a stranger's server, from ours);
 *   - bad_request: a field is wrong, or `from` names no directory entry, or
 *     one at another address (what an app records it was added from has to be true);
 *   - bad_address, with `reason`: the address is not public https on 443 or
 *     8443 (egress.ts checkPublicUrl);
 *   - key_in_link: the address carries a key or password in its query
 *     (credentialParam below);
 *   - already_added (with the `id` it has) or too_many: they already have
 *     this one, or CUSTOM_CONNECTORS_MAX apps;
 *   - not_mcp: the server answers neither 401 nor 2xx to an MCP initialize;
 *   - vendor_sign_in, unsupported, blocked_address and the rest of oauth.ts's:
 *     its sign-in fails the strict checks, including sending them to sign in
 *     at one of the catalog's vendors from another site;
 *   - unreachable, timeout or failed: it needs no sign-in but its tools cannot
 *     be listed, or it could not be reached at all.
 * Only no session (401), connected apps switched off altogether (404) and an
 * error nobody put into words (500) are HTTP errors.
 * A refusal after the row was made takes the row away again: nothing
 * half-added is kept. Where the sign-in sends the person is kept with the app
 * (signInHost), so a screen can say it before the browser opens, now and on
 * every later Connect (routes/connectors.ts refuses one that moved).
 *
 * Switched off and on for everyone by CUSTOM_CONNECTORS for now; if it becomes
 * a paid-plan perk, `mayAdd` below is the one place to ask the plan.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import type { ConnectorDef } from "../connectors/catalog.js";
import { authlessMark, probeMcp } from "../connectors/client.js";
import { encrypt, NoTokenKey } from "../connectors/crypto.js";
import { checkPublicUrl, EgressRefused } from "../connectors/egress.js";
import { stripInvisible } from "../connectors/hygiene.js";
import type { Connectors } from "../connectors/index.js";
import { toolOf } from "../connectors/list.js";
import { beginOAuth, ConnectorError } from "../connectors/oauth.js";
import { REGISTRY_NAME, searchDirectory } from "../connectors/registry.js";
import { POLICIES, policiesFor, type Policy } from "../connectors/risk.js";
import { ConnectorsNeedAccount, type Connection } from "../connectors/store.js";

export interface CustomRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when CONNECTORS is off. */
  connectors: Connectors | null;
  now?: () => number;
}

/** Tries at adding an app, per person, per hour. */
export const ADDS_PER_HOUR = 10;
const HOUR_MS = 60 * 60_000;
const NAME_MAX = 40;
const CLIENT_MAX = 512;
/** The most a search may be, before it is cleaned (registry.ts searchTerm). */
const QUERY_MAX = 100;

/**
 * A query parameter named like a credential (token, key, api_key, apiKey,
 * access_token, client_secret, password, auth, sig...), compared with its
 * punctuation and case taken out.
 */
const CREDENTIAL_PARAM = /(token|key|secret|password|passwd|pwd|auth|authorization|credentials?|signature|sig)$/;

/**
 * The name of a parameter in this address that looks like it carries a
 * credential, if any. An app's address is kept as it was pasted, in the
 * clear, and sent on every request; a key in it would sit unencrypted in the
 * table and its backups, go out in every query string (the MCP spec keeps
 * tokens out of those), and travel to the auth server as the sign-in's
 * `resource`. So an address with one is not added at all.
 */
export function credentialParam(url: URL): string | undefined {
  for (const name of url.searchParams.keys()) {
    if (CREDENTIAL_PARAM.test(name.toLowerCase().replace(/[^a-z]/g, ""))) return name;
  }
  return undefined;
}

/** Failures already in plain words. */
const known = (err: unknown): boolean =>
  err instanceof ConnectorError || err instanceof EgressRefused || err instanceof NoTokenKey || err instanceof ConnectorsNeedAccount;

/**
 * A stranger's server can fail a sign-in in ways nobody listed (the SDK's own
 * errors: a client tied to another auth server, a registration it refused, a
 * document it could not read). Those become `message`, instead of a 500.
 */
export function plainSignInError(err: unknown, message: string): unknown {
  return known(err) ? err : new ConnectorError("failed", message);
}

/** A no, in words a person can be shown: `code` to switch on, `message` to say. */
interface Refusal { code: string; message: string; [more: string]: unknown }

interface AddBody { name: string; url: unknown; clientId?: string; clientSecret?: string; from?: string }

/** The request's fields, cleaned, or the words saying what is wrong. */
function readAdd(body: unknown): AddBody | string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? stripInvisible(v).replace(/\s+/g, " ").trim() : undefined);
  const name = text(b.name);
  if (!name || name.length > NAME_MAX) return `Give it a name, up to ${NAME_MAX} letters.`;
  const out: AddBody = { name, url: b.url };
  for (const k of ["clientId", "clientSecret"] as const) {
    if (b[k] === undefined || b[k] === null || b[k] === "") continue;
    const v = text(b[k]);
    if (!v || v.length > CLIENT_MAX || /\s/.test(v)) return k === "clientId" ? "That client ID doesn't look right." : "That client secret doesn't look right.";
    out[k] = v;
  }
  if (out.clientSecret && !out.clientId) return "A client secret needs its client ID too.";
  if (b.from !== undefined && b.from !== null && b.from !== "") {
    if (typeof b.from !== "string" || !REGISTRY_NAME.test(b.from)) return "That directory entry isn't one I know.";
    out.from = b.from;
  }
  return out;
}

export function registerCustomConnectorRoutes(app: FastifyInstance, deps: CustomRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const c = deps.connectors;
  const now = deps.now ?? Date.now;
  /** userId -> when they tried adding an app, within the last hour. In memory: a restart forgives. */
  const tries = new Map<string, number[]>();

  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "connectors_off", message: "Connected apps are not switched on." });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ code: "not_found", message: "No such app" });
  /** A failure already in plain words, as the status and body it is answered with; undefined for any other. */
  const failure = (err: unknown): { status: number; body: Refusal } | undefined => {
    if (err instanceof ConnectorsNeedAccount) return { status: 403, body: { code: "needs_account", message: err.message } };
    if (err instanceof NoTokenKey) return { status: 503, body: { code: "not_configured", message: err.message } };
    if (err instanceof EgressRefused) return { status: 400, body: { code: "bad_address", reason: err.reason, message: err.message } };
    if (err instanceof ConnectorError) {
      const status = err.code === "not_configured" ? 503 : err.code === "unreachable" || err.code === "timeout" ? 502 : 400;
      return { status, body: { code: err.code, message: err.message } };
    }
    return undefined;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    const f = failure(err);
    if (!f) throw err;
    return reply.code(f.status).send(f.body);
  };
  /** Adding says no with a 200 and the reason: the screens can only read an answer that came with one. */
  const refuse = (reply: FastifyReply, body: Refusal) => reply.send({ refused: body });

  /** Whether this person may try adding an app now, counting this try. */
  const mayAdd = (userId: string): boolean => {
    const t = now();
    const recent = (tries.get(userId) ?? []).filter((at) => t - at < HOUR_MS);
    const ok = recent.length < ADDS_PER_HOUR;
    if (ok) recent.push(t);
    tries.delete(userId);
    tries.set(userId, recent);
    if (tries.size > 10_000) tries.delete(tries.keys().next().value!);
    return ok;
  };

  app.post<{ Body: Record<string, unknown> }>("/v1/connectors/custom", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    if (!c.custom.enabled) return refuse(reply, { code: "custom_off", message: "Adding your own apps isn't switched on." });
    if (!mayAdd(user.id)) return refuse(reply, { code: "too_many_tries", message: "That's a lot of tries in an hour. Try again a bit later." });
    const body = readAdd(req.body);
    if (typeof body === "string") return refuse(reply, { code: "bad_request", message: body });
    try {
      const url = await checkPublicUrl(body.url);
      if (credentialParam(url)) {
        return refuse(reply, { code: "key_in_link", message: "That link has a key or password in it, and X0 Bot doesn't keep those in a link, so I didn't add it. Try the app's address without it." });
      }
      if (body.from) {
        const entry = await c.directory.getDirectory(body.from);
        if (!entry || entry.url !== url.href) return refuse(reply, { code: "bad_request", message: "That directory entry isn't one I know." });
      }
      const own = await c.store.listCustom(user.id);
      const same = own.find((o) => o.url === url.href);
      if (same) return refuse(reply, { code: "already_added", message: `You've already added that app, as ${same.name}.`, id: same.id });
      if (own.length >= c.custom.max) {
        return refuse(reply, { code: "too_many", message: `You can add up to ${c.custom.max} apps of your own. Remove one to add another.` });
      }
      const auth = await probeMcp(url, body.name);
      const row = await c.store.createCustom(user.id, {
        name: body.name, url: url.href, auth, registryName: body.from,
        ...(body.clientId ? { clientId: body.clientId } : {}),
        ...(body.clientSecret ? { clientSecretEnc: encrypt(body.clientSecret) } : {}),
      });
      c.hub.forgetCustom(user.id);
      try {
        const def = (await c.hub.resolve(user.id, row.id))!;
        if (auth === "none") {
          await c.store.upsertConnection(user.id, row.id, { tokensEnc: authlessMark() });
          // Proves it is an MCP app, and pins the tools it has now: what the person added.
          await c.hub.tools(user.id, row.id);
          return reply.send({ id: row.id, connected: true });
        }
        const authorizeUrl = await beginOAuth({ store: c.store, redirectUrl: c.redirectUrl, ...c.signIn }, user.id, def);
        const signInHost = new URL(authorizeUrl).host;
        await c.store.setCustomSignInHost(user.id, row.id, signInHost);
        c.hub.forgetCustom(user.id);
        return reply.send({ id: row.id, authorizeUrl, signInHost });
      } catch (err) {
        await c.store.deleteCustom(user.id, row.id).catch(() => {});
        await c.hub.forget(user.id, row.id);
        c.hub.forgetCustom(user.id);
        if (!known(err)) req.log.warn({ error: (err as Error)?.name }, "custom connector sign-in failed");
        throw plainSignInError(err, `${body.name}'s sign-in didn't work, so I didn't add it.`);
      }
    } catch (err) {
      const f = failure(err);
      if (!f) throw err;
      return refuse(reply, f.body);
    }
  });

  app.delete<{ Params: { id: string } }>("/v1/connectors/custom/:id", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    try {
      // Removing works with the switch off too: what a person added is theirs to take away.
      if (!(await c.store.getCustom(user.id, req.params.id))) return notFound(reply);
      await c.store.deleteCustom(user.id, req.params.id);
      await c.hub.forget(user.id, req.params.id);
      c.hub.forgetCustom(user.id);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  /** The app and its connection, when this person has it connected; otherwise the reply is sent. */
  const connected = async (reply: FastifyReply, userId: string, id: string): Promise<{ def: ConnectorDef; conn: Connection } | null> => {
    const def = await c!.hub.resolve(userId, id);
    if (!def || def.hidden) { notFound(reply); return null; }
    const conn = await c!.store.getConnection(userId, def.id);
    if (!conn?.tokensEnc) { reply.code(404).send({ code: "not_connected", message: `${def.name} isn't connected.` }); return null; }
    return { def, conn };
  };
  const notCustom = (reply: FastifyReply) =>
    reply.code(404).send({ code: "not_custom", message: "Tool by tool settings are for apps you added. Set how far this app can go instead." });

  app.get<{ Params: { id: string } }>("/v1/connectors/:id/tools", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    try {
      const found = await connected(reply, user.id, req.params.id);
      if (!found) return reply;
      const sheet = await c.hub.toolSheet(user.id, found.def, { fresh: true });
      const conn = sheet.conn ?? found.conn;
      const tools = sheet.tools.map((t) => toolOf(c, found.def, t, conn));
      return reply.send({ tools, ...(sheet.version ? { version: sheet.version } : {}) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { tool?: unknown; policy?: unknown } }>("/v1/connectors/:id/tools/policy", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    const { tool, policy } = req.body ?? {};
    if (typeof tool !== "string" || !tool || tool.length > 128 || !POLICIES.includes(policy as Policy)) {
      return reply.code(400).send({ code: "bad_request", message: "tool is a tool's name and policy is allow, ask or off" });
    }
    try {
      const found = await connected(reply, user.id, req.params.id);
      if (!found) return reply;
      if (!found.def.custom) return notCustom(reply);
      const sheet = await c.hub.toolSheet(user.id, found.def);
      const info = sheet.tools.find((t) => t.name === tool);
      if (!info) return reply.code(404).send({ code: "unknown_tool", message: `${found.def.name} doesn't have that tool any more.` });
      if (!policiesFor(c.hub.toolRisk(found.def, info)).includes(policy as Policy)) {
        return reply.code(400).send({ code: "always_asks", message: "Anything that deletes or pays always asks you first. It can be Ask or Off." });
      }
      const toolPolicy = { ...(sheet.conn ?? found.conn).toolPolicy, [tool]: policy as Policy };
      await c.store.upsertConnection(user.id, found.def.id, { toolPolicy });
      return reply.send({ ok: true, tool, policy });
    } catch (err) { return fail(reply, err); }
  });

  // More apps. Read with the switch on only: it is the way in to adding one.
  app.get<{ Querystring: { q?: unknown; cursor?: unknown } }>("/v1/connectors/directory", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    if (!c.custom.enabled) return reply.code(404).send({ code: "custom_off", message: "Adding your own apps isn't switched on." });
    const { q, cursor } = req.query ?? {};
    if ((q !== undefined && (typeof q !== "string" || q.length > QUERY_MAX)) || (cursor !== undefined && typeof cursor !== "string")) {
      return reply.code(400).send({ code: "bad_request", message: `q is up to ${QUERY_MAX} letters, and cursor is the one a page gave` });
    }
    try {
      return reply.send(await searchDirectory(c.directory, q ?? "", { catalog: c.hub.catalog, cursor }));
    } catch (err) {
      req.log.warn({ error: (err as Error)?.message }, "mcp directory search failed");
      return reply.code(503).send({ code: "directory_unavailable", message: "I couldn't search for apps just now. Try again in a bit." });
    }
  });

  app.post<{ Params: { id: string }; Body: { version?: unknown } }>("/v1/connectors/:id/tools/accept", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    if (!c) return off(reply);
    const version = (req.body ?? {}).version;
    if (version !== undefined && (typeof version !== "string" || version.length > 128)) {
      return reply.code(400).send({ code: "bad_request", message: "version is the one the tool list came with" });
    }
    try {
      const found = await connected(reply, user.id, req.params.id);
      if (!found) return reply;
      if (!found.def.custom) return notCustom(reply);
      if (!(await c.hub.acceptTools(user.id, found.def, version as string | undefined))) {
        return reply.code(409).send({ code: "changed_again", message: "Its tools changed again while you were looking. Have another look." });
      }
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });
}
