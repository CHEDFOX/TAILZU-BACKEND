/**
 * A SPACE'S FEED (src/botsBots/{spaceFeed,threads}.ts, routes/bots/botsSpaces.ts; docs/spaces.md): a message to one person is seen
 * by them, its sender and the space's admin, and by nobody else, through every reader (the feed, old builds' chat, the widget's
 * words, a report, a file, unread counts, pushes, a chat's last line and its time); a block refuses it; a name at the start is
 * asked about, never sent to everyone by a slip; a member writes only after seeing the line about the admin.
 *
 * Home: Aanya (admin), Mom, Rohan and Dev. Mom writes to Rohan.
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

const { A_, M_, R_, D_, K_, X_, AREA, FILE_M, spacesServer } = await import("./spaces-rig.js");
const { signQuery } = await import("../src/botsBots/spaceLinks.js");

const served = () => spacesServer({ pushes });
type S = Awaited<ReturnType<typeof served>>;
const feed = async (s: S, id: string, who: string) => (await s.call("GET", `${AREA}/spaces/${id}/feed`, who)).body;
const texts = async (s: S, id: string, who: string) => ((await feed(s, id, who)).messages as Array<{ text: string }>).map((m) => m.text);
const post = (s: S, id: string, who: string, b: Record<string, unknown>) => s.call("POST", `${AREA}/spaces/${id}/feed`, who, b);

/** Home with everyone, a line for everyone first, then Mom's message to Rohan. */
async function homeWithSecret(s: S) {
  const id = await s.family([M_, R_, D_]);
  expect((await post(s, id, A_, { text: "Dinner at 8" })).status).toBe(201);
  s.clock.t += 60_000;
  pushes.length = 0;
  const r = await post(s, id, M_, { text: "Your birthday gift is in my cupboard", to: R_, files: [FILE_M] });
  expect(r.status).toBe(201);
  const thread = (await feed(s, id, A_)).space.threadId as string;
  return { id, thread, msg: r.body.message };
}

