/**
 * MEDIA AND FILES OVER HTTP (src/media, docs/media.md): THE APP'S DOOR FOR A FILE TOO BIG FOR A MESSAGE.
 *
 * A message to POST /v1/ask can carry a small file in its body (the front door's 8 MB). A PDF of forty pages, a recording or a video is sent here
 * first, once; what comes back is an attachment ref (id, kind, mime, bytes, sha256, name) that goes in `attachments` of the ask WITHOUT its bytes.
 * The file is read once (by SHA-256, for this person); every later question about it finds the few chunks that answer it, and nothing is read again.
 *
 *   POST   /v1/files              multipart, one `file` part (50 MB at most; each kind has a lower cap)
 *                                 -> 201 { file, attachment, cached }   200 if the same bytes had been read before
 *   GET    /v1/files              -> { files }  the person's files, newest first
 *   GET    /v1/files/:id          -> { file }
 *   POST   /v1/files/:id/keep { keep }     -> { file }  keep it past thirty days, or let it go
 *   DELETE /v1/files/:id          -> { ok }  the file, its text and its bytes
 *   POST   /v1/files/:id/artifact { kind: "chart" | "table", table? }
 *                                 -> 201 { artifact, version, kind }  a chart or a table artifact from a spreadsheet's rows, by code (no model)
 *   POST   /v1/files/:id/asset { projectId, use, branch?, path?, format?, message?, approvalId? }
 *                                 -> 201 { path, format, bytes, commit, pr? }  "add this logo to the project": the picture made fit for its use
 *                                    and committed through the workspace. With no `branch`, a work branch is made and a draft pull request
 *                                    opened. A commit that needs the person's yes answers 202 { needsApproval, approvalId, ... }; send the same
 *                                    request again with that approvalId
 *
 * With MEDIA_INGEST off every route answers 404 { code: "media_off" }. A refusal is written for a person: 413 too big, 422 password-protected
 * or a bomb or a kind we do not read, 503 a reader that is not switched on. A file that is not the caller's is 404.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import type { Artifacts } from "../artifacts/index.js";
import { isArtifactError } from "../artifacts/types.js";
import type { Code } from "../code/index.js";
import { projectDepsOf } from "../code/jobs/index.js";
import { isNeedsApproval } from "../code/policy.js";
import { createWorkBranch, workspace } from "../code/projects.js";
import { defaultGuard, type Guard } from "../guard/index.js";
import { insertAsset, isAssetUse, ASSET_USES } from "../media/assets.js";
import { makeDataArtifact } from "../media/dataartifact.js";
import { CAP_MAX, attachmentKindOf, isMediaError, viewOf, type MediaItem, type MediaService } from "../media/index.js";
import { failCode } from "./code.js";
import { idempotencyHeader, planOf } from "./guarded.js";
import { createHash } from "node:crypto";

export interface FilesRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null while MEDIA_INGEST is off. */
  media: MediaService | null;
  artifacts?: Artifacts | null;
  code?: Code | null;
  guard?: Guard;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = {
  empty: 400, bad_request: 400, too_big: 413, unsupported: 422, password: 422, bomb: 422, corrupt: 422, too_long: 422, not_configured: 503, worker_down: 503, not_found: 404, failed: 502,
};

/** The ref the app puts in `attachments` of an ask. */
export const attachmentOf = (i: MediaItem) => ({ id: i.id, kind: attachmentKindOf(i.kind), mime: i.mime, bytes: i.bytes, sha256: i.sha256, name: i.name });

