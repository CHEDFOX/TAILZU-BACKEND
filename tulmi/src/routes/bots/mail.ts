/**
 * THE MAIL BOT'S ROUTES (src/mail, docs/mail.md): what its pages call, passed to the mail worker inside the person's own account, and the
 * worker's one call back, that mail needs a person.
 *
 *   GET    /v1/mail/overview                                  the businesses, what waits for a person (most important first), the last 24 hours
 *   GET    /v1/mail/businesses                                the businesses, their addresses and modes
 *   POST   /v1/mail/businesses                                { name, domain, local? }: the domain and its mailbox made on our mail server
 *   GET    /v1/mail/businesses/:id                            one
 *   PUT    /v1/mail/businesses/:id                            { name?, signature? } (the worker's PATCH: the app's calls have no PATCH)
 *   DELETE /v1/mail/businesses/:id                            the business and its mailbox (its mail goes with it)
 *   GET    /v1/mail/businesses/:id/dns                        the records to add at the domain's DNS, each checked live
 *   POST   /v1/mail/businesses/:id/addresses                  { local, label? }
 *   PUT    /v1/mail/businesses/:id/addresses/:aid             { label?, aiMode?, displayName?, autoReply? }, or the auto-reply flat
 *                                                             (autoReplyEnabled, autoReplySubject, autoReplyBody, autoReplyDays) (the worker's PATCH)
 *   DELETE /v1/mail/businesses/:id/addresses/:aid
 *   GET    /v1/mail/businesses/:id/brief                      { profile, saved }: the company personality: how it writes, what it knows
 *   PUT    /v1/mail/businesses/:id/brief                      { profile } or its fields flat ({ about, knowledge, ... }): kept
 *   POST   /v1/mail/businesses/:id/brief/draft                { url? }: a brief drafted from the business's website, not kept
 *   GET    /v1/mail/businesses/:id/activity?limit=            the latest messages, as the AI sorted them and what it did
 *   GET    /v1/mail/businesses/:id/replies/:run               a draft beside the message it answers
 *   PUT    /v1/mail/businesses/:id/replies/:run               { text }: their words (the AI learns from them)
 *   POST   /v1/mail/businesses/:id/replies/:run/rewrite       { instruction }: written again as asked, still a draft
 *   POST   /v1/mail/businesses/:id/replies/:run/send          sent now
 *   POST   /v1/mail/businesses/:id/replies/:run/stop          a reply about to go waits as a draft
 *   DELETE /v1/mail/businesses/:id/replies/:run               thrown away
 *   POST   /v1/mail/businesses/:id/mail-app-password          { password }: for a mail app on a phone or a computer
 *   GET    /v1/mail/businesses/:id/folders                    all its mail, the main address's own, one per alias, the system folders
 *   GET    /v1/mail/businesses/:id/messages?folder=&page=     a folder's conversations, 30 a page, newest first
 *   GET    /v1/mail/businesses/:id/threads/:tid               one conversation (its unread messages marked read)
 *   POST   /v1/mail/businesses/:id/threads/:tid/:action       read, unread, star, unstar, archive, trash, junk, inbox
 *   POST   /v1/mail/businesses/:id/send                       { from, to, cc?, subject, text, replyTo? | forward? }
 *   POST   /v1/mail/businesses/:id/write                      { replyTo?, from?, instruction }: the AI writes it
 *   GET    /v1/mail/businesses/:id/rules                      each rule as a sentence
 *   POST   /v1/mail/businesses/:id/rules                      { name?, field, op, value, action, target? }
 *   DELETE /v1/mail/businesses/:id/rules/:rid
 *   POST   /v1/mail/businesses/:id/rules/:rid/toggle
 *
 *   POST   /v1/mail/notice                                    THE WORKER'S, signed with MAIL_WORKER_SECRET: { owner, business, name, status,
 *                                                             run?, kind?, priority? }. The person behind the owner (mail/owners.ts) gets a push
 *
 * The signed-in person's own: the worker is told their account only as a hash (mail/worker.ts ownerOf), and only the fields above are passed
 * on (never a business's AI allowance, which is ours to set). With BOTS off, or the mail bot not set up (MAIL_WORKER_URL, MAIL_WORKER_SECRET),
 * every route is 404 { code: "mail_off" }. The worker's errors come back as it wrote them, in words for a person. Nothing a person typed is logged.
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { mailOn } from "../../bots/builtin.js";
import { MemoryNonceStore, type NonceStore } from "../../code/jobs/handoff/sign.js";
import { getConfig } from "../../config.js";
import { mailOwners, type MailOwners } from "../../mail/owners.js";
import { MailError, mailWorker, OWNER, ownerOf, verifyWorkerCall, type MailWorker } from "../../mail/worker.js";
import { pushEngine } from "../../push/index.js";

export type MailPushKind = "mail_needs_you" | "mail_urgent" | "mail_paused";
export type MailNotify = (userId: string, msg: { kind: MailPushKind; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

export interface MailRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  /** The worker (the server's own when not given); null: not set up. */
  worker?: MailWorker | null;
  owners?: MailOwners;
  /** The push (push/index.ts's engine when not given). */
  notify?: MailNotify;
  nonces?: NonceStore;
  /** The secret the worker's notice is signed with (MAIL_WORKER_SECRET when not given). */
  secret?: string;
  now?: () => number;
}

