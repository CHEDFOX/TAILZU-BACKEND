/**
 * SHARING A PLAN (src/billing/planShare.ts, routes/bots/botsPlanShare.ts, migration 0096, docs/plan-share.md).
 *
 * A plan is a month's allowance on ONE account, and sharing it means other accounts draw on that SAME allowance: one shared pot.
 * What is proved here:
 *
 *   - someone with no plan of their own draws on the owner's, and what they spend lands on the OWNER's meter, with their name on
 *     the row so the owner's screen can say "Used 12% this month" without ever naming an amount
 *   - their own plan always wins: a person with one never draws on anybody else's, whatever rows exist
 *   - one plan a person; a lapsed owner's rows stay and simply stop resolving; stop-sharing takes effect at once
 *   - the owner's month running out stops everybody on it, in the same words
 *   - spaces only: no ask and no share to someone you share no space with; a held account may neither share, be shared with, nor ask
 *   - a `promised` ask becomes a real share the moment an entitlement is granted — the whole of "they have to buy and then can share"
 *   - the ask's notification carries the one ask its two buttons answer, and Share / Not now from it do exactly what the card's
 *     own two buttons do, through the one door every notification's button goes through (widgets/act.ts, psa:<askId>)
 *   - with PLAN_SHARE off (the default), every route is 404, no button answers, and the meter behaves exactly as it did before
 *     any of this existed
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

/** Who has a live plan of their own, as the billing tables would say. */
const plans = vi.hoisted(() => new Set<string>());
/** Who abuse prevention is holding right now (docs/trust.md §actions). */
const held = vi.hoisted(() => new Set<string>());
const pushes = vi.hoisted(() => [] as Array<{ userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }>);

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  const { signedIn } = await import("./spaces-rig.js");
  return { ...real, resolveUser: async (h: string | undefined) => signedIn(h) };
});
vi.mock("../src/billing/entitlements.js", async (orig) => {
  const real = await orig<typeof import("../src/billing/entitlements.js")>();
  return { ...real, getEntitlement: async (u: { id: string }) => (plans.has(u.id) ? { entitlement: "pro", active: true } : null) };
});
vi.mock("../src/trust/actions.js", async (orig) => {
  const real = await orig<typeof import("../src/trust/actions.js")>();
  return { ...real, heldFreeUse: (id: string) => held.has(id) };
});
vi.mock("../src/push/index.js", () => ({
  pushEngine: () => ({
    notify: async (userId: string, msg: { kind: string; vars: Record<string, string>; data?: Record<string, string> }) => {
      pushes.push({ userId, kind: msg.kind, vars: msg.vars, data: msg.data ?? {} });
      return null;
    },
  }),
}));

const { A_, M_, R_, X_, D_, AREA, spacesServer } = await import("./spaces-rig.js");
const { resetConfigForTests } = await import("../src/config.js");
const {
  MemoryPlanShareStore, forgetAllPayers, hasOwnPlan, payerFor, planShareOn, setPlanShareStoreForTests, settlePromisedAsks, shareWith, stopSharing,
} = await import("../src/billing/planShare.js");
const { forgetEntitlement } = await import("../src/billing/entitlements.js");
const { installHoldCheck } = await import("../src/you/usage.js");
const { Spending } = await import("../src/you/limits.js");
const { MemoryYouStore } = await import("../src/you/store.js");
const { registerPlanShareRoutes } = await import("../src/routes/bots/botsPlanShare.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { actPartsOf } = await import("../src/routes/bots/widgets.js");

/** A dollar is 8,800 paise at 88 rupees to the dollar; Lite's month is $35. */
const USD = 8800;
const LITE_MONTH = 35 * USD;
const NOW = Date.UTC(2026, 10, 10, 6, 0);

let store = new MemoryPlanShareStore();

function on(users = ""): void {
  vi.stubEnv("PLAN_SHARE", "true");
  if (users) vi.stubEnv("PLAN_SHARE_USERS", users);
  resetConfigForTests();
}

beforeEach(() => {
  plans.clear(); held.clear(); pushes.length = 0;
  store = new MemoryPlanShareStore();
  setPlanShareStoreForTests(store);
  installHoldCheck((id) => held.has(id));
  resetConfigForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); forgetAllPayers(); installHoldCheck(null); setPlanShareStoreForTests(null); });

