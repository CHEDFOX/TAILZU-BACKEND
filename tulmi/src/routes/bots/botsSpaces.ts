/**
 * Bots app · spaces: family and friends. Members, the admin's invites and the space's code, join requests, the feed (a message to
 * everyone or to one person, a thing shared from a bot), what's shared, payment requests, and messaging
 * (src/botsBots/{spaces,spaceJoin,spaceFeed,grants,spacePerms,shared,payments,threads,mail}.ts; docs/spaces.md; screens in
 * experience/bots/screens/spaces.ts). Registered by routes/bots/botsBots.ts, as is Work in space (routes/bots/work.ts). Every route is
 * the signed-in person's own; every permission is checked in src/botsBots, never here.
 *
 *   GET    /v1/botsapp/bots/spaces                      -> { spaces, you, unread }      each with `waiting` (payments waiting for your yes).
 *                                                        Home and both apps read it at every launch: it only reads, as it always did
 *   GET    /v1/botsapp/bots/spaces?full=1               the same, each space also with `invited`, `last` and `unread`, and the person's
 *                                                        `invitations`, `requests` (theirs to decide), `asked` and `draft` (the new Spaces screen)
 *   GET    /v1/botsapp/bots/spaces?last=1               the same as without, each space also with `last` and `unread` (Home's Space card);
 *                                                        it only reads
 *   POST   /v1/botsapp/bots/spaces { name }             -> 201 { id }   a real, named space (an old build's Start a space)
 *   POST   /v1/botsapp/bots/spaces/draft { name? }      -> 201 { draft }   Create: the draft nobody else sees, made if none (a name names it)
 *   POST   /v1/botsapp/bots/spaces/draft/invite { email }  -> 201 { draft }   Call Your People: an invite mailed at once
 *   POST   /v1/botsapp/bots/spaces/draft/done { name? } -> { id, name }   Done: the draft is a real space
 *   DELETE /v1/botsapp/bots/spaces/draft                Back: the draft goes, with its invites and any mail not yet sent
 *   PUT    /v1/botsapp/bots/spaces/invitations/:code { decision: accept|dismiss, consent?, consentV? }  -> JoinResult
 *   POST   /v1/botsapp/bots/spaces/join { code, consent?, consentV? }  -> JoinResult: joined (the invited address), member, or requested
 *   GET    /v1/botsapp/bots/spaces/join/:code           -> { invite: { name, members } | null }   what an email invite's code is for,
 *                                                        before joining (a space's own code: always null, so codes can't be guessed for names)
 *   GET    /v1/botsapp/bots/spaces/:id                  -> { space, items, payments, tasks, you, mailReady }   one whole (its code for the admin)
 *   PUT    /v1/botsapp/bots/spaces/:id { name }         rename (the admin);   DELETE leave (the admin: delete)
 *   POST   /v1/botsapp/bots/spaces/:id/code             -> { code }   the admin makes a new code; the old one stops working
 *   POST   /v1/botsapp/bots/spaces/:id/invite { email? } -> { code, link, expiresAt, email, mail, mailReady }   the admin (an old build's
 *                                                        invite: without an email, the space's own code and its link)
 *   DELETE /v1/botsapp/bots/spaces/:id/invites/:code    take an invite back (the admin)
 *   PUT    /v1/botsapp/bots/spaces/:id/requests/:rid { decision: accept|dismiss }  -> { status, name }   the admin lets someone in, or not
 *   PUT    /v1/botsapp/bots/spaces/:id/consent { consentV? }   the member tapped OK on the line about the admin (`consentV`: which
 *                                                        line their screen showed, spacePerms.ts lineShown; none is the line before)
 *   GET    /v1/botsapp/bots/spaces/:id/feed?before=&limit=  -> FeedRead
 *   POST   /v1/botsapp/bots/spaces/:id/feed { text?, to?, thing?: { bot, id }, files?, voice?, everyone? }  -> 201 { message } | 200 { confirm }
 *   DELETE /v1/botsapp/bots/spaces/:id/grants/:gid       Stop sharing a thing (its sharer, or the admin): the access and its card go
 *   DELETE /v1/botsapp/bots/spaces/:id/members/:member  remove someone (the admin)
 *   PUT    /v1/botsapp/bots/spaces/:id/members/:member, POST|PUT|DELETE .../roles...   410 gone: there are no roles any more
 *   POST   /v1/botsapp/bots/spaces/:id/bots { slug };  DELETE .../bots/:slug
 *   GET    /v1/botsapp/bots/spaces/:id/sharing          -> { bots: [{ bot, sharing: [{ userId, name, you, mode }] }] }   who shares what, per bot
 *   GET    /v1/botsapp/bots/spaces/:id/bots/:bot/shared  -> { bot, people: [{ userId, name, you, mode, items }] }   each person's shared items
 *   GET    /v1/botsapp/bots/spaces/:id/bots/:bot/mine    -> { bot, mode, items, own }   what you share there, and yours to pick from
 *   PUT    /v1/botsapp/bots/spaces/:id/bots/:bot/mine { mode } | { item, on }   change what you share (yours alone)
 *   GET    /v1/botsapp/bots/spaces/:id/memory           -> { space, admin, lines: [{ id, text, section, by, you, mine, at, shared }] }
 *                                                        what the group's bots know (botsBots/spaceMemory.ts)
 *   POST   /v1/botsapp/bots/spaces/:id/memory { text, section? } -> { line }   a line for the group's bots
 *   DELETE /v1/botsapp/bots/spaces/:id/memory/:line      forget it (the one who wrote it, or the admin)
 *   GET    /v1/botsapp/bots/spaces/:id/activity
 *   GET    /s/bots.spaces?join=CODE                     a code's link (spaces.ts inviteLinkOf) opened in a browser, not the app: a small
 *                                                      page (no session) that opens X0 Bot at joining and gives the code to type
 *   GET    /v1/botsapp/bots/invite/:code                the same page, for the links invites had before
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
 *
 * Reporting and blocking (routes/bots/safety.ts) are registered here too, on the same parts. A block hides the two from each other in the
 * lists above as well: a space's members, the people to message or share to (src/botsBots/blocks.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { BotError, isBotError } from "../../bots/index.js";
import { attachmentKindOf, type MediaService } from "../../media/index.js";
import { Blocks } from "../../botsBots/blocks.js";
import { startMailSender } from "../../botsBots/mail.js";
import { Payments } from "../../botsBots/payments.js";
import { Safety } from "../../botsBots/safety.js";
import { SharedItems } from "../../botsBots/shared.js";
import { supabase } from "../../auth/supabase.js";
import { registerSafetyRoutes, suspendWithSupabase } from "./safety.js";
import { verifyQuery } from "../../botsBots/spaceLinks.js";
import { codeOf, INVITE_CODE_RE, isJoinCodeShape, JOIN_SCREEN, showCode, type Spaces } from "../../botsBots/spaces.js";
import { SpaceJoin, type Joiner } from "../../botsBots/spaceJoin.js";
import { lineShown } from "../../botsBots/spacePerms.js";
import { SpaceFeed } from "../../botsBots/spaceFeed.js";
import { Grants } from "../../botsBots/grants.js";
import { Work } from "../../botsBots/work.js";
import { SpaceTasks } from "../../botsBots/spaceTasks.js";
import { SpaceShares, type ShareSources } from "../../botsBots/spaceShares.js";
import { SpaceMemory } from "../../botsBots/spaceMemory.js";
import { shareSources } from "../../botsBots/shareSources.js";
import { Threads, type FileRef } from "../../botsBots/threads.js";
import type { Trips } from "../../botsBots/trips.js";
import { pushEngine } from "../../push/index.js";
import { calendar } from "../../calendar/index.js";
import { SITE_UI } from "../../experience/site/copy.js";
import type { BotsAreaDeps } from "./botsArea.js";
import { AREA, apiOrigin, shownName } from "./botsBots.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const queryOf = (req: FastifyRequest): Record<string, unknown> => (req.query as Record<string, unknown> | undefined) ?? {};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** Who is joining, as spaceJoin.ts reads them: their address counts only once it is confirmed. */
const joinerOf = (user: AuthedUser): Joiner => ({ id: user.id, email: user.email ?? null, emailConfirmed: user.emailConfirmed === true });
/** No roles any more: what the old routes for them answer. */
const GONE = { code: "gone", message: "Roles are gone. Everyone in a space can do the same things; its admin can do a few more." };
/** Where the app is got (the API's own /download page). */
const DOWNLOAD = `${(process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").replace(/\/+$/, "")}/download`;

