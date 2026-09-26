import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { PUSH_DEFAULTS, type PushPayload } from "../src/push/defaults.js";
import { knobsOf, plan, type Facts, type LogEntry } from "../src/push/plan.js";
import { pickTime, rhythm, type Moment } from "../src/push/timing.js";
import { PushEngine } from "../src/push/engine.js";
import { MemoryPushStore, type Candidate } from "../src/push/store.js";
import type { PushMessage, PushSender, Receipt, Ticket } from "../src/push/expo.js";
import { ExpoSender } from "../src/push/expo.js";
import { applyRules, RuleSchema } from "../src/control/rules.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A Saturday, noon UTC.
const NOW = Date.parse("2026-09-26T12:00:00Z");
const TODAY = Date.parse("2026-09-26T00:00:00Z");

/** One dictation at hh:mm UTC on each of the given days ago. */
function habit(daysAgo: number[], hh = 19, mm = 15, words = 60): Moment[] {
  return daysAgo.map((d) => ({ at: TODAY - d * DAY + hh * HOUR + mm * MIN, words }));
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function payload(over: Record<string, unknown> = {}, labels: Record<string, string> = {}): PushPayload {
  const p = structuredClone(PUSH_DEFAULTS);
  Object.assign(p.flags, over);
  Object.assign(p.labels, labels);
  return p;
}

function facts(over: Partial<Facts> = {}): Facts {
  return {
    userId: "user-a",
    now: NOW,
    moments: habit(range(1, 14)),
    lastSeenAt: TODAY - DAY + 19 * HOUR + 20 * MIN,
    createdAt: NOW - 60 * DAY,
    tzOffsetMin: 0,
    entitled: false,
    log: [],
    ...over,
  };
}

const at = (ms: number) => new Date(ms).toISOString().slice(11, 16);

describe("when this person talks to their phone", () => {
  it("lands a little before the hour they usually dictate", () => {
    const r = rhythm(habit(range(1, 14)), NOW, 14);
    const t = pickTime({
      rhythm: r, from: NOW, to: TODAY + 23 * HOUR, tzOffsetMin: 0, lastSeenAt: null, seed: "user-a",
      knobs: { halfLifeDays: 14, dayBlend: 0.35, minEvents: 5, minDays: 3, leadMin: 10, jitterMin: 8, quietStartHour: 22, quietEndHour: 8, fallbackLocalHour: 19 },
    });
    expect(t?.basis).toBe("rhythm");
    expect(t!.sendAt).toBeGreaterThanOrEqual(TODAY + 18 * HOUR + 50 * MIN);
    expect(t!.sendAt).toBeLessThanOrEqual(TODAY + 18 * HOUR + 58 * MIN);
  });

  it("follows a habit that moved: recent weeks count more", () => {
    // Evenings a month ago, mornings the last ten days.
    const moments = [...habit(range(20, 40), 20, 0), ...habit(range(1, 10), 13, 5)];
    const d = plan(facts({ moments, lastSeenAt: null }), knobsOf(payload()));
    expect("sendAt" in d && at(d.sendAt) >= "12:50" && at(d.sendAt) <= "12:58").toBe(true);
  });

  it("never lands in their night; with no allowed habit hour, uses the evening on their clock", () => {
    // 19:15 UTC is 00:45 in India.
    const d = plan(facts({ tzOffsetMin: 330 }), knobsOf(payload()));
    expect("sendAt" in d).toBe(true);
    if (!("sendAt" in d)) return;
    expect(d.basis).toBe("fallback");
    const local = new Date(d.sendAt + 330 * MIN).getUTCHours();
    expect(local).toBeGreaterThanOrEqual(8);
    expect(local).toBeLessThan(22);
  });

  it("a plan asked again once its moment has come says now, not later", () => {
    const due = TODAY + 19 * HOUR + 2 * MIN;
    const d = plan(facts({ now: due }), knobsOf(payload()));
    expect("sendAt" in d && d.sendAt).toBe(due);
  });
});

describe("whether and why", () => {
  it("a streak that ends today unless they write: the streak nudge, in their words", () => {
    const d = plan(facts(), knobsOf(payload()));
    expect(d).toMatchObject({ kind: "streak", periodKey: "streak:2026-09-26", title: "Keep your streak", screenId: "stats" });
    if ("body" in d) expect(d.body).toBe("Day 15. One dictation keeps it going.");
  });

  it("no streak nudge once they have written today", () => {
    const moments = [...habit(range(1, 14)), { at: TODAY + 9 * HOUR, words: 40 }];
    const d = plan(facts({ moments }), knobsOf(payload({ "push.weekly.enabled": false })));
    expect("kind" in d ? d.kind : d.skip).not.toBe("streak");
  });

  it("not daily: the week's cap holds", () => {
    const log: LogEntry[] = [1, 2, 4].map((n) => ({ kind: "streak", periodKey: `streak:${n}`, status: "sent", sentAt: NOW - n * DAY, openedAt: NOW - n * DAY + MIN }));
    expect(plan(facts({ log }), knobsOf(payload()))).toEqual({ skip: "weekly cap" });
  });

  it("leaves someone alone who was just here", () => {
    const d = plan(facts({ lastSeenAt: NOW - 30 * MIN }), knobsOf(payload({ "push.smart.recentUseHours": 12 })));
    // Twelve hours after 11:30 is past the streak's cut-off: no time left today.
    expect("skip" in d).toBe(true);
  });

  it("goes quiet after three pushes nobody answered", () => {
    const moments = habit(range(10, 30));
    const log: LogEntry[] = [2, 3, 4].map((n) => ({ kind: "winback", periodKey: `x:${n}`, status: "sent", sentAt: NOW - n * DAY, openedAt: null }));
    const d = plan(facts({ moments, lastSeenAt: null, log }),
      knobsOf(payload({ "push.smart.maxPerWeek": 10, "push.winback.maxUnanswered": 10, "push.winback.everyDays": 1 })));
    expect("sendAt" in d && d.sendAt >= NOW + 12 * DAY).toBe(true);
  });

  it("someone who drifted away gets one gentle push, at their hour", () => {
    const moments = habit(range(5, 20));
    const d = plan(facts({ moments, lastSeenAt: null }), knobsOf(payload()));
    expect(d).toMatchObject({ kind: "winback", periodKey: "winback:2026-09-26", screenId: "home" });
    if ("sendAt" in d) expect(at(d.sendAt) >= "18:50" && at(d.sendAt) <= "18:58").toBe(true);
  });

  it("a free account that ran out last month hears its words are back", () => {
    const oct2 = Date.parse("2026-10-02T12:00:00Z");
    const sept = Array.from({ length: 20 }, (_, i) => ({ at: Date.parse("2026-09-05T19:00:00Z") + i * DAY, words: 500 }));
    const d = plan(facts({ now: oct2, moments: sept, lastSeenAt: null }), knobsOf(payload()));
    expect(d).toMatchObject({ kind: "refill", periodKey: "refill:2026-10", title: "Your words are back" });
  });

  it("a subscriber never hears about words", () => {
    const oct2 = Date.parse("2026-10-02T12:00:00Z");
    const sept = Array.from({ length: 20 }, (_, i) => ({ at: Date.parse("2026-09-05T19:00:00Z") + i * DAY, words: 500 }));
    const d = plan(facts({ now: oct2, moments: sept, lastSeenAt: null, entitled: true }), knobsOf(payload()));
    expect("kind" in d ? d.kind : "none").not.toBe("refill");
  });

  it("brand-new accounts are left alone for a day", () => {
    expect(plan(facts({ createdAt: NOW - 2 * HOUR }), knobsOf(payload()))).toEqual({ skip: "new account" });
  });

  it("the control plane turns it off for one person, live", () => {
    const rule = RuleSchema.parse({ id: "off-a", surface: "push", when: { users: ["user-a"] }, ops: [{ op: "set", path: "/flags/push.smart.enabled", value: false }] });
    const forA = applyRules(structuredClone(PUSH_DEFAULTS), [rule], { surface: "push", userId: "user-a" }).payload;
    const forB = applyRules(structuredClone(PUSH_DEFAULTS), [rule], { surface: "push", userId: "user-b" }).payload;
    expect(plan(facts(), knobsOf(forA))).toEqual({ skip: "off" });
    expect("kind" in plan(facts({ userId: "user-b" }), knobsOf(forB))).toBe(true);
  });

  it("the words are the server's", () => {
    const d = plan(facts(), knobsOf(payload({}, { "push.streak.title": "Day {n} of you", "push.streak.body": "Keep talking." })));
    expect(d).toMatchObject({ title: "Day 15 of you", body: "Keep talking." });
  });
});

class FakeSender implements PushSender {
  sent: PushMessage[][] = [];
  ticket: (m: PushMessage, i: number) => Ticket = (_m, i) => ({ status: "ok", id: `t${this.sent.length}-${i}` });
  receiptFor: (id: string) => Receipt = () => ({ status: "ok" });
  async send(messages: PushMessage[]): Promise<Ticket[]> {
    this.sent.push(messages);
    return messages.map((m, i) => this.ticket(m, i));
  }
  async receipts(ids: string[]): Promise<Record<string, Receipt>> {
    return Object.fromEntries(ids.map((id) => [id, this.receiptFor(id)]));
  }
}

function setup() {
  const store = new MemoryPushStore();
  const cand: Candidate = {
    userId: "user-a",
    tokens: [
      { platform: "ios", token: "ExponentPushToken[ios-a]", updatedAt: NOW - DAY },
      { platform: "android", token: "ExponentPushToken[and-a]", updatedAt: NOW - 2 * DAY },
    ],
    lastSeenAt: TODAY - DAY + 19 * HOUR + 20 * MIN,
    createdAt: NOW - 60 * DAY,
    locale: null,
    entitled: false,
    tzOffsetMin: 0,
  };
  store.candidatesList = [cand];
  store.momentsByUser.set("user-a", habit(range(1, 14)));
  const sender = new FakeSender();
  const quiet = { info: () => {}, warn: () => {} };
  const engine = new PushEngine(store, sender, () => structuredClone(PUSH_DEFAULTS), quiet);
  return { store, sender, engine, cand };
}

describe("the engine", () => {
  const DUE = TODAY + 19 * HOUR + 5 * MIN;

  it("sends nothing before the moment, then once to every phone, with a way back", async () => {
    const { store, sender, engine } = setup();
    const early = await engine.tick(NOW);
    expect(early.planned).toBe(1);
    expect(sender.sent.length).toBe(0);

    const r = await engine.tick(DUE);
    expect(r.sent).toBe(1);
    expect(sender.sent[0].map((m) => m.to)).toEqual(["ExponentPushToken[ios-a]", "ExponentPushToken[and-a]"]);
    const m = sender.sent[0][0];
    expect(m.data).toMatchObject({ screenId: "stats", kind: "streak" });
    expect(typeof m.data?.pushId).toBe("string");
    expect(store.rows[0]).toMatchObject({ status: "sent", periodKey: "streak:2026-09-26" });
    // The log keeps a hash, never the token.
    expect(JSON.stringify(store.rows[0].tickets)).not.toContain("ExponentPushToken");

    const again = await engine.tick(DUE + 5 * MIN);
    expect(again.sent).toBe(0);
    expect(sender.sent.length).toBe(1);
  });

  it("a dry run plans and reports, and sends and records nothing", async () => {
    const { store, sender, engine } = setup();
    const r = await engine.tick(DUE, { dryRun: true });
    expect(r.due).toBe(1);
    expect(r.preview?.[0]).toMatchObject({ userId: "user-a", kind: "streak" });
    expect(sender.sent.length).toBe(0);
    expect(store.rows.length).toBe(0);
  });

  it("someone who wrote after the plan was made is not nudged", async () => {
    const { store, sender, engine } = setup();
    await engine.tick(NOW);
    store.momentsByUser.set("user-a", [...habit(range(1, 14)), { at: DUE - 20 * MIN, words: 30 }]);
    const r = await engine.tick(DUE);
    expect(r.sent).toBe(0);
    expect(sender.sent.length).toBe(0);
  });

  it("drops a token Expo says belongs to no installed app, at send or at receipt", async () => {
    const { store, sender, engine, cand } = setup();
    sender.ticket = (m, i) => m.to.includes("and-a") ? { status: "error", error: "DeviceNotRegistered" } : { status: "ok", id: `t-${i}` };
    await engine.tick(DUE);
    expect(cand.tokens.map((t) => t.platform)).toEqual(["ios"]);
    expect(store.dropped).toEqual([{ userId: "user-a", platform: "android" }]);

    sender.receiptFor = () => ({ status: "error", error: "DeviceNotRegistered" });
    const later = await engine.tick(DUE + 20 * MIN);
    expect(later.receiptsChecked).toBe(1);
    expect(cand.tokens.length).toBe(0);
  });

  it("a tap is remembered", async () => {
    const { store, sender, engine } = setup();
    await engine.tick(DUE);
    const pushId = String(sender.sent[0][0].data?.pushId);
    await store.markOpened("user-a", pushId, DUE + MIN);
    expect(store.rows[0].openedAt).toBe(DUE + MIN);
    expect((await engine.stats(DUE + HOUR)).streak).toEqual({ sent: 1, opened: 1, failed: 0 });
  });

  it("turned off, it does nothing", async () => {
    const { sender, store } = setup();
    const off = new PushEngine(store, sender, () => payload({ "push.smart.enabled": false }), { info: () => {}, warn: () => {} });
    const r = await off.tick(DUE);
    expect(r.skipped.off).toBe(1);
    expect(sender.sent.length).toBe(0);
  });
});

describe("Expo's push service", () => {
  it("sends in hundreds, reads tickets in order, and maps failures", async () => {
    const calls: Array<{ url: string; body: unknown; auth?: string }> = [];
    const sender = new ExpoSender({
      accessToken: "tok",
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, auth: init.headers.authorization });
        const n = Array.isArray(body) ? body.length : 0;
        return {
          ok: true, status: 200,
          json: async () => ({ data: Array.from({ length: n }, (_, i) => i === 1 ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `id${i}` }) }),
        };
      },
    });
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: "t", body: "b" }));
    const tickets = await sender.send(msgs);
    expect(calls.length).toBe(2);
    expect(calls[0].auth).toBe("Bearer tok");
    expect(tickets.length).toBe(150);
    expect(tickets[1]).toEqual({ status: "error", error: "DeviceNotRegistered" });
    expect(tickets[0]).toEqual({ status: "ok", id: "id0" });
  });

  it("a failed request is an error ticket per message, never a throw", async () => {
    const sender = new ExpoSender({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
    expect(await sender.send([{ to: "x", title: "t", body: "b" }])).toEqual([{ status: "error", error: "http_503" }]);
    const down = new ExpoSender({ fetch: async () => { throw new Error("ECONNRESET"); } });
    expect(await down.send([{ to: "x", title: "t", body: "b" }])).toEqual([{ status: "error", error: "network" }]);
  });
});

describe("without its log", () => {
  it("sends nothing when push_log cannot be read", async () => {
    const { store, sender, engine } = setup();
    store.log = async () => { throw new Error("relation push_log does not exist"); };
    const r = await engine.tick(TODAY + 19 * HOUR + 5 * MIN);
    expect(r.skipped["no push_log"]).toBe(1);
    expect(sender.sent.length).toBe(0);
  });
});
