/**
 * THE MAIL BOT'S ROUTES (src/mail, docs/mail.md): what its pages call, passed to the mail worker inside the account of the business's owner, and
 * the worker's one call back, that mail needs a person.
 *
 *   GET    /v1/mail/overview                                  the businesses, what waits for a person (most important first), the last 24 hours,
 *                                                             and who in their spaces they can give an address to (people)
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
 *   POST   /v1/mail/businesses/:id/addresses/:aid/handlers    { memberId }: the address given to a member of the owner's spaces to answer -> { business }
 *   DELETE /v1/mail/businesses/:id/addresses/:aid/handlers/:memberId   taken back -> { business }
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
 *   POST   /v1/mail/businesses/:id/send                       { from, to, cc?, subject, text, replyTo? | forward?, tid? }
 *   POST   /v1/mail/businesses/:id/write                      { replyTo?, from?, instruction, tid? }: the AI writes it
 *   GET    /v1/mail/businesses/:id/rules                      each rule as a sentence
 *   POST   /v1/mail/businesses/:id/rules                      { name?, field, op, value, action, target? }
 *   DELETE /v1/mail/businesses/:id/rules/:rid
 *   POST   /v1/mail/businesses/:id/rules/:rid/toggle
 *
 *   POST   /v1/mail/notice                                    THE WORKER'S, signed with MAIL_WORKER_SECRET: { owner, business, name, status,
 *                                                             run?, kind?, priority?, address? }. The person behind the owner (mail/owners.ts)
 *                                                             gets a push, and so does each member they gave that address to answer
 *
 * The worker is told an account only as a hash (mail/worker.ts ownerOf), and only the fields above are passed on (never a business's AI
 * allowance, which is ours to set; never `tid`, which is ours to check). With BOTS off, or the mail bot not set up (MAIL_WORKER_URL,
 * MAIL_WORKER_SECRET), every route is 404 { code: "mail_off" }. The worker's errors come back as it wrote them, in words for a person. Nothing
 * a person typed is logged.
 *
 * IN A SPACE (mail/access.ts; nothing of it while Spaces is off). A business is reached three ways, and every call for it is made inside its
 * OWNER's account, whoever asks:
 *   - its owner's own (and a business the registry has not heard of: the worker says no if it isn't theirs)
 *   - a member's, by their space's admin: everything, read and write, as the owner; told when a member sets one up (space_mail)
 *   - addresses its owner gave a member to answer (space_mail_handle): that member sees the business with only those addresses (no mail-app
 *     login), only their folders (an alias's, the main address's own), only conversations that involve them (from, to or cc), only the AI's
 *     drafts and activity for them, and sends only from them, a reply or a forward only within such a conversation (`tid`). Everything
 *     else (records, personality, rules, addresses, settings, the handlers) is 404 not_found for them. Before a conversation is acted on it
 *     is looked at without marking it read (the worker's ?peek=1), so a refusal changes nothing in the owner's mailbox.
 * Someone else's business that reaches them none of these ways answers as one that isn't there. The lists (overview, businesses) carry their
 * own, then each member's (access "admin", owner), then each business where they answer addresses (access "handler", owner); an address of
 * a business they may change carries who answers it (handledBy).
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { mailOn } from "../../bots/builtin.js";
import { MemoryNonceStore, type NonceStore } from "../../code/jobs/handoff/sign.js";
import { getConfig } from "../../config.js";
import { mailAccess, mailBusinesses, mailHandlers, type MailAccess, type MailBusinesses, type MailHandler, type MailHandlers, type MailReach } from "../../mail/access.js";
import type { MailBusinessView, MailPerson, MailRunView } from "../../mail/digest.js";
import { mailOwners, type MailOwners } from "../../mail/owners.js";
import { MailError, mailWorker, OWNER, ownerOf, verifyWorkerCall, type MailWorker } from "../../mail/worker.js";
import { NO_PEOPLE, type MeetPeople } from "../../meet/people.js";
import { getProfile } from "../../profile/store.js";
import { pushEngine } from "../../push/index.js";

export type MailPushKind = "mail_needs_you" | "mail_urgent" | "mail_paused" | "space_mail" | "space_mail_handle";
export type MailNotify = (userId: string, msg: { kind: MailPushKind; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

export interface MailRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  /** The worker (the server's own when not given); null: not set up. */
  worker?: MailWorker | null;
  owners?: MailOwners;
  /** Who is whose space admin (meet/people.ts: the server's one instance, the meeting bot's too). Nobody when not given. */
  people?: MeetPeople;
  /** Whose each business is, and the addresses given to members (mail/access.ts: the server's when not given). */
  businesses?: MailBusinesses;
  handlers?: MailHandlers;
  /** A person's first name, for a push that says who gave an address (their profile's when not given). */
  nameOf?: (userId: string) => Promise<string>;
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
/** A person's id in a path or a body (Supabase's are uuids). */
const PERSON = /^[A-Za-z0-9_-]{1,64}$/;
/** An address as the worker's notice names it. */
const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,253}$/;
/** What a query may hold, by its name: a folder's key, a page. */
const QUERY: Record<string, RegExp> = { limit: /^[0-9]{1,4}$/, page: /^[0-9]{1,4}$/, folder: /^(inbox|main|drafts|sent|archive|junk|trash|f-[A-Za-z0-9_-]{1,64})$/ };
const NOTICE_MAX = 4 * 1024;
/** What waits for a person, every business together, most important first. */
const WAITING_MAX = 50;