/** A meter over the memory store, with the entitlements the test set. */
const meter = (youStore = new MemoryYouStore(), now = NOW) =>
  new Spending({ store: youStore, jobs: null, now: () => now, entitlement: async (id) => (plans.has(id) ? { entitlement: "pro", active: true } : null) });

// ===================================================================== the rule

describe("the rule: whose month is this", () => {
  it("answers 'themselves' for everyone while PLAN_SHARE is off, before it reads a single row", async () => {
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    expect(planShareOn(M_)).toBe(false);
    expect(await payerFor(M_)).toEqual({ userId: M_ });
  });

  it("puts someone with no plan of their own on the owner's, and leaves the owner on their own", async () => {
    on();
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    expect(await payerFor(M_)).toMatchObject({ userId: A_, sharedFrom: { userId: A_ } });
    expect(await payerFor(A_)).toEqual({ userId: A_ });
  });

  it("their own plan always wins: a member who buys one stops drawing on anybody else's, row and all", async () => {
    on();
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    expect((await payerFor(M_)).userId).toBe(A_);
    plans.add(M_);
    forgetEntitlement(M_, { granted: true });
    forgetAllPayers();
    expect(await payerFor(M_)).toEqual({ userId: M_ });
    // And the row is still there, so letting their own plan lapse puts them back on the shared one.
    expect(await store.shareOf(M_)).toMatchObject({ ownerId: A_ });
  });

  it("stops resolving while the owner's plan is lapsed, and brings everyone back when it renews", async () => {
    on();
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    expect((await payerFor(M_)).userId).toBe(A_);
    plans.delete(A_);
    forgetAllPayers();
    expect(await payerFor(M_)).toEqual({ userId: M_ });
    plans.add(A_);
    forgetAllPayers();
    expect((await payerFor(M_)).userId).toBe(A_);
  });

  it("gives a held account nobody else's plan, and lends nothing from a held owner", async () => {
    on();
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    held.add(M_);
    forgetAllPayers();
    expect(await payerFor(M_)).toEqual({ userId: M_ });
    held.delete(M_); held.add(A_);
    forgetAllPayers();
    expect(await payerFor(M_)).toEqual({ userId: M_ });
  });

  it("refuses to put somebody on a second plan, and never says whose the first one is", async () => {
    on();
    plans.add(A_); plans.add(R_);
    await shareWith(A_, M_, NOW);
    const err = await shareWith(R_, M_, NOW).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("They are already on a plan.");
    expect(err?.message).not.toContain(A_);
    expect((await payerFor(M_)).userId).toBe(A_);
  });

  it("takes effect at once when sharing stops: the very next answer is their own month again", async () => {
    on();
    plans.add(A_);
    await shareWith(A_, M_, NOW);
    expect((await payerFor(M_)).userId).toBe(A_);
    await stopSharing(A_, M_);
    expect(await payerFor(M_)).toEqual({ userId: M_ });
  });

  it("only the accounts PLAN_SHARE_USERS names, when it names any", async () => {
    on(`${A_},${M_}`);
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    await store.addShare({ ownerId: A_, memberId: R_, createdAt: NOW });
    expect((await payerFor(M_)).userId).toBe(A_);
    expect(await payerFor(R_)).toEqual({ userId: R_ });
  });
});

// ===================================================================== the meter

