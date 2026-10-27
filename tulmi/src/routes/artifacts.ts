/**
 * ARTIFACTS, OVER HTTP: THE APP'S DOOR TO THE ARTIFACT CORE (src/artifacts, docs/artifacts.md).
 *
 * An artifact is a live thing a bot makes (a page, a React component, SVG, a diagram, markdown) that the person sees and clicks in
 * the app, run by the viewer in a sandbox with no network. The viewer never holds a Tailzu token: the app, its parent, calls these
 * routes as the person and relays what the viewer needs (src/artifacts/protocol.ts). Every route authenticates like the rest of /v1
 * and is the OWNER's only, unless it says otherwise.
 *
 *   POST   /v1/artifacts { type, title?, content, projectId? }          -> 201 { artifact, version, content, paise, totalPaise, how }
 *   POST   /v1/artifacts { type?, title?, prompt, projectId? }          -> 201 the same, MADE from the words (the code tier, the strong
 *                                                                          tier when the classifier says the request is complex)
 *   GET    /v1/artifacts?projectId=                                     -> { artifacts }  newest change first
 *   GET    /v1/artifacts/:id?version=                                   -> { artifact, version, content, kit? }  the head, or an earlier version;
 *                                                                          kit is the project's look (protocol.ts DesignKitCss) for a project artifact
 *   GET    /v1/artifacts/:id/versions                                   -> { versions: [{ version, kind, madeBy, note, createdAt, storedBytes }] }
 *   POST   /v1/artifacts/:id/revert { version }                         -> { artifact, version, content, ... }  a NEW version with that one's text
 *   DELETE /v1/artifacts/:id                                            -> { ok }  with its versions and data
 *   POST   /v1/artifacts/:id/edit { instruction, elementId? }           -> { artifact, version, content, paise, totalPaise, how }  a person's edit:
 *                                                                          with an elementId (the viewer's data-tz-id) the model is sent only that
 *                                                                          element, on the cheap tier; without, exact replacements against the artifact
 *   POST   /v1/artifacts/:id/errors { version, kind, message, line?, col?, stack? }
 *                                                                       -> { status: fixed | duplicate | limit | stale | not_fixable | failed, ... }
 *                                                                          the viewer's error, for an automatic fix (deduped, two tries a version)
 *   POST   /v1/artifacts/:id/share { othersCanSave? }                   -> { token, path, othersCanSave }  a link anyone can read; idempotent
 *   DELETE /v1/artifacts/:id/share                                      -> { ok }  the link stops working
 *   GET    /v1/artifacts/shared/:token                                  -> PUBLIC, read only: { id, type, title, version, content, othersCanSave, kit? }
 *   GET    /v1/artifacts/:id/data?scope=shared|me                       -> { keys }
 *   GET    /v1/artifacts/:id/data/:key?scope=                           -> { found, value }
 *   PUT    /v1/artifacts/:id/data/:key?scope= { value }                 -> { ok }
 *   DELETE /v1/artifacts/:id/data/:key?scope=                           -> { ok, deleted }
 *                                                                          Saved data. scope "shared" is everyone's, "me" (the default) is the caller's
 *                                                                          own. The owner may do all of it. Someone with the share token (header
 *                                                                          x-artifact-share, or ?share=), signed in or not, may READ shared data, and
 *                                                                          may write only if the owner turned "others can save" on (anonymous: shared
 *                                                                          only). Values are 64 KB, 500 keys a scope; rate limited per person or link
 *   POST   /v1/artifacts/:id/ask { prompt, tier? }                      -> { text, paise, leftPaise }  the artifact asks the bot: metered against the
 *                                                                          CALLER (signed in; the owner or someone with the share token), the cheap
 *                                                                          tier unless tier is "code", at most 8,000 characters, rate limited
 *   POST   /v1/artifacts/:id/build { projectId, version?, budgetPaise? }
 *                                                                       -> 201 { job, branch, spec, located, kit }  "build it": a Code bot job whose
 *                                                                          spec is this version (the head if none is named)
 *   POST   /v1/code/projects/:id/artifacts/component { request, image? }
 *                                                                       -> 201 { artifact, version, content, type, located, kit, layout?, paise }  a
 *                                                                          component made in the project's style and shown in place; image is a
 *                                                                          sketch or a screenshot (a data: URL, png, jpeg, webp or gif)
 *
 * With ARTIFACTS off every route answers 404 { code: "artifacts_off" }, before the session. The project routes need the Code bot and the
 * project brain (404 code_off / brain_off; 409 brain_not_ready for a project whose brain was never built).
 *
 * What a mistake looks like: an artifact that is not the caller's is 404 (it does not say it exists), a bad body 400, a refusal (a secret, an
 * import that is not available, an edit that did not apply) 422 with the reason in words, a head that moved 409, too fast 429 with
 * retry-after, a model that cannot be reached 503. Every change says what it cost.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import type { AgentOrchestrator } from "../code/agent/orchestrator.js";
import type { Code } from "../code/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { ownProject, workspace, type ProjectDeps } from "../code/projects.js";
import type { Artifacts, Access } from "../artifacts/index.js";
import { buildFromArtifact, noCompare, type CompareHook } from "../artifacts/build.js";
import { componentArtifact, workspaceFiles } from "../artifacts/kit.js";
import { LIMITS } from "../artifacts/protocol.js";
import { ARTIFACT_TYPES, isArtifactError, type Artifact, type Change, type ArtifactType } from "../artifacts/types.js";
import { failCode } from "./code.js";

export interface ArtifactRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when ARTIFACTS is off. */
  artifacts: Artifacts | null;
  /** The Code bot and the agent, for the project routes and "build it". Null or absent: those answer 404 code_off. */
  code?: Code | null;
  jobs?: JobRouter | null;
  agent?: AgentOrchestrator | null;
  /** The screenshot compare step's seam (artifacts/build.ts); none until it is built. */
  compareHook?: CompareHook;
}

