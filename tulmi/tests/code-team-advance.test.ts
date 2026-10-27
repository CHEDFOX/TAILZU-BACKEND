/**
 * A LEAD DRIVEN ONE ADVANCE AT A TIME (the Cloudflare Worker's way: src/code/agent/loop.ts advanceLoop, orchestrator.advance, docs/code-team.md "On Cloudflare"): the lead
 * rests with `waitingOn: "team"` while its helpers work, each helper that ends or needs the person wakes it through the port, and a finished lead stops its helpers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { teamRig, call, buildScript, allGood, OVER } = await import("./team-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { TEAM_REST_MS } = await import("../src/code/team/types.js");
const { TEAM_IDLE_REST_MS } = await import("../src/code/team/lead.js");
type Rig = Awaited<ReturnType<typeof teamRig>>;
type Advance = Awaited<ReturnType<Rig["lead"]["advance"]>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });

/** A passive server (the Worker's), its two ports recorded, and a driver that advances every job it has been told about until none is left. */
async function worker(r: Rig) {
  r.lead.crash();
  const started: string[] = [];
  const woke: string[] = [];
  const orch = r.server({ instanceId: "worker", passive: true, team: { start: async (id) => { started.push(id); }, wake: async (id) => { woke.push(id); } } });
  const log: Array<{ id: string; a: Advance }> = [];
  const advance = async (id: string): Promise<Advance> => {
    const a = await orch.advance(id, { holder: `wf-${log.length}`, turns: 2 });
    log.push({ id, a });
    return a;
  };
  /** Advances the lead and then every helper once, over and over, until the lead is over (the Workflows, taking turns). */
  async function drive(leadId: string, o: { until?: (n: number) => boolean; max?: number } = {}) {
    for (let n = 0; n < (o.max ?? 600); n += 1) {
      if (o.until?.(n)) return;
      if (OVER.includes((await r.jobNow(leadId)).state)) return;
      r.fake.clock.t += 1_000;
      // The runner answers a step on the next turn of the event loop.
      await new Promise<void>((res) => setImmediate(res));
      for (const id of [leadId, ...started]) {
        const j = await r.jobNow(id);
        if (OVER.includes(j.state) || (j.state === "waiting_for_you" && ["answer", "approval", "budget"].includes(j.waitingOn ?? ""))) continue;
        await advance(id);
      }
    }
    throw new Error("the lead did not end");
  }
  return { orch, started, woke, log, advance, drive };
}

describe("a lead advanced one step at a time", () => {
  it("rests with waitingOn team while its helpers work, is woken by each helper that ends, and ends with the pull request", async () => {
    const r = await teamRig();
    allGood(r);
    const w = await worker(r);
    const { job } = await r.startLead(undefined, { orch: w.orch });
    await w.drive(job.id);
    const end = await r.jobNow(job.id);
    const s = await r.stateNow(job.id);
    expect(end.state, s.report?.text).toBe("done");
    // Four helpers were started through the port, each by the id of its job; and the lead was woken when helpers ended.
    expect(w.started).toHaveLength(4);
    expect(new Set(w.started).size).toBe(4);
    expect(w.woke.filter((id) => id === job.id).length).toBeGreaterThanOrEqual(4);
    expect(w.woke.every((id) => id === job.id)).toBe(true);
    // The lead's own advances: waits for its team, with the length of the rest, and a last one that ends it.
    const mine = w.log.filter((x) => x.id === job.id).map((x) => x.a);
    const waits = mine.filter((a): a is Extract<Advance, { next: "wait" }> => a.next === "wait");
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.some((a) => a.waitingOn === "team")).toBe(true);
    // (It also waits for the computer that runs its checks, like any job: that is a different wait.)
    expect(waits.every((a) => a.waitingOn === "team" || a.waitingOn === "runner")).toBe(true);
    expect(waits.some((a) => a.waitingOn === "team" && a.waitMs === TEAM_REST_MS)).toBe(true);
    expect(mine.at(-1)).toEqual({ next: "end", why: "finished" });
    // The claim is let go after every advance, so the Workflow's next one (or its retry) is never blocked.
    expect(end.agentHolder).toBeNull();
    expect(s.team!.parts.every((p) => p.status === "merged")).toBe(true);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
  });

  it("rests longer when every part that is left waits for the person, and the helper that needs the person wakes the lead", async () => {
    const r = await teamRig();
    allGood(r);
    // Every helper asks a question first.
    for (const k of ["p1", "p2", "p3", "p4"]) r.scripts.get(k)!.unshift(call("ask_user", { question: `Question from ${k}?` }));
    const w = await worker(r);
    const { job } = await r.startLead(undefined, { orch: w.orch });
    await w.drive(job.id, { until: () => w.woke.length >= 3 && w.log.some((x) => x.id === job.id && x.a.next === "wait" && x.a.waitMs === TEAM_IDLE_REST_MS), max: 200 });
    const s = await r.stateNow(job.id);
    expect(s.team!.parts.filter((p) => p.id > 0).map((p) => p.status)).toEqual(["blocked", "blocked", "blocked", "ready"]);
    expect(w.woke.length).toBeGreaterThanOrEqual(3);
    expect(w.log.some((x) => x.id === job.id && x.a.next === "wait" && x.a.waitMs === TEAM_REST_MS)).toBe(true);
    expect(w.log.some((x) => x.id === job.id && x.a.next === "wait" && x.a.waitMs === TEAM_IDLE_REST_MS)).toBe(true);
    // The person answers the questions (the fourth part's too, when it starts); the team goes on to the end.
    for (let i = 0; i < 40 && !OVER.includes((await r.jobNow(job.id)).state); i += 1) {
      for (const id of w.started) {
        const j = await r.jobNow(id);
        if (j.state === "waiting_for_you" && j.waitingOn === "answer") await w.orch.answer("alice", id, "Go ahead");
      }
      await w.drive(job.id, { until: (n) => n >= 25 }).catch(() => undefined);
    }
    const end = await r.jobNow(job.id);
    expect(end.state, (await r.stateNow(job.id)).report?.text).toBe("done");
    expect((await r.stateNow(job.id)).team!.parts.every((p) => p.status === "merged")).toBe(true);
  });
});

void buildScript;
