/**
 * CALLS (src/rooms/service.ts, lobby.ts, store.ts): a call made with its link, sealed, under the name given; someone with the link waits at
 * the door and the host is told once (not while the host is in the call); let in, they get a guest's pass, not let in, none; the lobby turned
 * off lets in whoever waits and the next straight in; the host's pass names no account; another person's call is none of theirs; LiveKit's
 * webhook keeps who is in and each time people were, once per event; the day's minutes stop new people; a full call takes nobody more; a
 * guest sent away gets no new pass; a call ended closes at LiveKit and its link is dead; the tick closes a call too long or over the day's
 * minutes and ends a room unused for a month; an account deleted closes its calls.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { RoomService, hostIdentity, lkName, cleanName, minutesToday, SESSION_MAX_MS, UNUSED_MS } = await import("../src/rooms/service.js");
const { MemoryRoomStore } = await import("../src/rooms/store.js");
const { Lobby, WAIT_MS } = await import("../src/rooms/lobby.js");
const { sealer, hashOf } = await import("../src/rooms/link.js");
const { readJwt } = await import("../src/rooms/livekit.js");

const KEYS = { key: "APIx0test", secret: "livekit-test-secret-0123456789abcdef" };
const T0 = Date.UTC(2026, 10, 13, 10, 0, 0);
const MIN = 60_000;
const AANYA = "aanya-0001", RAVI = "ravi-0002";

function rig(o: { maxPeople?: number; dailyMinutes?: number } = {}) {
  let now = T0;
  const clock = () => now;
  const lk: string[] = [];
  const pushes: Array<{ userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }> = [];
  const published: Array<{ userId: string; topics: string[] }> = [];
  const store = new MemoryRoomStore(clock);
  const s = new RoomService({
    store, keys: KEYS, now: clock, lobby: new Lobby(clock), sealer: sealer(Buffer.alloc(32, 7)),
    livekit: {
      url: "wss://x0-test.livekit.cloud",
      ensureRoom: async (n, r) => { lk.push(`ensure ${n} ${r.maxPeople}`); },
      deleteRoom: async (n) => { lk.push(`delete ${n}`); },
      removeParticipant: async (n, i) => { lk.push(`remove ${n} ${i}`); },
    },
    notify: async (userId, msg) => { pushes.push({ userId, ...msg }); },
    publish: (userId, topics) => { published.push({ userId, topics }); },
    maxPeople: o.maxPeople ?? 4, dailyMinutes: o.dailyMinutes ?? 120, linkOrigin: "https://x0bot.com",
  });
  const hook = (event: string, room: string, identity?: string, name?: string, id?: string) =>
    s.onWebhook({ event, id: id ?? `${event}-${identity ?? ""}-${now}`, room: { name: lkName(room) }, ...(identity ? { participant: { identity, name } } : {}) });
  return { s, store, lk, pushes, published, hook, tick: (ms: number) => { now += ms; }, at: () => now };
}

const claimsOf = (pass: string) => readJwt(pass, KEYS.secret, Math.floor(T0 / 1000))!;

describe("a call", () => {
  it("is made with its link, sealed, under the name given, and the lobby on", async () => {
    const { s, store } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co", businessId: "leaf-co" });
    expect(r).toMatchObject({ title: "A call with Leaf & Co", host: "Leaf & Co", status: "open", lobby: true, people: [], waiting: [], businessId: "leaf-co", minutes: 0 });
    expect(r.link).toBe(`https://x0bot.com/m/${r.code}`);
    const row = (await store.get(r.id))!;
    expect(row.codeHash).toBe(hashOf(r.code));
    expect(row.codeEnc).not.toContain(r.code);
    expect((await s.make(AANYA, { host: "Leaf & Co", title: "  Order 1234 \u0000 <b>call</b> " })).title).toBe("Order 1234 b call /b");
    expect((await s.list(AANYA, { businessId: "leaf-co" })).map((x) => x.id)).toEqual([r.id]);
  });

  it("is none of anyone else's", async () => {
    const { s } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    expect(await s.room(RAVI, r.id)).toBeNull();
    expect(await s.join(RAVI, r.id)).toBeNull();
    expect(await s.end(RAVI, r.id)).toBeNull();
    expect(await s.list(RAVI)).toEqual([]);
  });

  it("gives its host a pass that names no account, with the room's admin", async () => {
    const { s, lk } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const p = (await s.join(AANYA, r.id, "Aanya"))!;
    expect(p).toMatchObject({ url: "wss://x0-test.livekit.cloud", identity: hostIdentity(AANYA), name: "Aanya", host: true, room: { id: r.id, host: "Leaf & Co" } });
    expect(p.identity).not.toContain(AANYA);
    expect(claimsOf(p.pass)).toMatchObject({ sub: hostIdentity(AANYA), video: { room: lkName(r.id), roomAdmin: true } });
    expect(lk).toEqual([`ensure ${lkName(r.id)} 4`]);
    // Its own name is the business's when the person has none.
    expect((await s.join(AANYA, r.id))!.name).toBe("Leaf & Co");
  });
});

describe("the lobby", () => {
  it("keeps someone with the link at the door, tells the host once, and lets them in with a guest's pass", async () => {
    const { s, pushes, published } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co", businessId: "leaf-co", title: "Order 1234" });
    expect(await s.guest(r.code)).toEqual({ title: "Order 1234", host: "Leaf & Co", status: "open", lobby: true, full: false });

    const k = (await s.knock(r.link, "  Ravi \n Kumar "))!;
    expect(k).toEqual({ knock: k.knock, state: "waiting" });
    expect(await s.answer(r.code, k.knock)).toEqual({ knock: k.knock, state: "waiting" });
    expect(pushes).toEqual([{ userId: AANYA, kind: "room_waiting", key: r.id, vars: { name: "Ravi Kumar", title: "Order 1234" }, data: { r: r.id, b: "leaf-co" } }]);
    expect(published.at(-1)).toEqual({ userId: AANYA, topics: [`room:${r.id}`, "bot:mail"] });

    // A second guest soon after: the host is not told again.
    await s.knock(r.code, "Asha");
    expect(pushes).toHaveLength(1);

    const view = (await s.room(AANYA, r.id))!;
    expect(view.waiting.map((w) => w.name)).toEqual(["Ravi Kumar", "Asha"]);
    // The host sees who waits by an id that is not the guest's own key.
    expect(view.waiting[0]!.id).not.toBe(k.knock);

    await s.admit(AANYA, r.id, view.waiting[0]!.id);
    const a = await s.answer(r.code, k.knock);
    expect(a.state).toBe("admitted");
    expect(a.pass).toMatchObject({ name: "Ravi Kumar", host: false });
    expect(a.pass!.identity).toMatch(/^g_/);
    const c = claimsOf(a.pass!.pass);
    expect(c.video).toMatchObject({ room: lkName(r.id), roomJoin: true });
    expect(c.video).not.toHaveProperty("roomAdmin");

    await s.deny(AANYA, r.id, view.waiting[1]!.id);
    expect((await s.room(AANYA, r.id))!.waiting).toEqual([]);
    await expect(s.admit(AANYA, r.id, view.waiting[1]!.id)).rejects.toMatchObject({ status: 404 });
  });

  it("does not tell a host who is in the call", async () => {
    const { s, pushes, hook } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya");
    await s.knock(r.code, "Ravi");
    expect(pushes).toEqual([]);
  });

  it("turned off lets in whoever waits, and the next comes straight in", async () => {
    const { s } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const k = (await s.knock(r.code, "Ravi"))!;
    expect((await s.set(AANYA, r.id, { lobby: false }))!.lobby).toBe(false);
    expect((await s.answer(r.code, k.knock)).state).toBe("admitted");
    const next = (await s.knock(r.code, "Asha"))!;
    expect(next.state).toBe("admitted");
    expect(next.pass?.name).toBe("Asha");
  });

  it("asks for a name, and forgets a knock nobody answered", async () => {
    const { s, tick } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await expect(s.knock(r.code, "  ")).rejects.toMatchObject({ status: 400 });
    const k = (await s.knock(r.code, "Ravi"))!;
    tick(WAIT_MS + MIN);
    expect((await s.answer(r.code, k.knock)).state).toBe("gone");
    expect(await s.knock("abc-defg-hjk", "Ravi")).toBeNull();
    expect(await s.answer("abc-defg-hjk", k.knock)).toEqual({ knock: k.knock, state: "gone" });
  });
});

describe("LiveKit's webhook", () => {
  it("keeps who is in and each time people were, once per event", async () => {
    const { s, hook, tick } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya", "EV1");
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya", "EV1");
    tick(5 * MIN);
    await hook("participant_joined", r.id, "g_abc", "Ravi", "EV2");
    let v = (await s.room(AANYA, r.id))!;
    expect(v.status).toBe("live");
    expect(v.people.map((p) => [p.name, p.role])).toEqual([["Aanya", "host"], ["Ravi", "guest"]]);

    tick(10 * MIN);
    await hook("participant_left", r.id, "g_abc", undefined, "EV3");
    await hook("participant_left", r.id, hostIdentity(AANYA), undefined, "EV4");
    v = (await s.room(AANYA, r.id))!;
    expect(v).toMatchObject({ status: "open", people: [], minutes: 15 });

    // A second time, closed by LiveKit itself.
    await hook("participant_joined", r.id, "g_def", "", "EV5");
    expect((await s.room(AANYA, r.id))!.people[0]!.name).toBe("Guest");
    tick(5 * MIN);
    await hook("room_finished", r.id, undefined, undefined, "EV6");
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "open", people: [], minutes: 20 });
  });

  it("leaves rooms that are not ours alone", async () => {
    const { s, published } = rig();
    await s.onWebhook({ event: "participant_joined", id: "x", room: { name: "someone-else" }, participant: { identity: "a" } });
    await s.onWebhook(null);
    expect(published).toEqual([]);
  });
});

describe("limits", () => {
  it("stops new people once the day's minutes are used, and frees them as the day goes", async () => {
    const { s, hook, tick } = rig({ dailyMinutes: 30 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya");
    tick(31 * MIN);
    await hook("participant_left", r.id, hostIdentity(AANYA));
    await expect(s.join(AANYA, r.id)).rejects.toMatchObject({ status: 402, code: "room_minutes" });
    await expect(s.knock(r.code, "Ravi")).rejects.toMatchObject({ status: 503, code: "room_minutes" });
    tick(24 * 60 * MIN);
    await expect(s.join(AANYA, r.id)).resolves.toBeTruthy();
  });

  it("takes nobody more into a full call", async () => {
    const { s, hook } = rig({ maxPeople: 2 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const k = (await s.knock(r.code, "Asha"))!;
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya");
    await hook("participant_joined", r.id, "g_one", "Ravi");
    expect((await s.guest(r.code))!.full).toBe(true);
    await expect(s.knock(r.code, "Sam")).rejects.toMatchObject({ status: 409, code: "room_full" });
    const waiting = (await s.room(AANYA, r.id))!.waiting;
    await expect(s.admit(AANYA, r.id, waiting[0]!.id)).rejects.toMatchObject({ status: 409 });
    expect((await s.answer(r.code, k.knock)).state).toBe("waiting");
    // The host already in comes back in.
    await expect(s.join(AANYA, r.id)).resolves.toBeTruthy();
  });

  it("measures the day's minutes over the last 24 hours only", () => {
    const room = { sessions: [{ start: T0 - 25 * 60 * MIN, end: T0 - 23 * 60 * MIN }, { start: T0 - 10 * MIN, end: null }] } as never;
    expect(minutesToday([room], T0)).toBe(70);
  });
});

describe("sending away and ending", () => {
  it("sends a guest away, and their knock gives no new pass", async () => {
    const { s, lk, hook } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const k = (await s.knock(r.code, "Ravi"))!;
    await s.admit(AANYA, r.id, (await s.room(AANYA, r.id))!.waiting[0]!.id);
    const identity = (await s.answer(r.code, k.knock)).pass!.identity;
    await hook("participant_joined", r.id, identity, "Ravi");
    const v = (await s.remove(AANYA, r.id, identity))!;
    expect(v.people).toEqual([]);
    expect(lk).toContain(`remove ${lkName(r.id)} ${identity}`);
    expect(await s.answer(r.code, k.knock)).toEqual({ knock: k.knock, state: "denied" });
    await expect(s.remove(AANYA, r.id, hostIdentity(AANYA))).rejects.toMatchObject({ status: 400 });
  });

  it("ends a call for everyone: closed at LiveKit, the lobby emptied, the link dead", async () => {
    const { s, lk, hook } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const k = (await s.knock(r.code, "Ravi"))!;
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya");
    const v = (await s.end(AANYA, r.id))!;
    expect(v).toMatchObject({ status: "ended", people: [], waiting: [] });
    expect(lk.at(-1)).toBe(`delete ${lkName(r.id)}`);
    expect(await s.answer(r.code, k.knock)).toEqual({ knock: k.knock, state: "gone" });
    expect((await s.guest(r.code))!.status).toBe("ended");
    await expect(s.knock(r.code, "Asha")).rejects.toMatchObject({ status: 410 });
    await expect(s.join(AANYA, r.id)).rejects.toMatchObject({ status: 410 });
    // A late webhook changes nothing.
    await hook("participant_joined", r.id, "g_late", "Late");
    expect((await s.room(AANYA, r.id))!.people).toEqual([]);
  });
});

describe("the tick", () => {
  it("closes a call too long, keeping its link", async () => {
    const { s, lk, hook, tick } = rig({ dailyMinutes: 1440 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya");
    tick(SESSION_MAX_MS - MIN);
    await s.tick();
    expect(lk).not.toContain(`delete ${lkName(r.id)}`);
    tick(2 * MIN);
    await s.tick();
    expect(lk).toContain(`delete ${lkName(r.id)}`);
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "open", people: [] });
  });

  it("closes a call over the day's minutes", async () => {
    const { s, lk, hook, tick } = rig({ dailyMinutes: 20 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await hook("participant_joined", r.id, hostIdentity(AANYA), "Aanya");
    tick(21 * MIN);
    await s.tick();
    expect(lk).toContain(`delete ${lkName(r.id)}`);
  });

  it("ends a room unused for a month", async () => {
    const { s, tick } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    tick(UNUSED_MS + MIN);
    await s.tick();
    expect((await s.room(AANYA, r.id))!.status).toBe("ended");
  });
});

describe("an account deleted", () => {
  it("closes its calls going on at LiveKit", async () => {
    const { s, lk, hook } = rig();
    const live = await s.make(AANYA, { host: "Leaf & Co" });
    await s.make(AANYA, { host: "Leaf & Co" });
    await hook("participant_joined", live.id, hostIdentity(AANYA), "Aanya");
    await s.forAccountDelete(AANYA);
    expect(lk.filter((x) => x.startsWith("delete"))).toEqual([`delete ${lkName(live.id)}`]);
  });
});

describe("a name", () => {
  it("is one line, no control characters or angle brackets, cut short", () => {
    expect(cleanName("  Ravi\t\n Kumar  ")).toBe("Ravi Kumar");
    expect(cleanName("<script>x</script>")).toBe("script x /script");
    expect(cleanName("a".repeat(100))).toHaveLength(60);
    expect(cleanName(42)).toBe("");
  });
});