describe("the meter, keyed on the payer", () => {
  it("lands a member's spend on the OWNER's month, with their name on the row and nothing on their own", async () => {
    on();
    plans.add(A_);
    await shareWith(A_, M_, NOW);
    const youStore = new MemoryYouStore();
    const s = meter(youStore);
    // Warm the payer the way a real request does (the gate runs first), then record as a bot answer would.
    await s.usage(M_);
    s.record(M_, "tailzu", 3.5 * USD);
    await new Promise((r) => setTimeout(r, 0));
    expect(await youStore.spendSince(M_, 0)).toEqual([]);
    expect(await youStore.spendSince(A_, 0)).toEqual([{ bot: "tailzu", at: NOW, paise: 3.5 * USD, by: M_ }]);
    // One pot: the owner's own meter and the member's read the same month.
    expect((await s.usage(A_, { fresh: true })).month.used).toBeCloseTo(3.5 / 35, 4);
    expect((await s.usage(M_, { fresh: true })).month.used).toBeCloseTo(3.5 / 35, 4);
    // And the owner's screen can say whose it was, as a share of the month and never an amount.
    expect(await s.shareOfMonth(A_, M_)).toBeCloseTo(3.5 / 35, 4);
    expect(await s.shareOfMonth(A_, A_)).toBe(0);
  });

  it("gives a member the OWNER's plan, not the free one", async () => {
    on();
    plans.add(A_);
    await shareWith(A_, M_, NOW);
    const s = meter();
    expect((await s.usage(M_)).plan).toMatchObject({ name: "Lite", paid: true });
    // Nobody shares with R_, so R_ is on Free's $3 as before.
    expect((await s.usage(R_)).plan).toMatchObject({ name: "Free", paid: false });
  });

  it("stops the members too when the owner's month runs out, in the same words", async () => {
    on();
    plans.add(A_);
    await shareWith(A_, M_, NOW);
    const youStore = new MemoryYouStore();
    await youStore.addSpend(A_, "code", LITE_MONTH, NOW - 60_000);
    const s = meter(youStore);
    const owner = await s.refusal(A_);
    const member = await s.refusal(M_);
    expect(owner?.code).toBe("quota_exceeded");
    expect(member?.message).toBe(owner?.message);
    // Nothing in it names the owner, or says the month is somebody else's.
    expect(member?.message).not.toContain(A_);
    // And someone not on the plan is untouched.
    expect(await s.refusal(R_)).toBeNull();
  });

  it("frees the member the moment sharing stops, even with the owner's month spent", async () => {
    on();
    plans.add(A_);
    await shareWith(A_, M_, NOW);
    const youStore = new MemoryYouStore();
    await youStore.addSpend(A_, "code", LITE_MONTH, NOW - 60_000);
    const s = meter(youStore);
    expect(await s.refusal(M_)).not.toBeNull();
    await stopSharing(A_, M_);
    s.forget(M_);
    expect(await s.refusal(M_)).toBeNull();
  });

  it("with PLAN_SHARE off, a row in the table changes nothing at all", async () => {
    plans.add(A_);
    await store.addShare({ ownerId: A_, memberId: M_, createdAt: NOW });
    const youStore = new MemoryYouStore();
    await youStore.addSpend(A_, "code", LITE_MONTH, NOW - 60_000);
    const s = meter(youStore);
    expect(await s.refusal(M_)).toBeNull();
    expect((await s.usage(M_)).plan).toMatchObject({ name: "Free" });
    s.record(M_, "tailzu", 100);
    await new Promise((r) => setTimeout(r, 0));
    expect((await youStore.spendSince(M_, 0)).map((r) => r.paise)).toEqual([100]);
  });
});

// ===================================================================== buying completes a promise

describe("a promise kept the moment a plan is paid for", () => {
  it("turns every promised ask into a real share on the grant, and tells the asker", async () => {
    on();
    const ask = { id: "ask-1", askerId: R_, ownerId: M_, state: "promised" as const, createdAt: NOW };
    await store.addAsk(ask);
    // M_ has nothing yet, so the promise cannot be kept.
    expect(await settlePromisedAsks(M_, NOW)).toBe(0);
    expect(await store.shareOf(R_)).toBeNull();
    // They buy one: the webhook's grant clears the cache, which is what carries the promise through.
    plans.add(M_);
    expect(await settlePromisedAsks(M_, NOW)).toBe(1);
    expect(await store.shareOf(R_)).toMatchObject({ ownerId: M_ });
    expect((await store.askById("ask-1"))?.state).toBe("shared");
    expect((await payerFor(R_)).userId).toBe(M_);
  });

  it("does nothing on a grant while PLAN_SHARE is off", async () => {
    await store.addAsk({ id: "ask-2", askerId: R_, ownerId: M_, state: "promised", createdAt: NOW });
    plans.add(M_);
    expect(await settlePromisedAsks(M_, NOW)).toBe(0);
    expect(await store.shareOf(R_)).toBeNull();
  });

  it("an entitlement change clears the payer cache for the owner and everyone on their plan", async () => {
    on();
    plans.add(A_);
    await shareWith(A_, M_, NOW);
    expect((await payerFor(M_)).userId).toBe(A_);
    plans.delete(A_);
    forgetEntitlement(A_);
    await new Promise((r) => setTimeout(r, 0));
    expect(await payerFor(M_)).toEqual({ userId: M_ });
  });
});

