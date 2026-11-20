/**
 * THE SPACE'S ADMIN HAS NO AUTOMATIC ACCESS TO ANYTHING OF ANYONE'S (docs/social.md §4;
 * src/botsBots/{grants,spaceFeed,work,threads,spaces,spaceJoin,spacePerms}.ts, routes/bots/{botsSpaces,work}.ts).
 *
 * This file used to be its opposite: the admin listed every consenting member's things in "/", shared any of them with anyone,
 * opened them all read-write in Work in space, and the owner was never told. All of that is gone, and these cases are what holds
 * it gone — each one the inverse of a case that used to pass:
 *
 *   - "/" lists the admin's OWN things only; an "of:<owner>:<item>" id is a thing that isn't there
 *   - the admin cannot share a member's thing, with anyone, and no grant is ever written with a by_id
 *   - Work in space shows the admin a space with nobody in it until somebody shares something
 *   - a message to one person is not the admin's to read
 *   - a member writes without agreeing to anything, and the old consent route answers while writing nothing
 *
 * Home: Aanya (admin), Mom, Rohan, and Dev (brought in with no consent at all). Mom's plan has a doctor's visit and a satsang.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const pushes = vi.hoisted(() => [] as Array<{ userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }>);
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  const { signedIn } = await import("./spaces-rig.js");
  return { ...real, resolveUser: async (h: string | undefined) => signedIn(h) };
});
vi.mock("../src/push/index.js", () => ({
  pushEngine: () => ({ notify: async (userId: string, msg: { kind: string; vars: Record<string, string>; data: Record<string, string> }) => { pushes.push({ userId, kind: msg.kind, vars: msg.vars, data: msg.data }); return null; } }),
}));

const { A_, M_, R_, D_, AREA, spacesServer } = await import("./spaces-rig.js");
const { shareSources } = await import("../src/botsBots/shareSources.js");
const { calendar } = await import("../src/calendar/index.js");
const { spaceTable } = await import("../src/botsBots/spaceRows.js");

const W = (bot: string) => `${AREA}/work/${bot}`;
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
/** The id the admin's "/" used to give a member's thing. Nothing makes one now; it must read as a thing that isn't there. */
const ofMember = (ownerId: string, itemId: string) => `of:${ownerId}:${itemId}`;

async function served() {
  const clock = { t: Date.UTC(2026, 10, 10, 6, 0) };
  const real = shareSources({ now: () => clock.t });
  const sources = {
    plan: real.plan!,
    notes: { list: async (u: string) => (u === M_ ? [{ id: "n1", title: "Family meeting", line: "12 min", at: clock.t }] : []) },
  };
  const s = await spacesServer({ pushes, clock, sources });
  const cal = calendar();
  const doctor = await cal.addEvent(M_, { title: "Doctor visit", day: "2026-11-14", time: "19:40", place: "Apollo, Indiranagar", notes: "Bring reports", tz: 330 });
  const satsang = await cal.addEvent(M_, { title: "Satsang", day: "2026-11-15", time: "08:00", tz: 330 });
  const own = await cal.addEvent(A_, { title: "Aanya's dentist", day: "2026-11-13", time: "10:00", tz: 330 });
  const dev = await cal.addEvent(D_, { title: "Dev's dentist", day: "2026-11-16", time: "10:00", tz: 330 });
  const home = await s.family([M_, R_]);
  await s.bringIn(home, D_, { consent: false });
  return { ...s, home, doctor: `e:${doctor.id}`, satsang: `e:${satsang.id}`, own: `e:${own.id}`, dev: `e:${dev.id}` };
}
type S = Awaited<ReturnType<typeof served>>;
const post = (s: S, who: string, b: Record<string, unknown>) => s.call("POST", `${AREA}/spaces/${s.home}/feed`, who, b);
const feed = async (s: S, who: string) => (await s.call("GET", `${AREA}/spaces/${s.home}/feed`, who)).body;
const item = (s: S, who: string, owner: string, id: string) => s.call("GET", `${W("plan")}/item?${q({ space: s.home, owner, item: id, tz: "330" })}`, who);
const mine = (s: S, who: string, space = s.home) => s.call("GET", `${W("plan")}/mine?${q({ space, tz: "330" })}`, who);
const grants = () => spaceTable<{ id: string; owner_id: string; by_id?: string | null }>("space_grants");

