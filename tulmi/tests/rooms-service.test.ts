/**
 * CALLS (src/rooms/service.ts, lobby.ts, store.ts): a call made with its link, sealed, under the name given; someone takes a seat by
 * sending their offer and gets the answer; the seat is a bearer, kept only as a hash and never on a screen; someone with the link waits at
 * the door and the host is told once (not while the host is in the call); let in, they may take a seat, not let in, they may not; the lobby
 * off lets them straight in; another person's call is none of theirs; pulling brings someone else's tracks in and never their own; the
 * heartbeat carries who is in and what each is sending, and a seat that goes quiet leaves the call by itself; the day's minutes; a full
 * call; someone sent away; a call ended; the tick; an account deleted.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { RoomService, hostIdentity, cleanName, minutesToday, seatHash, SESSION_MAX_MS, UNUSED_MS, SEAT_QUIET_MS } = await import("../src/rooms/service.js");
const { MemoryRoomStore } = await import("../src/rooms/store.js");
const { Lobby, WAIT_MS } = await import("../src/rooms/lobby.js");
const { sealer, hashOf } = await import("../src/rooms/link.js");

type Sfu = import("../src/rooms/sfu.js").Sfu;

const T0 = Date.UTC(2026, 10, 14, 10, 0, 0);
const MIN = 60_000;
const AANYA = "aanya-0001", RAVI = "ravi-0002";
const OFFER = { sdp: "OFFER", audioMid: "0", videoMid: "1" };

function rig(o: { maxPeople?: number; dailyMinutes?: number } = {}) {
  let now = T0;
  const clock = () => now;
  const log: string[] = [];
  const pushes: Array<{ userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }> = [];
  const published: Array<{ userId: string; topics: string[] }> = [];
  const store = new MemoryRoomStore(clock);
  let sessions = 0;
  const sfu: Sfu = {
    newSession: async () => { const id = `sess-${++sessions}`; log.push(`new ${id}`); return id; },
    publish: async (s, _offer, tracks) => { log.push(`publish ${s} ${tracks.map((t) => t.trackName).join(",")}`); return { type: "answer", sdp: `ANSWER-${s}` }; },
    pull: async (s, want) => {
      log.push(`pull ${s} ${want.map((w) => w.trackName).join(",")}`);
      return { offer: { type: "offer", sdp: "THEIR-OFFER" }, mustAnswer: true, tracks: want.map((w, i) => ({ trackName: w.trackName, mid: String(10 + i) })) };
    },
    answer: async (s) => { log.push(`answer ${s}`); },
    closeTracks: async (s, mids) => { log.push(`close ${s} ${mids.join(",")}`); },
  };
  const s = new RoomService({
    store, sfu, now: clock, lobby: new Lobby(clock), sealer: sealer(Buffer.alloc(32, 7)),
    notify: async (userId, msg) => { pushes.push({ userId, ...msg }); },
    publish: (userId, topics) => { published.push({ userId, topics }); },
    maxPeople: o.maxPeople ?? 4, dailyMinutes: o.dailyMinutes ?? 120, linkOrigin: "https://x0bot.com",
  });
  return { s, store, log, pushes, published, sfu, tick: (ms: number) => { now += ms; }, at: () => now };
}

/** A guest let in and seated, for the tests that need two people. */
async function guestIn(r: { s: ReturnType<typeof rig>["s"] }, code: string, name: string, offer = { sdp: "G-OFFER", audioMid: "0" }) {
  const k = (await r.s.knock(code, name))!;
  const room = await r.s.room(AANYA, (await r.s.list(AANYA))[0]!.id);
  const waiting = room!.waiting.find((w) => w.name === name);
  if (waiting) await r.s.admit(AANYA, room!.id, waiting.id);
  return (await r.s.joinAsGuest(code, k.knock, offer))!;
}

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
    expect(await s.join(RAVI, r.id, OFFER)).toBeNull();
    expect(await s.end(RAVI, r.id)).toBeNull();
    expect(await s.list(RAVI)).toEqual([]);
  });
});