describe("a message to one person", () => {
  it("is seen by its sender, the one it is to and the admin; nobody else, in any reader", async () => {
    const s = await served();
    const { id, thread, msg } = await homeWithSecret(s);
    expect(msg).toMatchObject({ from: { userId: M_, name: "Mom", you: true }, to: { userId: R_, name: "Rohan", you: false }, text: "Your birthday gift is in my cupboard" });
    for (const who of [M_, R_, A_]) expect(await texts(s, id, who), who).toContain("Your birthday gift is in my cupboard");
    expect(await texts(s, id, D_)).toEqual(["Dinner at 8"]);
    // Rohan sees it as a normal message to him; the admin sees who it was to.
    const forRohan = (await feed(s, id, R_)).messages.at(-1);
    expect(forRohan.to).toEqual({ userId: R_, name: "Rohan", you: true });
    expect((await feed(s, id, A_)).messages.at(-1).to).toEqual({ userId: R_, name: "Rohan", you: false });
    // Old builds' chat reads the same thread.
    expect(((await s.call("GET", `${AREA}/threads/${thread}`, D_)).body.messages as Array<{ text: string }>).map((m) => m.text)).toEqual(["Dinner at 8"]);
    expect((await s.call("GET", `${AREA}/threads/${thread}`, M_)).body.messages.at(-1).to).toMatchObject({ name: "Rohan" });
    // The widget's words.
    expect((await s.parts.threads.recentFrom(D_)).map((r) => r.text)).not.toContain("Your birthday gift is in my cupboard");
    expect((await s.parts.threads.recentFrom(R_)).map((r) => r.text)).toContain("Your birthday gift is in my cupboard");
    // A report: Dev can't report what he can't see; Rohan can.
    expect((await s.call("POST", `${AREA}/reports`, D_, { kind: "message", id: msg.id, thread, reason: "spam" })).status).toBe(404);
    expect((await s.call("GET", `${AREA}/reports/preview?kind=message&id=${msg.id}&thread=${thread}`, R_)).status).toBe(200);
    // Its file: a link signed for Dev opens nothing.
    const fid = msg.files[0].id as string;
    const forDev = `/v1/botsapp/bots/threads/${thread}/files/${msg.id}/${fid}?${signQuery(D_, [thread, msg.id, fid])}`;
    expect((await s.call("GET", forDev, null)).status).toBe(404);
    const forRohanFile = `/v1/botsapp/bots/threads/${thread}/files/${msg.id}/${fid}?${signQuery(R_, [thread, msg.id, fid])}`;
    expect((await s.call("GET", forRohanFile, null)).status).toBe(200);
  });

  it("counts unread, pings and tells live only who sees it; the admin is not pinged", async () => {
    const s = await served();
    const id = await s.family([M_, R_, D_]);
    await post(s, id, A_, { text: "Dinner at 8" });
    const unread = async (who: string) => (await s.call("GET", `${AREA}/spaces?full=1`, who)).body.spaces[0].unread as number;
    const before = { dev: await unread(D_), aanya: await unread(A_), rohan: await unread(R_) };
    pushes.length = 0;
    await post(s, id, M_, { text: "Psst", to: R_ });
    expect(await unread(D_)).toBe(before.dev);
    expect(await unread(R_)).toBe(before.rohan + 1);
    // It is the admin's feed too: it counts, silently.
    expect(await unread(A_)).toBe(before.aanya + 1);
    expect(pushes.map((p) => [p.userId, p.kind, p.data])).toEqual([[R_, "space_feed", { id }]]);
    expect(JSON.stringify(pushes)).not.toContain("Psst");
    // A message for everyone pings everyone else, the admin too.
    pushes.length = 0;
    await post(s, id, R_, { text: "Thanks" });
    expect(pushes.map((p) => p.userId).sort()).toEqual([A_, M_, D_].sort());
  });

  it("never becomes the last line, nor moves the time, of anyone's chat or space", async () => {
    const s = await served();
    const { id, thread } = await homeWithSecret(s);
    const devList = (await s.call("GET", `${AREA}/threads`, D_)).body.threads.find((t: { id: string }) => t.id === thread);
    expect(devList.last.text).toBe("Aanya S.: Dinner at 8");
    const lineAt = devList.last.at as number;
    s.clock.t += 60_000;
    await post(s, id, M_, { text: "Another secret", to: R_ });
    const again = (await s.call("GET", `${AREA}/threads`, D_)).body.threads.find((t: { id: string }) => t.id === thread);
    expect(again.last).toEqual({ text: "Aanya S.: Dinner at 8", at: lineAt });
    expect((await s.call("GET", `${AREA}/spaces?full=1`, R_)).body.spaces[0].last).toEqual({ from: "Aanya S.", text: "Dinner at 8", at: lineAt });
    // Taking out the last line for everyone: the one before it for everyone, never the secret.
    s.clock.t += 60_000;
    const late = (await post(s, id, D_, { text: "On my way" })).body.message;
    expect(await s.parts.threads.removeMessage(thread, late.id)).toMatchObject({ id: late.id });
    const after = (await s.call("GET", `${AREA}/threads`, D_)).body.threads.find((t: { id: string }) => t.id === thread);
    expect(after.last).toEqual({ text: "Aanya S.: Dinner at 8", at: lineAt });
  });

  it("is refused with a block either way, and to someone not in the space", async () => {
    const s = await served();
    const id = await s.family([M_, R_, D_]);
    await s.parts.threads.blocks.block(R_, M_, "Mom");
    expect((await post(s, id, M_, { text: "hi", to: R_ })).body).toEqual({ code: "blocked", message: "You can't message them." });
    expect((await post(s, id, R_, { text: "hi", to: M_ })).status).toBe(403);
    expect((await post(s, id, M_, { text: "hi", to: X_ })).body).toEqual({ code: "not_found", message: "They aren't in this space." });
    expect((await post(s, id, M_, { text: "hi", to: M_ })).status).toBe(404);
    // Someone with a block is left out of the feed's people.
    expect((await feed(s, id, R_)).people.map((p: { name: string }) => p.name)).toEqual(["Aanya S.", "Rohan", "Dev"]);
  });
});