/**
 * A phone that opens an invite's link in its browser has no X0 Bot (with it, the link opens the app: apple-app-site-association and
 * assetlinks.json cover /s/*), so it goes to its own store. Android's carries the invite as the install referrer. A computer, or anything
 * else, gets the page.
 */
export function storeFor(userAgent: unknown, code: string): string | null {
  const ua = String(userAgent ?? "");
  if (/iPhone|iPad|iPod/i.test(ua)) return SITE_UI.stores.ios;
  if (/Android/i.test(ua)) return `${SITE_UI.stores.android}&referrer=${encodeURIComponent(`join=${code}`)}`;
  return null;
}

/**
 * A code opened in a browser instead of the app: a button that opens X0 Bot at joining (tulmi://, which the apps register), and the
 * code to type in Spaces. A space's own code never expires, so its page names no space (a page that did would let anyone guess codes
 * and read family names without signing in); only an email invite's own code still says which space. The code is written into the
 * page only once it has the exact shape of one; no script runs here.
 */
function invitePage(code: string, s: { name: string; members: number } | null, joinCode: boolean): string {
  const line = !s ? "This invite doesn't work any more. Ask for a new one."
    : joinCode ? "You're invited to a space on X0 Bot."
    : `You're invited to <b>${esc(s.name)}</b> on X0 Bot (${s.members} ${s.members === 1 ? "person" : "people"} so far).`;
  const how = s && INVITE_CODE_RE.test(code)
    ? `<a class="btn" href="tulmi://screen/${JOIN_SCREEN}?join=${code}">Open in X0 Bot</a>`
      + `<p>Open X0 Bot, open Spaces, tap your bot, and type this code:</p><p class="code">${esc(joinCode ? showCode(code) : code)}</p>`
      + `<p class="meta">No X0 Bot yet? <a href="${DOWNLOAD}">Get it here</a>, sign in, and open this link again.</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>X0 Bot space invite</title>
<style>body{margin:0;font:16px/1.45 -apple-system,system-ui,sans-serif;color:#0a0a0a;background:#fff}main{max-width:420px;margin:0 auto;padding:48px 20px;display:flex;flex-direction:column;gap:14px}p{margin:0}.btn{display:flex;align-items:center;justify-content:center;height:54px;border-radius:27px;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:600;margin-top:4px}.code{font:600 22px ui-monospace,monospace;letter-spacing:2px}.meta{font-size:13px;color:#5c5c5c}a{color:#0a0a0a}</style></head>
<body><main><p>${line}</p>${how}</main></body></html>`;
}

