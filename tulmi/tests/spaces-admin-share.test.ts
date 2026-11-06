/**
 * THE SPACE'S ADMIN SHARES ANY MEMBER'S THING (src/botsBots/{grants,spaceFeed,work,threads,spaces,spaceJoin,spacePerms}.ts,
 * routes/bots/{botsSpaces,work}.ts; docs/spaces.md "Sharing one thing"):
 *
 *   - the admin's "/" lists their own things, then each member's who agreed to the line as it is now, each line saying whose
 *   - the admin shares a member's thing with one person, or everyone, with exactly the access the owner's own share would give: the
 *     grant says whose it is and who shared it; the one it reaches finds it under its owner, "Shared by Aanya"; one thing only
 *   - only the admin may; the owner must be in the space and have agreed to the new line; never across a block
 *   - only the admin stops a share the admin made (its owner can't); a member stops their own; the admin any
 *   - the owner is not told: no card in their feed, no push, no unread, no last line, nothing on their page
 *   - the line about the admin now says "can see and share": who agreed to the old one is asked once more, and until then the admin
 *     sees only what they share; new joiners agree to the new one when they join
 *
 * Home: Aanya (admin), Mom, Rohan, and Dev (who never saw the line about the admin). Mom's plan has a doctor's visit and a satsang.
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

const { A_, M_, R_, D_, X_, AREA, spacesServer } = await import("./spaces-rig.js");
const { shareSources } = await import("../src/botsBots/shareSources.js");
const { calendar } = await import("../src/calendar/index.js");
const { spaceTable } = await import("../src/botsBots/spaceRows.js");
const { table } = await import("../src/botsBots/rows.js");
const { ofMember } = await import("../src/botsBots/work.js");
const { ADMIN_LINE, CONSENT_VERSION } = await import("../src/botsBots/spacePerms.js");

const W = (bot: string) => `${AREA}/work/${bot}`;
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

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
const act = (s: S, who: string, owner: string, id: string, b: Record<string, unknown>) => s.call("POST", `${W("plan")}/item`, who, { space: s.home, owner, item: id, tz: 330, ...b });
const unshare = (s: S, who: string, gid: string) => s.call("DELETE", `${AREA}/spaces/${s.home}/grants/${gid}`, who);
const mine = (s: S, who: string, space = s.home) => s.call("GET", `${W("plan")}/mine?${q({ space, tz: "330" })}`, who);
/** The admin shares Mom's doctor's visit (by the id the admin's "/" gives it), to Rohan unless said. */
const shareMoms = (s: S, o: { to?: string | null; id?: string; owner?: string } = {}) =>
  post(s, A_, { ...(o.to === null ? {} : { to: o.to ?? R_ }), thing: { bot: "plan", id: ofMember(o.owner ?? M_, o.id ?? s.doctor) } });
const members = () => table<{ space_id: string; user_id: string; consent_ms?: number | null; consent_v?: number | null }>("space_members");

