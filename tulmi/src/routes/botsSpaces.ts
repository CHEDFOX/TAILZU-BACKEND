/**
 * Bots app · spaces: family and friends. Members and what each may do, invites by link or email, what's shared, payment requests, and
 * messaging (src/botsBots/{spaces,spacePerms,shared,payments,threads,mail}.ts; screens in experience/bots/screens/spaces.ts).
 * Registered by routes/botsBots.ts. Every route is the signed-in person's own; every permission is checked in src/botsBots, never here.
 *
 *   GET    /v1/botsapp/bots/spaces                      -> { spaces, you, unread }      each with `waiting` (payments waiting for your yes)
 *   POST   /v1/botsapp/bots/spaces { name }             -> 201 { id }
 *   GET    /v1/botsapp/bots/spaces/:id                  -> { space, items, payments, tasks, you, mailReady }   one whole (invites and activity as you may see them)
 *   PUT    /v1/botsapp/bots/spaces/:id { name }         rename;   DELETE leave (the admin: delete)
 *   POST   /v1/botsapp/bots/spaces/:id/invite { email?, role?, perms? }  -> { code, link, expiresAt, email, mail, mailReady }
 *   DELETE /v1/botsapp/bots/spaces/:id/invites/:code    take an invite back
 *   POST   /v1/botsapp/bots/spaces/join { code }        -> { id, name }   (an email invite: signed in with that email)
 *   PUT    /v1/botsapp/bots/spaces/:id/members/:member { role } | { perms } | { canApprove };  DELETE (remove)
 *   POST   /v1/botsapp/bots/spaces/:id/roles { name, perms };  PUT|DELETE .../roles/:role
 *   POST   /v1/botsapp/bots/spaces/:id/bots { slug };  DELETE .../bots/:slug
 *   GET    /v1/botsapp/bots/spaces/:id/activity
 *   GET    /v1/botsapp/bots/invite/:code                a small page: what the invite is for and how to use it (no session)
 *
 *   GET    /v1/botsapp/bots/share/targets               -> { spaces, people }   where something can be shared
 *   POST   /v1/botsapp/bots/shares { kind, ref?, title?, text?, url?, items?, note?, access, to: { space } | { person } }  -> 201 { item, threadId }
 *   GET    /v1/botsapp/bots/spaces/:id/items;  POST .../spaces/:id/lists { title }
 *   GET|PUT|DELETE /v1/botsapp/bots/items/:id           PUT { op: add|toggle|drop|clearDone|rename, text?, line?, title? }
 *   GET    /v1/botsapp/bots/items/:id/file?v=&exp=&sig= a shared file's bytes (a signed link; the viewer must still see it)
 *
 *   GET    /v1/botsapp/bots/spaces/:id/payments;  POST { amount, to, name?, note? }
 *   PUT    /v1/botsapp/bots/spaces/:id/payments/:pid { decision: approve|decline } | { paid: true };  DELETE (take back)
 *
 *   GET    /v1/botsapp/bots/tasks/given                 -> { tasks }   what's waiting for you, across your spaces ("Given to you")
 *   GET    /v1/botsapp/bots/spaces/:id/tasks;  POST { kind: task|plan, title, notes?, people, day?, time?, endTime?, place?, tz }
 *   PUT    /v1/botsapp/bots/spaces/:id/tasks/:tid { status: done|todo|cant, note? }   (yours);  DELETE (who set it, or the admin)
 *
 *   GET    /v1/botsapp/bots/threads                     -> { threads, unread }
 *   GET    /v1/botsapp/bots/threads/contacts            -> { people, groupSpaces }
 *   POST   /v1/botsapp/bots/threads/direct { person }   -> { id };   POST .../threads/group { space, name?, people: [ids] | "all" } -> { id }
 *   GET    /v1/botsapp/bots/threads/:id?before=&limit=  -> { thread, messages, more, before }   (the newest page marks it read)
 *   POST   /v1/botsapp/bots/threads/:id/messages { text?, files?: [fileId] }  -> 201 { message }
 *   PUT    /v1/botsapp/bots/threads/:id { muted };  DELETE (leave a group)
 *   GET    /v1/botsapp/bots/threads/:id/files/:mid/:fid?v=&exp=&sig=   a photo or file in a message (signed, as above)
 *
 * Email goes through the outbox (src/botsBots/mail.ts); with no provider plugged in it waits there and the screens say so.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { isBotError } from "../bots/index.js";
import { attachmentKindOf, type MediaService } from "../media/index.js";
import { startMailSender } from "../botsBots/mail.js";
import { Payments } from "../botsBots/payments.js";
import { SharedItems } from "../botsBots/shared.js";
import { verifyQuery } from "../botsBots/spaceLinks.js";
import type { Spaces } from "../botsBots/spaces.js";
import { SpaceTasks } from "../botsBots/spaceTasks.js";
import { Threads, type FileRef } from "../botsBots/threads.js";
import type { Trips } from "../botsBots/trips.js";
import { pushEngine } from "../push/index.js";
import { calendar } from "../calendar/index.js";
import type { BotsAreaDeps } from "./botsArea.js";
import { AREA, apiOrigin, shownName } from "./botsBots.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const queryOf = (req: FastifyRequest): Record<string, unknown> => (req.query as Record<string, unknown> | undefined) ?? {};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** Shown inline only when it can't run anything: pictures, PDFs, sound and video. Everything else is a download. */
const INLINE = /^(image\/(png|jpeg|webp|gif|heic|heif)|application\/pdf|audio\/[a-z0-9.+-]+|video\/(mp4|webm|quicktime))$/;

