/**
 * X0's cloud runner as the job router sees it (src/containers.ts): the "paid" place, live sessions only, priced by the minute (or free), and a step
 * handed to the job's own container with the same offer a person's PC gets.
 */
import { describe, expect, it } from "vitest";
import { CloudContainerProvider } from "../src/containers.js";
import { SESSION_COMMAND } from "../../tulmi/src/code/live/protocol.js";

const JOB = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: "u", projectId: "p", jobId: JOB, estimateMinutes: 3, now: 0 };
const session = { commands: [SESSION_COMMAND] } as never;
const classic = { commands: ["npm test"] } as never;

function rig(o: { binding?: boolean; paisePerMin?: number } = {}) {
  const begun: Array<{ name: string; o: Record<string, any> }> = [];
  const ended: string[] = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (name: string) => ({ begin: async (x: Record<string, any>) => { begun.push({ name, o: x }); }, end: async () => { ended.push(name); } }),
  };
  const offer = { jobId: JOB, stepIdx: 2, epoch: 7, session: { url: "wss://jobs.example/v1/rooms/x/runner", ticket: "t", idleSec: 120 }, repo: { kind: "app" } };
  const router = { runnerStepFor: async () => offer };
  const env = { ...(o.binding === false ? {} : { XODE_RUNNER: ns }) } as never;
  const p = new CloudContainerProvider({ env, router: () => router as never, paisePerMin: o.paisePerMin ?? 0 });
  return { p, begun, ended, offer };
}

describe("the cloud runner as a place", () => {
  it("takes live sessions only, and says what one would cost (setup minutes included)", async () => {
    const { p } = rig({ paisePerMin: 20 });
    expect(await p.availableFor(ctx, session)).toEqual({ ok: true, places: 1, estimatePaise: 100 });
    expect(await p.availableFor(ctx, classic)).toMatchObject({ ok: false, reason: "session_only" });
    expect((await rig().p.available(ctx)).estimatePaise).toBe(0);
  });

  it("without its binding there is no such place", async () => {
    const { p } = rig({ binding: false });
    expect((await p.available(ctx)).ok).toBe(false);
    await expect(p.dispatch({ id: JOB, userId: "u" } as never, session)).rejects.toThrow(/not set up/);
  });

  it("hands the step's offer to the job's own container, and takes it back on cancel", async () => {
    const { p, begun, ended, offer } = rig({ paisePerMin: 20 });
    expect(await p.dispatch({ id: JOB, userId: "u" } as never, session)).toEqual({ holder: `cloud:${JOB}` });
    expect(begun).toEqual([{ name: JOB, o: { userId: "u", step: offer, paisePerMin: 20 } }]);
    await expect(p.dispatch({ id: JOB, userId: "u" } as never, classic)).rejects.toThrow(/live sessions only/);
    await p.cancel({ id: JOB } as never);
    expect(ended).toEqual([JOB]);
  });
});
