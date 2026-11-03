/**
 * THE PERSON'S CONTEXT (docs/context.md): what X0 knows of someone when they ask, so the one key's brain and Ask do not start blank.
 *
 *   build.ts   contextFor: the one builder; the sections in a fixed order, a hard cap, data only
 *   keep.ts    what is learned from what they did: asks, the people they message, what came of a run; forgetting
 *   store.ts   the table (migration 0065), in memory or Supabase
 *
 *   createPersonContext(deps)   the service the routes use, or null when CONTEXT is false
 *
 * Read by POST /v1/ask/decide (into the decide prompt) and POST /v1/agent at a run's first step (into the planner's message); kept from
 * what /v1/ask/decide decided and how /v1/agent runs ended; shown and forgotten at /v1/context (routes/ask/context.ts).
 */
import type { AskDecision, DecideInput } from "../askDecide/index.js";
import type { AuthedUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import { getProfile } from "../profile/store.js";
import { routineStore, type RoutineStore } from "../routines/index.js";
import { clean, contextFor, routineWork, type BuiltContext, type OpenWork } from "./build.js";
import { forgetAll, forgetPerson, forgetTurns, keepAsk, keepResult, type KeepDeps } from "./keep.js";
import { contextStore, emptyKept, type ContextStore, type Kept } from "./store.js";

export { contextFor, renderContext, routineWork, clean, ago, tzWords, CONTEXT_WAIT_MS, type BuiltContext, type ContextParts, type ContextOptions, type ContextSources, type YouFact, type FactStatus, type OpenWork } from "./build.js";
export { keepAsk, keepResult, forgetAll, forgetPerson, forgetTurns, notKept, secretish, foldInto, foldPiece, rankPeople, TURNS_KEPT, PEOPLE_KEPT, SUMMARY_MAX, type KeepDeps } from "./keep.js";
export { contextStore, resetContextStoreForTests, MemoryContextStore, cleanKept, emptyKept, type ContextStore, type Kept, type KeptTurn, type Person } from "./store.js";

/** What open work is read from, narrowed to what is read. */
export interface PersonContextDeps {
  jobs?: { listJobs(userId: string, limit?: number): Promise<ReadonlyArray<{ state: string; task: string; waitingOn: string | null }>> } | null;
  connectors?: { tasks: { list(userId: string, limit?: number): Promise<ReadonlyArray<{ state: string; title: string; approval: unknown }>> } } | null;
  routines?: RoutineStore;
  store?: ContextStore;
  on?: KeepDeps["on"];
  now?: () => number;
}

const OPEN_READ = 20;
const safe = <T>(p: Promise<T>, empty: T): Promise<T> => p.catch(() => empty);

export class PersonContext {
  constructor(private readonly d: PersonContextDeps = {}) {}

  private keep(): KeepDeps {
    return { ...(this.d.store ? { store: this.d.store } : {}), ...(this.d.on ? { on: this.d.on } : {}), ...(this.d.now ? { now: this.d.now } : {}) };
  }

  /** Open work and lately done, read live: routines, Xode's questions, connected apps' calls waiting for a yes. */
  async openWork(userId: string, now: number, tz: number): Promise<OpenWork> {
    const [routines, jobs, tasks] = await Promise.all([
      safe((this.d.routines ?? routineStore()).list(userId), []),
      this.d.jobs ? safe(this.d.jobs.listJobs(userId, OPEN_READ), []) : Promise.resolve([]),
      this.d.connectors ? safe(this.d.connectors.tasks.list(userId, OPEN_READ), []) : Promise.resolve([]),
    ]);
    const r = routineWork(routines, now, tz);
    const waiting = [
      ...jobs.filter((j) => j.state === "waiting_for_you").map((j) => `Xode waits for their ${j.waitingOn === "approval" ? "yes" : "answer"}: ${clean(j.task, 80)}`),
      ...tasks.filter((t) => t.state === "waiting" && t.approval).map((t) => `A connected app's action waits for their yes: ${clean(t.title, 80)}`),
    ];
    return { open: [...waiting, ...r.open], results: r.results };
  }

  /** The context for this person now. Never throws. */
  for(user: AuthedUser, o: { tz?: number; about?: string; now?: number; max?: number } = {}): Promise<BuiltContext> {
    const now = o.now ?? (this.d.now ?? Date.now)();
    return contextFor(user.id, { ...o, now }, {
      ...(this.d.store ? { store: this.d.store } : {}),
      ...(this.d.on ? { on: this.d.on } : {}),
      profile: () => getProfile(user),
      open: () => this.openWork(user.id, now, o.tz ?? 330),
    });
  }

  /** What is kept, as the app shows it. */
  async kept(userId: string): Promise<Kept> {
    return (await (this.d.store ?? contextStore()).get(userId)) ?? emptyKept();
  }

  keepAsk(userId: string, input: DecideInput, decision: AskDecision): Promise<boolean> {
    return keepAsk(userId, { input, decision }, this.keep());
  }

  keepResult(userId: string, run: { said: string; result: string; app?: string; private?: boolean }): Promise<boolean> {
    return keepResult(userId, run, this.keep());
  }

  forgetAll(userId: string): Promise<void> { return forgetAll(userId, this.keep()); }
  forgetPerson(userId: string, name: string): Promise<boolean> { return forgetPerson(userId, name, this.keep()); }
  forgetTurns(userId: string): Promise<void> { return forgetTurns(userId, this.keep()); }
}

/** The service, or null when CONTEXT is false. */
export function createPersonContext(d: PersonContextDeps = {}): PersonContext | null {
  return getConfig().CONTEXT ? new PersonContext(d) : null;
}