export function registerFilesRoutes(app: FastifyInstance, deps: FilesRoutesDeps): void {
  const media = deps.media;
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "media_off", message: "Reading files is not switched on." });

  const fail = (reply: FastifyReply, err: unknown) => {
    if (isMediaError(err)) return reply.code(STATUS[err.code] ?? err.status).send({ code: err.code, message: err.message });
    if (isArtifactError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    return failCode(reply, err);
  };

  const begin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!media) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return { media, user };
  };

  const itemOf = async (m: MediaService, userId: string, id: string, reply: FastifyReply, light = true): Promise<MediaItem | null> => {
    const i = UUID.test(id) ? await m.store.get(userId, id, { light }) : null;
    if (!i) { reply.code(404).send({ code: "not_found", message: "I couldn't find that file." }); return null; }
    return i;
  };

  // --- in

  app.post("/v1/files", { ...tight(30) }, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    let part: { filename: string; toBuffer(): Promise<Buffer> } | undefined;
    try {
      part = await (req as unknown as { file(o?: unknown): Promise<{ filename: string; toBuffer(): Promise<Buffer> } | undefined> }).file({ limits: { fileSize: CAP_MAX, files: 1 } });
    } catch {
      part = undefined;
    }
    if (!part) return reply.code(400).send({ code: "no_file", message: "Send the file as a multipart form with one `file` part." });
    let data: Buffer;
    try {
      data = await part.toBuffer();
    } catch {
      return reply.code(413).send({ code: "too_big", message: `That file is over ${Math.round(CAP_MAX / 1024 / 1024)} MB, which is the most I take.` });
    }
    const name = part.filename || "file";
    const gone = new AbortController();
    reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
    try {
      const guard = deps.guard ?? defaultGuard();
      // The key is the bytes: two different files are two runs, the same file twice (a double tap) is one.
      const out = await guard.run({
        userId: s.user.id, plan: await planOf(s.user), route: "POST /v1/files", lane: "ask", header: idempotencyHeader(req), signal: gone.signal,
        body: { sha: createHash("sha256").update(data).digest("hex"), name },
        keep: (r: { status: number }) => r.status < 400,
        // A repeat after the first finished is a new request: the file may have been deleted since, and the answer is not the same then.
        replayUnkeyed: false,
      }, async () => {
        const r = await s.media.ingest(s.user.id, { name, data });
        return { status: r.cached ? 200 : 201, body: { file: viewOf(r.item), attachment: attachmentOf(r.item), cached: r.cached } };
      });
      if (out.replay) reply.header("idempotent-replayed", "true");
      return reply.code(out.result.status).send(out.result.body);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError" && gone.signal.aborted) return reply;
      return fail(reply, err);
    }
  });

  // --- read, keep, delete

  app.get("/v1/files", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send({ files: (await s.media.store.list(s.user.id, 50)).map(viewOf) }); } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/files/:id", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      const i = await itemOf(s.media, s.user.id, req.params.id, reply);
      return i ? reply.send({ file: viewOf(i), attachment: attachmentOf(i) }) : reply;
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { keep?: unknown } }>("/v1/files/:id/keep", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    if (typeof req.body?.keep !== "boolean") return reply.code(400).send({ code: "bad_request", message: "keep is true or false." });
    try {
      if (!UUID.test(req.params.id)) return reply.code(404).send({ code: "not_found", message: "I couldn't find that file." });
      const i = await s.media.keep(s.user.id, req.params.id, req.body.keep);
      return i ? reply.send({ file: viewOf(i) }) : reply.code(404).send({ code: "not_found", message: "I couldn't find that file." });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/files/:id", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      const ok = UUID.test(req.params.id) && (await s.media.remove(s.user.id, req.params.id));
      return ok ? reply.send({ ok: true }) : reply.code(404).send({ code: "not_found", message: "I couldn't find that file." });
    } catch (err) { return fail(reply, err); }
  });

  // --- a spreadsheet as a chart or a table

  app.post<{ Params: { id: string }; Body: { kind?: unknown; table?: unknown; projectId?: unknown } }>("/v1/files/:id/artifact", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const svc = deps.artifacts?.service;
    if (!svc) return reply.code(404).send({ code: "artifacts_off", message: "Artifacts are not switched on." });
    const kind = req.body?.kind;
    if (kind !== "chart" && kind !== "table") return reply.code(400).send({ code: "bad_request", message: "kind is chart or table." });
    const at = req.body?.table === undefined ? 0 : Number(req.body.table);
    if (!Number.isInteger(at) || at < 0) return reply.code(400).send({ code: "bad_request", message: "table is the number of the sheet, from 0." });
    const projectId = req.body?.projectId;
    if (projectId !== undefined && (typeof projectId !== "string" || !UUID.test(projectId))) return reply.code(400).send({ code: "bad_request", message: "projectId is a project's id." });
    try {
      const i = await itemOf(s.media, s.user.id, req.params.id, reply);
      if (!i) return reply;
      const t = i.meta.tables?.[at];
      if (!t) return reply.code(422).send({ code: "no_table", message: "That file has no table in it to draw." });
      if (kind === "chart" && !t.numeric.length) return reply.code(422).send({ code: "no_numbers", message: "That table has no column of numbers to draw a chart of." });
      const r = await makeDataArtifact(svc, s.user.id, t, kind, { fileName: i.name, ...(projectId ? { projectId } : {}) });
      return reply.code(201).send({ artifact: { id: r.change.artifact.id, type: r.change.artifact.type, title: r.change.artifact.title }, version: r.change.version, kind });
    } catch (err) { return fail(reply, err); }
  });

  // --- "add this logo to the project"

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>("/v1/files/:id/asset", { ...tight(20) }, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (typeof b.projectId !== "string" || !UUID.test(b.projectId)) return reply.code(400).send({ code: "bad_request", message: "projectId is a project's id." });
    if (!isAssetUse(b.use)) return reply.code(400).send({ code: "bad_request", message: `use is one of ${Object.keys(ASSET_USES).join(", ")}.` });
    if (b.format !== undefined && b.format !== "webp" && b.format !== "png") return reply.code(400).send({ code: "bad_request", message: "format is webp or png." });
    for (const k of ["branch", "path", "message", "approvalId"] as const) {
      if (b[k] !== undefined && (typeof b[k] !== "string" || !(b[k] as string) || (b[k] as string).length > 500)) return reply.code(400).send({ code: "bad_request", message: `${k} is text, up to 500 characters.` });
    }
    const code = deps.code;
    if (!code) return reply.code(404).send({ code: "code_off", message: "The Code bot is not switched on." });
    const pd = projectDepsOf(code);
    if (!pd) return reply.code(503).send({ code: "not_configured", message: "GitHub isn't set up on this server yet." });
    try {
      const i = await itemOf(s.media, s.user.id, req.params.id, reply);
      if (!i) return reply;
      const bytes = await s.media.bytesOf(i);
      if (!bytes) return reply.code(409).send({ code: "no_bytes", message: "I don't keep that picture's bytes, so I can't add it. Send it again." });
      const made = typeof b.branch !== "string";
      const branch = typeof b.branch === "string" ? b.branch : (await createWorkBranch(pd, s.user.id, b.projectId, `Add ${b.use}: ${i.name}`)).branch;
      const ws = await workspace(pd, s.user.id, b.projectId, branch);
      const out = await insertAsset({ worker: s.media.worker }, ws, {
        data: bytes, name: i.name, use: b.use, ...(typeof b.path === "string" ? { path: b.path } : {}), ...(b.format ? { format: b.format as "webp" | "png" } : {}),
        ...(typeof b.message === "string" ? { message: b.message } : {}), ...(typeof b.approvalId === "string" ? { approvalId: b.approvalId } : {}),
      });
      if (!out.ok) return reply.code(422).send({ code: "not_added", message: out.why });
      if (isNeedsApproval(out.commit)) return reply.code(202).send({ ...out.commit, branch, path: out.path, notes: out.notes });
      let pr: { number: number; url: string } | undefined;
      if (made) {
        const opened = await ws.openDraftPr(`Add ${b.use}: ${i.name}`.slice(0, 100), `Adds \`${out.path}\` (${out.format}, ${Math.round(out.bytes / 1024)} KB), made fit for use as a ${b.use}.`);
        pr = { number: opened.prNumber, url: opened.prUrl };
      }
      return reply.code(201).send({ path: out.path, format: out.format, bytes: out.bytes, ...(out.width ? { width: out.width, height: out.height } : {}), branch, commit: out.commit, notes: out.notes, ...(pr ? { pr } : {}) });
    } catch (err) { return fail(reply, err); }
  });
}