describe("the admin's \"/\"", () => {
  it("lists the admin's own things first, then each member's who agreed, each line saying whose; anyone else only their own", async () => {
    const s = await served();
    const items = (await mine(s, A_)).body.items as Array<{ id: string; title: string; line: string }>;
    expect(items.map((i) => [i.title, i.line])).toEqual([
      ["Aanya's dentist", "Event"],
      ["Doctor visit", "Mom's · Sat 14 Nov · 7:40 pm"],
      ["Satsang", "Mom's · Sun 15 Nov · 8 am"],
    ]);
    expect(items[1]!.id).toBe(ofMember(M_, s.doctor));
    // Dev never agreed: nothing of his. Another bot: Mom's notes, by her name.
    expect(items.some((i) => i.title === "Dev's dentist")).toBe(false);
    expect((await s.call("GET", `${W("notes")}/mine?${q({ space: s.home })}`, A_)).body.items).toEqual([{ id: ofMember(M_, "n1"), title: "Family meeting", line: "Mom's · 12 min", at: expect.any(Number) }]);
    // A member asking with the space gets their own, as without it; so does the admin without it, or for a space not theirs.
    expect((await mine(s, M_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Doctor visit", "Satsang"]);
    expect((await mine(s, R_)).body.items).toEqual([]);
    expect((await s.call("GET", `${W("plan")}/mine`, A_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Aanya's dentist"]);
    const momsClub = (await s.call("POST", `${AREA}/spaces`, M_, { name: "Club" })).body.id as string;
    await s.bringIn(momsClub, A_, { by: M_ });
    expect((await mine(s, A_, momsClub)).body.items.map((i: { title: string }) => i.title)).toEqual(["Aanya's dentist"]);
  });

  it("leaves out a member with a block between them and the admin", async () => {
    const s = await served();
    await s.parts.threads.blocks.block(M_, A_, "Aanya S.");
    expect((await mine(s, A_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Aanya's dentist"]);
  });
});

describe("the admin shares a member's thing", () => {
  it("with one person: the grant says whose it is and who shared it, the card says so, and it reaches only them", async () => {
    const s = await served();
    const r = await shareMoms(s);
    expect(r.status).toBe(201);
    expect(r.body.message.thing).toEqual({ grantId: expect.any(String), bot: "plan", botName: "Plan Ease", ownerId: M_, ownerName: "Mom", id: s.doctor, title: "Doctor visit", line: "Event" });
    const [g] = await spaceTable<{ owner_id: string; by_id: string; to_id: string; item_id: string }>("space_grants").select({ space_id: s.home });
    expect(g).toMatchObject({ owner_id: M_, by_id: A_, to_id: R_, item_id: s.doctor });
    // Rohan's feed: the admin's card, of Mom's thing.
    const forRohan = (await feed(s, R_)).messages.find((m: { thing: unknown }) => m.thing);
    expect(forRohan).toMatchObject({ from: { userId: A_, name: "Aanya S." }, thing: { ownerId: M_, ownerName: "Mom", title: "Doctor visit" } });
    expect((await feed(s, D_)).messages.some((m: { thing: unknown }) => m.thing)).toBe(false);
  });

  it("gives what Mom's own share would: Rohan finds it under Mom, \"Shared by Aanya\", changes its time, adds a note; one thing only", async () => {
    const s = await served();
    await shareMoms(s);
    const page = (await s.call("GET", W("plan"), R_)).body;
    expect(page.spaces[0].people).toEqual([expect.objectContaining({ userId: M_, name: "Mom", how: "shared", line: "1 plan · Shared by Aanya S." })]);
    const person = (await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner: M_ })}`, R_)).body;
    expect(person.items).toEqual([expect.objectContaining({ id: s.doctor, title: "Doctor visit", sharedBy: "Aanya S." })]);
    const v = (await item(s, R_, M_, s.doctor)).body.item;
    expect(v).toMatchObject({ how: "shared", owner: { userId: M_, name: "Mom" }, sharedBy: "Aanya S.", can: { time: true, note: true }, detail: { place: "Apollo, Indiranagar" } });
    // Exactly that one thing: her satsang, her notes and her page are not his.
    expect((await item(s, R_, M_, s.satsang)).status).toBe(404);
    expect((await s.call("GET", `${W("notes")}/item?${q({ space: s.home, owner: M_, item: "n1" })}`, R_)).status).toBe(404);
    expect((await item(s, D_, M_, s.doctor)).status).toBe(404);
    // As a share by name: he moves it on Mom's own calendar, and his note is hers (and the admin's) to read.
    expect((await act(s, R_, M_, s.doctor, { op: "time", day: "2026-11-14", time: "19:30" })).status).toBe(200);
    expect((await calendar().event(M_, s.doctor.slice(2), 330)).start).toBe(Date.UTC(2026, 10, 14, 14, 0));
    expect((await act(s, R_, M_, s.doctor, { op: "note", text: "I'll drive you" })).status).toBe(200);
    expect((await item(s, M_, M_, s.doctor)).body.item.notes.map((n: { text: string }) => n.text)).toContain("I'll drive you");
  });

  it("with everyone: a look and a note for whoever is in the space, never a change to Mom's calendar", async () => {
    const s = await served();
    const r = await shareMoms(s, { to: null, id: s.satsang });
    expect(r.status).toBe(201);
    for (const who of [R_, D_]) expect((await item(s, who, M_, s.satsang)).body.item, who).toMatchObject({ how: "shared", sharedBy: "Aanya S.", can: { time: false, note: true } });
    expect((await act(s, R_, M_, s.satsang, { op: "time", day: "2026-11-15", time: "06:00" })).status).toBe(404);
    expect((await item(s, R_, M_, s.doctor)).status).toBe(404);
  });

  it("is the admin's alone: a member can't share anyone else's thing, by either id", async () => {
    const s = await served();
    for (const id of [ofMember(M_, s.doctor), s.doctor]) {
      expect((await post(s, R_, { to: D_, thing: { bot: "plan", id } })).body, id).toEqual({ code: "not_found", message: "That isn't there any more." });
    }
    // Mom, sharing "Mom's" own by that id, isn't the admin either.
    expect((await post(s, M_, { thing: { bot: "plan", id: ofMember(M_, s.doctor) } })).status).toBe(404);
    expect(await spaceTable("space_grants").select({ space_id: s.home })).toEqual([]);
  });

  it("needs an owner in the space who agreed to the line as it is now; never one who didn't, or isn't there, or to themself", async () => {
    const s = await served();
    expect((await shareMoms(s, { owner: D_, id: s.dev })).body).toEqual({ code: "not_allowed", message: "Dev hasn't agreed yet that Home's admin can share their things." });
    expect((await shareMoms(s, { owner: X_, id: s.dev })).status).toBe(404);
    expect((await shareMoms(s, { to: M_ })).status).toBe(400);
    expect((await shareMoms(s, { id: "e:nothing" })).status).toBe(404);
    // Mom agreed to the old line only ("can see"): not hers to share until she agrees to the new one.
    await members().update({ space_id: s.home, user_id: M_ }, { consent_v: 1 });
    expect((await shareMoms(s)).status).toBe(403);
    expect(await spaceTable("space_grants").select({ space_id: s.home })).toEqual([]);
    await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, M_, { consentV: CONSENT_VERSION });
    expect((await shareMoms(s)).status).toBe(201);
  });

  it("is refused across a block, and what was shared stops reaching across one made later", async () => {
    const s = await served();
    const { blocks } = s.parts.threads;
    // Mom and Rohan: refused, and said so.
    await blocks.block(M_, R_, "Rohan");
    expect((await shareMoms(s)).body).toEqual({ code: "blocked", message: "You can't share Mom's things with Rohan." });
    await blocks.unblock(M_, R_);
    // Mom and the admin: the admin can't see her things, so they aren't there.
    await blocks.block(M_, A_, "Aanya S.");
    expect((await shareMoms(s)).status).toBe(404);
    await blocks.unblock(M_, A_);
    // Shared, then a block: between Mom and Rohan, or between Mom and the admin, and it reaches nobody.
    await shareMoms(s);
    expect((await item(s, R_, M_, s.doctor)).status).toBe(200);
    await blocks.block(R_, M_, "Mom");
    expect((await item(s, R_, M_, s.doctor)).status).toBe(404);
    await blocks.unblock(R_, M_);
    expect((await item(s, R_, M_, s.doctor)).status).toBe(200);
    await blocks.block(A_, M_, "Mom");
    expect((await item(s, R_, M_, s.doctor)).status).toBe(404);
    expect((await s.call("GET", W("plan"), R_)).body.spaces[0].people).toEqual([]);
  });

  it("never reaches someone with a block between them and the admin, as its card doesn't", async () => {
    const s = await served();
    const { blocks } = s.parts.threads;
    // Dev, in the space with a block with the admin: a share the admin made of Mom's, to everyone, reaches Rohan only.
    await blocks.block(D_, A_, "Aanya S.");
    await shareMoms(s, { to: null, id: s.satsang });
    expect((await item(s, R_, M_, s.satsang)).body.item).toMatchObject({ how: "shared", sharedBy: "Aanya S." });
    expect((await item(s, D_, M_, s.satsang)).status).toBe(404);
    expect((await s.call("GET", W("plan"), D_)).body.spaces[0].people).toEqual([]);
    expect((await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner: M_ })}`, D_)).status).toBe(404);
    expect((await feed(s, D_)).messages.some((m: { thing: unknown }) => m.thing)).toBe(false);
    // Mom's own share to everyone still reaches him: the block is with the admin, not with her.
    await post(s, M_, { thing: { bot: "plan", id: s.doctor } });
    expect((await item(s, D_, M_, s.doctor)).body.item).toMatchObject({ how: "shared" });
    expect((await item(s, D_, M_, s.doctor)).body.item.sharedBy).toBeUndefined();
    // Made before the block, it stops when the block is made.
    await blocks.unblock(D_, A_);
    expect((await item(s, D_, M_, s.satsang)).status).toBe(200);
    await blocks.block(A_, D_, "Dev");
    expect((await item(s, D_, M_, s.satsang)).status).toBe(404);
  });

  it("goes when its owner leaves the space", async () => {
    const s = await served();
    await shareMoms(s);
    await s.call("DELETE", `${AREA}/spaces/${s.home}`, M_);
    expect(await spaceTable("space_grants").select({ space_id: s.home })).toEqual([]);
  });
});

describe("Stop sharing", () => {
  it("a share the admin made is the admin's alone to stop: its owner is refused, and so is the one it reaches", async () => {
    const s = await served();
    const card = (await shareMoms(s)).body.message;
    const gid = card.thing.grantId as string;
    expect((await unshare(s, M_, gid)).body).toEqual({ code: "not_allowed", message: "Only the space's admin can stop sharing this." });
    expect((await unshare(s, R_, gid)).status).toBe(403);
    expect((await unshare(s, D_, gid)).status).toBe(403);
    expect((await item(s, R_, M_, s.doctor)).status).toBe(200);
    expect((await unshare(s, A_, gid)).body).toEqual({ ok: true });
    expect((await item(s, R_, M_, s.doctor)).status).toBe(404);
    expect((await feed(s, R_)).messages.some((m: { id: string }) => m.id === card.id)).toBe(false);
  });

  it("a member stops a share they made of their own thing, and the admin can stop it too; the admin's share of it stands apart", async () => {
    const s = await served();
    const own = (await post(s, M_, { to: R_, thing: { bot: "plan", id: s.satsang } })).body.message.thing.grantId as string;
    const admins = (await shareMoms(s, { id: s.satsang })).body.message.thing.grantId as string;
    expect(admins).not.toBe(own);
    // Rohan has it twice over; the owner's own counts, so it isn't "Shared by" anyone.
    expect((await item(s, R_, M_, s.satsang)).body.item.sharedBy).toBeUndefined();
    expect((await unshare(s, M_, own)).body).toEqual({ ok: true });
    // Mom's own is gone; the admin's still reaches him, now said to be the admin's.
    expect((await item(s, R_, M_, s.satsang)).body.item).toMatchObject({ how: "shared", sharedBy: "Aanya S." });
    expect((await unshare(s, M_, admins)).status).toBe(403);
    expect((await unshare(s, A_, admins)).body).toEqual({ ok: true });
    expect((await item(s, R_, M_, s.satsang)).status).toBe(404);
    const again = (await post(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } })).body.message.thing.grantId as string;
    expect((await unshare(s, A_, again)).body).toEqual({ ok: true });
  });
});

describe("the owner is not told", () => {
  it("no card in Mom's feed, no push, no unread, no last line, and not on her page; the one it is for is pinged", async () => {
    const s = await served();
    // Everyone has read the feed so far.
    for (const who of [A_, M_, R_, D_]) await feed(s, who);
    const unread = async (who: string) => (await s.call("GET", `${AREA}/spaces?full=1`, who)).body.spaces[0].unread as number;
    const lastLine = async (who: string) => (await s.call("GET", `${AREA}/spaces?last=1`, who)).body.spaces[0].last;
    await post(s, R_, { text: "Dinner at 8?" });
    const before = await lastLine(M_);
    pushes.length = 0;
    await shareMoms(s);
    expect(pushes.map((p) => p.userId)).toEqual([R_]);
    // To everyone: everyone but Mom is pinged.
    s.clock.t += 60_000;
    pushes.length = 0;
    await shareMoms(s, { to: null, id: s.satsang });
    expect(pushes.map((p) => p.userId).sort()).toEqual([R_, D_].sort());
    // Only Rohan's message is new for her (read before the feed is opened, which marks it read).
    expect(await unread(M_)).toBe(1);
    expect((await feed(s, M_)).messages.some((m: { thing: unknown }) => m.thing)).toBe(false);
    expect((await feed(s, R_)).messages.filter((m: { thing: unknown }) => m.thing)).toHaveLength(2);
    expect((await feed(s, D_)).messages.filter((m: { thing: unknown }) => m.thing)).toHaveLength(1);
    // The space's last line is still the one for everyone before: no list or Home card says it to her (nor to anyone).
    expect(await lastLine(M_)).toEqual(before);
    expect(await lastLine(R_)).toEqual(before);
    const thread = (await feed(s, M_)).space.threadId as string;
    expect(((await s.call("GET", `${AREA}/threads/${thread}`, M_)).body.messages as Array<{ item: unknown }>).some((m) => m.item)).toBe(false);
    expect((await s.parts.threads.recentFrom(M_)).map((x) => x.text)).not.toContain("Shared Satsang");
    // Her own page lists only who she shared it with herself.
    expect((await item(s, M_, M_, s.doctor)).body.item.shared).toEqual([]);
    expect((await item(s, M_, M_, s.satsang)).body.item.shared).toEqual([]);
    // Nor in the space's activity, which every member reads.
    expect(JSON.stringify((await s.call("GET", `${AREA}/spaces/${s.home}/activity`, M_)).body)).not.toMatch(/Doctor visit|Satsang/);
  });

  it("someone with a block with Mom doesn't see the card of her thing either, nor is pinged for it", async () => {
    const s = await served();
    await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, D_, { consentV: CONSENT_VERSION });
    await s.parts.threads.blocks.block(D_, M_, "Mom");
    pushes.length = 0;
    await shareMoms(s, { to: null, id: s.satsang });
    expect(pushes.map((p) => p.userId)).toEqual([R_]);
    expect((await feed(s, D_)).messages.some((m: { thing: unknown }) => m.thing)).toBe(false);
  });
});

describe("the line about the admin, now \"can see and share\"", () => {
  it("Mom, who agreed to the old line, is asked once more before she writes; until then the admin sees only what she shares", async () => {
    const s = await served();
    await members().update({ space_id: s.home, user_id: M_ }, { consent_v: null });
    expect((await feed(s, M_)).space.consented).toBe(false);
    expect((await post(s, M_, { text: "Hi" })).body).toEqual({ code: "consent_needed", message: "Tap OK on the line about the space's admin first." });
    // The admin: Mom isn't "all their plans" any more, and none of hers is in "/".
    expect((await s.call("GET", W("plan"), A_)).body.spaces[0].people.map((p: { name: string; how: string }) => [p.name, p.how])).toEqual([["Rohan", "admin"]]);
    expect((await item(s, A_, M_, s.satsang)).status).toBe(404);
    expect((await mine(s, A_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Aanya's dentist"]);
    // Nor does Mom's Work page say the admin sees her things.
    expect((await s.call("GET", W("plan"), M_)).body.seenBy).toEqual([]);
    // OK on the new line: all as it was, and the version is kept.
    expect((await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, M_, { consentV: CONSENT_VERSION })).status).toBe(200);
    expect((await members().select({ space_id: s.home, user_id: M_ }))[0]).toMatchObject({ consent_ms: s.clock.t, consent_v: CONSENT_VERSION });
    expect((await feed(s, M_)).space.consented).toBe(true);
    expect((await post(s, M_, { text: "Hi" })).status).toBe(201);
    expect((await item(s, A_, M_, s.satsang)).body.item.how).toBe("admin");
  });

  it("new joiners agree to the new line when they join; a request made under the old one comes in without it", async () => {
    const s = await served();
    expect((await members().select({ space_id: s.home, user_id: R_ }))[0]).toMatchObject({ consent_v: CONSENT_VERSION });
    expect((await members().select({ space_id: s.home, user_id: D_ }))[0]).toMatchObject({ consent_ms: null, consent_v: null });
    // Someone with the code asks (having seen the line), but under the old wording: let in, then asked in the feed.
    const code = (await s.call("GET", `${AREA}/spaces/${s.home}`, A_)).body.space.code as string;
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code, consent: true, consentV: CONSENT_VERSION })).body).toEqual({ status: "requested" });
    const [req] = await spaceTable<{ id: string; consent_v: number | null }>("space_join_requests").select({ space_id: s.home, user_id: X_ });
    expect(req!.consent_v).toBe(CONSENT_VERSION);
    await spaceTable("space_join_requests").update({ id: req!.id }, { consent_v: null });
    expect((await s.call("PUT", `${AREA}/spaces/${s.home}/requests/${req!.id}`, A_, { decision: "accept" })).body.status).toBe("joined");
    expect((await feed(s, X_)).space.consented).toBe(false);
  });

  it("a yes from a screen that still showed the line before counts as that line's, so they are asked once more", async () => {
    const s = await served();
    // The feed's OK from a card drawn before the line changed (no consentV): the line before, still not this one.
    await members().update({ space_id: s.home, user_id: M_ }, { consent_ms: null, consent_v: null });
    expect((await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, M_)).status).toBe(200);
    expect((await members().select({ space_id: s.home, user_id: M_ }))[0]).toMatchObject({ consent_ms: s.clock.t, consent_v: 1 });
    expect((await feed(s, M_)).space.consented).toBe(false);
    expect((await shareMoms(s)).status).toBe(403);
    expect((await mine(s, A_)).body.items.some((i: { title: string }) => i.title === "Doctor visit")).toBe(false);
    // The card as it is now: agreed.
    await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, M_, { consentV: CONSENT_VERSION });
    expect((await feed(s, M_)).space.consented).toBe(true);
    expect((await shareMoms(s)).status).toBe(201);
    // Accept, and a code typed, on a thought drawn before the line changed: in, with the line before, and asked in the feed.
    const code = (await s.call("GET", `${AREA}/spaces/${s.home}`, A_)).body.space.code as string;
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code, consent: true })).body).toEqual({ status: "requested" });
    const [req] = await spaceTable<{ id: string; consent_v: number | null }>("space_join_requests").select({ space_id: s.home, user_id: X_ });
    expect(req!.consent_v).toBe(1);
    expect((await s.call("PUT", `${AREA}/spaces/${s.home}/requests/${req!.id}`, A_, { decision: "accept" })).body.status).toBe("joined");
    expect((await members().select({ space_id: s.home, user_id: X_ }))[0]).toMatchObject({ consent_v: 1 });
    expect((await feed(s, X_)).space.consented).toBe(false);
    const club = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Club" })).body.id as string;
    const inv = (await s.call("POST", `${AREA}/spaces/${club}/invite`, A_, { email: "rohan@example.in" })).body;
    expect((await s.call("PUT", `${AREA}/spaces/invitations/${inv.code}`, R_, { decision: "accept", consent: true })).body.status).toBe("joined");
    expect((await s.call("GET", `${AREA}/spaces/${club}/feed`, R_)).body.space.consented).toBe(false);
  });

  it("says so everywhere it is said: the invite mail, and the line's own words", async () => {
    const s = await served();
    expect(ADMIN_LINE).toBe("The space's admin can see and share your work and messages here.");
    await s.call("POST", `${AREA}/spaces/${s.home}/invite`, A_, { email: "nani@example.in" });
    const mail = (await s.outbox.byRef("space_invite", (await s.call("GET", `${AREA}/spaces/${s.home}`, A_)).body.space.invites.find((i: { email: string }) => i.email === "nani@example.in").code))!;
    expect(mail.body_text).toContain("The space's admin can see and share your work and messages there.");
  });
});
