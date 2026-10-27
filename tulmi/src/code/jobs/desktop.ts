/**
 * THE PERSON'S OWN PCS AS A PLACE, THAT LOOKS AT THE STEP IT IS ASKED ABOUT (protocol version 2).
 *
 * providers.ts has the plain DesktopProvider: any online computer that has allowed the project and is idle. That cannot tell a live session from an
 * ordinary step, or know a computer said no to this one, so it cannot keep the two promises of protocol version 2:
 *
 *   - a LIVE-ONLY computer (hello.capabilities.liveOnly) takes a live session and no ordinary step;
 *   - a computer that DECLINED a step is not offered that step again (the router moved it at once: router.ts decline).
 *
 * It also puts a computer that is not in a container first (the person's own machine), then the one heard from most recently (devices.ts capable).
 *
 * The router asks `availableFor(ctx, step)` when a provider has it (a step-aware one) and `available(ctx)` otherwise, so the plain provider and a
 * test's fake are untouched. The Worker's CloudDesktopProvider (jobs/src/desktops.ts) answers the same two questions from the person's Durable Object.
 */
import { isSessionCommands } from "../live/protocol.js";
import type { Device, DeviceBook } from "./devices.js";
import { NoPlace, type Availability, type AvailabilityCtx, type ComputeProvider } from "./providers.js";
import type { JobStore } from "./store.js";
import type { CodeJob, JobStep } from "./types.js";

/** A place that can say yes or no to one particular step. */
export interface StepAwareProvider extends ComputeProvider {
  availableFor(ctx: AvailabilityCtx, step: JobStep): Promise<Availability>;
}

export const isStepAware = (p: ComputeProvider): p is StepAwareProvider => typeof (p as { availableFor?: unknown }).availableFor === "function";

export class CapableDesktopProvider implements StepAwareProvider {
  readonly kind = "desktop" as const;

  constructor(private readonly o: { devices: DeviceBook; store: JobStore; now: () => number }) {}

  /** The computers that could take this step, best first: capable for it, and not holding a step already. */
  private async idle(userId: string, projectId: string, step?: Pick<JobStep, "commands" | "declined">): Promise<Device[]> {
    const capable = this.o.devices.capable(userId, projectId, this.o.now(), {
      session: step ? isSessionCommands(step.commands) : false, ...(step?.declined.length ? { skip: new Set(step.declined) } : {}),
    });
    const free: Device[] = [];
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
    const [device] = await this.idle(job.userId, job.projectId, step);
    if (!device) throw new NoPlace("none of the person's computers is free");
    return { holder: device.deviceId };
  }

  /** Nothing to tell the PC: its next progress or result carries the old epoch and is refused as stale_lease. */
  async cancel(): Promise<void> {}
}