/** Shown inline only when it can't run anything: pictures, PDFs, sound and video. Everything else is a download. */
const INLINE = /^(image\/(png|jpeg|webp|gif|heic|heif)|application\/pdf|audio\/[a-z0-9.+-]+|video\/(mp4|webm|quicktime))$/;

export interface SpaceParts {
  spaces: Spaces; threads: Threads; items: SharedItems; payments: Payments; tasks: SpaceTasks; safety: Safety; shares: SpaceShares; memory: SpaceMemory;
  /** Invitations, codes and join requests; the feed; things shared from a bot; Work in space (routes/bots/work.ts). */
  join: SpaceJoin; feed: SpaceFeed; grants: Grants; work: Work;
}

type SpacePush = "space_task" | "space_plan" | "space_message" | "space_joined" | "space_feed" | "space_request" | "space_accepted";
/** A push to someone's phones (push/defaults.ts space_*): never throws, and says nothing private. */
const push = async (userId: string, msg: { kind: SpacePush; key: string; vars: Record<string, string>; data: Record<string, string> }) => {
  try { await pushEngine()?.notify(userId, msg); } catch { /* a missed push is not a lost task or message: both are in the app */ }
};

/** The parts, around one Spaces: chats, shared things and payments ask it who may do what. */
export function spaceParts(spaces: Spaces, o: {
  media?: MediaService | null; trips?: Trips | null; now?: () => number; origin?: string;
  log?: { warn(o: object, m: string): void };
  /** The admin's suspend (routes/bots/safety.ts); by default Supabase's ban, where this server has the service key. */
  suspend?: ((userId: string) => Promise<boolean>) | null;
  /** Where each bot's own items come from, for sharing into a group (botsBots/shareSources.ts by default). */
  sources?: ShareSources;
} = {}): SpaceParts {
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
  const blocks = new Blocks(now, { log: o.log });
  const threads = new Threads(spaces, now, { files: { get: fileOf }, notify: push, blocks, filePath: (t, m, f) => `${origin}${AREA}/threads/${t}/files/${m}/${f}` });
  const items = new SharedItems(spaces, threads, now, {
    file: fileOf,
    trip: o.trips ? async (userId, id) => { const t = await o.trips!.current(userId); return t && t.id === id ? t : null; } : undefined,
  }, { filePath: (id) => `${origin}${AREA}/items/${id}/file` });
  const tasks = new SpaceTasks(spaces, now, { notify: push });
  // Plans and tasks from other people land on the person's own calendar ("From Aanya"); their tick, or no, there is their answer here.
  calendar().onSpaceAnswer((userId, spaceId, taskId, status) => tasks.answer(userId, spaceId, taskId, { status }));
  // Whoever made the invite that was used hears who came in with it, so a code that reached the wrong person is seen at once.
  spaces.onMembers(async (e) => {
    const j = e.joined;
    if (!j?.invitedBy || j.invitedBy === j.userId) return;
    await push(j.invitedBy, { kind: "space_joined", key: `${e.spaceId}:${j.userId}`, vars: { name: j.name, space: j.spaceName ?? "your space" }, data: { spaceId: e.spaceId } });
  });
  const sources = o.sources ?? shareSources({ trips: o.trips, now });
  // A thing shared from a bot ("/" in the feed), and Work in space on each bot's page.
  const grants = new Grants(spaces, blocks, now);
  const safety = new Safety(spaces, threads, items, now, { log: o.log, grants, suspend: o.suspend !== undefined ? o.suspend : supabase() ? suspendWithSupabase : null });
  const shares = new SpaceShares(spaces, sources, now);
  // What the group's bots know about the group: lines members write there, or share from their own space one at a time.
  const memory = new SpaceMemory(spaces, { now, hidden: (u) => blocks.hiddenFor(u) });
  const payments = new Payments(spaces, now);
  // Coming in: invitations to the invited address, codes, and the admin letting people in.
  const join = new SpaceJoin(spaces, now, { notify: push, blocks });
  const feed = new SpaceFeed(spaces, threads, grants, sources, blocks, { payments, tasks });
  const work = new Work(spaces, grants, shares, sources, undefined, now);
  return { spaces, threads, items, payments, tasks, safety, shares, memory, join, feed, grants, work };
}