const BASE = "/v1/mail";
const NOTICE = `${BASE}/notice`;
const B = `${BASE}/businesses/:id`;
const ID = /^[a-z0-9-]{1,80}$/;
const NUM = /^[1-9][0-9]{0,11}$/;
const TID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION = /^(read|unread|star|unstar|archive|trash|junk|inbox)$/;
/** What a query may hold, by its name: a folder's key, a page. */
const QUERY: Record<string, RegExp> = { limit: /^[0-9]{1,4}$/, page: /^[0-9]{1,4}$/, folder: /^(inbox|main|drafts|sent|archive|junk|trash|f-[A-Za-z0-9_-]{1,64})$/ };
const NOTICE_MAX = 4 * 1024;

/** What a brief may hold: the rest of a body is not passed on. */
const BRIEF_FIELDS = ["about", "voice", "knowledge", "policies", "signature", "replyLanguage", "sendDelayMinutes", "maxAutoPerSenderPerDay"] as const;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Each route the pages call: the fields of its body passed on (none: no body), and whether making it keeps whose account it is. */
const ROUTES: ReadonlyArray<{ method: Method; path: string; to?: Method; body?: readonly string[]; brief?: true; address?: true; keepOwner?: true; query?: readonly string[] }> = [
  { method: "GET", path: `${BASE}/overview` },
  { method: "GET", path: `${BASE}/businesses` },
  { method: "POST", path: `${BASE}/businesses`, body: ["name", "domain", "local"], keepOwner: true },
  { method: "GET", path: B },
  { method: "PUT", path: B, to: "PATCH", body: ["name", "signature"] },
  { method: "DELETE", path: B },
  { method: "GET", path: `${B}/dns` },
  { method: "POST", path: `${B}/addresses`, body: ["local", "label"] },
  { method: "PUT", path: `${B}/addresses/:aid`, to: "PATCH", body: ["label", "aiMode", "displayName", "autoReply"], address: true },
  { method: "DELETE", path: `${B}/addresses/:aid` },
  { method: "GET", path: `${B}/brief` },
  { method: "PUT", path: `${B}/brief`, brief: true },
  { method: "POST", path: `${B}/brief/draft`, body: ["url"] },
  { method: "GET", path: `${B}/activity`, query: ["limit"] },
  { method: "GET", path: `${B}/replies/:run` },
  { method: "PUT", path: `${B}/replies/:run`, body: ["text"] },
  { method: "POST", path: `${B}/replies/:run/rewrite`, body: ["instruction"] },
  { method: "POST", path: `${B}/replies/:run/send` },
  { method: "POST", path: `${B}/replies/:run/stop` },
  { method: "DELETE", path: `${B}/replies/:run` },
  { method: "POST", path: `${B}/mail-app-password`, body: ["password"] },
  { method: "GET", path: `${B}/folders` },
  { method: "GET", path: `${B}/messages`, query: ["folder", "page"] },
  { method: "GET", path: `${B}/threads/:tid` },
  { method: "POST", path: `${B}/threads/:tid/:action` },
  { method: "POST", path: `${B}/send`, body: ["from", "to", "cc", "subject", "text", "replyTo", "forward"] },
  { method: "POST", path: `${B}/write`, body: ["replyTo", "from", "instruction"] },
  { method: "GET", path: `${B}/rules` },
  { method: "POST", path: `${B}/rules`, body: ["name", "field", "op", "value", "action", "target"] },
  { method: "DELETE", path: `${B}/rules/:rid` },
  { method: "POST", path: `${B}/rules/:rid/toggle` },
];

