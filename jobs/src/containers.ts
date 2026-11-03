/**
 * X0'S CLOUD RUNNER: A CONTAINER PER JOB, FOR WHEN THE PERSON'S PC IS OFF AND THEIR GITHUB MINUTES ARE USED UP (docs/cloudflare-jobs.md section 13).
 *
 *   XodeRunner                 the Durable Object that owns one job's container (Cloudflare Containers): `begin` starts it with the step, and when the
 *                              container stops, the step's result is reported from its exit code and the minutes it ran (onStop)
 *   CloudContainerProvider     the job router's "paid" place: after the person's PCs and GitHub's computers, by the person's rule. It takes live
 *                              sessions only (the agent's runs on Cloudflare are sessions); the container joins the job's room like any runner
 *
 * The container (jobs/container) fetches the code with the step's read-only token or one-time link and runs the same session script GitHub's
 * computers run. It has the internet (installs need it) and nothing of the Worker's: no secret goes in but the step's own, short-lived ones.
 *
 * What it costs the person: CODE_CLOUD_PAISE_PER_MIN a minute, rounded up (0, the default, is free: a free place needs no yes, placement.ts).
 */
import { Container } from "@cloudflare/containers";
import type { StepAwareProvider } from "../../tulmi/src/code/jobs/desktop.js";
import { NoPlace, type Availability, type AvailabilityCtx } from "../../tulmi/src/code/jobs/providers.js";
import type { JobRouter, RunnerStep } from "../../tulmi/src/code/jobs/router.js";
import type { CodeJob, JobStep } from "../../tulmi/src/code/jobs/types.js";
import { isSessionCommands } from "../../tulmi/src/code/live/protocol.js";
import type { Env } from "./env.js";

/** Minutes a run spends before the work: start, fetch the code, install. Added to an estimate. */
const SETUP_MIN = 2;

interface RunRow { userId: string; jobId: string; stepIdx: number; epoch: number; startedAt: number; paisePerMin: number }

/** How a stopped container's step is reported: the router's submitResult on the Worker (world.ts). */
export type ReportRun = (userId: string, body: Record<string, unknown>) => Promise<unknown>;
let report: ReportRun | null = null;
/** world.ts sets this when it makes the router; tests set their own. */
export function setRunReporter(fn: ReportRun | null): void { report = fn; }

export class XodeRunner extends Container<Env> {
  /** The session's own idle rules end it long before this; this only reaps a container nothing talks to. */
  sleepAfter = "2h";
  enableInternet = true;

  /** Starts the container for one step. A container already running for this job is stopped first (its step is fenced by the epoch). */
  async begin(o: { userId: string; step: RunnerStep; paisePerMin: number }): Promise<void> {
    const prev = await this.ctx.storage.get<RunRow>("run");
    if (prev) { await this.ctx.storage.delete("run"); await this.stop().catch(() => undefined); }
    const row: RunRow = { userId: o.userId, jobId: o.step.jobId, stepIdx: o.step.stepIdx, epoch: o.step.epoch, startedAt: Date.now(), paisePerMin: Math.max(0, o.paisePerMin) };
    await this.ctx.storage.put("run", row);
    await this.start({ envVars: { X0_STEP: btoa(unescape(encodeURIComponent(JSON.stringify(o.step)))), TAILZU_RUNNER_KIND: "container" } });
  }

  /** The step was taken back (the router fenced it): stop, and report nothing. */
  async end(): Promise<void> {
    await this.ctx.storage.delete("run");
    await this.stop().catch(() => undefined);
  }

  override async onStop(p: { exitCode: number; reason: string }): Promise<void> {
    const run = await this.ctx.storage.get<RunRow>("run");
    if (!run) return;
    await this.ctx.storage.delete("run");
    const minutes = Math.max(0, (Date.now() - run.startedAt) / 60_000);
    const body = {
      jobId: run.jobId, stepIdx: run.stepIdx, epoch: run.epoch, exitCode: p.exitCode,
      outputTail: `[X0 cloud: the session ended (${p.reason === "exit" ? `exit ${p.exitCode}` : "stopped"}); ${Math.ceil(minutes)} minute(s)]`,
      minutes: Math.round(minutes * 1000) / 1000, changes: [], paise: Math.ceil(minutes) * run.paisePerMin,
    };
    if (!report) {
      // A Durable Object can wake in a fresh isolate: the world is made, which sets the reporter (world.ts).
      const { getWorld } = await import("./world.js");
      await getWorld(this.env).catch(() => null);
    }
    await report?.(run.userId, body).catch((err) => console.error("cloud runner: the result could not be reported", (err as Error)?.name ?? "error"));
  }

  override onError(error: unknown): unknown {
    console.error("cloud runner: the container failed", (error as Error)?.name ?? "error");
    throw error;
  }
}

export function runnerOf(env: Env, jobId: string): DurableObjectStub<XodeRunner> {
  const ns = env.XODE_RUNNER!;
  return ns.get(ns.idFromName(jobId));
}

export class CloudContainerProvider implements StepAwareProvider {
  readonly kind = "paid" as const;

  constructor(private readonly o: { env: Env; router: () => JobRouter | null; paisePerMin: number }) {}

  private estimate(ctx: AvailabilityCtx): number {
    return Math.ceil(Math.max(1, ctx.estimateMinutes) + SETUP_MIN) * this.o.paisePerMin;
  }

  async available(ctx: AvailabilityCtx): Promise<Availability> {
    return { ok: !!this.o.env.XODE_RUNNER, places: 1, estimatePaise: this.estimate(ctx) };
  }

  /** Live sessions only: a classic step (run, then report the changes) is for the person's PC or GitHub. */
  async availableFor(ctx: AvailabilityCtx, step: JobStep): Promise<Availability> {
    if (!this.o.env.XODE_RUNNER) return { ok: false, reason: "off" };
    if (!isSessionCommands(step.commands)) return { ok: false, reason: "session_only" };
    return { ok: true, places: 1, estimatePaise: this.estimate(ctx) };
  }

  async dispatch(job: CodeJob, step: JobStep): Promise<{ holder: string }> {
    const router = this.o.router();
    if (!router || !this.o.env.XODE_RUNNER) throw new NoPlace("the cloud runner is not set up");
    if (!isSessionCommands(step.commands)) throw new NoPlace("the cloud runner takes live sessions only");
    const offer = await router.runnerStepFor(job, step);
    if (!offer.session) throw new NoPlace("the step has no session to join");
    await runnerOf(this.o.env, job.id).begin({ userId: job.userId, step: offer, paisePerMin: this.o.paisePerMin });
    return { holder: `cloud:${job.id}` };
  }

  async cancel(job: CodeJob): Promise<void> {
    if (this.o.env.XODE_RUNNER) await runnerOf(this.o.env, job.id).end().catch(() => undefined);
  }
}
