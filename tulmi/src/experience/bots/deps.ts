/**
 * THE REAL BotsDeps: the reads a Bots app screen makes, for one signed-in person, from the services the server runs.
 *
 * Built per request by server.ts (botsDepsFor). Every service may be absent (its switch is off): the read is then
 * empty, and the screen draws what is true (the four built-ins, nothing waiting). `api` calls the app's own HTTP
 * routes in-process (fastify inject) as the person, so a screen can read anything a client could, through the same
 * checks, without a new service being threaded through here.
 */
import type { AuthedUser } from "../../auth/supabase.js";
import type { Bots } from "../../bots/index.js";
import { stateOf } from "../../code/agent/types.js";
import type { JobRouter } from "../../code/jobs/router.js";
import type { CodeJob } from "../../code/jobs/types.js";
import type { Connectors } from "../../connectors/index.js";
import type { BotLite, BotsDeps, JobLite, TaskLite } from "./live.js";
import { DEFAULT_MONTH_BUDGET_PAISE } from "./live.js";

export interface BotsServices {
  bots: Bots | null;
  jobs: JobRouter | null;
  connectors: Connectors | null;
  /** Minutes writing by voice saved in the last seven days (history/store.ts statsForUser). */
  minutesSaved?: (user: AuthedUser, tzOffsetMinutes: number) => Promise<number>;
  /** The app's own routes, in-process (fastify's inject). */
  inject?: (o: { method: string; url: string; payload?: unknown; headers: Record<string, string> }) => Promise<{ statusCode: number; body: string }>;
}

/** A job as the Bots app reads it: its state, and the question or yes its agent is waiting on. */
export function jobLite(j: CodeJob): JobLite {
  const s = stateOf(j.checkpoint);
  const w = s?.waiting;
  return {
    id: j.id, task: j.task, state: j.state, waitingOn: j.waitingOn,
    ...(w?.kind === "question" ? { question: { text: w.question, ...(w.options?.length ? { options: [...w.options] } : {}) } } : {}),
    ...(w?.kind === "approval" ? { approval: { summary: approvalLine(w.action, w.summary) } } : {}),
    spentPaise: j.spentPaise, createdAt: j.createdAt, updatedAt: j.updatedAt,
  };
}

/** What a waiting yes is about, in a line: the policy's own title when it gave one, else its action in words. */
export function approvalLine(action: string, summary: Record<string, unknown>): string {
  const t = typeof summary.title === "string" ? summary.title : typeof summary.text === "string" ? summary.text : "";
  if (t.trim()) return t.trim().slice(0, 140);
  if (action === "job.plan") return "Go ahead with this plan?";
  return `Okay to ${action.replace(/^[a-z]+\./, "").replace(/[._-]+/g, " ")}?`;
}

export function botsDepsFor(svc: BotsServices, user: AuthedUser, authorization: string, tzOffsetMinutes: number): BotsDeps {
  return {
    async bots(): Promise<BotLite[]> {
      if (!svc.bots) return [];
      return (await svc.bots.list(user.id)).map((b) => ({ slug: b.slug, name: b.name, colour: b.colour, purpose: b.purpose, builtin: b.builtin }));
    },
    async jobs(): Promise<JobLite[]> {
      return svc.jobs ? (await svc.jobs.listJobs(user.id, 50)).map(jobLite) : [];
    },
    async tasks(): Promise<TaskLite[]> {
      if (!svc.connectors) return [];
      return (await svc.connectors.tasks.list(user.id, 20)).map((t) => ({
        id: t.id, state: t.state, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt,
        ...(t.approval ? { approval: { id: t.approval.id, connector: t.approval.connector, preview: t.approval.preview } } : {}),
      }));
    },
    async minutesSaved(): Promise<number> {
      return svc.minutesSaved ? svc.minutesSaved(user, tzOffsetMinutes) : 0;
    },
    async budgetPaise(): Promise<number> {
      return DEFAULT_MONTH_BUDGET_PAISE;
    },
    now: () => Date.now(),
    async api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
      if (!svc.inject) throw new Error("api: not available");
      if (!path.startsWith("/v1/")) throw new Error(`api: not an API path: ${path}`);
      const r = await svc.inject({
        method, url: path, ...(body === undefined ? {} : { payload: body }),
        headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      });
      if (r.statusCode < 200 || r.statusCode >= 300) throw Object.assign(new Error(`api: ${method} ${path} → ${r.statusCode}`), { status: r.statusCode });
      return (r.body ? JSON.parse(r.body) : null) as T;
    },
  };
}

/** No one signed in: nothing to read. The screens draw the four built-ins and nothing waiting. */
export function emptyDeps(): BotsDeps {
  return {
    bots: async () => [], jobs: async () => [], tasks: async () => [], minutesSaved: async () => 0,
    budgetPaise: async () => DEFAULT_MONTH_BUDGET_PAISE, now: () => Date.now(),
    api: async () => { throw Object.assign(new Error("api: not signed in"), { status: 401 }); },
  };
}