/** A space as one person sees it: nobody with a block between them in its members (blocks.ts). */
async function withoutHidden<S extends { members: Array<{ userId: string }> }>(threads: Threads, userId: string, s: S): Promise<S> {
  const hidden = await threads.blocks.hiddenFor(userId);
  return hidden.size ? { ...s, members: s.members.filter((m) => !hidden.has(m.userId)) } : s;
}

export function registerSpacesRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { spaces: Spaces; trips?: Trips | null; parts?: SpaceParts; sources?: ShareSources }): SpaceParts {
  const p = o.parts ?? spaceParts(o.spaces, { media: deps.media, trips: o.trips ?? null, log: app.log, ...(o.sources ? { sources: o.sources } : {}) });
  const { spaces, threads, items, payments, tasks, shares, memory, join, feed } = p;
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

  app.get(`${AREA}/spaces`, RL, run(async (user, req) => {
    const q = queryOf(req);
    const full = q.full === "1" || q.full === "true";
    // Home's one Space card says the newest line across the spaces: each one's last line and unread, and none of full=1's sweeps.
    const lines = q.last === "1" || q.last === "true";
    const list = await Promise.all((await spaces.list(user.id)).map((s) => withoutHidden(threads, user.id, s)));
    // Without full=1 this is what it always was: Home reads it at every load and both apps at launch, so it only reads.
    const [rows, unread, invitations, requests, asked, draft] = await Promise.all([
      Promise.all(list.map(async (s) => {
        const waiting = await payments.waitingFor(user.id, s.id).catch(() => 0);
        if (!full && lines) {
          const sum = await threads.summaryFor(user.id, s.id).catch(() => null);
          return { ...s, waiting, last: sum?.last ?? null, unread: sum?.unread ?? 0 };
        }
        if (!full) return { ...s, waiting };
        const [sum, invited] = await Promise.all([threads.summaryFor(user.id, s.id).catch(() => null), spaces.invited(user.id, s.id).catch(() => 0)]);
        return { ...s, waiting, invited, last: sum?.last ?? null, unread: sum?.unread ?? 0 };
      })),
      threads.list(user.id).then((t) => t.unread, () => 0),
      full ? join.invitationsFor(joinerOf(user)).catch(() => []) : null,
      full ? join.requestsFor(user.id).catch(() => []) : null,
      full ? join.askedBy(user.id).catch(() => []) : null,
      // The person's open draft (Create, Call Your People): its read sweeps their drafts left a day.
      full ? spaces.draftOf(user.id).catch(() => null) : null,
    ]);
    return { spaces: rows, you: shownName(user), unread, ...(full ? { invitations, requests, asked, draft } : {}) };
  }));
  app.post(`${AREA}/spaces`, RL, run(async (user, req, reply) => { const r = await spaces.create(user.id, bodyOf(req.body).name, shownName(user)); reply.code(201); return r; }));
  // Create on the new Spaces screen (a draft until Done). These, and invitations, come before /spaces/:id.
  app.post(`${AREA}/spaces/draft`, tight(20), run(async (user, req, reply) => { const draft = await spaces.draft({ id: user.id }, { name: bodyOf(req.body).name }, shownName(user)); reply.code(201); return { draft }; }));
  app.post(`${AREA}/spaces/draft/invite`, tight(20), run(async (user, req, reply) => { const draft = await spaces.draftInvite({ id: user.id }, bodyOf(req.body).email, shownName(user)); reply.code(201); return { draft }; }));
  app.post(`${AREA}/spaces/draft/done`, RL, run(async (user, req) => spaces.finishDraft({ id: user.id }, { name: bodyOf(req.body).name }, shownName(user))));
  app.delete(`${AREA}/spaces/draft`, RL, run(async (user) => { await spaces.dropDraft(user.id); return { ok: true }; }));
  app.put(`${AREA}/spaces/invitations/:code`, tight(20), run(async (user, req) => {
    const b = bodyOf(req.body);
    return join.decideInvitation(joinerOf(user), param(req, "code"), b.decision, b.consent === true ? lineShown(b.consentV) : 0, shownName(user));
  }));
  // A code: the invited address joins at once; anyone else asks the admin. An old build reads `id` and `name` when it joined.
  app.post(`${AREA}/spaces/join`, tight(20), run(async (user, req) => {
    const b = bodyOf(req.body);
    return join.join(joinerOf(user), b.code, shownName(user), b.consent === true ? lineShown(b.consentV) : 0);
  }));
  // What an email invite's code is for, before joining (its link opens Spaces with it: screens/spaces.ts). Codes that don't work count.
  app.get(`${AREA}/spaces/join/:code`, tight(30), run(async (user, req) => ({ invite: await join.peek(user.id, param(req, "code")) })));
  app.get(`${AREA}/spaces/:id`, RL, run(async (user, req) => {
    const id = param(req, "id");
    const space = await withoutHidden(threads, user.id, await spaces.detail(user.id, id));
    const [shared, pays, todo] = await Promise.all([items.list(user.id, id).catch(() => []), payments.list(user.id, id).catch(() => []), tasks.list(user.id, id).catch(() => [])]);
    return { space, items: shared, payments: pays, tasks: todo, you: shownName(user), mailReady: spaces.mailer.configured };
  }));
  app.put(`${AREA}/spaces/:id`, RL, run(async (user, req) => { await spaces.rename(user.id, param(req, "id"), bodyOf(req.body).name); return { ok: true }; }));
  app.delete(`${AREA}/spaces/:id`, RL, run(async (user, req) => spaces.leave(user.id, param(req, "id"))));
  app.post(`${AREA}/spaces/:id/code`, tight(20), run(async (user, req) => ({ code: await spaces.newCode({ id: user.id }, param(req, "id")) })));
  app.post(`${AREA}/spaces/:id/invite`, tight(20), run(async (user, req) => spaces.invite({ id: user.id }, param(req, "id"), { email: bodyOf(req.body).email }, shownName(user))));
  app.delete(`${AREA}/spaces/:id/invites/:code`, RL, run(async (user, req) => { await spaces.revokeInvite(user.id, param(req, "id"), param(req, "code")); return { ok: true }; }));
  app.put(`${AREA}/spaces/:id/requests/:rid`, RL, run(async (user, req) => join.decide(user.id, param(req, "id"), param(req, "rid"), bodyOf(req.body).decision)));
  app.put(`${AREA}/spaces/:id/consent`, RL, run(async (user, req) => { await spaces.setConsent(user.id, param(req, "id"), lineShown(bodyOf(req.body).consentV)); return { ok: true }; }));
  app.get(`${AREA}/spaces/:id/feed`, RL, run(async (user, req) => {
    const q = queryOf(req);
    return feed.read(user.id, param(req, "id"), { before: q.before, limit: q.limit });
  }));
  app.post(`${AREA}/spaces/:id/feed`, tight(90), run(async (user, req, reply) => {
    const r = await feed.send({ id: user.id, name: shownName(user) }, param(req, "id"), bodyOf(req.body));
    if ("message" in r) reply.code(201);
    return r;
  }));
  app.delete(`${AREA}/spaces/:id/grants/:gid`, RL, run(async (user, req) => { await feed.unshare(user.id, param(req, "id"), param(req, "gid")); return { ok: true }; }));
  // There are no roles any more: what an old build asks of them is gone (410), and says so.
  const gone = run(async () => { throw new BotError(GONE.code, GONE.message, 410); });
  app.put(`${AREA}/spaces/:id/members/:member`, RL, gone);
  app.delete(`${AREA}/spaces/:id/members/:member`, RL, run(async (user, req) => spaces.leave(user.id, param(req, "id"), param(req, "member"))));
  app.post(`${AREA}/spaces/:id/roles`, RL, gone);
  app.put(`${AREA}/spaces/:id/roles/:role`, RL, gone);
  app.delete(`${AREA}/spaces/:id/roles/:role`, RL, gone);
  app.post(`${AREA}/spaces/:id/bots`, RL, run(async (user, req) => { await spaces.addBot(user.id, param(req, "id"), bodyOf(req.body).slug); return { ok: true }; }));
  app.delete(`${AREA}/spaces/:id/bots/:slug`, RL, run(async (user, req) => { await spaces.removeBot(user.id, param(req, "id"), param(req, "slug")); return { ok: true }; }));
  // A group's sub-bots: what each person shares from their own Plan, Notes, Travel and Xode (botsBots/spaceShares.ts).
  app.get(`${AREA}/spaces/:id/sharing`, RL, run(async (user, req) => ({ bots: await shares.summary(user.id, param(req, "id")) })));
  app.get(`${AREA}/spaces/:id/bots/:bot/shared`, RL, run(async (user, req) => shares.view(user.id, param(req, "id"), param(req, "bot"))));
  app.get(`${AREA}/spaces/:id/bots/:bot/mine`, RL, run(async (user, req) => shares.mine(user.id, param(req, "id"), param(req, "bot"))));
  app.put(`${AREA}/spaces/:id/bots/:bot/mine`, RL, run(async (user, req) => { const b = bodyOf(req.body); return shares.set(user.id, param(req, "id"), param(req, "bot"), { mode: b.mode, item: b.item, on: b.on }); }));
  app.get(`${AREA}/spaces/:id/memory`, RL, run(async (user, req) => memory.view(user.id, param(req, "id"))));
  app.post(`${AREA}/spaces/:id/memory`, RL, run(async (user, req) => { const b = bodyOf(req.body); return { line: await memory.add(user.id, param(req, "id"), b.text, { section: b.section }) }; }));
  app.delete(`${AREA}/spaces/:id/memory/:line`, RL, run(async (user, req) => { await memory.forget(user.id, param(req, "id"), param(req, "line")); return { ok: true }; }));
  app.get(`${AREA}/spaces/:id/activity`, RL, run(async (user, req) => ({ activity: await spaces.activity(user.id, param(req, "id"), Number(queryOf(req).limit) || 50) })));

  // An invite's link (https://app.x0bot.com/s/bots.spaces?join=CODE) opens the app; a browser that has no app to hand it to lands here:
  // a phone goes on to its store, a computer gets the page.
  const sendInvite = async (req: FastifyRequest, reply: FastifyReply, raw: unknown) => {
    const code = codeOf(raw);
    // A space's own code is never looked up here: every code of its shape gets the same page (and a phone the same store), so this
    // page, which needs no session, can't tell a guess that works from one that doesn't. The app checks it when they type it.
    const joinCode = isJoinCodeShape(code);
    const s = joinCode ? { name: "", members: 0 } : code ? await spaces.peek(code).catch(() => null) : null;
    const store = s && INVITE_CODE_RE.test(code) ? storeFor(req.headers["user-agent"], code) : null;
    if (store) return reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer").redirect(store, 302);
    return reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      .header("referrer-policy", "no-referrer").header("x-robots-tag", "noindex")
      .send(invitePage(code, s, joinCode));
  };
  app.get(`/s/${JOIN_SCREEN}`, tight(30), async (req, reply) => sendInvite(req, reply, queryOf(req).join));
  app.get(`${AREA}/invite/:code`, tight(30), async (req, reply) => sendInvite(req, reply, param(req, "code")));

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

  // ------------------------------------------------------------------ reporting and blocking

  registerSafetyRoutes(app, deps, p);

  return p;
}
