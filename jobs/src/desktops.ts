/**
 * THE PERSON'S OWN PCS AS A PLACE FOR THE WORKER'S ROUTER.
 *
 * The router (tulmi/src/code/jobs/router.ts) asks each place whether it has room and gives it a step. On the VPS the place for a person's PCs
 * reads the process's DeviceBook; here it reads the person's UserDevices Durable Object (userDevices.ts): the PCs that have a socket open, said
 * hello, have "run commands" on, allow the project and are not busy. A PC counts only if it is not already holding a step the router gave it.
 *
 * `dispatch` picks one, builds the step as the PC is given it (the router's `runnerStepFor`: the read-only repo access, the staged edits, and for
 * a live session the way into the job's room) and sends it down the PC's socket. A PC with no socket makes `dispatch` throw NoPlace and the router
 * chooses again. The step's lease is the router's usual one: a PC that does not take it, or goes quiet, loses it in 90 seconds and the step moves.
 */
import type { StepAwareProvider } from "../../tulmi/src/code/jobs/desktop.js";
import { NoPlace, type Availability, type AvailabilityCtx } from "../../tulmi/src/code/jobs/providers.js";
import { isSessionCommands } from "../../tulmi/src/code/live/protocol.js";
import type { JobRouter } from "../../tulmi/src/code/jobs/router.js";
import type { JobStore } from "../../tulmi/src/code/jobs/store.js";
import type { CodeJob, JobStep } from "../../tulmi/src/code/jobs/types.js";
import type { DeviceOffer } from "../../tulmi/src/code/live/protocol.js";
import type { DeviceView, UserDevices } from "./userDevices.js";
import type { Env } from "./env.js";

export interface CloudDesktopOptions {
  devices: (userId: string) => Pick<DurableObjectStub<UserDevices>, "capable" | "offer" | "cancel" | "online">;
  store: Pick<JobStore, "findHeld">;
  /** The router this provider belongs to (it makes the provider's step; the two are built together, so it is asked for late). */
  router: () => Pick<JobRouter, "runnerStepFor"> | null;
}

export function devicesOf(env: Pick<Env, "USER_DEVICES">) {
  return (userId: string) => env.USER_DEVICES.get(env.USER_DEVICES.idFromName(userId));
}

export class CloudDesktopProvider implements StepAwareProvider {
  readonly kind = "desktop" as const;

  constructor(private readonly o: CloudDesktopOptions) {}

  /**
   * The PCs that could take a step of this project, best first: capable for it (a live-only PC takes a live session and no other step; a PC that declined
   * this step is not asked again; one in a container comes after the person's own machine), and not holding a step already.
   */
  private async idle(userId: string, projectId: string, step?: Pick<JobStep, "commands" | "declined">): Promise<DeviceView[]> {
    const capable = await this.o.devices(userId).capable(projectId, step ? { session: isSessionCommands(step.commands), skip: step.declined } : {});
    const free: DeviceView[] = [];
    for (const d of capable) {
      if ((await this.o.store.findHeld(userId, "desktop", d.deviceId)).length === 0) free.push(d);
    }
    return free;
  }

  async available(ctx: AvailabilityCtx): Promise<Availability> {
    const places = (await this.idle(ctx.userId, ctx.projectId)).length;
    return { ok: places > 0, places };
  }

  async availableFor(ctx: AvailabilityCtx, step: JobStep): Promise<Availability> {
    const places = (await this.idle(ctx.userId, ctx.projectId, step)).length;
    return { ok: places > 0, places };
  }

  async dispatch(job: CodeJob, step: JobStep): Promise<{ holder: string }> {
    const router = this.o.router();
    if (!router) throw new NoPlace("the router is not ready");
    const devices = this.o.devices(job.userId);
    for (const d of await this.idle(job.userId, job.projectId, step)) {
      const offer = (await router.runnerStepFor(job, step)) as unknown as DeviceOffer;
      if (await devices.offer(d.deviceId, offer)) return { holder: d.deviceId };
    }
    throw new NoPlace("none of the person's computers could be reached");
  }

  /** Tells the PC to let go of the step. Its next progress or result carries the old epoch and is refused as stale_lease in any case. */
  async cancel(job: CodeJob): Promise<void> {
    if (job.leaseHolder) await this.o.devices(job.userId).cancel(job.leaseHolder, job.id, job.leaseEpoch).catch(() => false);
  }
}