export interface SpaceParts { spaces: Spaces; threads: Threads; items: SharedItems; payments: Payments; tasks: SpaceTasks }

/** A push to someone's phones (push/defaults.ts space_*): never throws, and says nothing private. */
const push = async (userId: string, msg: { kind: "space_task" | "space_plan" | "space_message"; key: string; vars: Record<string, string>; data: Record<string, string> }) => {
  try { await pushEngine()?.notify(userId, msg); } catch { /* a missed push is not a lost task or message: both are in the app */ }
};

/** The parts, around one Spaces: chats, shared things and payments ask it who may do what. */
export function spaceParts(spaces: Spaces, o: { media?: MediaService | null; trips?: Trips | null; now?: () => number; origin?: string } = {}): SpaceParts {
  const media = o.media ?? null;
  // Full addresses: a picture is fetched by the app's image component, which knows no base.
  const origin = o.origin ?? apiOrigin();
  const now = o.now ?? Date.now;
  const fileOf = async (userId: string, id: string) => {
    const i = media ? await media.store.get(userId, id, { light: true }).catch(() => null) : null;
    if (!i) return null;
    // A file sent to someone, or shared, is kept past the usual thirty days.
    if (!i.keep) await media!.keep(userId, id, true).catch(() => undefined);
    return { id: i.id, name: i.name, mime: i.mime, bytes: i.bytes, kind: attachmentKindOf(i.kind) };
  };
  const threads = new Threads(spaces, now, { files: { get: fileOf }, notify: push, filePath: (t, m, f) => `${origin}${AREA}/threads/${t}/files/${m}/${f}` });
  const items = new SharedItems(spaces, threads, now, {
    file: fileOf,
    trip: o.trips ? async (userId, id) => { const t = await o.trips!.current(userId); return t && t.id === id ? t : null; } : undefined,
  }, { filePath: (id) => `${origin}${AREA}/items/${id}/file` });
  const tasks = new SpaceTasks(spaces, now, { notify: push });
  // Plans and tasks from other people land on the person's own calendar ("From Aanya"); their tick, or no, there is their answer here.
  calendar().onSpaceAnswer((userId, spaceId, taskId, status) => tasks.answer(userId, spaceId, taskId, { status }));
  return { spaces, threads, items, payments: new Payments(spaces, now), tasks };
}