const NOT_FOUND = { code: "not_found", message: "Not found." } as const;
/** Someone else's business they have no way into: answered as the worker answers one that isn't there. */
const NO_BUSINESS = { code: "bad_request", message: "No such business." } as const;

/** What a brief may hold: the rest of a body is not passed on. */
const BRIEF_FIELDS = ["about", "voice", "knowledge", "policies", "signature", "replyLanguage", "sendDelayMinutes", "maxAutoPerSenderPerDay"] as const;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/**
 * What a member given addresses may do on a route (mail/access.ts handler), and how it is checked: their business, their folders, a folder
 * of theirs, a conversation that involves them, mail from their address, the AI's activity and drafts for their addresses. Absent: nothing.
 */
type HandlerUse = "business" | "folders" | "messages" | "thread" | "action" | "send" | "write" | "activity" | "reply";
interface RouteDef {
  method: Method; path: string; to?: Method; body?: readonly string[]; brief?: true; address?: true; keepOwner?: true; query?: readonly string[];
  /** One of the lists, merged with the person's spaces. */
  list?: "overview" | "businesses";
  handler?: HandlerUse;
  /** What goes from the registry once the worker did it. */
  forget?: "business" | "address";
}
/** Each route the pages call: the fields of its body passed on (none: no body), and whether making it keeps whose account it is. */
const ROUTES: readonly RouteDef[] = [
  { method: "GET", path: `${BASE}/overview`, list: "overview" },
  { method: "GET", path: `${BASE}/businesses`, list: "businesses" },
  { method: "POST", path: `${BASE}/businesses`, body: ["name", "domain", "local"], keepOwner: true },
  { method: "GET", path: B, handler: "business" },
  { method: "PUT", path: B, to: "PATCH", body: ["name", "signature"] },
  { method: "DELETE", path: B, forget: "business" },
  { method: "GET", path: `${B}/dns` },
  { method: "POST", path: `${B}/addresses`, body: ["local", "label"] },
  { method: "PUT", path: `${B}/addresses/:aid`, to: "PATCH", body: ["label", "aiMode", "displayName", "autoReply"], address: true },
  { method: "DELETE", path: `${B}/addresses/:aid`, forget: "address" },
  { method: "GET", path: `${B}/brief` },
  { method: "PUT", path: `${B}/brief`, brief: true },
  { method: "POST", path: `${B}/brief/draft`, body: ["url"] },
  { method: "GET", path: `${B}/activity`, query: ["limit"], handler: "activity" },
  { method: "GET", path: `${B}/replies/:run`, handler: "reply" },
  { method: "PUT", path: `${B}/replies/:run`, body: ["text"], handler: "reply" },
  { method: "POST", path: `${B}/replies/:run/rewrite`, body: ["instruction"], handler: "reply" },
  { method: "POST", path: `${B}/replies/:run/send`, handler: "reply" },
  { method: "POST", path: `${B}/replies/:run/stop`, handler: "reply" },
  { method: "DELETE", path: `${B}/replies/:run`, handler: "reply" },
  { method: "POST", path: `${B}/mail-app-password`, body: ["password"] },
  { method: "GET", path: `${B}/folders`, handler: "folders" },
  { method: "GET", path: `${B}/messages`, query: ["folder", "page"], handler: "messages" },
  { method: "GET", path: `${B}/threads/:tid`, handler: "thread" },
  { method: "POST", path: `${B}/threads/:tid/:action`, handler: "action" },
  { method: "POST", path: `${B}/send`, body: ["from", "to", "cc", "subject", "text", "replyTo", "forward"], handler: "send" },
  { method: "POST", path: `${B}/write`, body: ["replyTo", "from", "instruction"], handler: "write" },
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

const lower = (s: string): string => s.trim().toLowerCase();

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

// ------------------------------------------------------------------------------------------------------------- what a person is shown

type FolderView = { key: string; id?: string; name?: string; role?: string | null; kind?: string; unread?: number; total?: number; email?: string };
type ThreadLook = {
  messages?: Array<{ id?: unknown; from?: { email?: unknown } | null; to?: Array<{ email?: unknown }> | null; cc?: Array<{ email?: unknown }> | null }>;
};
type ListAnswer = { businesses?: MailBusinessView[]; waiting?: MailRunView[]; [k: string]: unknown };

const isBusiness = (b: unknown): b is MailBusinessView => !!b && typeof b === "object" && typeof (b as { id?: unknown }).id === "string";
const businessesIn = (o: ListAnswer): MailBusinessView[] => (Array.isArray(o.businesses) ? o.businesses.filter(isBusiness) : []);
const runsIn = (o: ListAnswer): MailRunView[] => (Array.isArray(o.waiting) ? o.waiting : []);
const titled = (local: string): string => local.replace(/[._+-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A conversation involves one of these addresses: a message from it, or to or cc it. */
function involves(t: ThreadLook, emails: ReadonlySet<string>): boolean {
  const has = (e: unknown): boolean => typeof e === "string" && emails.has(lower(e));
  return (t.messages ?? []).some((m) => has(m.from?.email) || (m.to ?? []).some((x) => has(x.email)) || (m.cc ?? []).some((x) => has(x.email)));
}

/** Each address of a business its owner (or their admin) may change, with the members who answer it, by the names the owner's spaces have. */
function answered(b: MailBusinessView, ownerId: string, rows: readonly MailHandler[], members: readonly MailPerson[]): MailBusinessView {
  if (!Array.isArray(b.addresses)) return b;
  const named = new Map(members.map((m) => [m.id, m]));
  const theirs = rows.filter((h) => h.businessId === b.id && h.ownerId === ownerId);
  return {
    ...b,
    addresses: b.addresses.map((a) => {
      const by = new Map<string, MailPerson>();
      for (const h of theirs) {
        const person = named.get(h.memberId);
        if (person && h.addressEmail === lower(a.email ?? "")) by.set(person.id, { id: person.id, name: person.name });
      }
      return { ...a, handledBy: [...by.values()] };
    }),
  };
}

/** A business as a member who answers some of its addresses sees it: those addresses only, no mail-app login, whose it is. Its address is
 *  theirs (the main address when it is theirs), so what is written from it starts from an address they may send from. */
function forHandler(b: MailBusinessView, emails: ReadonlySet<string>, owner: MailPerson): MailBusinessView {
  const { mailApp: _login, ...rest } = b;
  const addresses = (Array.isArray(b.addresses) ? b.addresses : []).filter((a) => emails.has(lower(a.email ?? ""))).map(({ handledBy: _by, ...a }) => a);
  const first = addresses.find((a) => a.isPrimary) ?? addresses[0];
  return { ...rest, ...(first ? { email: first.email } : {}), access: "handler", owner, addresses };
}

const STATUS_RANK: Record<string, number> = { needs_person: 0, drafted: 1 };
const PRIORITY_RANK: Record<string, number> = { urgent: 0, normal: 1 };
/** The worker's order for what waits: a person's answer first, then drafts, then replies about to go; urgent first; newest first. */
const byNeed = (a: MailRunView, b: MailRunView): number =>
  (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2)
  || (PRIORITY_RANK[a.priority ?? ""] ?? 2) - (PRIORITY_RANK[b.priority ?? ""] ?? 2)
  || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);

const REFUSED = Symbol("refused");

export function registerMailRoutes(app: FastifyInstance, deps: MailRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const worker = (): MailWorker | null => (deps.worker !== undefined ? deps.worker : mailWorker());
  const owners = (): MailOwners => deps.owners ?? mailOwners();
  const businesses = (): MailBusinesses => deps.businesses ?? mailBusinesses();
  const handlers = (): MailHandlers => deps.handlers ?? mailHandlers();
  let accessMade: MailAccess | null = null;
  const access = (): MailAccess => (accessMade ??= mailAccess({ businesses: businesses(), handlers: handlers(), people: deps.people ?? NO_PEOPLE }));
  const nameOf = deps.nameOf ?? firstNameOf;
  const push = deps.notify ?? defaultNotify;
  const now = deps.now ?? Date.now;
  const nonces = deps.nonces ?? new MemoryNonceStore(now);
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "mail_off", message: "The mail bot is not switched on." });
  const kept = (what: string) => (err: unknown) => { app.log.warn({ err: (err as Error)?.message }, `mail: ${what}`); };
  const answer = (reply: FastifyReply, out: unknown, code = 200) => reply.header("cache-control", "no-store").code(code).send(out);
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof MailError) return reply.code(err.status).send({ code: err.code, message: err.message });
    throw err;
  };

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; w: MailWorker } | null> => {
    const w = deps.bots && mailOn() ? worker() : null;
    if (!w) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return { user, w };
  };

  /** A business its owner or their admin may change, with whose it is and who answers each address. */
  const dress = async (b: MailBusinessView, reach: MailReach): Promise<MailBusinessView> => {
    const rows = (await handlers().ofBusinesses([b.id]).catch((err) => { kept("handlers")(err); return [] as MailHandler[]; }))
      .filter((h) => h.ownerId === reach.ownerId);
    const members = rows.length ? await access().membersOf(reach.ownerId) : [];
    return answered({ ...b, access: reach.access as "own" | "admin", ...(reach.owner ? { owner: reach.owner } : {}) }, reach.ownerId, rows, members);
  };

  /** The person who gave an address, as the member's spaces have them, else their own first name. */
  const giverName = async (giverId: string, memberId: string): Promise<string> =>
    (await access().adminName(memberId, giverId)) || (await nameOf(giverId).catch(() => "")) || "Someone";

  // --------------------------------------------------------------------------------------------------------------------- the lists

  /**
   * The person's own businesses (their list as the worker has it), each member's (their space's admin reaches it in full), and each where
   * they answer addresses (those addresses only). What waits for a person comes the same way: their own, their members', and what came to
   * their addresses. The last 24 hours are their own.
   */
  const lists = async (me: string, w: MailWorker, which: "overview" | "businesses"): Promise<Record<string, unknown>> => {
    const path = which === "overview" ? "/overview" : "/businesses";
    const own = await w.call<ListAnswer>(ownerOf(me), "GET", path);
    const ownList = businessesIn(own);
    // Each business in their own list is theirs: the registry learns the older ones here.
    await businesses().claim(me, ownList.map((b) => b.id)).catch(kept("claim"));
    const [members, given] = await Promise.all([
      access().membersOf(me),
      handlers().ofMember(me).catch((err) => { kept("handlers")(err); return [] as MailHandler[]; }),
    ]);
    const memberIds = new Set(members.map((m) => m.id));

    // The members who have a business here: their lists, inside their accounts. One that can't be read just now is left out.
    const owning = members.length ? await businesses().owning([...memberIds]).catch((err) => { kept("owning")(err); return new Set<string>(); }) : new Set<string>();
    const theirs = (await Promise.all(members.filter((m) => owning.has(m.id)).map(async (m) => {
      try {
        const out = await w.call<ListAnswer>(ownerOf(m.id), "GET", path);
        const list = businessesIn(out);
        await businesses().claim(m.id, list.map((b) => b.id)).catch(kept("claim"));
        return { owner: m, out, list };
      } catch { return null; }
    }))).filter((x): x is NonNullable<typeof x> => x !== null);

    // The addresses given to them, by owner and business. An owner who is one of their members is above already, whole.
    const byOwner = new Map<string, Map<string, Set<string>>>();
    for (const h of given) {
      if (h.ownerId === me || memberIds.has(h.ownerId)) continue;
      const biz = byOwner.get(h.ownerId) ?? new Map<string, Set<string>>();
      byOwner.set(h.ownerId, biz);
      const emails = biz.get(h.businessId) ?? new Set<string>();
      biz.set(h.businessId, emails);
      emails.add(lower(h.addressEmail));
    }
    const handled = (await Promise.all([...byOwner].map(async ([ownerId, biz]) => {
      // Only while they are still a member of a space that owner is the admin of.
      if (!(await access().membersOf(ownerId)).some((m) => m.id === me)) return null;
      try {
        const out = await w.call<ListAnswer>(ownerOf(ownerId), "GET", path);
        return { ownerId, biz, out, list: businessesIn(out).filter((b) => biz.has(b.id)) };
      } catch { return null; }
    }))).filter((x): x is NonNullable<typeof x> => x !== null);
    const admins = handled.length ? await access().adminsOf(me) : [];

    // Who answers which address, on the businesses they may change: their own and their members'.
    const mayChange = [...ownList, ...theirs.flatMap((t) => t.list)];
    const rows = mayChange.length ? await handlers().ofBusinesses(mayChange.map((b) => b.id)).catch((err) => { kept("handlers")(err); return [] as MailHandler[]; }) : [];
    const peopleOf = async (ownerId: string): Promise<MailPerson[]> =>
      ownerId === me ? members : rows.some((h) => h.ownerId === ownerId) ? access().membersOf(ownerId) : [];

    const list: MailBusinessView[] = ownList.map((b) => answered({ ...b, access: "own" }, me, rows, members));
    for (const t of theirs) {
      const named = await peopleOf(t.owner.id);
      list.push(...t.list.map((b) => answered({ ...b, access: "admin", owner: t.owner }, t.owner.id, rows, named)));
    }
    for (const h of handled) {
      const owner: MailPerson = { id: h.ownerId, name: admins.find((a) => a.id === h.ownerId)?.name ?? "" };
      list.push(...h.list.map((b) => forHandler(b, h.biz.get(b.id)!, owner)));
    }
    if (which === "businesses") return { ...own, businesses: list };

    const others = [
      ...theirs.flatMap((t) => runsIn(t.out)),
      ...handled.flatMap((h) => runsIn(h.out).filter((r) => !!r.companyId && !!h.biz.get(r.companyId)?.has(lower(r.address ?? "")))),
    ];
    const waiting = others.length ? [...runsIn(own), ...others].sort(byNeed).slice(0, WAITING_MAX) : runsIn(own);
    return { ...own, businesses: list, waiting, people: members };
  };

  // ----------------------------------------------------------------------------------------------------- a member who answers addresses

  /**
   * One call by a member given addresses: what they may see and do, checked before it is done (REFUSED: 404, as for anything else of the
   * business's). The worker is asked inside the owner's account.
   */
  const asHandler = async (use: HandlerUse, c: {
    w: MailWorker; me: string; reach: MailReach; id: string; p: Record<string, string>; q: Record<string, unknown>; b: Record<string, unknown>;
    rest: string; body: unknown; r: RouteDef;
  }): Promise<unknown> => {
    const owner = ownerOf(c.reach.ownerId);
    const at = `/businesses/${c.id}`;
    const emails = c.reach.addresses ?? new Set<string>();
    const mine = (email: unknown): boolean => typeof email === "string" && emails.has(lower(email));
    /** A conversation looked at without marking it read: a refusal changes nothing in the owner's mailbox. */
    const peek = (tid: string) => c.w.call<ThreadLook & Record<string, unknown>>(owner, "GET", `${at}/threads/${tid}?peek=1`);

    /** Their folders: each alias's that is theirs, the main address's own when it is theirs. Never All mail, Sent, Drafts or the rest. */
    const theirFolders = async (): Promise<{ list: FolderView[]; inbox: FolderView | null }> => {
      const all = ((await c.w.call<{ folders?: FolderView[] }>(owner, "GET", `${at}/folders`)).folders ?? []).filter((f) => f && typeof f.key === "string");
      const list = all.filter((f) => f.kind === "address" && mine(f.email));
      // A business with its main address alone has no folder of that address's own (the worker makes "main" once there are aliases), so
      // its Inbox is that address's mail: its handler gets it as "main". Only when the business has no other address at all.
      if (all.some((f) => f.kind === "address")) return { list, inbox: null };
      const inbox = all.find((f) => f.key === "inbox");
      if (!inbox) return { list, inbox: null };
      const biz = (await c.w.call<{ business?: MailBusinessView }>(owner, "GET", at)).business;
      const only = Array.isArray(biz?.addresses) && biz!.addresses.length === 1 ? biz!.addresses[0]! : null;
      if (!only?.isPrimary || !mine(only.email)) return { list, inbox: null };
      const main: FolderView = { ...inbox, key: "main", role: null, kind: "address", name: only.label || titled(only.email.split("@")[0] ?? ""), email: only.email };
      return { list: [main, ...list], inbox: main };
    };

    switch (use) {
      case "business": {
        const out = await c.w.call<{ business?: unknown }>(owner, "GET", at);
        if (!isBusiness(out.business)) return out;
        return { ...out, business: forHandler(out.business, emails, { id: c.reach.ownerId, name: await access().adminName(c.me, c.reach.ownerId) }) };
      }
      case "folders":
        return { folders: (await theirFolders()).list };
      case "messages": {
        const { list, inbox } = await theirFolders();
        const key = typeof c.q.folder === "string" && QUERY.folder!.test(c.q.folder) ? c.q.folder : "";
        const folder = key ? list.find((f) => f.key === key) : undefined;
        if (!folder) return REFUSED;
        const page = typeof c.q.page === "string" && QUERY.page!.test(c.q.page) ? `&page=${c.q.page}` : "";
        // The main address alone: its mail is the Inbox's, asked for by that name, and shown as theirs.
        const out = await c.w.call<Record<string, unknown>>(owner, "GET", `${at}/messages?folder=${folder === inbox ? "inbox" : encodeURIComponent(folder.key)}${page}`);
        return { ...out, folder: folder === inbox ? inbox : out.folder, folders: list };
      }
      case "thread": {
        const t = await peek(c.p.tid!);
        if (!involves(t, emails)) return REFUSED;
        // Opened by someone it is for: marked read, as when its owner opens it (the look above left it as it was).
        await c.w.call(owner, "POST", `${at}/threads/${c.p.tid}/read`, {}).catch(() => undefined);
        return t;
      }
      case "action":
        if (!involves(await peek(c.p.tid!), emails)) return REFUSED;
        return c.w.call(owner, "POST", c.rest, c.body);
      case "send":
      case "write": {
        if (!mine(c.b.from)) return REFUSED;
        // A reply or a forward: only of a message in a conversation that involves them, named by its tid.
        const originals = (use === "send" ? [c.b.replyTo, c.b.forward] : [c.b.replyTo]).filter((x) => x !== undefined && x !== null && x !== "").map(String);
        if (originals.length) {
          const tid = typeof c.b.tid === "string" ? c.b.tid : "";
          if (!TID.test(tid)) return REFUSED;
          const t = await peek(tid);
          if (!involves(t, emails) || !originals.every((id) => (t.messages ?? []).some((m) => m.id === id))) return REFUSED;
        }
        return c.w.call(owner, "POST", c.rest, c.body);
      }
      case "activity": {
        const asked = typeof c.q.limit === "string" && QUERY.limit!.test(c.q.limit) ? Number(c.q.limit) : 50;
        const out = await c.w.call<{ runs?: MailRunView[] }>(owner, "GET", `${at}/activity?limit=200`);
        return { ...out, runs: (Array.isArray(out.runs) ? out.runs : []).filter((r) => mine(r.address)).slice(0, Math.min(200, Math.max(1, asked))) };
      }
      case "reply": {
        // The draft read first: only one written for an address of theirs.
        const view = await c.w.call<{ address?: unknown }>(owner, "GET", `${at}/replies/${c.p.run}`);
        if (!mine(view.address)) return REFUSED;
        return c.r.method === "GET" ? view : c.w.call(owner, c.r.to ?? c.r.method, c.rest, c.body);
      }
    }
  };

  // ---------------------------------------------------------------------------------------------------------------- the pages' routes

  for (const r of ROUTES) {
    app.route({
      method: r.method, url: r.path, config: deps.rateLimit as never,
      handler: async (req, reply) => {
        const got = await begin(req, reply);
        if (!got) return reply;
        const me = got.user.id;
        const p = (req.params ?? {}) as Record<string, string>;
        if ((p.id !== undefined && !ID.test(p.id)) || (p.aid !== undefined && !NUM.test(p.aid)) || (p.run !== undefined && !NUM.test(p.run))
          || (p.tid !== undefined && !TID.test(p.tid)) || (p.action !== undefined && !ACTION.test(p.action)) || (p.rid !== undefined && !NUM.test(p.rid))) {
          return reply.code(404).send(NOT_FOUND);
        }
        // The worker's path is this one inside the account: /v1/o/<owner>/businesses/...
        let rest = (req.url.split("?")[0] ?? "").slice(BASE.length);
        const q = (req.query ?? {}) as Record<string, unknown>;
        if (r.query) {
          const allowed = r.query.filter((k) => typeof q[k] === "string" && (QUERY[k] ?? /^$/).test(q[k] as string)).map((k) => `${k}=${encodeURIComponent(q[k] as string)}`);
          if (allowed.length) rest += `?${allowed.join("&")}`;
        }
        const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
        const body = r.brief
          ? { profile: briefOf(b.profile && typeof b.profile === "object" ? b.profile as Record<string, unknown> : b) }
          : r.address ? addressOf(b)
          : r.body ? pick(b, r.body) : r.method === "GET" || r.method === "DELETE" ? undefined : {};
        try {
          if (r.list) return answer(reply, await lists(me, got.w, r.list));

          if (p.id === undefined) {
            // A business made: theirs, inside their own account.
            const out = await got.w.call<{ business?: unknown }>(ownerOf(me), r.to ?? r.method, rest, body);
            // Their first business: the push can now find them when its mail needs them.
            if (r.keepOwner) await owners().keep(me, ownerOf(me)).catch(() => undefined);
            if (!isBusiness(out.business) || !ID.test(out.business.id)) return answer(reply, out, r.keepOwner ? 201 : 200);
            const made = out.business;
            await businesses().keep(made.id, me).catch(kept("keep"));
            // Made again under an old business's id: nobody answers for it yet.
            await handlers().forgetBusiness(made.id).catch(kept("forget"));
            // Each admin of a space they are a member of is told: their name as that space has it, and the domain. Never the mail.
            const domain = typeof made.domain === "string" && made.domain ? made.domain : made.name || "a business";
            let admins: Array<{ userId: string; memberName: string }> = [];
            try { admins = await (deps.people ?? NO_PEOPLE).adminsOf(me); } catch (err) { kept("admins")(err); }
            for (const a of admins) {
              if (a.userId === me) continue;
              await push(a.userId, { kind: "space_mail", key: made.id, vars: { name: a.memberName || "Someone", domain }, data: { slug: "mail", b: made.id } }).catch(() => undefined);
            }
            return answer(reply, { ...out, business: await dress(made, { ownerId: me, access: "own" }) }, r.keepOwner ? 201 : 200);
          }

          const reach = await access().resolve(me, p.id);
          if (!reach) return reply.code(404).send(NO_BUSINESS);
          if (reach.access === "handler") {
            if (!r.handler) return reply.code(404).send(NOT_FOUND);
            const out = await asHandler(r.handler, { w: got.w, me, reach, id: p.id, p, q, b, rest, body, r });
            return out === REFUSED ? reply.code(404).send(NOT_FOUND) : answer(reply, out);
          }
          // Their own, or a member's as their space's admin: as the owner, inside the owner's account.
          const out = await got.w.call<{ business?: unknown }>(ownerOf(reach.ownerId), r.to ?? r.method, rest, body);
          if (r.forget === "business") {
            await businesses().forget(p.id).catch(kept("forget"));
            await handlers().forgetBusiness(p.id).catch(kept("forget"));
          }
          if (r.forget === "address") await handlers().forgetAddress(p.id, Number(p.aid)).catch(kept("forget"));
          return answer(reply, out && typeof out === "object" && isBusiness(out.business) ? { ...out, business: await dress(out.business, reach) } : out);
        } catch (err) {
          return fail(reply, err);
        }
      },
    });
  }

  // --------------------------------------------------------------------------------------------- who answers an address (owner and admin)

  /** The business, and how the viewer reaches it, for the two routes below: their own or a member's; anyone else gets the 404 they'd get. */
  const changeable = async (reply: FastifyReply, me: string, id: string): Promise<MailReach | null> => {
    const reach = await access().resolve(me, id);
    if (!reach) { reply.code(404).send(NO_BUSINESS); return null; }
    if (reach.access === "handler") { reply.code(404).send(NOT_FOUND); return null; }
    return reach;
  };

  app.post(`${B}/addresses/:aid/handlers`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const me = got.user.id;
    const p = (req.params ?? {}) as Record<string, string>;
    if (!ID.test(p.id ?? "") || !NUM.test(p.aid ?? "")) return reply.code(404).send(NOT_FOUND);
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const memberId = typeof b.memberId === "string" ? b.memberId.trim() : "";
    try {
      const reach = await changeable(reply, me, p.id!);
      if (!reach) return reply;
      // Only a member of a space the business's owner is the admin of (people.ts), as it is now.
      const person = PERSON.test(memberId) ? (await access().membersOf(reach.ownerId)).find((m) => m.id === memberId) : undefined;
      if (!person) {
        const whose = reach.access === "own" ? "you look after" : `${(reach.owner?.name ?? "").split(/\s+/)[0] || "its owner"} looks after`;
        return reply.code(404).send({ code: "not_your_person", message: `You can give an address only to someone in a space ${whose}.` });
      }
      const view = (await got.w.call<{ business?: unknown }>(ownerOf(reach.ownerId), "GET", `/businesses/${p.id}`)).business;
      const address = isBusiness(view) && Array.isArray(view.addresses) ? view.addresses.find((a) => a.id === Number(p.aid)) : undefined;
      if (!isBusiness(view) || !address) return reply.code(404).send({ code: "not_found", message: "No such address." });
      // The worker just said whose it is: the registry keeps it, so the member's calls go inside the owner's account.
      await businesses().keep(view.id, reach.ownerId).catch(kept("keep"));
      let added: boolean;
      try {
        added = await handlers().give({ businessId: view.id, ownerId: reach.ownerId, addressId: address.id, addressEmail: address.email, memberId: person.id });
      } catch (err) {
        kept("give")(err);
        return reply.code(503).send({ code: "mail_down", message: "That couldn't be kept just now. Try again in a moment." });
      }
      if (added) {
        const day = new Date(now()).toISOString().slice(0, 10);
        await push(person.id, {
          kind: "space_mail_handle", key: `${view.id}:${address.id}:${day}`, vars: { name: await giverName(me, person.id), address: address.email },
          data: { slug: "mail", b: view.id },
        }).catch(() => undefined);
      }
      return answer(reply, { business: await dress(view, reach) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete(`${B}/addresses/:aid/handlers/:memberId`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const p = (req.params ?? {}) as Record<string, string>;
    if (!ID.test(p.id ?? "") || !NUM.test(p.aid ?? "") || !PERSON.test(p.memberId ?? "")) return reply.code(404).send(NOT_FOUND);
    try {
      const reach = await changeable(reply, got.user.id, p.id!);
      if (!reach) return reply;
      // The business read first, inside its owner's account: a business that isn't theirs (or their member's) is refused before anything goes.
      const view = (await got.w.call<{ business?: unknown }>(ownerOf(reach.ownerId), "GET", `/businesses/${p.id}`)).business;
      if (!isBusiness(view)) return reply.code(404).send(NO_BUSINESS);
      const address = Array.isArray(view.addresses) ? view.addresses.find((a) => a.id === Number(p.aid)) : undefined;
      try {
        await handlers().take({ businessId: view.id, ownerId: reach.ownerId, addressId: Number(p.aid), ...(address ? { addressEmail: address.email } : {}), memberId: p.memberId! });
      } catch (err) {
        kept("take")(err);
        return reply.code(503).send({ code: "mail_down", message: "That couldn't be changed just now. Try again in a moment." });
      }
      return answer(reply, { business: await dress(view, reach) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ------------------------------------------------------------------------------------------------------------------- the worker's notice

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
    const day = new Date(now()).toISOString().slice(0, 10);
    const msg: Parameters<MailNotify>[1] = status === "paused"
      ? { kind: "mail_paused" as const, key: `${n.business}:paused:${day}`, vars: { business }, data: { slug: "mail" } }
      : { kind: status === "needs_person" ? "mail_needs_you" as const : "mail_urgent" as const, key: `${n.business}:${run}`, vars: { business, what }, data: { b: String(n.business), run: String(run) } };
    await push(userId, msg).catch(() => undefined);
    // The members the owner gave that address to answer hear of it too, while they are still in a space the owner is the admin of.
    const address = typeof n.address === "string" && EMAIL.test(n.address.trim()) ? lower(n.address) : "";
    if (status !== "paused" && address) {
      const rows = (await handlers().ofBusinesses([String(n.business)]).catch((err) => { kept("handlers")(err); return [] as MailHandler[]; }))
        .filter((h) => h.ownerId === userId && h.addressEmail === address && h.memberId !== userId);
      if (rows.length) {
        const members = new Set((await access().membersOf(userId)).map((m) => m.id));
        for (const memberId of new Set(rows.map((h) => h.memberId))) if (members.has(memberId)) await push(memberId, msg).catch(() => undefined);
      }
    }
    return reply.send({ ok: true, pushed: true });
  });
}

/** The server's push engine, when it runs (push/index.ts). A missed push is not a lost message: it waits on the page. */
const defaultNotify: MailNotify = async (userId, msg) => { await pushEngine()?.notify(userId, msg); };

/** The person's first name, from their profile ("" when there is none). */
async function firstNameOf(userId: string): Promise<string> {
  const p = await getProfile({ id: userId });
  return (p.fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