describe("taking a seat", () => {
  it("publishes the host's own tracks and hands back the answer, naming no account", async () => {
    const { s, log, store } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const seat = (await s.join(AANYA, r.id, { ...OFFER, name: "Aanya" }))!;
    expect(seat).toMatchObject({ identity: hostIdentity(AANYA), name: "Aanya", host: true, answer: "ANSWER-sess-1", people: [] });
    expect(seat.identity).not.toContain(AANYA);
    expect(seat.seat.startsWith(`${r.id}.`)).toBe(true);
    expect(log).toEqual(["new sess-1", `publish sess-1 ${hostIdentity(AANYA)}-audio,${hostIdentity(AANYA)}-video`]);
    // The bearer is kept only as a hash, and the SFU session never reaches a screen.
    const row = (await store.get(r.id))!;
    expect(row.people[0]!.seatHash).toBe(seatHash(seat.seat));
    expect(JSON.stringify(row.people)).not.toContain(seat.seat.split(".")[1]);
    expect(JSON.stringify(await s.room(AANYA, r.id))).not.toContain("sess-1");
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "live", people: [{ name: "Aanya", role: "host", audio: `${hostIdentity(AANYA)}-audio` }] });
  });

  it("takes an audio-only seat, and refuses an offer that is not one", async () => {
    const { s } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const seat = (await s.join(AANYA, r.id, { sdp: "OFFER", audioMid: "0" }))!;
    expect((await s.room(AANYA, r.id))!.people[0]).not.toHaveProperty("video");
    expect(seat.answer).toBe("ANSWER-sess-1");
    await expect(s.join(AANYA, r.id, { sdp: "", audioMid: "0" })).rejects.toMatchObject({ status: 400 });
    await expect(s.join(AANYA, r.id, { sdp: "x", audioMid: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("replaces a person's own seat when their app joins again", async () => {
    const { s, store } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const first = (await s.join(AANYA, r.id, OFFER))!;
    const second = (await s.join(AANYA, r.id, OFFER))!;
    expect(second.seat).not.toBe(first.seat);
    expect((await store.get(r.id))!.people).toHaveLength(1);
    expect((await s.live(first.seat)).gone).toBe(true);
    expect((await s.live(second.seat)).gone).toBeUndefined();
  });
});

describe("the lobby", () => {
  it("keeps someone at the door, tells the host once, and lets them take a seat once let in", async () => {
    const { s, pushes, published } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co", businessId: "leaf-co", title: "Order 1234" });
    expect(await s.guest(r.code)).toEqual({ title: "Order 1234", host: "Leaf & Co", status: "open", lobby: true, full: false });

    const k = (await s.knock(r.link, "  Ravi \n Kumar "))!;
    expect(k.state).toBe("waiting");
    expect(await s.knockAnswer(r.code, k.knock)).toEqual({ knock: k.knock, state: "waiting" });
    expect(pushes).toEqual([{ userId: AANYA, kind: "room_waiting", key: r.id, vars: { name: "Ravi Kumar", title: "Order 1234" }, data: { r: r.id, b: "leaf-co" } }]);
    expect(published.at(-1)).toEqual({ userId: AANYA, topics: [`room:${r.id}`, "bot:mail"] });

    // Not let in yet: no seat.
    await expect(s.joinAsGuest(r.code, k.knock, { sdp: "G", audioMid: "0" })).rejects.toMatchObject({ status: 403, code: "room_wait" });

    await s.knock(r.code, "Asha");
    expect(pushes).toHaveLength(1);
    const view = (await s.room(AANYA, r.id))!;
    expect(view.waiting.map((w) => w.name)).toEqual(["Ravi Kumar", "Asha"]);
    // The host sees who waits by an id that is not the guest's own key.
    expect(view.waiting[0]!.id).not.toBe(k.knock);

    await s.admit(AANYA, r.id, view.waiting[0]!.id);
    const seat = (await s.joinAsGuest(r.code, k.knock, { sdp: "G", audioMid: "0" }))!;
    expect(seat).toMatchObject({ name: "Ravi Kumar", host: false });
    expect(seat.identity).toMatch(/^g_/);
    // One knock, one seat.
    await expect(s.joinAsGuest(r.code, k.knock, { sdp: "G", audioMid: "0" })).rejects.toMatchObject({ status: 409, code: "room_twice" });

    await s.deny(AANYA, r.id, view.waiting[1]!.id);
    expect((await s.room(AANYA, r.id))!.waiting).toEqual([]);
    await expect(s.admit(AANYA, r.id, view.waiting[1]!.id)).rejects.toMatchObject({ status: 404 });
  });

  it("does not tell a host who is in the call", async () => {
    const { s, pushes } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await s.join(AANYA, r.id, OFFER);
    await s.knock(r.code, "Ravi");
    expect(pushes).toEqual([]);
  });

  it("turned off lets people straight in", async () => {
    const { s } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const waiting = (await s.knock(r.code, "Ravi"))!;
    expect((await s.set(AANYA, r.id, { lobby: false }))!.lobby).toBe(false);
    expect((await s.knockAnswer(r.code, waiting.knock)).state).toBe("admitted");
    const next = (await s.knock(r.code, "Asha"))!;
    expect(next.state).toBe("admitted");
    expect((await s.joinAsGuest(r.code, next.knock, { sdp: "G", audioMid: "0" }))!.name).toBe("Asha");
  });

  it("asks for a name, and forgets a knock nobody answered", async () => {
    const { s, tick } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await expect(s.knock(r.code, "  ")).rejects.toMatchObject({ status: 400 });
    const k = (await s.knock(r.code, "Ravi"))!;
    tick(WAIT_MS + MIN);
    expect((await s.knockAnswer(r.code, k.knock)).state).toBe("gone");
    expect(await s.knock("abc-defg-hjk", "Ravi")).toBeNull();
    expect(await s.knockAnswer("abc-defg-hjk", k.knock)).toEqual({ knock: k.knock, state: "gone" });
  });
});

describe("in the call", () => {
  it("brings someone else's tracks in, and never their own", async () => {
    const r0 = rig();
    const { s, log } = r0;
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    const guest = await guestIn(r0, r.code, "Ravi");

    log.length = 0;
    const out = await s.pull(host.seat, [{ identity: guest.identity, kind: "audio" }, { identity: host.identity, kind: "audio" }]);
    expect(log).toEqual([`pull sess-1 ${guest.identity}-audio`]);
    expect(out).toMatchObject({ offer: "THEIR-OFFER", mustAnswer: true, tracks: [{ trackName: `${guest.identity}-audio`, mid: "10" }] });

    await s.answer(host.seat, "MY-ANSWER");
    expect(log.at(-1)).toBe("answer sess-1");

    // Nobody who is not in the call, and nothing for a seat that is not one.
    expect(await s.pull(host.seat, [{ identity: "g_nobody", kind: "audio" }])).toEqual({ offer: null, mustAnswer: false, tracks: [] });
    await expect(s.pull(`${r.id}.notaseat`, [])).rejects.toMatchObject({ status: 404 });
  });

  it("carries who is in and what each is sending, and turns a camera off", async () => {
    const r0 = rig();
    const { s } = r0;
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    const guest = await guestIn(r0, r.code, "Ravi");

    const live = await s.live(host.seat);
    expect(live.status).toBe("live");
    expect(live.people.map((p) => p.name)).toEqual(["Ravi"]);
    // The host is told who waits; a guest is not.
    expect(live.waiting).toEqual([]);
    expect((await s.live(guest.seat)).waiting).toBeUndefined();
    // Nobody is told anyone's seat or session.
    expect(JSON.stringify(live)).not.toContain("sess-");

    await s.live(host.seat, { video: false });
    const seen = (await s.live(guest.seat)).people[0]!;
    expect(seen.audio).toBe(`${host.identity}-audio`);
    expect(seen.video).toBeUndefined();
    await s.live(host.seat, { video: true });
    expect((await s.live(guest.seat)).people[0]!.video).toBe(`${host.identity}-video`);
  });

  it("drops a seat that goes quiet, so a killed app leaves the call", async () => {
    const r0 = rig();
    const { s, tick } = r0;
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    const guest = await guestIn(r0, r.code, "Ravi");
    expect((await s.room(AANYA, r.id))!.people).toHaveLength(2);

    tick(SEAT_QUIET_MS + 1_000);
    await s.live(host.seat);
    // The guest said nothing: they are not in the call any more, whatever the row still says.
    expect((await s.room(AANYA, r.id))!.people.map((p) => p.name)).toEqual(["Leaf & Co"]);
    expect((await s.live(guest.seat)).gone).toBe(true);
  });

  it("hangs up, and closes the call when the last person goes", async () => {
    const { s } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    expect((await s.room(AANYA, r.id))!.status).toBe("live");
    await s.leave(host.seat);
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "open", people: [] });
    expect((await s.live(host.seat)).gone).toBe(true);
    // The link still works: a call that emptied is not an ended one.
    expect((await s.guest(r.code))!.status).toBe("open");
  });
});

describe("limits", () => {
  it("stops new people once the day's minutes are used, and frees them as the day goes", async () => {
    const { s, tick } = rig({ dailyMinutes: 30 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    tick(31 * MIN);
    await s.leave(host.seat);
    await expect(s.join(AANYA, r.id, OFFER)).rejects.toMatchObject({ status: 402, code: "room_minutes" });
    await expect(s.knock(r.code, "Ravi")).rejects.toMatchObject({ status: 503, code: "room_minutes" });
    tick(24 * 60 * MIN);
    await expect(s.join(AANYA, r.id, OFFER)).resolves.toBeTruthy();
  });

  it("takes nobody more into a full call", async () => {
    const r0 = rig({ maxPeople: 2 });
    const { s } = r0;
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await s.join(AANYA, r.id, OFFER);
    await guestIn(r0, r.code, "Ravi");
    expect((await s.guest(r.code))!.full).toBe(true);
    await expect(s.knock(r.code, "Sam")).rejects.toMatchObject({ status: 409, code: "room_full" });
    // The host already in comes back in.
    await expect(s.join(AANYA, r.id, OFFER)).resolves.toBeTruthy();
  });

  it("measures the day's minutes over the last 24 hours only", () => {
    const room = { sessions: [{ start: T0 - 25 * 60 * MIN, end: T0 - 23 * 60 * MIN }, { start: T0 - 10 * MIN, end: null }] } as never;
    expect(minutesToday([room], T0)).toBe(70);
  });
});

describe("sending away and ending", () => {
  it("sends a guest away: their seat goes, and their own app is told it is out", async () => {
    const r0 = rig();
    const { s } = r0;
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    const guest = await guestIn(r0, r.code, "Ravi");
    const v = (await s.remove(AANYA, r.id, guest.identity))!;
    expect(v.people.map((p) => p.name)).toEqual(["Leaf & Co"]);
    expect((await s.live(guest.seat)).gone).toBe(true);
    // Nobody pulls them any more.
    expect(await s.pull(host.seat, [{ identity: guest.identity, kind: "audio" }])).toMatchObject({ tracks: [] });
    await expect(s.remove(AANYA, r.id, host.identity)).rejects.toMatchObject({ status: 400 });
  });

  it("ends a call for everyone: the seats go, the lobby empties, the link is dead", async () => {
    const { s } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    const k = (await s.knock(r.code, "Ravi"))!;
    const v = (await s.end(AANYA, r.id))!;
    expect(v).toMatchObject({ status: "ended", people: [], waiting: [] });
    expect(await s.knockAnswer(r.code, k.knock)).toEqual({ knock: k.knock, state: "gone" });
    expect((await s.guest(r.code))!.status).toBe("ended");
    expect((await s.live(host.seat)).gone).toBe(true);
    await expect(s.knock(r.code, "Asha")).rejects.toMatchObject({ status: 410 });
    await expect(s.join(AANYA, r.id, OFFER)).rejects.toMatchObject({ status: 410 });
    await expect(s.pull(host.seat, [])).rejects.toMatchObject({ status: 410 });
  });
});

describe("the tick", () => {
  it("closes a call that has run too long, keeping its link", async () => {
    const { s, tick } = rig({ dailyMinutes: 1440 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    // Still talking, so the seat is not quiet.
    for (let i = 0; i < 2; i++) { tick(SESSION_MAX_MS / 2 - MIN); await s.live(host.seat); }
    await s.tick();
    expect((await s.room(AANYA, r.id))!.status).toBe("live");
    tick(3 * MIN);
    await s.live(host.seat);
    await s.tick();
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "open", people: [] });
    expect((await s.guest(r.code))!.status).toBe("open");
  });

  it("closes a call over the day's minutes", async () => {
    const { s, tick } = rig({ dailyMinutes: 20 });
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, r.id, OFFER))!;
    for (let i = 0; i < 3; i++) { tick(7 * MIN); await s.live(host.seat); }
    await s.tick();
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "open", people: [] });
  });

  it("drops seats that went quiet", async () => {
    const { s, tick } = rig();
    const r = await s.make(AANYA, { host: "Leaf & Co" });
    await s.join(AANYA, r.id, OFFER);
    tick(SEAT_QUIET_MS + 1_000);
    await s.tick();
    expect((await s.room(AANYA, r.id))!).toMatchObject({ status: "open", people: [] });
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
  it("empties and ends its calls", async () => {
    const { s } = rig();
    const live = await s.make(AANYA, { host: "Leaf & Co" });
    await s.make(AANYA, { host: "Leaf & Co" });
    const host = (await s.join(AANYA, live.id, OFFER))!;
    await s.forAccountDelete(AANYA);
    expect((await s.list(AANYA)).every((x) => x.status === "ended")).toBe(true);
    expect((await s.live(host.seat)).gone).toBe(true);
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