export function registerSpacesRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { spaces: Spaces; trips?: Trips | null; parts?: SpaceParts }): SpaceParts {
  const p = o.parts ?? spaceParts(o.spaces, { media: deps.media, trips: o.trips ?? null });
  const { spaces, threads, items, payments, tasks } = p;
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const stopMail = startMailSender({ outbox: spaces.outbox, mailer: spaces.mailer, log: app.log });
  app.addHook("onClose", async () => { stopMail(); });

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.name }, "spaces: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };
  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) { return fail(req, reply, err); }
    };

  /** A shared file's bytes, from its owner's store. Anything that isn't exactly right is the same plain 404. */
  const serve = async (reply: FastifyReply, f: FileRef | null) => {
    const gone = () => reply.code(404).send({ code: "not_found", message: "That file isn't there any more." });
    if (!f || !deps.media) return gone();
    const item = await deps.media.store.get(f.owner, f.id, { light: true }).catch(() => null);
    const bytes = item ? await deps.media.bytesOf(item).catch(() => null) : null;
    if (!item || !bytes) return gone();
    const inline = INLINE.test(item.mime);
    return reply.header("content-type", inline ? item.mime : "application/octet-stream")
      .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(item.name.slice(0, 120))}`)
      .header("x-content-type-options", "nosniff").header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "private, max-age=600").send(bytes);
  };

  // ------------------------------------------------------------------ spaces

  app.get(`${AREA}/spaces`, RL, run(async (user) => {
    const list = await spaces.list(user.id);
    const withWaiting = await Promise.all(list.map(async (s) => ({ ...s, waiting: await payments.waitingFor(user.id, s.id).catch(() => 0) })));
    const unread = await threads.list(user.id).then((t) => t.unread, () => 0);
    return { spaces: withWaiting, you: shownName(user), unread };
  }));
  app.post(`${AREA}/spaces`, RL, run(async (user, req, reply) => { const r = await spaces.create(user.id, bodyOf(req.body).name, shownName(user)); reply.code(201); return r; }));
  app.get(`${AREA}/spaces/:id`, RL, run(async (user, req) => {
    const id = param(req, "id");
    const space = await spaces.detail(user.id, id);
    const [shared, pays, todo] = await Promise.all([items.list(user.id, id).catch(() => []), payments.list(user.id, id).catch(() => []), tasks.list(user.id, id).catch(() => [])]);
    return { space, items: shared, payments: pays, tasks: todo, you: shownName(user), mailReady: spaces.mailer.configured };
  }));
  app.put(`${AREA}/spaces/:id`, RL, run(async (user, req) => { await spaces.rename(user.id, param(req, "id"), bodyOf(req.body).name); return { ok: true }; }));
  app.delete(`${AREA}/spaces/:id`, RL, run(async (user, req) => spaces.leave(user.id, param(req, "id"))));
  app.post(`${AREA}/spaces/:id/invite`, tight(20), run(async (user, req) => {
    const b = bodyOf(req.body);
    return spaces.invite({ id: user.id }, param(req, "id"), { email: b.email, role: b.role, perms: b.perms });
  }));
  app.delete(`${AREA}/spaces/:id/invites/:code`, RL, run(async (user, req) => { await spaces.revokeInvite(user.id, param(req, "id"), param(req, "code")); return { ok: true }; }));
  app.post(`${AREA}/spaces/join`, tight(20), run(async (user, req) => spaces.join({ id: user.id, email: user.email ?? null }, bodyOf(req.body).code, shownName(user))));
  app.put(`${AREA}/spaces/:id/members/:member`, RL, run(async (user, req) => {
    const b = bodyOf(req.body);
    if (b.role === undefined && b.perms === undefined) { await spaces.setApprover(user.id, param(req, "id"), param(req, "member"), b.canApprove); return { ok: true }; }
    return spaces.setPerms(user.id, param(req, "id"), param(req, "member"), { role: b.role, perms: b.perms });
  }));
  app.delete(`${AREA}/spaces/:id/members/:member`, RL, run(async (user, req) => spaces.leave(user.id, param(req, "id"), param(req, "member"))));
  app.post(`${AREA}/spaces/:id/roles`, RL, run(async (user, req, reply) => { const b = bodyOf(req.body); reply.code(201); return { role: await spaces.saveRole(user.id, param(req, "id"), { name: b.name, perms: b.perms }) }; }));
  app.put(`${AREA}/spaces/:id/roles/:role`, RL, run(async (user, req) => { const b = bodyOf(req.body); return { role: await spaces.saveRole(user.id, param(req, "id"), { roleId: param(req, "role"), name: b.name, perms: b.perms }) }; }));
  app.delete(`${AREA}/spaces/:id/roles/:role`, RL, run(async (user, req) => { await spaces.dropRole(user.id, param(req, "id"), param(req, "role")); return { ok: true }; }));
  app.post(`${AREA}/spaces/:id/bots`, RL, run(async (user, req) => { await spaces.addBot(user.id, param(req, "id"), bodyOf(req.body).slug); return { ok: true }; }));
  app.delete(`${AREA}/spaces/:id/bots/:slug`, RL, run(async (user, req) => { await spaces.removeBot(user.id, param(req, "id"), param(req, "slug")); return { ok: true }; }));
  app.get(`${AREA}/spaces/:id/activity`, RL, run(async (user, req) => ({ activity: await spaces.activity(user.id, param(req, "id"), Number(queryOf(req).limit) || 50) })));

  app.get(`${AREA}/invite/:code`, tight(30), async (req, reply) => {
    const code = param(req, "code").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const s = await spaces.peek(code).catch(() => null);
    const line = s
      ? `You're invited to <b>${esc(s.name)}</b> on Tailzu (${s.members} ${s.members === 1 ? "person" : "people"} so far).`
      : "This invite doesn't work any more. Ask for a new one.";
    const who = s?.email ? `<p>It's for ${esc(s.email)}: sign in to Tailzu with that email to accept it.</p>` : "";
    const how = s ? `${who}<p>Open Tailzu, go to <b>You → Spaces</b>, tap <b>Join with a code</b> and enter:</p><p style="font:600 22px ui-monospace,monospace;letter-spacing:2px">${esc(code)}</p>` : "";
    return reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store")
      .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tailzu space invite</title><body style="font:16px system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 20px;color:#0a0a0a"><p>${line}</p>${how}</body>`);
  });

  // ------------------------------------------------------------------ sharing

  app.get(`${AREA}/share/targets`, RL, run(async (user) => {
    const [mine, c] = await Promise.all([spaces.mine(user.id), threads.contacts(user.id)]);
    return { spaces: mine.map((s) => ({ id: s.id, name: s.name, canShare: s.perms.includes("share") })), people: c.people };
  }));
  app.post(`${AREA}/shares`, tight(30), run(async (user, req, reply) => { const r = await items.share(user.id, shownName(user), bodyOf(req.body)); reply.code(201); return r; }));
  app.get(`${AREA}/spaces/:id/items`, RL, run(async (user, req) => ({ items: await items.list(user.id, param(req, "id")) })));
  app.post(`${AREA}/spaces/:id/lists`, RL, run(async (user, req, reply) => { reply.code(201); return { item: await items.newList(user.id, shownName(user), param(req, "id"), bodyOf(req.body).title) }; }));
  app.get(`${AREA}/items/:id`, RL, run(async (user, req) => ({ item: await items.get(user.id, param(req, "id")) })));
  app.put(`${AREA}/items/:id`, RL, run(async (user, req) => ({ item: await items.edit(user.id, param(req, "id"), bodyOf(req.body)) })));
  app.delete(`${AREA}/items/:id`, RL, run(async (user, req) => { await items.remove(user.id, param(req, "id")); return { ok: true }; }));
  app.get(`${AREA}/items/:id/file`, tight(120), async (req, reply) => {
    const q = queryOf(req), id = param(req, "id");
    const viewer = typeof q.v === "string" ? q.v : "";
    const f = viewer ? await items.fileOf(viewer, id).catch(() => null) : null;
    return serve(reply, f && verifyQuery(q, [id, f.id]) === viewer ? f : null);
  });

  // ------------------------------------------------------------------ payments

  app.get(`${AREA}/spaces/:id/payments`, RL, run(async (user, req) => ({ payments: await payments.list(user.id, param(req, "id"), Number(queryOf(req).limit) || 30) })));
  app.post(`${AREA}/spaces/:id/payments`, tight(30), run(async (user, req, reply) => { reply.code(201); return { payment: await payments.ask(user.id, param(req, "id"), bodyOf(req.body)) }; }));
  app.put(`${AREA}/spaces/:id/payments/:pid`, RL, run(async (user, req) => {
    const b = bodyOf(req.body);
    return { payment: b.paid === true ? await payments.paid(user.id, param(req, "id"), param(req, "pid")) : await payments.decide(user.id, param(req, "id"), param(req, "pid"), b.decision) };
  }));
  app.delete(`${AREA}/spaces/:id/payments/:pid`, RL, run(async (user, req) => { await payments.cancel(user.id, param(req, "id"), param(req, "pid")); return { ok: true }; }));

  // ------------------------------------------------------------------ tasks and plans for others

  app.get(`${AREA}/tasks/given`, RL, run(async (user) => ({ tasks: await tasks.givenTo(user.id) })));
  app.get(`${AREA}/spaces/:id/tasks`, RL, run(async (user, req) => ({ tasks: await tasks.list(user.id, param(req, "id")) })));
  app.post(`${AREA}/spaces/:id/tasks`, tight(40), run(async (user, req, reply) => { reply.code(201); return { task: await tasks.create(user.id, param(req, "id"), bodyOf(req.body)) }; }));
  app.put(`${AREA}/spaces/:id/tasks/:tid`, RL, run(async (user, req) => ({ task: await tasks.answer(user.id, param(req, "id"), param(req, "tid"), bodyOf(req.body)) })));
  app.delete(`${AREA}/spaces/:id/tasks/:tid`, RL, run(async (user, req) => { await tasks.remove(user.id, param(req, "id"), param(req, "tid")); return { ok: true }; }));

  // ------------------------------------------------------------------ messaging

  app.get(`${AREA}/threads`, RL, run(async (user) => threads.list(user.id)));
  app.get(`${AREA}/threads/contacts`, RL, run(async (user) => threads.contacts(user.id)));
  app.post(`${AREA}/threads/direct`, RL, run(async (user, req) => threads.direct(user.id, shownName(user), String(bodyOf(req.body).person ?? ""))));
  app.post(`${AREA}/threads/group`, RL, run(async (user, req) => {
    const b = bodyOf(req.body);
    return threads.group(user.id, String(b.space ?? ""), { name: b.name, people: b.people });
  }));
  app.get(`${AREA}/threads/:id`, RL, run(async (user, req) => {
    const q = queryOf(req);
    return threads.read(user.id, param(req, "id"), { before: q.before, limit: q.limit });
  }));
  app.post(`${AREA}/threads/:id/messages`, tight(90), run(async (user, req, reply) => {
    const b = bodyOf(req.body);
    const message = await threads.send(user.id, param(req, "id"), { text: b.text, files: b.files });
    reply.code(201);
    return { message };
  }));
  app.put(`${AREA}/threads/:id`, RL, run(async (user, req) => { await threads.mute(user.id, param(req, "id"), bodyOf(req.body).muted); return { ok: true }; }));
  app.delete(`${AREA}/threads/:id`, RL, run(async (user, req) => { await threads.leave(user.id, param(req, "id")); return { ok: true }; }));
  app.get(`${AREA}/threads/:id/files/:mid/:fid`, tight(240), async (req, reply) => {
    const q = queryOf(req), tid = param(req, "id"), mid = param(req, "mid"), fid = param(req, "fid");
    const viewer = verifyQuery(q, [tid, mid, fid]);
    const f = viewer ? await threads.fileOf(viewer, tid, mid, fid).catch(() => null) : null;
    return serve(reply, f);
  });

  return p;
}
