/**
 * LIVE UPDATES: SAYING SO WHEN SOMETHING A PERSON SEES CHANGES (bus.ts is the channel, topics.ts the names).
 *
 *   livePublish(userId, ["keybot"])       a change, for every device the person has open (bursts coalesced, below)
 *   installLiveWrites(app)                every 2xx write over HTTP whose route is in topics.ts's table publishes its topics,
 *                                         after the response has gone (an onResponse hook: never in a request's way)
 *   liveJobStore(store)                   the Code bot's jobs say so as they move (the agent, the ticker, a runner's result),
 *                                         whoever made the change: job:<id>, code, home, activity; and the job's Live Activity
 *                                         (setJobChangeHook: the APNs pusher, widgets/activity.ts, when it is configured)
 *   liveNote(userId, id)                  a meeting's notes changed (notes/store.ts): notes, note:<id>
 *
 * A BURST IS ONE EVENT. Per person and topic, the first event goes at once and the rest of a burst become one more at its end
 * (a job's checkpoints, a note's transcript growing every few seconds, a write that calls another route in-process). One topic's
 * gap: GAP_MS, or ITEM_GAP_MS for one thing's own topic (job:<id>, note:<id>), which a person watches closely; a working job's
 * lists (Home, Activity, the Code bot's) LIST_GAP_MS, since each of those reloads reads a good deal.
 *
 * Who wrote, for the hook: the session's user id, read locally from the JWT (auth/jwt.ts localUserId, no network), else the same
 * resolveUser the route used (a desktop's static token, a server with no JWT key). Only after a 2xx, so the route has already
 * accepted that session.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { live, type LiveBus } from "./bus.js";
import { jobTopic, noteTopic, TOPIC, topicsForWrite } from "./topics.js";
import { localUserId } from "../auth/jwt.js";
import { resolveUser } from "../auth/supabase.js";
import type { CodeJob, JobStep } from "../code/jobs/types.js";
import type { JobPatch, JobStore } from "../code/jobs/store.js";

export const GAP_MS = 1000;
export const ITEM_GAP_MS = 400;

const gapFor = (topic: string): number => (topic.startsWith("job:") || topic.startsWith("note:") ? ITEM_GAP_MS : GAP_MS);

/** Per person and topic: the first event of a burst at once, the rest folded into one at the end of the gap. */
export class LiveThrottle {
  private last = new Map<string, number>();
  private due = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly bus: LiveBus = live,
    private readonly gap: (topic: string) => number = gapFor,
    private readonly now: () => number = Date.now,
  ) {}

  publish(userId: string, topics: Iterable<string>): void {
    if (!userId) return;
    for (const topic of new Set(topics)) if (topic) this.hit(userId, topic);
  }

  private hit(userId: string, topic: string): void {
    const key = `${userId}\n${topic}`;
    if (this.due.has(key)) return;                         // the end of this burst is already on its way
    const t = this.now();
    const prev = this.last.get(key);
    const gap = this.gap(topic);
    if (prev === undefined || t - prev >= gap) { this.fire(userId, topic, key, t); return; }
    const timer = setTimeout(() => { this.due.delete(key); this.fire(userId, topic, key, this.now()); }, gap - (t - prev));
    timer.unref?.();
    this.due.set(key, timer);
  }

  private fire(userId: string, topic: string, key: string, t: number): void {
    this.last.set(key, t);
    if (this.last.size > 5000) {
      for (const [k, at] of this.last) if (t - at >= this.gap(k.slice(k.indexOf("\n") + 1)) && !this.due.has(k)) this.last.delete(k);
    }
    this.bus.publish([userId], topic);
  }

  /** Drop what is waiting (tests, shutdown). */
  clear(): void {
    for (const t of this.due.values()) clearTimeout(t);
    this.due.clear();
    this.last.clear();
  }
}

const throttle = new LiveThrottle();
/** A job at work writes often: the lists it shows on (Home, Activity, the Code bot's) hear of it at most every LIST_GAP_MS. */
export const LIST_GAP_MS = 3000;
const listThrottle = new LiveThrottle(live, () => LIST_GAP_MS);

/** Tell every device this person has open that these topics changed. Never throws. */
export function livePublish(userId: string, topics: Iterable<string>): void {
  try { throttle.publish(userId, topics); } catch { /* a hint lost is a screen refreshed a little later */ }
}

/** A meeting's notes changed: the list and the note. */
export function liveNote(userId: string, id: string): void {
  livePublish(userId, [TOPIC.notes, noteTopic(id)]);
}