describe("a name at the start", () => {
  it("is asked about when spoken: one Mom, nobody, two Moms", async () => {
    const s = await served();
    const id = await s.family([M_, R_, D_]);
    const said = await post(s, id, R_, { text: "Mom, dinner's ready", voice: true });
    expect(said.status).toBe(200);
    expect(said.body).toEqual({ confirm: { toId: M_, toName: "Mom", text: "dinner's ready", whole: "Mom, dinner's ready", line: "Send this to Mom only?" } });
    expect(await texts(s, id, A_)).not.toContain("Mom, dinner's ready");
    expect((await post(s, id, R_, { text: "Hey mom dinner's ready", voice: true })).body.confirm.toId).toBe(M_);
    expect((await post(s, id, R_, { text: "dinner's ready", voice: true })).status).toBe(201);
    expect(await texts(s, id, D_)).toContain("dinner's ready");
    await s.bringIn(id, K_);
    const two = (await post(s, id, R_, { text: "Mom, dinner's ready", voice: true })).body.confirm;
    expect(two).toEqual({ toId: "", toName: "", text: "Mom, dinner's ready", whole: "Mom, dinner's ready", line: "Two people here have that name. Send it to everyone, or cancel and write it with @." });
  });

  it("is asked about when typed with @ and nobody picked; @nobody and empty picks go to everyone", async () => {
    const s = await served();
    const id = await s.family([M_, R_, D_]);
    expect((await post(s, id, R_, { text: "@Mom dinner" })).body.confirm).toMatchObject({ toId: M_, text: "dinner", line: "Send this to Mom only?" });
    const nobody = await post(s, id, R_, { text: "@nobody hi" });
    expect(nobody.status).toBe(201);
    expect(nobody.body.message.to).toBeNull();
    const empty = await post(s, id, R_, { text: "for all", to: "", thing: { bot: "", id: "" } });
    expect(empty.status).toBe(201);
    expect(empty.body.message).toMatchObject({ to: null, thing: null });
    expect(await texts(s, id, D_)).toEqual(["@nobody hi", "for all"]);
    // With a person picked, or without "@" at the start, it never asks.
    expect((await post(s, id, R_, { text: "@Mom dinner", to: M_ })).status).toBe(201);
    expect((await post(s, id, R_, { text: "Mom made dinner" })).status).toBe(201);
    expect((await post(s, id, R_, {})).body).toEqual({ code: "bad_request", message: "Write something first." });
  });
});

describe("Everyone, after the question", () => {
  it("sends to everyone when the person chose it, without asking about the name again", async () => {
    const s = await served();
    const home = await s.family([M_, R_]);
    const asked = await s.call("POST", `${AREA}/spaces/${home}/feed`, A_, { text: "@Rohan! dinner" });
    expect(asked.body.confirm).toMatchObject({ toId: R_ });
    const sent = await s.call("POST", `${AREA}/spaces/${home}/feed`, A_, { text: asked.body.confirm.whole, everyone: true });
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ to: null, text: "@Rohan! dinner" });
  });
});

describe("the line about the admin", () => {
  it("must be seen (OK tapped) before a member writes; the admin never needs it", async () => {
    const s = await served();
    const id = await s.family([M_]);
    await s.bringIn(id, R_, { consent: false });
    const read = await feed(s, id, R_);
    expect(read.space).toMatchObject({ consented: false, admin: false, adminName: "Aanya S." });
    expect((await post(s, id, R_, { text: "hi" })).body).toEqual({ code: "consent_needed", message: "Tap OK on the line about the space's admin first." });
    expect((await post(s, id, R_, { text: "hi", thing: { bot: "plan", id: "e:x" } })).status).toBe(403);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/consent`, R_)).body).toEqual({ ok: true });
    expect((await feed(s, id, R_)).space.consented).toBe(true);
    expect((await post(s, id, R_, { text: "hi" })).status).toBe(201);
    expect((await feed(s, id, A_)).space).toMatchObject({ consented: true, admin: true });
    expect((await post(s, id, A_, { text: "welcome" })).status).toBe(201);
  });

  it("reads people, what waits, and pages of the feed", async () => {
    const s = await served();
    const id = await s.family([M_, R_]);
    for (let i = 1; i <= 35; i += 1) { s.clock.t += 1000; await post(s, id, M_, { text: `Line ${i}` }); }
    const first = await feed(s, id, R_);
    expect(first.people).toEqual([
      { userId: A_, name: "Aanya S.", you: false, admin: true }, { userId: M_, name: "Mom", you: false, admin: false }, { userId: R_, name: "Rohan", you: true, admin: false },
    ]);
    expect(first.messages).toHaveLength(30);
    expect(first.more).toBe(true);
    const older = (await s.call("GET", `${AREA}/spaces/${id}/feed?before=${first.before}`, R_)).body;
    expect(older.messages.map((m: { text: string }) => m.text)).toEqual(["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"]);
    await s.call("POST", `${AREA}/spaces/${id}/payments`, M_, { to: "shop@okaxis", name: "Shop", note: "Milk" });
    expect((await feed(s, id, R_)).payments).toEqual([expect.objectContaining({ payee: "Shop", status: "waiting" })]);
    expect((await s.call("GET", `${AREA}/spaces/${id}/feed`, X_)).status).toBe(404);
  });
});
