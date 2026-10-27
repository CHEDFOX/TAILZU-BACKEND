/**
 * THE TEAM'S MONEY, ITS CRASHES AND ITS END (src/code/team, docs/code-team.md sections 3 and 7): the lead keeps 20% and divides the rest, a part that runs out of its slice stops
 * cleanly and is reported, a lead that crashes is picked up again without running a finished part twice, and a lead that ends stops its helpers and gives their money back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { teamRig, call, done, edit, buildScript, settle, goodSplit, allGood, CONTRACT_EDIT, OVER, run, chain } = await import("./team-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { reserveOf } = await import("../src/code/team/budget.js");
const { LostClaim } = await import("../src/code/agent/run.js");
type Rig = Awaited<ReturnType<typeof teamRig>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });
afterEach(() => vi.restoreAllMocks());

describe("the budget", () => {
  it("keeps a fifth for the lead, shares the rest by the parts' shares, and takes it from the lead's wallet while the helpers work", async () => {
    const r = await teamRig();
    allGood(r);
    const BUDGET = 10_000;
    // The lead's wallet, seen at the moment each helper starts its first turn.
    const wallet: Array<{ spent: number; budget: number }> = [];
    for (const k of ["p1", "p2", "p3", "p4"]) {
      const script = r.scripts.get(k)!;
      script.unshift((() => ({ calls: [{ name: "note", args: { text: "starting" } }] })) as never);
    }
    const { job } = await r.startLead(undefined, { budgetPaise: BUDGET });
    const watcher = setInterval(() => void r.jobNow(job.id).then((j) => { if (j.spentPaise > 1000) wallet.push({ spent: j.spentPaise, budget: j.budgetPaise }); }), 1);
    const { s, job: end } = await run(r, job.id);
    clearInterval(watcher);
    expect(end.state, s.report?.text).toBe("done");
    const t = s.team!;
    expect(t.reservePaise).toBe(reserveOf(BUDGET));
    expect(t.reservePaise).toBe(2000);
    // The pool is what was left, less the reserve, divided by shares 3:3:2:2 (the split said so) to the paise.
    const helpers = t.parts.filter((p) => p.id > 0);
    expect(helpers.reduce((n, p) => n + p.budgetPaise, 0)).toBe(t.poolPaise);
    expect(t.poolPaise).toBeLessThanOrEqual(BUDGET - 2000);
    expect(t.poolPaise).toBeGreaterThan(BUDGET - 2000 - 200);
    const by = (n: number) => helpers.find((p) => p.id === n)!;
    // (A paise that does not divide goes to one of them.)
    expect(Math.abs(by(1).budgetPaise - by(2).budgetPaise)).toBeLessThanOrEqual(1);
    expect(Math.abs(by(3).budgetPaise - by(4).budgetPaise)).toBeLessThanOrEqual(1);
    expect(Math.abs(by(1).budgetPaise / by(3).budgetPaise - 1.5)).toBeLessThan(0.01);
    // While they worked the pool was out of the lead's wallet (spent counted it); the job's own budget never changed.
    expect(wallet.length).toBeGreaterThan(0);
    expect(Math.max(...wallet.map((w) => w.spent))).toBeGreaterThanOrEqual(t.poolPaise);
    expect(wallet.every((w) => w.budget === BUDGET)).toBe(true);
    // Each helper's job was made with its slice as the job's own budget.
    for (const h of await r.helpers(job.id)) {
      const part = by(h.state.part!.id);
      expect((await r.jobNow(h.id)).budgetPaise).toBe(part.budgetPaise);
    }
    // At the end what a part did not spend went back, so the lead's figure is what the team cost: its own spend and the helpers'.
    for (const p of helpers) {
      expect(p.refundedPaise + p.spentPaise, `part ${p.id}`).toBe(p.reservedPaise);
      expect(p.spentPaise).toBeGreaterThan(0);
    }
    const helperSpend = helpers.reduce((n, p) => n + p.spentPaise, 0);
    expect(end.spentPaise).toBeGreaterThanOrEqual(helperSpend);
    expect(end.spentPaise).toBeLessThan(BUDGET * 0.1);
    expect(end.spentPaise - helperSpend, "the lead's own cost").toBeLessThan(200);
    expect(s.report!.costPaise).toBe(end.spentPaise);
  });

  it("asks for more money instead of starting a team the budget cannot pay, and goes on when it comes", async () => {
    const r = await teamRig();
    allGood(r);
    // 600 paise: the reserve (120) and 150 for each of four helpers is 720.
    const { job } = await r.startLead(undefined, { budgetPaise: 600 });
    await settle(r, async () => (await r.jobNow(job.id)).state === "waiting_for_you");
    const j = await r.jobNow(job.id);
    expect(j.waitingOn).toBe("budget");
    const s = await r.stateNow(job.id);
    expect(s.report!.outcome).toBe("budget");
    expect(s.report!.text).toContain("ran out of budget");
    expect(await r.helpers(job.id)).toHaveLength(0);
    expect(s.team!.stage).toBe("run");
    // The split was not asked for again: the team is kept.
    await r.lead.addBudget("alice", job.id, 20_000);
    const end = await run(r, job.id);
    expect(end.job.state, end.s.report?.text).toBe("done");
    expect(r.json.of("team.split")).toHaveLength(1);
    expect(end.s.team!.parts.every((p) => p.status === "merged")).toBe(true);
  });

  it("stops one part that runs out of its slice cleanly, reports it, goes on with the others, and parks for the money of that part alone", async () => {
    const r = await teamRig();
    allGood(r);
    r.model.paise = 40;
    const split = goodSplit();
    split.parts[4]!.budgetShare = 5;
    for (const p of split.parts.slice(1, 4)) p.budgetShare = 10;
    r.json.on("team.split", split);
    const { job, branch } = await r.startLead(undefined, { budgetPaise: 2400 });
    await settle(r, async () => (await r.jobNow(job.id)).state === "waiting_for_you");
    const j = await r.jobNow(job.id);
    const s = await r.stateNow(job.id);
    expect(j.waitingOn, s.report?.text).toBe("budget");
    const by = (n: number) => s.team!.parts.find((p) => p.id === n)!;
    // The others were built, reviewed and merged; the fourth stopped, and says so.
    expect([1, 2, 3].map((n) => by(n).status)).toEqual(["merged", "merged", "merged"]);
    expect(by(4).status).toBe("exhausted");
    expect(by(4).reason).toContain("used up its share of the budget");
    const stopped = (await r.helpers(job.id)).find((h) => h.state.part!.id === 4)!;
    const sj = await r.jobNow(stopped.id);
    expect(sj.state).toBe("waiting_for_you");
    expect(sj.waitingOn).toBe("budget");
    expect(stopped.state.report).toMatchObject({ outcome: "budget" });
    // Its slice was used, and nothing else's: the helper never spent past it.
    expect(sj.spentPaise).toBeLessThanOrEqual(sj.budgetPaise);
    // The lead asks the person, naming the part, once; the helper's own question is the helper's.
    expect(s.waiting).toMatchObject({ kind: "budget" });
    expect(r.toldOf("needs_you").some((n) => n.data.jobId === job.id && /Part 4/.test(n.data.reason ?? ""))).toBe(true);
    // Not merged, not in the branch: a part that stopped half way is not put in.
    expect(r.fake.files(r.repo, branch)["src/util/format.ts"]).toBe('export const format = "v0";\n');
    // The money comes: the part is given it, goes on, is reviewed and merged, and the team is done.
    await r.lead.addBudget("alice", job.id, 3000);
    const end = await run(r, job.id);
    expect(end.job.state, end.s.report?.text).toBe("done");
    expect(end.s.team!.parts.find((p) => p.id === 4)!.status).toBe("merged");
    expect(r.fake.files(r.repo, branch)["src/util/format.ts"]).toBe('export const format = "v1";\n');
    expect((await r.jobNow(stopped.id)).state).toBe("done");
  });
});

describe("a lead that crashes", () => {
  it("is picked up by another server, and does not run a part that finished again, nor make a helper twice", async () => {
    const r = await teamRig();
    allGood(r);
    const { job, branch } = await r.startLead();
    // The first server dies when the third helper starts its first turn: part 1 or 2 may be finished by then, the lead is waiting.
    let crashed = false;
    for (const k of ["p3", "p4"]) {
      r.scripts.get(k)!.unshift(() => {
        if (!crashed) { crashed = true; r.lead.crash(); throw new LostClaim(); }
        return { calls: [{ name: "note", args: { text: "back" } }] };
      });
    }
    await settle(r, async () => crashed, 200).catch(() => undefined);
    expect(crashed).toBe(true);
    const turnsBefore = r.model.turns;
    const jobsBefore = (await r.helpers(job.id)).length;
    // Another server over the same stores picks the jobs up after their claims have run out.
    const two = r.server({ instanceId: "two" });
    r.fake.clock.t += 3 * 60_000;
    await two.tick();
    for (let i = 0; i < 300; i += 1) {
      if (OVER.includes((await r.jobNow(job.id)).state)) break;
      await two.idle();
      r.fake.clock.t += 1_000;
      await two.tick();
      await new Promise<void>((res) => setImmediate(res));
    }
    const s = await r.stateNow(job.id);
    expect((await r.jobNow(job.id)).state, s.report?.text).toBe("done");
    // Four helpers, never five; four merge commits, never five; every part merged once.
    const hs = await r.helpers(job.id);
    expect(hs).toHaveLength(4);
    expect(jobsBefore).toBeLessThanOrEqual(4);
    expect(new Set(hs.map((h) => h.state.part!.id)).size).toBe(4);
    expect(chain(r, branch).filter((c) => c.parents.length === 2)).toHaveLength(4);
    expect(s.team!.parts.every((p) => p.status === "merged")).toBe(true);
    // A part's script runs once: the turns the model took are the scripts' (plus the one that crashed and the note the retry took).
    expect(r.model.turns - turnsBefore).toBeLessThan(40);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    // The crashed server's money was never taken twice: the lead's figure is the team's real cost.
    const end = await r.jobNow(job.id);
    const helperSpend = s.team!.parts.reduce((n, p) => n + p.spentPaise, 0);
    expect(end.spentPaise - helperSpend).toBeLessThan(200);
    for (const p of s.team!.parts.filter((x) => x.id > 0)) expect(p.refundedPaise + p.spentPaise).toBe(p.reservedPaise);
  });

  it("finds the helper it made before it wrote it down, and uses that one", async () => {
    const r = await teamRig();
    allGood(r);
    // The first start of a helper fails once, after the job exists and before the lead has written it into its state: a crash between the two.
    let failed = false;
    const lead = r.server({
      instanceId: "flaky",
      team: { start: async () => { if (!failed) { failed = true; throw new Error("the server went away"); } } },
    });
    const { job } = await r.startLead(undefined, { orch: lead });
    for (let i = 0; i < 400; i += 1) {
      if (OVER.includes((await r.jobNow(job.id)).state)) break;
      await lead.idle();
      r.fake.clock.t += 20_000;
      await lead.tick();
      await new Promise<void>((res) => setImmediate(res));
    }
    expect(failed).toBe(true);
    const s = await r.stateNow(job.id);
    expect((await r.jobNow(job.id)).state, s.report?.text).toBe("done");
    const hs = await r.helpers(job.id);
    expect(hs).toHaveLength(4);
    expect(new Set(hs.map((h) => h.state.part!.id)).size).toBe(4);
  });
});

describe("a lead that ends", () => {
  it("stops its helpers, and gives back the money they had not spent", async () => {
    const r = await teamRig();
    allGood(r);
    let leadId = "";
    // The person stops the lead while the helpers are working: it happens in a helper's second turn.
    r.scripts.get("p3")!.splice(1, 0, () => { void r.lead.stopJob("alice", leadId); return { calls: [{ name: "note", args: { text: "working" } }] }; });
    const started = await r.startLead(undefined, { budgetPaise: 10_000 });
    leadId = started.job.id;
    await settle(r, async () => OVER.includes((await r.jobNow(leadId)).state));
    await r.lead.idle();
    const j = await r.jobNow(leadId);
    expect(j.state).toBe("cancelled");
    const hs = await r.helpers(leadId);
    expect(hs.length).toBeGreaterThanOrEqual(3);
    for (const h of hs) expect(["cancelled", "done"], `helper ${h.state.part!.id}`).toContain(h.jobState);
    expect(hs.some((h) => h.jobState === "cancelled")).toBe(true);
    // What was reserved and not spent is back: the lead's figure is the real cost of what ran.
    const s = await r.stateNow(leadId);
    let helperSpend = 0;
    for (const h of hs) helperSpend += (await r.jobNow(h.id)).spentPaise;
    expect(j.spentPaise - helperSpend).toBeLessThan(500);
    expect(j.spentPaise).toBeLessThan(2000);
    expect(s.team!.parts.filter((p) => p.reservedPaise > 0).every((p) => p.refundedPaise + p.spentPaise === p.reservedPaise)).toBe(true);
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
  });
});

void [call, done, edit, buildScript, CONTRACT_EDIT, goodSplit, chain];
void ({} as Rig);