/** Who else hears that a job changed: the "Bots at work" Live Activity's pusher (widgets/activity.ts, set by routes/widgets.ts). */
let jobChangeHook: ((userId: string, jobId: string) => void) | null = null;
export function setJobChangeHook(fn: ((userId: string, jobId: string) => void) | null): void { jobChangeHook = fn; }

/** A Code bot job changed: its page at once, the Code bot's lists, Home's tiles and Activity a little more slowly; and its Live Activity. */
export function liveJob(userId: string, jobId: string): void {
  livePublish(userId, [jobTopic(jobId)]);
  try { listThrottle.publish(userId, [TOPIC.code, TOPIC.home, TOPIC.activity]); } catch { /* a hint lost */ }
  try { jobChangeHook?.(userId, jobId); } catch { /* never the writer's problem */ }
}

/** Who made this request, for publishing after it. Null when nobody can be said to have. */
export async function writerOf(req: FastifyRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  const local = await localUserId(auth).catch(() => null);
  if (local) return local;
  return (await resolveUser(auth).catch(() => null))?.id ?? null;
}

export interface LiveWritesOptions {
  publish?: (userId: string, topics: string[]) => void;
  userOf?: (req: FastifyRequest) => Promise<string | null>;
}

/** Every successful write in topics.ts's table publishes its topics, once the response has gone. */
export function installLiveWrites(app: FastifyInstance, o: LiveWritesOptions = {}): void {
  const publish = o.publish ?? livePublish;
  const userOf = o.userOf ?? writerOf;
  app.addHook("onResponse", async (req, reply) => {
    const code = reply.statusCode;
    if (code < 200 || code >= 300 || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const route = req.routeOptions?.url;
    if (!route) return;
    const topics = topicsForWrite(req.method, route, (req.params ?? {}) as Record<string, unknown>);
    if (!topics.length) return;
    try {
      const id = await userOf(req);
      if (id) publish(id, topics);
    } catch { /* never the request's problem */ }
  });
}

/** Lease and claim bookkeeping: changes nobody sees on a screen. */
const UNSEEN: ReadonlySet<keyof JobPatch> = new Set<keyof JobPatch>([
  "leaseHolder", "leaseEpoch", "leaseExpiresAt", "reassignments", "agent", "agentHolder", "agentEpoch", "agentExpiresAt",
]);
const seen = (patch: JobPatch | undefined): boolean => !patch || Object.keys(patch).some((k) => !UNSEEN.has(k as keyof JobPatch));

/**
 * The job store, saying so whenever a job or one of its steps changes in a way a screen shows. Every method is the store's own;
 * the publish comes after the write and never changes its result. A step's job is looked up once to learn whose it is.
 */
export function liveJobStore<S extends JobStore>(store: S, onChange: (userId: string, jobId: string) => void = liveJob): S {
  const owners = new Map<string, string>();
  const own = (j: CodeJob | null | undefined): void => {
    if (!j?.id || !j.userId) return;
    owners.set(j.id, j.userId);
    if (owners.size > 2000) owners.delete(owners.keys().next().value as string);
  };
  const tell = (j: CodeJob | null | undefined): void => { if (j?.id && j.userId) { own(j); onChange(j.userId, j.id); } };
  const stepOf = (jobId: string): void => {
    const known = owners.get(jobId);
    if (known) { onChange(known, jobId); return; }
    void store.getJobById(jobId).then(tell, () => undefined);
  };
  return new Proxy(store, {
    get(target, key) {
      const v = Reflect.get(target, key, target) as unknown;
      if (typeof v !== "function") return v;
      const fn = v as (...a: unknown[]) => unknown;
      switch (key) {
        case "createJob":
          return async (...a: unknown[]) => { const j = (await fn.apply(target, a)) as CodeJob; try { tell(j); } catch { /* hint only */ } return j; };
        case "casJob":
          return async (...a: unknown[]) => {
            const j = (await fn.apply(target, a)) as CodeJob | null;
            try { if (seen(a[2] as JobPatch)) tell(j); else own(j); } catch { /* hint only */ }
            return j;
          };
        case "getJob": case "getJobById":
          return async (...a: unknown[]) => { const j = (await fn.apply(target, a)) as CodeJob | null; own(j); return j; };
        case "addStep": case "updateStep":
          return async (...a: unknown[]) => {
            const s = (await fn.apply(target, a)) as JobStep | null;
            try { if (s && typeof a[0] === "string") stepOf(a[0]); } catch { /* hint only */ }
            return s;
          };
        default:
          return fn.bind(target);
      }
    },
  });
}
