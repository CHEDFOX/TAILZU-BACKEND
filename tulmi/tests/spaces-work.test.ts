/**
 * THINGS SHARED FROM A BOT, AND WORK IN SPACE (src/botsBots/{grants,work,spaceFeed}.ts, routes/bots/work.ts; docs/spaces.md):
 *
 *   - "/" shares one of your own things with one person (or everyone): a grant and a card only they, you and the admin see
 *   - the grantee's bot page lists who shared what (never reading anyone's bot to do it), opens the thing, changes its time on the
 *     owner's own calendar and adds notes; anyone else gets the same 404 as a thing that isn't there
 *   - the admin sees every member's things who saw the line about the admin, and nobody else's
 *   - an old per-bot share stays view only; every answer but the owner's needs a space both are in; notes stay in their space; work
 *     is never written to the space's activity; leaving, and moderation taking the card out, take the access away
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

const { A_, M_, R_, D_, AREA, spacesServer } = await import("./spaces-rig.js");
const { shareSources } = await import("../src/botsBots/shareSources.js");
const { calendar } = await import("../src/calendar/index.js");
const { spaceTable } = await import("../src/botsBots/spaceRows.js");

const W = (bot: string) => `${AREA}/work/${bot}`;
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function served() {
  const clock = { t: Date.UTC(2026, 10, 10, 6, 0) };
  // Every read of someone's bot is counted: a bot page's own read must never list anyone else's.
  const reads: string[] = [];
  const real = shareSources({ now: () => clock.t });
  const sources = {
    plan: { list: async (u: string) => { reads.push(`plan:${u}`); return real.plan!.list(u); } },
    notes: { list: async (u: string) => { reads.push(`notes:${u}`); return u === M_ ? [{ id: "n1", title: "Family meeting", line: "12 min", at: clock.t }] : []; } },
  };
  const s = await spacesServer({ pushes, clock, sources });
  const cal = calendar();
  const doctor = await cal.addEvent(M_, { title: "Doctor visit", day: "2026-11-14", time: "19:40", place: "Apollo, Indiranagar", notes: "Bring reports", tz: 330 });
  const satsang = await cal.addEvent(M_, { title: "Satsang", day: "2026-11-15", time: "08:00", tz: 330 });
  const dev = await cal.addEvent(D_, { title: "Dev's dentist", day: "2026-11-16", time: "10:00", tz: 330 });
  const home = await s.family([M_, R_]);
  await s.bringIn(home, D_, { consent: false });
  return { ...s, reads, home, doctor: `e:${doctor.id}`, satsang: `e:${satsang.id}`, dev: `e:${dev.id}` };
}
type S = Awaited<ReturnType<typeof served>>;
const share = (s: S, who: string, b: Record<string, unknown>) => s.call("POST", `${AREA}/spaces/${s.home}/feed`, who, b);
const item = (s: S, who: string, owner: string, id: string, space = s.home) => s.call("GET", `${W("plan")}/item?${q({ space, owner, item: id, tz: "330" })}`, who);
const act = (s: S, who: string, owner: string, id: string, b: Record<string, unknown>, space = s.home) => s.call("POST", `${W("plan")}/item`, who, { space, owner, item: id, tz: 330, ...b });

describe("sharing one thing with \"/\"", () => {
  it("only shares your own things, and its card is seen by the one it is for, the sender and the admin", async () => {
    const s = await served();
    expect((await share(s, R_, { text: "look", thing: { bot: "plan", id: s.doctor } })).body).toEqual({ code: "not_found", message: "That isn't there any more." });
    expect((await share(s, M_, { thing: { bot: "shop", id: "x" } })).status).toBe(404);
    const r = await share(s, M_, { text: "So you know", to: R_, thing: { bot: "plan", id: s.doctor } });
    expect(r.status).toBe(201);
    expect(r.body.message.thing).toEqual({ grantId: expect.any(String), bot: "plan", botName: "Plan Ease", ownerId: M_, id: s.doctor, title: "Doctor visit", line: "Event" });
    const cards = async (who: string) => ((await s.call("GET", `${AREA}/spaces/${s.home}/feed`, who)).body.messages as Array<{ thing: unknown }>).filter((m) => m.thing).length;
    expect([await cards(M_), await cards(R_), await cards(A_), await cards(D_)]).toEqual([1, 1, 1, 0]);
    expect((await s.call("GET", `${W("plan")}/mine`, M_)).body.items.map((i: { title: string }) => i.title)).toEqual(["Doctor visit", "Satsang"]);
  });
});

describe("Work in space", () => {
  it("lists who shared what with the grantee, without reading anyone's bot, and opens only that thing", async () => {
    const s = await served();
    await share(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } });
    s.reads.length = 0;
    const page = (await s.call("GET", W("plan"), R_)).body;
    expect(page).toEqual({
      bot: "plan", botName: "Plan Ease", seenBy: ["Aanya S."], notesOnMine: [],
      spaces: [{ spaceId: s.home, spaceName: "Home", admin: false, people: [{ userId: M_, name: "Mom", how: "shared", line: "1 plan shared with you" }] }],
    });
    expect(s.reads).toEqual([]);
    const person = (await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner: M_ })}`, R_)).body;
    expect(person.items.map((i: { title: string }) => i.title)).toEqual(["Doctor visit"]);
    expect(person.person).toMatchObject({ how: "shared" });
    const it1 = (await item(s, R_, M_, s.doctor)).body.item;
    expect(it1).toMatchObject({
      title: "Doctor visit", how: "shared", owner: { userId: M_, name: "Mom", you: false }, space: { id: s.home, name: "Home" },
      detail: { when: "Sat 14 Nov · 7:40 pm", day: "2026-11-14", time: "19:40", place: "Apollo, Indiranagar", notes: "Bring reports" }, can: { time: true, note: true },
    });
    // Not shared with him: as if it weren't there.
    expect((await item(s, R_, M_, s.satsang)).status).toBe(404);
    expect((await item(s, D_, M_, s.doctor)).status).toBe(404);
    expect((await act(s, D_, M_, s.doctor, { op: "note", text: "hi" })).status).toBe(404);
    expect((await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner: M_ })}`, D_)).status).toBe(404);
    expect((await s.call("GET", W("shop"), R_)).status).toBe(404);
  });

  it("changes the time on the owner's own calendar and adds notes, as notes on the thing, never in the space's activity", async () => {
    const s = await served();
    await share(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } });
    const log = async () => (await s.call("GET", `${AREA}/spaces/${s.home}/activity`, A_)).body.activity.length as number;
    const before = await log();
    const moved = (await act(s, R_, M_, s.doctor, { op: "time", day: "2026-11-14", time: "19:30" })).body.item;
    expect(moved.detail.when).toBe("Sat 14 Nov · 7:30 pm");
    expect((await calendar().event(M_, s.doctor.slice(2), 330)).start).toBe(Date.UTC(2026, 10, 14, 14, 0));
    expect(moved.notes).toEqual([expect.objectContaining({ by: "You", you: true, text: "Moved it to Sat 14 Nov · 7:30 pm." })]);
    s.clock.t += 1000;
    const noted = (await act(s, R_, M_, s.doctor, { op: "note", text: "I'll drive you" })).body.item;
    expect(noted.notes.map((n: { text: string }) => n.text)).toEqual(["I'll drive you", "Moved it to Sat 14 Nov · 7:30 pm."]);
    expect(await log()).toBe(before);
    // Mom sees both on her own thing, by Rohan, and on her bot's page.
    expect((await item(s, M_, M_, s.doctor)).body.item).toMatchObject({ how: "own", notes: [expect.objectContaining({ by: "Rohan", text: "I'll drive you" }), expect.anything()] });
    expect((await s.call("GET", W("plan"), M_)).body.notesOnMine[0]).toMatchObject({ itemId: s.doctor, title: "Doctor visit", by: "Rohan", text: "I'll drive you", spaceId: s.home });
    expect((await act(s, R_, M_, s.doctor, { op: "note", text: "" })).status).toBe(400);
    expect((await act(s, R_, M_, s.doctor, { op: "time", day: "tomorrow", time: "x" })).status).toBe(400);
  });

  it("shows the admin every member's things who saw the line about the admin, and nobody else's", async () => {
    const s = await served();
    s.reads.length = 0;
    const page = (await s.call("GET", W("plan"), A_)).body;
    expect(page.spaces).toEqual([{ spaceId: s.home, spaceName: "Home", admin: true, people: [
      { userId: M_, name: "Mom", how: "admin", line: "All their plans" }, { userId: R_, name: "Rohan", how: "admin", line: "All their plans" },
    ] }]);
    expect(page.seenBy).toEqual([]);
    expect(s.reads).toEqual([]);
    const mom = (await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner: M_ })}`, A_)).body;
    expect(mom.items.map((i: { title: string }) => i.title)).toEqual(["Doctor visit", "Satsang"]);
    expect((await item(s, A_, M_, s.satsang)).body.item).toMatchObject({ how: "admin", can: { time: true, note: true } });
    // Dev never tapped OK: the admin sees nothing of his.
    expect((await item(s, A_, D_, s.dev)).status).toBe(404);
    expect((await s.call("GET", `${W("plan")}/person?${q({ space: s.home, owner: D_ })}`, A_)).status).toBe(404);
    // Notes are every bot's: Mom's notes too.
    expect((await s.call("GET", W("notes"), A_)).body.spaces[0].people[0]).toMatchObject({ how: "admin", line: "All their notes" });
  });

  it("keeps an old per-bot share view only, and needs a space both are in", async () => {
    const s = await served();
    // Mom's club, with Dev, where she shares her whole plan the old way.
    const club = (await s.call("POST", `${AREA}/spaces`, M_, { name: "Club" })).body.id;
    await s.bringIn(club, D_, { by: M_ });
    expect((await s.call("PUT", `${AREA}/spaces/${club}/bots/plan/mine`, M_, { mode: "all" })).status).toBe(200);
    // Rohan names the club, which he isn't in: nothing, though Mom shares everything there.
    expect((await item(s, R_, M_, s.satsang, club)).status).toBe(404);
    const v = (await item(s, D_, M_, s.doctor, club)).body.item;
    expect(v).toMatchObject({ how: "view", can: { time: false, note: true }, detail: { when: "Sat 14 Nov · 7:40 pm" } });
    expect(v.detail.place).toBeUndefined();
    expect(v.detail.notes).toBeUndefined();
    expect((await act(s, D_, M_, s.doctor, { op: "time", day: "2026-11-14", time: "18:00" }, club)).status).toBe(404);
    // Every space Dev is in (Home, with nobody to show him yet, too), so the bot page always has Work in space.
    expect((await s.call("GET", W("plan"), D_)).body.spaces).toEqual([
      { spaceId: s.home, spaceName: "Home", admin: false, people: [] },
      { spaceId: club, spaceName: "Club", admin: false, people: [{ userId: M_, name: "Mom", how: "view", line: "Everything they share" }] },
    ]);
    // A note through Home (Rohan's grant) stays in Home: Dev, working through the club, doesn't see it; Mom sees both.
    await share(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } });
    await act(s, R_, M_, s.doctor, { op: "note", text: "Through Home" });
    s.clock.t += 1000;
    await act(s, D_, M_, s.doctor, { op: "note", text: "Through the club" }, club);
    expect((await item(s, D_, M_, s.doctor, club)).body.item.notes.map((n: { text: string }) => n.text)).toEqual(["Through the club"]);
    expect((await item(s, R_, M_, s.doctor)).body.item.notes.map((n: { text: string }) => n.text)).toEqual(["Through Home"]);
    expect((await item(s, M_, M_, s.doctor)).body.item.notes.map((n: { text: string }) => n.text)).toEqual(["Through the club", "Through Home"]);
  });

  it("goes when someone leaves, and when moderation takes the card out", async () => {
    const s = await served();
    const card = (await share(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } })).body.message;
    expect((await item(s, R_, M_, s.doctor)).status).toBe(200);
    // A report of the card, upheld: the access goes with it.
    const thread = (await s.call("GET", `${AREA}/spaces/${s.home}/feed`, R_)).body.space.threadId;
    const rep = (await s.call("POST", `${AREA}/reports`, R_, { kind: "message", id: card.id, thread, reason: "spam" })).body.report;
    await s.parts.safety.resolve(rep.id, { remove: true });
    expect((await item(s, R_, M_, s.doctor)).status).toBe(404);
    const people = async () => ((await s.call("GET", W("plan"), R_)).body.spaces as Array<{ people: unknown[] }>).flatMap((x) => x.people);
    expect(await people()).toEqual([]);
    // Shared again, then Rohan leaves and comes back: nothing of it is left.
    await share(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } });
    expect(await people()).toHaveLength(1);
    await s.call("DELETE", `${AREA}/spaces/${s.home}`, R_);
    expect(await spaceTable("space_grants").select({ space_id: s.home, to_id: R_ })).toEqual([]);
    await s.bringIn(s.home, R_);
    expect(await people()).toEqual([]);
  });

  it("shares with everyone in the space with \"/\" alone", async () => {
    const s = await served();
    expect((await share(s, M_, { thing: { bot: "plan", id: s.satsang } })).status).toBe(201);
    for (const who of [R_, A_]) expect((await item(s, who, M_, s.satsang)).status, who).toBe(200);
    expect((await item(s, R_, M_, s.satsang)).body.item.how).toBe("shared");
    // Dev hasn't tapped OK: he can't post, but he is still someone a share to everyone reaches.
    expect((await item(s, D_, M_, s.satsang)).body.item.how).toBe("shared");
  });
});

describe("the gaps a review found", () => {
  it("a share to everyone is a look and a note, never a change to the owner's calendar; only a share by name moves it", async () => {
    const s = await served();
    await share(s, M_, { thing: { bot: "plan", id: s.satsang } });
    expect((await item(s, R_, M_, s.satsang)).body.item).toMatchObject({ how: "shared", can: { time: false, note: true } });
    const before = (await calendar().event(M_, s.satsang.slice(2), 330)).start;
    expect((await act(s, R_, M_, s.satsang, { op: "time", day: "2026-11-15", time: "06:00" })).status).toBe(404);
    expect((await calendar().event(M_, s.satsang.slice(2), 330)).start).toBe(before);
    // Shared with Rohan by name as well: now he may.
    await share(s, M_, { to: R_, thing: { bot: "plan", id: s.satsang } });
    expect((await item(s, R_, M_, s.satsang)).body.item.can.time).toBe(true);
    expect((await item(s, D_, M_, s.satsang)).body.item.can.time).toBe(false);
  });

  it("Stop sharing: the sharer or the admin takes it back, the card leaves the feed, the access goes; nobody else can", async () => {
    const s = await served();
    const card = (await share(s, M_, { text: "So you know", to: R_, thing: { bot: "plan", id: s.doctor } })).body.message;
    const gid = card.thing.grantId as string;
    const unshare = (who: string, space = s.home, id = gid) => s.call("DELETE", `${AREA}/spaces/${space}/grants/${id}`, who);
    // The owner's page says who has it.
    expect((await item(s, M_, M_, s.doctor)).body.item.shared).toEqual([{ grantId: gid, spaceId: s.home, spaceName: "Home", to: "Rohan" }]);
    expect((await item(s, R_, M_, s.doctor)).body.item.shared).toEqual([]);
    // Rohan (who has it) and Dev can't take it back; a stranger's space or a grant that isn't there is 404.
    expect((await unshare(R_)).status).toBe(403);
    expect((await unshare(D_)).status).toBe(403);
    expect((await unshare(M_, s.home, "nope")).status).toBe(404);
    expect((await unshare(M_)).body).toEqual({ ok: true });
    expect((await item(s, R_, M_, s.doctor)).status).toBe(404);
    const feed = (await s.call("GET", `${AREA}/spaces/${s.home}/feed`, R_)).body.messages as Array<{ id: string }>;
    expect(feed.some((m) => m.id === card.id)).toBe(false);
    expect((await item(s, M_, M_, s.doctor)).body.item.shared).toEqual([]);
    expect((await unshare(M_)).status).toBe(404);
    // The admin can take a member's share back too, a share to everyone included.
    const all = (await share(s, M_, { thing: { bot: "plan", id: s.satsang } })).body.message;
    expect((await item(s, M_, M_, s.satsang)).body.item.shared).toEqual([{ grantId: all.thing.grantId, spaceId: s.home, spaceName: "Home", to: "Everyone" }]);
    expect((await unshare(A_, s.home, all.thing.grantId)).body).toEqual({ ok: true });
    expect((await item(s, R_, M_, s.satsang)).status).toBe(404);
  });

  it("a note added through a share to one person is for the owner, its writer and the admin, not for another it was shared with", async () => {
    const s = await served();
    await share(s, M_, { to: R_, thing: { bot: "plan", id: s.doctor } });
    // Shared with Dev separately; and Dev taps OK so he can write.
    await s.call("PUT", `${AREA}/spaces/${s.home}/consent`, D_);
    await share(s, M_, { to: D_, thing: { bot: "plan", id: s.doctor } });
    await act(s, D_, M_, s.doctor, { op: "note", text: "Can't come, hospital appointment" });
    s.clock.t += 1000;
    await act(s, R_, M_, s.doctor, { op: "note", text: "I'll drive" });
    const notes = async (who: string) => ((await item(s, who, M_, s.doctor)).body.item.notes as Array<{ text: string }>).map((n) => n.text);
    expect(await notes(R_)).toEqual(["I'll drive"]);
    expect(await notes(D_)).toEqual(["Can't come, hospital appointment"]);
    expect(await notes(M_)).toEqual(["I'll drive", "Can't come, hospital appointment"]);
    expect(await notes(A_)).toEqual(["I'll drive", "Can't come, hospital appointment"]);
    // The owner's own note, and the admin's, are for everyone who may open it.
    s.clock.t += 1000;
    await act(s, M_, M_, s.doctor, { op: "note", text: "Thank you both" });
    expect(await notes(R_)).toEqual(["Thank you both", "I'll drive"]);
    expect(await notes(D_)).toEqual(["Thank you both", "Can't come, hospital appointment"]);
  });

  it("opening your own thing with a space you aren't in says no space's name", async () => {
    const s = await served();
    const other = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Secret Club" })).body.id;
    const v = (await item(s, M_, M_, s.doctor, other)).body.item;
    expect(v.how).toBe("own");
    expect(v.space).toEqual({ id: "", name: "" });
    expect(JSON.stringify(v)).not.toContain("Secret Club");
  });

  it("screens a shared thing's line, which its card shows to others", async () => {
    // A trip's line is its owner's own "when · who", typed: the card shows it to everyone it reaches.
    const sources = { travel: { list: async (u: string) => (u === M_ ? [{ id: "t1", title: "Goa trip", line: "Dec · send nudes", at: null }] : []) } };
    const t = await spacesServer({ pushes, sources });
    const home = await t.family([M_, R_]);
    const r = await t.call("POST", `${AREA}/spaces/${home}/feed`, M_, { thing: { bot: "travel", id: "t1" } });
    expect(r).toMatchObject({ status: 422, body: { code: "blocked_content" } });
    expect(await spaceTable("space_grants").select({ space_id: home })).toEqual([]);
  });
});