/** Each kind of message, as the push names it ("A complaint needs your answer."). */
export const KIND_WORDS: Record<string, string> = {
  question: "A question", support: "A support request", sales: "A sales enquiry", order: "An order", billing: "A billing question",
  complaint: "A complaint", partnership: "A partnership offer", job: "A job enquiry", personal: "A personal message", notification: "A notice",
  spam: "A message", other: "A message",
};

const pick = (b: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(fields.filter((f) => b[f] !== undefined).map((f) => [f, b[f]]));

/** An address's change. The app's forms send the auto-reply's fields flat ({ autoReplyEnabled, autoReplySubject, autoReplyBody,
 *  autoReplyDays }): they are put together here, as the worker takes them. */
function addressOf(b: Record<string, unknown>): Record<string, unknown> {
  const out = pick(b, ["label", "aiMode", "displayName", "autoReply"]);
  if (["autoReplyEnabled", "autoReplySubject", "autoReplyBody", "autoReplyDays"].some((k) => b[k] !== undefined)) {
    out.autoReply = {
      enabled: b.autoReplyEnabled === true || b.autoReplyEnabled === "true",
      subject: typeof b.autoReplySubject === "string" ? b.autoReplySubject : "",
      body: typeof b.autoReplyBody === "string" ? b.autoReplyBody : "",
      days: Number(b.autoReplyDays) || 1,
    };
  }
  return out;
}

/** A brief's fields; an empty voice or rules is left out, so the worker keeps what it had (an empty rules field would drop "never promise a
 *  refund" with it), while the facts and the about may be emptied. */
function briefOf(b: Record<string, unknown>): Record<string, unknown> {
  const out = pick(b, BRIEF_FIELDS);
  for (const k of ["voice", "policies"]) if (typeof out[k] === "string" && !(out[k] as string).trim()) delete out[k];
  return out;
}

export function registerMailRoutes(app: FastifyInstance, deps: MailRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const worker = (): MailWorker | null => (deps.worker !== undefined ? deps.worker : mailWorker());
  const owners = (): MailOwners => deps.owners ?? mailOwners();
  const now = deps.now ?? Date.now;
  const nonces = deps.nonces ?? new MemoryNonceStore(now);
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "mail_off", message: "The mail bot is not switched on." });

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; w: MailWorker } | null> => {
    const w = deps.bots && mailOn() ? worker() : null;
    if (!w) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return { user, w };
  };

  for (const r of ROUTES) {
    app.route({
      method: r.method, url: r.path, config: deps.rateLimit as never,
      handler: async (req, reply) => {
        const got = await begin(req, reply);
        if (!got) return reply;
        const p = (req.params ?? {}) as Record<string, string>;
        if ((p.id !== undefined && !ID.test(p.id)) || (p.aid !== undefined && !NUM.test(p.aid)) || (p.run !== undefined && !NUM.test(p.run))
          || (p.tid !== undefined && !TID.test(p.tid)) || (p.action !== undefined && !ACTION.test(p.action)) || (p.rid !== undefined && !NUM.test(p.rid))) {
          return reply.code(404).send({ code: "not_found", message: "Not found." });
        }
        // The worker's path is this one inside the account: /v1/o/<owner>/businesses/...
        let rest = (req.url.split("?")[0] ?? "").slice(BASE.length);
        if (r.query) {
          const q = (req.query ?? {}) as Record<string, unknown>;
          const kept = r.query.filter((k) => typeof q[k] === "string" && (QUERY[k] ?? /^$/).test(q[k] as string)).map((k) => `${k}=${encodeURIComponent(q[k] as string)}`);
          if (kept.length) rest += `?${kept.join("&")}`;
        }
        const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
        const body = r.brief
          ? { profile: briefOf(b.profile && typeof b.profile === "object" ? b.profile as Record<string, unknown> : b) }
          : r.address ? addressOf(b)
          : r.body ? pick(b, r.body) : r.method === "GET" || r.method === "DELETE" ? undefined : {};
        const owner = ownerOf(got.user.id);
        try {
          const out = await got.w.call(owner, r.to ?? r.method, rest, body);
          // Their first business: the push can now find them when its mail needs them.
          if (r.keepOwner) await owners().keep(got.user.id, owner).catch(() => undefined);
          return reply.header("cache-control", "no-store").code(r.method === "POST" && r.keepOwner ? 201 : 200).send(out);
        } catch (err) {
          if (err instanceof MailError) return reply.code(err.status).send({ code: err.code, message: err.message });
          throw err;
        }
      },
    });
  }

  // The worker says mail needs a person. Signed over the exact bytes it sent, so they are kept on this route alone.
  app.post(NOTICE, {
    ...rl,
    preParsing: async (req, _reply, payload) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of payload) {
        size += (chunk as Buffer).length;
        if (size > NOTICE_MAX) throw Object.assign(new Error("body too large"), { statusCode: 413 });
        chunks.push(chunk as Buffer);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      (req as unknown as { rawBody?: string }).rawBody = text;
      return Readable.from([Buffer.from(text, "utf8")]);
    },
  }, async (req, reply) => {
    const secret = deps.secret ?? getConfig().MAIL_WORKER_SECRET ?? "";
    if (!deps.bots || !mailOn() || !secret) return off(reply);
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const ok = await verifyWorkerCall({
      secret, method: "POST", pathWithQuery: req.url, body: raw, header: (n) => req.headers[n] as string | undefined, nonces, now: now(),
    });
    if (!ok) return reply.code(401).send({ code: "auth", message: "Not signed." });
    let n: Record<string, unknown>;
    try { n = JSON.parse(raw) as Record<string, unknown>; } catch { return reply.code(400).send({ code: "bad_request", message: "Not JSON." }); }
    const status = String(n.status ?? "");
    const run = Number(n.run);
    if (!OWNER.test(String(n.owner ?? "")) || !ID.test(String(n.business ?? "")) || !["needs_person", "drafted", "paused"].includes(status)
      || (status !== "paused" && !(Number.isInteger(run) && run > 0))) {
      return reply.code(400).send({ code: "bad_request", message: "owner, business, status and run are needed." });
    }
    const userId = await owners().userOf(String(n.owner)).catch(() => null);
    if (!userId) return reply.send({ ok: true, pushed: false });
    const business = String(n.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Your business";
    const kind = String(n.kind ?? "");
    const what = Object.hasOwn(KIND_WORDS, kind) ? KIND_WORDS[kind]! : "A message";
    const push = deps.notify ?? defaultNotify;
    const day = new Date(now()).toISOString().slice(0, 10);
    const msg: Parameters<MailNotify>[1] = status === "paused"
      ? { kind: "mail_paused" as const, key: `${n.business}:paused:${day}`, vars: { business }, data: { slug: "mail" } }
      : { kind: status === "needs_person" ? "mail_needs_you" as const : "mail_urgent" as const, key: `${n.business}:${run}`, vars: { business, what }, data: { b: String(n.business), run: String(run) } };
    await push(userId, msg).catch(() => undefined);
    return reply.send({ ok: true, pushed: true });
  });
}

/** The server's push engine, when it runs (push/index.ts). A missed push is not a lost message: it waits on the page. */
const defaultNotify: MailNotify = async (userId, msg) => { await pushEngine()?.notify(userId, msg); };