/** A create carries up to 512 KB of source (JSON-escaped); a component request may carry a picture. */
const CREATE_BODY_LIMIT = 2 * 1024 * 1024;
const IMAGE_BODY_LIMIT = 6 * 1024 * 1024;
const IMAGE_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});

/** An artifact as its owner sees it. */
export function ownerView(a: Artifact) {
  return {
    id: a.id, type: a.type, title: a.title, projectId: a.projectId, headVersion: a.headVersion, shared: a.shareToken !== null, shareToken: a.shareToken,
    othersCanSave: a.othersCanSave, spentPaise: a.spentPaise, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

export function registerArtifactRoutes(app: FastifyInstance, deps: ArtifactRoutesDeps): void {
  const svc = deps.artifacts?.service ?? null;
  const RL = { config: deps.rateLimit };
  /** The app's per-route limit, tightened for the routes a stranger's artifact can reach or that cost money. */
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "artifacts_off", message: "Artifacts are not switched on." });
  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

  const fail = (reply: FastifyReply, err: unknown) => {
    if (isArtifactError(err)) {
      const retry = err.detail?.retryAfterSec;
      if (typeof retry === "number") reply.header("retry-after", String(retry));
      return reply.code(err.status).send({ code: err.code, message: err.message, ...(err.detail?.errors ? { errors: err.detail.errors, warnings: err.detail.warnings } : {}) });
    }
    return failCode(reply, err);
  };

  /** The service, then the session. Null once the answer has been sent. */
  const begin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!svc) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { noSession(reply); return null; }
    return { svc, user };
  };

  /** For the doors a share link opens: the session if there is one, and the link's token if there is one. */
  const guest = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!svc) { off(reply); return null; }
    let userId: string | null = null;
    if (req.headers["authorization"]) {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) { noSession(reply); return null; }
      userId = user.id;
    }
    const h = req.headers["x-artifact-share"];
    const q = (req.query as { share?: unknown } | undefined)?.share;
    const token = typeof h === "string" && h ? h.slice(0, 200) : typeof q === "string" && q ? q.slice(0, 200) : null;
    return { svc, userId, token };
  };

  const scopeOf = (q: unknown): "shared" | "me" | null => {
    const s = (q as { scope?: unknown } | undefined)?.scope;
    return s === undefined || s === "me" ? "me" : s === "shared" ? "shared" : null;
  };

  /** A change as the app gets it: the new head with its text, so the viewer can load it at once, and what it cost. */
  const changed = async (c: Change) => ({
    artifact: ownerView(c.artifact), version: c.version, content: await svc!.contentOf(c.artifact.id, c.version), paise: c.paise, totalPaise: c.totalPaise, how: c.how,
  });

  // --- make, read, list

  app.post<{ Body: unknown }>("/v1/artifacts", { ...RL, bodyLimit: CREATE_BODY_LIMIT }, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    try {
      if (typeof b.prompt === "string" && b.content === undefined) {
        const type = b.type === undefined ? "html" : b.type;
        if (!ARTIFACT_TYPES.includes(type as ArtifactType)) return reply.code(400).send({ code: "bad_request", message: `type is one of ${ARTIFACT_TYPES.join(", ")}.` });
        const c = await s.svc.generate(s.user.id, {
          request: b.prompt, type: type as ArtifactType, ...(typeof b.title === "string" ? { title: b.title } : {}), ...(typeof b.projectId === "string" ? { projectId: b.projectId } : {}),
        });
        return reply.code(201).send({ ...(await changed(c)), classifiedAs: c.classifiedAs });
      }
      const c = await s.svc.create(s.user.id, { type: b.type, title: b.title, content: b.content, projectId: b.projectId, madeBy: "person" });
      return reply.code(201).send(await changed(c));
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Querystring: { projectId?: unknown } }>("/v1/artifacts", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const projectId = req.query?.projectId;
    if (projectId !== undefined && (typeof projectId !== "string" || !UUID.test(projectId))) return reply.code(400).send({ code: "bad_request", message: "projectId is a project's id." });
    try {
      return reply.send({ artifacts: (await s.svc.list(s.user.id, projectId ? { projectId } : {})).map(ownerView) });
    } catch (err) { return fail(reply, err); }
  });

  // The share link's public read. Registered before the :id routes; the static segment wins in the router anyway.
  app.get<{ Params: { token: string } }>("/v1/artifacts/shared/:token", tight(60), async (req, reply) => {
    if (!svc) return off(reply);
    try {
      svc.rate("data", `ip:${req.ip}`);
      const v = await svc.shared(req.params.token);
      return reply.header("cache-control", "private, no-store").header("referrer-policy", "no-referrer").send(v);
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string }; Querystring: { version?: unknown } }>("/v1/artifacts/:id", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const q = req.query?.version;
    let version: number | undefined;
    if (q !== undefined) {
      version = typeof q === "string" && /^\d{1,9}$/.test(q) ? Number(q) : NaN;
      if (!Number.isInteger(version)) return reply.code(400).send({ code: "bad_request", message: "version is a whole number." });
    }
    try {
      const v = await s.svc.get(s.user.id, req.params.id, version);
      return reply.send({ artifact: ownerView(v.artifact), version: v.version, content: v.content, ...(v.kit ? { kit: v.kit } : {}) });
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/artifacts/:id/versions", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      return reply.send({ versions: await s.svc.versions(s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/artifacts/:id/revert", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      return reply.send(await changed(await s.svc.revert(s.user.id, req.params.id, bodyOf(req.body).version)));
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/artifacts/:id", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      await s.svc.remove(s.user.id, req.params.id);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  // --- a person's edits, and the viewer's errors

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/artifacts/:id/edit", tight(30), async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    if (typeof b.instruction !== "string" || !b.instruction.trim()) return reply.code(400).send({ code: "bad_request", message: "instruction is what to change." });
    if (b.elementId !== undefined && typeof b.elementId !== "string") return reply.code(400).send({ code: "bad_request", message: 'elementId is the element\'s "line:column".' });
    const gone = new AbortController();
    reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
    try {
      const c = b.elementId
        ? await s.svc.editElement(s.user.id, req.params.id, b.elementId as string, b.instruction, gone.signal)
        : await s.svc.editWhole(s.user.id, req.params.id, b.instruction, gone.signal);
      return reply.send(await changed(c));
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/artifacts/:id/errors", tight(60), async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const kind = b.kind;
    if (typeof b.version !== "number" || !Number.isInteger(b.version) || typeof b.message !== "string" || !b.message
      || (kind !== "compile" && kind !== "runtime" && kind !== "import" && kind !== "limit")) {
      return reply.code(400).send({ code: "bad_request", message: "version, kind (compile, runtime, import or limit) and message are the viewer's error." });
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    try {
      const out = await s.svc.reportError(s.user.id, req.params.id, b.version, {
        kind, message: b.message.slice(0, 1000), ...(num(b.line) !== undefined ? { line: num(b.line)! } : {}), ...(num(b.col) !== undefined ? { col: num(b.col)! } : {}),
        ...(typeof b.stack === "string" ? { stack: b.stack.slice(0, 2000) } : {}),
      });
      if (out.status === "fixed") return reply.send({ status: "fixed", ...(await changed(out.change)) });
      return reply.send(out);
    } catch (err) { return fail(reply, err); }
  });

  // --- sharing

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/artifacts/:id/share", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const o = bodyOf(req.body).othersCanSave;
    if (o !== undefined && typeof o !== "boolean") return reply.code(400).send({ code: "bad_request", message: "othersCanSave is true or false." });
    try {
      const a = await s.svc.share(s.user.id, req.params.id, o === undefined ? {} : { othersCanSave: o });
      return reply.send({ token: a.shareToken, path: `/v1/artifacts/shared/${a.shareToken}`, othersCanSave: a.othersCanSave });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/artifacts/:id/share", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      await s.svc.unshare(s.user.id, req.params.id);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  // --- saved data (the owner, or someone with the share link) and ask

  const access = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const g = await guest(req, reply);
    if (!g) return null;
    const scope = scopeOf(req.query);
    if (!scope) { reply.code(400).send({ code: "bad_request", message: 'scope is "shared" or "me".' }); return null; }
    const acc: Access = await g.svc.access(req.params.id, { userId: g.userId, token: g.token });
    return { svc: g.svc, acc, scope, token: g.token };
  };

  app.get<{ Params: { id: string } }>("/v1/artifacts/:id/data", tight(120), async (req, reply) => {
    try {
      const a = await access(req, reply);
      if (!a) return reply;
      return reply.send({ keys: await a.svc.dataKeys(a.acc, a.scope, a.token) });
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string; key: string } }>("/v1/artifacts/:id/data/:key", tight(120), async (req, reply) => {
    try {
      const a = await access(req, reply);
      if (!a) return reply;
      const e = await a.svc.dataGet(a.acc, a.scope, req.params.key, a.token);
      return reply.send({ found: e !== null, value: e ? e.value : null });
    } catch (err) { return fail(reply, err); }
  });

  app.put<{ Params: { id: string; key: string }; Body: unknown }>("/v1/artifacts/:id/data/:key", tight(120), async (req, reply) => {
    try {
      const a = await access(req, reply);
      if (!a) return reply;
      const b = bodyOf(req.body);
      if (!("value" in b)) return reply.code(400).send({ code: "bad_request", message: "value is any JSON value." });
      await a.svc.dataPut(a.acc, a.scope, req.params.key, b.value, a.token);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string; key: string } }>("/v1/artifacts/:id/data/:key", tight(120), async (req, reply) => {
    try {
      const a = await access(req, reply);
      if (!a) return reply;
      return reply.send({ ok: true, deleted: await a.svc.dataDelete(a.acc, a.scope, req.params.key, a.token) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/artifacts/:id/ask", tight(30), async (req, reply) => {
    try {
      const g = await guest(req, reply);
      if (!g) return reply;
      const b = bodyOf(req.body);
      if (typeof b.prompt !== "string" || !b.prompt.trim()) return reply.code(400).send({ code: "bad_request", message: "prompt is what to ask." });
      if (b.prompt.length > LIMITS.askChars) return reply.code(413).send({ code: "too_large", message: `A question may be ${LIMITS.askChars} characters at most.` });
      if (b.tier !== undefined && b.tier !== "cheap" && b.tier !== "code") return reply.code(400).send({ code: "bad_request", message: 'tier is "cheap" or "code".' });
      const acc = await g.svc.access(req.params.id, { userId: g.userId, token: g.token });
      const gone = new AbortController();
      reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
      return reply.send(await g.svc.ask(acc, b.prompt, { ...(b.tier ? { tier: b.tier as "cheap" | "code" } : {}), signal: gone.signal }));
    } catch (err) { return fail(reply, err); }
  });

  // --- a project's artifacts, and "build it" (the Code bot)

  /** The Code bot and its brain, as the project routes need them. Null once the answer has been sent. */
  const codeReady = (reply: FastifyReply) => {
    const code = deps.code;
    if (!code) { reply.code(404).send({ code: "code_off", message: "The Code bot is not switched on." }); return null; }
    if (!code.github) { reply.code(503).send({ code: "not_configured", message: "GitHub isn't set up on this server yet." }); return null; }
    if (!code.brain) { reply.code(404).send({ code: "brain_off", message: "The project brain isn't switched on." }); return null; }
    const d: ProjectDeps = { store: code.store, github: code.github, approvals: code.approvals, oauth: code.oauth };
    return { code, brain: code.brain, d };
  };

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/projects/:id/artifacts/component", { ...tight(20), bodyLimit: IMAGE_BODY_LIMIT }, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const c = codeReady(reply);
    if (!c) return reply;
    const b = bodyOf(req.body);
    if (typeof b.request !== "string" || b.request.trim().length < 3 || b.request.length > 4000) {
      return reply.code(400).send({ code: "bad_request", message: "request is the component you want, 4,000 characters at most." });
    }
    if (b.image !== undefined && (typeof b.image !== "string" || b.image.length > 5_000_000 || !IMAGE_URL.test(b.image))) {
      return reply.code(400).send({ code: "bad_request", message: "image is a sketch or a screenshot as a data: URL (png, jpeg, webp or gif), up to about 3.5 MB." });
    }
    const gone = new AbortController();
    reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
    try {
      const project = await ownProject(c.d, s.user.id, req.params.id);
      const brain = await c.brain.open(s.user.id, project.id);
      if ((await brain.status()).status === "none") return reply.code(409).send({ code: "brain_not_ready", message: "Tailzu hasn't read this project yet. Start its brain first." });
      const ws = await workspace(c.d, s.user.id, project.id, project.defaultBranch);
      const files = workspaceFiles(ws);
      const r = await componentArtifact(
        { service: s.svc, kit: { store: s.svc.store, files, brain }, brain, call: c.brain.runtime.call, gateway: c.brain.runtime.gateway },
        { id: project.id, userId: s.user.id, name: project.fullName }, b.request, { ...(typeof b.image === "string" ? { image: b.image } : {}), signal: gone.signal },
      );
      const { change, ...rest } = r;
      return reply.code(201).send({ ...(await changed(change)), ...rest });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/artifacts/:id/build", tight(10), async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const c = codeReady(reply);
    if (!c) return reply;
    if (!deps.jobs) return reply.code(503).send({ code: "not_configured", message: "GitHub isn't set up on this server yet." });
    if (!deps.agent) return reply.code(404).send({ code: "agent_off", message: "The Code bot's agent is not switched on on this server." });
    const b = bodyOf(req.body);
    if (typeof b.projectId !== "string" || !UUID.test(b.projectId)) return reply.code(400).send({ code: "bad_request", message: "projectId is the project to build it into." });
    if (b.version !== undefined && (typeof b.version !== "number" || !Number.isInteger(b.version))) return reply.code(400).send({ code: "bad_request", message: "version is the version they approved." });
    if (b.budgetPaise !== undefined && typeof b.budgetPaise !== "number") return reply.code(400).send({ code: "bad_request", message: "budgetPaise is a whole number of paise." });
    try {
      const artifact = await s.svc.own(s.user.id, req.params.id);
      const project = await ownProject(c.d, s.user.id, b.projectId);
      const brain = await c.brain.open(s.user.id, project.id);
      if ((await brain.status()).status === "none") return reply.code(409).send({ code: "brain_not_ready", message: "Tailzu hasn't read this project yet. Start its brain first." });
      const ws = await workspace(c.d, s.user.id, project.id, project.defaultBranch);
      const built = await buildFromArtifact(
        {
          service: s.svc, projects: c.d, jobs: deps.jobs, agent: deps.agent, kit: { store: s.svc.store, files: workspaceFiles(ws), brain }, brain,
          compareHook: deps.compareHook ?? noCompare, call: c.brain.runtime.call, gateway: c.brain.runtime.gateway,
        },
        s.user.id, artifact.id, (b.version as number | undefined) ?? artifact.headVersion, project.id, { ...(typeof b.budgetPaise === "number" ? { budgetPaise: b.budgetPaise } : {}) },
      );
      const { job, ...rest } = built;
      return reply.code(201).send({ job: { id: job.id, state: job.state, branch: built.branch }, ...rest });
    } catch (err) { return fail(reply, err); }
  });
}