// ===================================================================== the routes

describe("the routes", () => {
  const served = async () => {
    const clock = { t: NOW };
    const youStore = new MemoryYouStore();
    const spending = meter(youStore, NOW);
    const s = await spacesServer({
      pushes: [], clock,
      extra: (app, deps, spaces) => registerPlanShareRoutes(app, deps as never, { spaces, spending, now: () => clock.t }),
    });
    // Home: Aanya (admin), Mom and Rohan. Dev is in a space of his own; X_ is in none of theirs.
    const home = await s.family([M_, R_]);
    return { ...s, home, youStore, spending };
  };
  type S = Awaited<ReturnType<typeof served>>;
  const get = (s: S, who: string) => s.call("GET", `${AREA}/plan/share`, who);
  const share = (s: S, who: string, memberIds: string[]) => s.call("POST", `${AREA}/plan/share`, who, { memberIds });
  const ask = (s: S, who: string, ownerId: string, about?: string) => s.call("POST", `${AREA}/plan/share/ask`, who, { ownerId, ...(about ? { about } : {}) });
  const answer = (s: S, who: string, id: string, decision: string) => s.call("PUT", `${AREA}/plan/share/ask/${id}`, who, { decision });

  it("answers 404 on every route while PLAN_SHARE is off, and says nothing about what it would do", async () => {
    const s = await served();
    plans.add(A_);
    for (const r of [
      await get(s, A_), await share(s, A_, [M_]), await ask(s, M_, A_),
      await s.call("DELETE", `${AREA}/plan/share/${M_}`, A_), await s.call("DELETE", `${AREA}/plan/share/mine`, M_),
      await answer(s, A_, "x", "share"),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ code: "plan_share_off" });
    }
    await s.app.close();
  });

  it("shares with people from the same space, and draws the two sides of it", async () => {
    on();
    const s = await served();
    plans.add(A_);
    const before = await get(s, A_);
    expect(before.body).toMatchObject({ canShare: true, members: [], asks: [] });
    expect((before.body.people as Array<{ userId: string; hasPlan: boolean }>).map((p) => p.userId).sort()).toEqual([M_, R_].sort());

    const r = await share(s, A_, [M_]);
    expect(r.status).toBe(200);
    expect(r.body.view.members).toMatchObject([{ userId: M_, name: "Mom", usedPct: 0 }]);
    expect(r.body.view.members[0].look).toMatchObject({ seed: M_ });

    // Mom's own screen leads with whose plan she is on, and never with an amount.
    const mom = await get(s, M_);
    expect(mom.body.on).toMatchObject({ ownerId: A_, planName: "Lite", monthUsedPct: 0, myUsedPct: 0, since: NOW });
    expect(JSON.stringify(mom.body)).not.toMatch(/paise|₹|\$/);
    // Rohan is told nothing about whose plan Mom is on: only that she has one now.
    const rohan = await get(s, R_);
    expect(rohan.body.on).toBeUndefined();
    expect(JSON.stringify(rohan.body)).not.toContain('"ownerId"');
    expect((rohan.body.people as Array<{ userId: string; hasPlan: boolean }>).find((p) => p.userId === M_)).toMatchObject({ hasPlan: false });
    await s.app.close();
  });

  it("will not share with, or be asked by, someone you share no space with", async () => {
    on();
    const s = await served();
    plans.add(A_);
    const r = await share(s, A_, [X_]);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "not_connected" });
    const a = await ask(s, X_, A_);
    expect(a.status).toBe(403);
    expect(a.body).toMatchObject({ code: "not_connected" });
    await s.app.close();
  });

  it("refuses a second plan, a plan from someone who has none, and a share from someone who already has one", async () => {
    on();
    const s = await served();
    plans.add(A_); plans.add(R_);
    await share(s, A_, [M_]);
    expect((await share(s, R_, [M_])).body).toMatchObject({ code: "already_shared", message: "They are already on a plan." });
    // Mom has R_'s and A_'s names nowhere in that sentence.
    expect(JSON.stringify((await share(s, R_, [M_])).body)).not.toContain(A_);
    // Someone with no plan has nothing to give.
    plans.delete(R_);
    expect((await share(s, R_, [M_])).body).toMatchObject({ code: "no_plan" });
    // And someone with a plan is not put on another's.
    plans.add(R_);
    expect((await share(s, A_, [R_])).body).toMatchObject({ code: "has_plan" });
    await s.app.close();
  });

  it("asks, and the owner's yes puts them on it", async () => {
    on();
    const s = await served();
    plans.add(A_);
    const a = await ask(s, M_, A_, "Diwali party");
    expect(a.status).toBe(200);
    expect(pushes.filter((p) => p.kind === "plan_share_ask")).toMatchObject([{ userId: A_, vars: { name: "Mom", about: "Diwali party" } }]);
    // It is waiting on Aanya's screen, and Mom's own screen shows she asked.
    const mine = await get(s, A_);
    expect(mine.body.asks).toMatchObject([{ askerId: M_, name: "Mom", about: "Diwali party" }]);
    expect((await get(s, M_)).body.asked).toMatchObject({ ownerId: A_, name: "Aanya S." });

    const id = mine.body.asks[0].id as string;
    // Nobody else may answer it.
    expect((await answer(s, R_, id, "share")).status).toBe(404);
    expect((await answer(s, A_, id, "share")).status).toBe(200);
    expect((await get(s, M_)).body.on).toMatchObject({ ownerId: A_ });
    expect(pushes.some((p) => p.userId === M_ && p.kind === "plan_share_on")).toBe(true);
    await s.app.close();
  });

  it("a promise, then a purchase: the share is waiting when the payment lands", async () => {
    on();
    const s = await served();
    // Nobody has a plan. Rohan asks Mom; Mom has none, so she promises.
    const a = await ask(s, R_, M_);
    expect(a.status).toBe(200);
    const id = ((await get(s, M_)).body.asks as Array<{ id: string }>)[0]!.id;
    expect((await answer(s, M_, id, "promise")).status).toBe(200);
    expect((await get(s, R_)).body.on).toBeUndefined();
    // Mom buys a plan: the grant turns the promise into a real share with nothing more pressed.
    plans.add(M_);
    forgetEntitlement(M_, { granted: true });
    await new Promise((r) => setTimeout(r, 0));
    expect((await get(s, R_)).body.on).toMatchObject({ ownerId: M_, name: "Mom" });
    await s.app.close();
  });

  it("a quiet no, and the same person cannot be asked again for a week", async () => {
    on();
    const s = await served();
    plans.add(A_);
    const a = await ask(s, M_, A_);
    expect(a.status).toBe(200);
    const id = ((await get(s, A_)).body.asks as Array<{ id: string }>)[0]!.id;
    expect((await answer(s, A_, id, "decline")).status).toBe(200);
    // Mom is told only that nothing is waiting: no reason, anywhere.
    const mom = await get(s, M_);
    expect(mom.body.asked).toBeUndefined();
    expect(JSON.stringify(mom.body)).not.toMatch(/declin|no thanks|not now/i);
    const again = await ask(s, M_, A_);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "asked_recently" });
    // A week later it may be asked again.
    s.clock.t = NOW + 8 * 86_400_000;
    expect((await ask(s, M_, A_)).status).toBe(200);
    await s.app.close();
  });

  it("stops sharing, and lets a member leave on their own", async () => {
    on();
    const s = await served();
    plans.add(A_);
    await share(s, A_, [M_, R_]);
    expect(((await get(s, A_)).body.members as unknown[]).length).toBe(2);
    expect((await s.call("DELETE", `${AREA}/plan/share/${R_}`, A_)).status).toBe(200);
    expect((await get(s, R_)).body.on).toBeUndefined();
    // Mom leaves by herself: "mine" is not an account id, so the two never collide.
    expect((await s.call("DELETE", `${AREA}/plan/share/mine`, M_)).status).toBe(200);
    expect((await get(s, M_)).body.on).toBeUndefined();
    expect((await get(s, A_)).body.members).toEqual([]);
    await s.app.close();
  });

  it("a held account may neither share, be shared with, nor ask, and is told nothing about why", async () => {
    on();
    const s = await served();
    plans.add(A_);
    held.add(A_);
    const r = await share(s, A_, [M_]);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "not_now" });
    expect(JSON.stringify(r.body)).not.toMatch(/hold|abuse|signal|trust|block/i);
    expect((await get(s, A_)).status).toBe(403);
    held.delete(A_);
    // Shared WITH a held account: the same answer, from the other side.
    held.add(M_);
    expect((await share(s, A_, [M_])).body).toMatchObject({ code: "not_now" });
    // And a held account cannot ask.
    expect((await ask(s, M_, A_)).status).toBe(403);
    await s.app.close();
  });

  it("never shares with somebody across a block", async () => {
    on();
    const s = await served();
    plans.add(A_);
    await s.parts.threads.blocks.block(A_, R_, "Rohan");
    const r = await share(s, A_, [R_]);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "not_connected" });
    expect((await get(s, A_)).body.people).toMatchObject([{ userId: M_ }]);
    await s.app.close();
  });

  it("D_, who shares no space with any of them, is nobody's person to share with", async () => {
    on();
    const s = await served();
    plans.add(A_);
    expect((await get(s, A_)).body.people as Array<{ userId: string }>).not.toContainEqual(expect.objectContaining({ userId: D_ }));
    expect(await hasOwnPlan(D_)).toBe(false);
    await s.app.close();
  });

  // ------------------------------------------------------------ the same two buttons, from the notification

  /**
   * THE NOTIFICATION'S DOOR (src/widgets/act.ts, billing/planShareActs.ts): what the phone posts to POST /v1/widgets/act when
   * Share or Not now is tapped on the push. The real parts, so the switch is read the way the server reads it.
   */
  const tapping = () => {
    const acts = new QuickActs(
      actPartsOf({ bots: null, code: null, jobs: null, connectors: null, agent: null } as never, { tasks: null as never, threads: null as never }),
      new MemoryQuickActionStore(), () => NOW,
    );
    return (who: string, item: string, action: string) =>
      acts.run(who, { item, action }, { kind: "session" }, { inPlaceRisks: [], modes: {}, tokenEnabled: true });
  };
  /** The ask just made, as its push carries it: the item the notification's two buttons answer. */
  const itemOf = (): string => pushes.filter((p) => p.kind === "plan_share_ask").at(-1)!.data.item!;

  it("the ask's push carries the one ask its buttons answer, and Share from it shares, once", async () => {
    on();
    const s = await served();
    plans.add(A_);
    await ask(s, M_, A_, "Diwali party");
    const sentAsk = pushes.find((p) => p.kind === "plan_share_ask")!;
    const id = ((await get(s, A_)).body.asks as Array<{ id: string }>)[0]!.id;
    expect(sentAsk.data).toMatchObject({ ask: id, item: `psa:${id}` });

    const tap = tapping();
    expect(await tap(A_, itemOf(), "share")).toMatchObject({ status: 200, body: { ok: true, state: "shared" } });
    // The same as the card: Mom is on Aanya's plan, and Mom is told.
    expect((await get(s, M_)).body.on).toMatchObject({ ownerId: A_ });
    expect(pushes.filter((p) => p.userId === M_ && p.kind === "plan_share_on")).toHaveLength(1);
    // The apps retry: the same tap gives the first answer back, and nothing is done twice.
    expect(await tap(A_, itemOf(), "share")).toMatchObject({ status: 200, body: { state: "shared", repeat: true } });
    expect(pushes.filter((p) => p.kind === "plan_share_on")).toHaveLength(1);
    // And the other button, on an ask that has been answered, answers nothing.
    expect(await tap(A_, itemOf(), "decline")).toMatchObject({ status: 409, body: { code: "not_waiting" } });
    expect((await get(s, A_)).body.asks).toEqual([]);
    await s.app.close();
  });

  it("Not now from the notification is as quiet as Not now on the card, twice over", async () => {
    on();
    const s = await served();
    plans.add(A_);
    await ask(s, M_, A_);
    const tap = tapping();
    expect(await tap(A_, itemOf(), "decline")).toMatchObject({ status: 200, body: { ok: true, state: "declined" } });
    // Mom is told nothing at all: not that it was declined, and certainly not why.
    expect(pushes.filter((p) => p.userId === M_)).toEqual([]);
    const mom = await get(s, M_);
    expect(mom.body.asked).toBeUndefined();
    expect(mom.body.on).toBeUndefined();
    expect(await tap(A_, itemOf(), "decline")).toMatchObject({ status: 200, body: { state: "declined", repeat: true } });
    expect(await tap(A_, itemOf(), "share")).toMatchObject({ status: 409, body: { code: "not_waiting" } });
    expect((await get(s, M_)).body.on).toBeUndefined();
    await s.app.close();
  });

  it("answers only the ask it was sent for, and only for the person it was sent to", async () => {
    on();
    const s = await served();
    plans.add(A_);
    await ask(s, M_, A_);
    const item = itemOf();
    const id = ((await get(s, A_)).body.asks as Array<{ id: string }>)[0]!.id;
    const tap = tapping();
    // Rohan was sent nothing. He is told what anyone is told about somebody else's ask: it has gone.
    expect(await tap(R_, item, "share")).toMatchObject({ status: 404, body: { code: "not_found" } });
    // Mom cannot answer her own ask from here either.
    expect(await tap(M_, item, "share")).toMatchObject({ status: 404, body: { code: "not_found" } });
    // An id that names no ask at all.
    expect(await tap(A_, "psa:99999999-9999-4999-8999-999999999999", "share")).toMatchObject({ status: 404 });
    // Nothing a button could carry answers anything but its own two actions.
    expect(await tap(A_, item, "promise")).toMatchObject({ status: 400, body: { code: "bad_request" } });
    expect((await get(s, M_)).body.on).toBeUndefined();
    // Taken back by the asker while the notification sat there: there is nothing left to answer.
    expect((await answer(s, M_, id, "withdraw")).status).toBe(200);
    expect(await tap(A_, item, "share")).toMatchObject({ status: 409, body: { code: "not_waiting" } });
    expect((await get(s, M_)).body.on).toBeUndefined();
    await s.app.close();
  });

  it("Share from a notification may only share: someone on Free is told so, and the ask stays where the card can answer it", async () => {
    on();
    const s = await served();
    // Nobody has a plan. Rohan asks Mom, who is on Free: the card would say "See plans and share" and open the plans screen,
    // which a button on a notification has no way to do. It says so instead of promising something that is not there.
    await ask(s, R_, M_);
    const tap = tapping();
    const r = await tap(M_, itemOf(), "share");
    expect(r).toMatchObject({ status: 409, body: { code: "no_plan" } });
    expect(String(r.body.message)).toMatch(/don't have a plan/i);
    // Nothing was promised behind her back: the ask is still waiting on her Activity, and Rohan is on nobody's plan.
    expect((await get(s, M_)).body.asks).toMatchObject([{ askerId: R_ }]);
    expect((await get(s, R_)).body.on).toBeUndefined();
    expect(pushes.filter((p) => p.kind === "plan_share_on")).toEqual([]);
    // A refused tap is let go, so the same button works the moment she really has a plan.
    plans.add(M_);
    expect(await tap(M_, itemOf(), "share")).toMatchObject({ status: 200, body: { state: "shared" } });
    expect((await get(s, R_)).body.on).toMatchObject({ ownerId: M_ });
    await s.app.close();
  });

  it("with PLAN_SHARE off, the notification's buttons answer nothing at all", async () => {
    on();
    const s = await served();
    plans.add(A_);
    await ask(s, M_, A_);
    const item = itemOf();
    const tap = tapping();
    // The switch goes off under a notification that is already on a phone.
    vi.unstubAllEnvs();
    resetConfigForTests();
    expect(planShareOn(A_)).toBe(false);
    for (const action of ["share", "decline"]) {
      expect(await tap(A_, item, action)).toMatchObject({ status: 400, body: { code: "bad_request" } });
    }
    expect((await get(s, A_)).status).toBe(404);
    // Back on, the same button answers again: the switch is read on every tap, never at boot.
    on();
    expect(await tap(A_, item, "share")).toMatchObject({ status: 200, body: { state: "shared" } });
    await s.app.close();
  });
});