describe('the admin\'s "/"', () => {
  it("lists the admin's own things and nobody else's, in any bot", async () => {
    const s = await served();
    const items = (await mine(s, A_)).body.items as Array<{ id: string; title: string; line: string }>;
    expect(items.map((i) => [i.title, i.line])).toEqual([["Aanya's dentist", "Event"]]);
    // No line saying whose, because there is nobody else's here.
    expect(JSON.stringify(items)).not.toContain("Mom's");
    expect(items.every((i) => !i.id.startsWith("of:"))).toBe(true);
    expect((await s.call("GET", `${W("notes")}/mine?${q({ space: s.home })}`, A_)).body.items).toEqual([]);
    // With the space, without it, and for a space the admin only belongs to: the same, their own.
    expect((await s.call("GET", `${W("plan")}/mine`, A_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Aanya's dentist"]);
    const momsClub = (await s.call("POST", `${AREA}/spaces`, M_, { name: "Club" })).body.id as string;
    await s.bringIn(momsClub, A_, { by: M_ });
    expect((await mine(s, A_, momsClub)).body.items.map((i: { title: string }) => i.title)).toEqual(["Aanya's dentist"]);
    // And a member's own list is unchanged by any of this.
    expect((await mine(s, M_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Doctor visit", "Satsang"]);
  });
});

describe("the admin cannot share a member's thing", () => {
  it("is told it isn't there, whoever it is for, and writes no grant", async () => {
    const s = await served();
    for (const to of [R_, null, D_]) {
      const r = await post(s, A_, { ...(to === null ? {} : { to }), thing: { bot: "plan", id: ofMember(M_, s.doctor) } });
      expect(r.status, String(to)).toBe(404);
      expect(r.body.message).toBe("That isn't there any more.");
    }
    // Nor by naming the member's own item id directly: it is not the admin's thing.
    expect((await post(s, A_, { to: R_, thing: { bot: "plan", id: s.doctor } })).status).toBe(404);
    expect(await grants().select({}, { limit: 10 })).toEqual([]);
  });

  it("a grant is never written with a by_id, so nothing is ever shared by somebody other than its owner", async () => {
    const s = await served();
    expect((await post(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } })).status).toBe(201);
    const rows = await grants().select({}, { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.owner_id).toBe(M_);
    expect(rows[0]!.by_id ?? null).toBeNull();
  });

  it("but the admin still stops any share in its space, which takes nothing from anyone's account", async () => {
    const s = await served();
    const g = (await post(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } })).body.message.thing.grantId as string;
    expect((await s.call("DELETE", `${AREA}/spaces/${s.home}/grants/${g}`, A_)).status).toBe(200);
    expect(await grants().select({}, { limit: 10 })).toEqual([]);
    // Mom's own thing is untouched: stopping a share is moderation of the feed, not a reach into her bot.
    expect((await mine(s, M_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Doctor visit", "Satsang"]);
  });
});

describe("Work in space, for the admin", () => {
  it("is a space with nobody in it until somebody shares something", async () => {
    const s = await served();
    const page = (await s.call("GET", W("plan"), A_)).body;
    expect(page.spaces).toEqual([{ spaceId: s.home, spaceName: "Home", admin: true, people: [] }]);
    // Nobody can see the admin's own things either, so nothing says anyone can.
    expect(page.seenBy).toEqual([]);
    for (const owner of [M_, R_, D_]) {
      expect((await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner })}`, A_)).status, owner).toBe(404);
      expect((await item(s, A_, owner, s.doctor)).status, owner).toBe(404);
    }
    // Once Mom shares one thing, that one thing appears — and only that one.
    expect((await post(s, M_, { to: A_, thing: { bot: "plan", id: s.doctor } })).status).toBe(201);
    const after = (await s.call("GET", W("plan"), A_)).body;
    expect(after.spaces[0].people).toEqual([expect.objectContaining({ userId: M_, how: "shared", line: "1 plan shared with you" })]);
    expect((await item(s, A_, M_, s.doctor)).status).toBe(200);
    expect((await item(s, A_, M_, s.satsang)).status).toBe(404);
  });
});

describe("a message to one person is not the admin's to read", () => {
  it("not in the feed, not unread, not pushed", async () => {
    const s = await served();
    await post(s, A_, { text: "Dinner at 8" });
    const unread = async (who: string) => (await s.call("GET", `${AREA}/spaces?full=1`, who)).body.spaces[0].unread as number;
    const before = await unread(A_);
    pushes.length = 0;
    expect((await post(s, M_, { text: "Just between us", to: R_ })).status).toBe(201);
    const texts = async (who: string) => ((await feed(s, who)).messages as Array<{ text: string }>).map((m) => m.text);
    expect(await texts(R_)).toContain("Just between us");
    expect(await texts(A_)).toEqual(["Dinner at 8"]);
    expect(await unread(A_)).toBe(before);
    expect(pushes.map((p) => p.userId)).toEqual([R_]);
  });
});

describe("nothing is gated on a line any more", () => {
  it("Dev agreed to nothing and writes anyway; the old consent route answers and writes nothing", async () => {
    const s = await served();
    expect((await feed(s, D_)).space).toMatchObject({ consented: true, admin: false });
    expect((await post(s, D_, { text: "hello all" })).status).toBe(201);
    expect((await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, D_, { consentV: 2 })).body).toEqual({ ok: true });
    // Still nothing of Dev's is the admin's, whatever he taps.
    expect((await item(s, A_, D_, s.dev)).status).toBe(404);
  });
});
