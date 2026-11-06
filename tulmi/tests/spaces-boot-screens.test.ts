/**
 * THE NEW SPACES, DRAWN FROM THE SERVER'S OWN ANSWERS (experience/bots/screens/spaces/{start,feed,peoplePage}.ts, screens/work.ts
 * over src/botsBots/{spaces,spaceJoin,spaceFeed,grants,work}.ts and their routes).
 *
 * spaces-family-screens.test.ts draws the screens from fixtures, and the spaces-* tests hold the routes to their rules. The screens
 * declare their own copy of what the routes answer, so this file joins the two: a family is made through the real routes (on memory
 * tables), and each new screen is built for a phone and a window from what those routes answer, with the new blocks and with an
 * older build's. Every endpoint a new tree names must be a route the server has.
 *
 * Aanya makes Home and is its admin; Mom and Rohan come in by their invitations (having seen the line about the admin); Dev comes in
 * without it. Mom writes to Rohan alone and shares her doctor's visit with him.
 */
import { describe, expect, it, vi } from "vitest";
import type { Node, ScreenResponse } from "../../shared/types/sdui.js";

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

const { A_, M_, R_, D_, X_, K_, AREA, spacesServer } = await import("./spaces-rig.js");
const { shareSources } = await import("../src/botsBots/shareSources.js");
const { calendar } = await import("../src/calendar/index.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { sampleApi } = await import("./bots-bots-data.js");
const P = await import("../src/botsBots/personLook.js");

type Client = "phone" | "desktop";
const NEW = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras"];
const OLD = ["BotsKit", "FileUpload"];
const canOf = (client: Client, base: string[]): string[] => [...base, ...(base === NEW ? (client === "phone" ? ["ActionParams"] : ["DeskTalkTo"]) : [])];
const NAMES: Record<string, string> = { [A_]: "Aanya", [M_]: "Mom", [R_]: "Rohan", [D_]: "Dev", [X_]: "X", [K_]: "Mom K" };
const NODES_3I = ["BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords"];

async function family() {
  const clock = { t: Date.UTC(2026, 10, 10, 6, 0) };
  const s = await spacesServer({ pushes, clock, sources: shareSources({ now: () => clock.t }) as never });
  const doctor = await calendar().addEvent(M_, { title: "Doctor visit", day: "2026-11-14", time: "19:40", place: "Apollo, Indiranagar", tz: 330 });
  const home = await s.family([M_, R_]);
  await s.bringIn(home, D_, { consent: false });
  return { ...s, home, doctor: `e:${doctor.id}` };
}
type Fam = Awaited<ReturnType<typeof family>>;

/** A screen as `who` sees it: the spaces and work routes answer from the server; the rest of the app from the sample day. */
async function draw(f: Fam, who: string, screenId: string, client: Client, o: { params?: Record<string, string>; can?: string[] } = {}) {
  const fallback = await sampleApi();
  const deps = {
    ...fakeDeps({ api: fallback }),
    api: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      if (path.startsWith(`${AREA}/spaces`) || path.startsWith(`${AREA}/work`)) {
        const r = await f.call(method as "GET", path, who, body);
        if (r.status >= 400) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
        return r.body as T;
      }
      const k = `${method} ${path}`;
      if (k in fallback) return fallback[k] as T;
      throw Object.assign(new Error(`api: ${k} → 404`), { status: 404 });
    },
  };
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: who, name: NAMES[who] ?? "Someone" }, can: new Set(o.can ?? canOf(client, NEW)), desk: { pages: client === "desktop", notes: client === "desktop" } },
    deps as never,
  );
  const nodes = walk(s.root!);
  expect(lintTree(s.root!), `${screenId} on the ${client} is lint-clean`).toEqual([]);
  return { s, nodes, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
}

/** Every action anywhere in a screen (nodes' on, nested sequences and conditions, props that hold actions). */
function actionsIn(x: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(x)) { for (const v of x) actionsIn(v, out); return out; }
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o);
  for (const v of Object.values(o)) actionsIn(v, out);
  return out;
}

/**
 * Every endpoint a tree names is a route the server has: called with no session, a route answers 401 (run() checks the session
 * first), and only a path the server doesn't know answers 404. "$state" in a path stands for an id.
 */
async function routesExist(f: Fam, s: ScreenResponse) {
  expect((await f.call("POST", `${AREA}/spaces/nowhere/at/all`, null, {})).status, "a path the server doesn't know").toBe(404);
  const calls = actionsIn(s).filter((a) => a.kind === "callEndpoint" && String(a.path).startsWith(AREA));
  for (const a of calls) {
    const path = String(a.path).replace(/\$state\.[A-Za-z0-9_.]+/g, "x");
    const r = await f.call(a.method as "GET", path, null, a.body ?? (a.method === "GET" || a.method === "DELETE" ? undefined : {}));
    expect(r.status, `${String(a.method)} ${path}`).toBe(401);
  }
  return calls.length;
}

const has3i = (nodes: Node[]) => nodes.some((n) => NODES_3I.includes(n.type));

describe("the new Spaces from the server's answers", () => {
  it("a first Spaces screen: the crowd and the dotted Create; an invitation waiting opens his thought, and Accept lets her in", async () => {
    const f = await family();
    // Mom K. is invited to Home by Aanya and has no space yet.
    const inv = await f.call("POST", `${AREA}/spaces/${f.home}/invite`, A_, { email: "mom.k@example.in" });
    expect(inv.status).toBe(200);
    for (const client of ["phone", "desktop"] as const) {
      const v = await draw(f, K_, "bots.spaces", client);
      expect(v.texts, client).toContain("Your Own Space");
      expect(v.nodes.filter((n) => n.type === "BotCrowd"), client).toHaveLength(1);
      expect(v.s.state, client).toMatchObject({ thOpen: true, news: 1, creating: false });
      expect(v.texts, client).toContain("Home");
      expect(v.texts.some((t) => t.startsWith("Aanya") && t.includes("invited you")), client).toBe(true);
      const accept = actionsIn(v.s).find((a) => a.kind === "callEndpoint" && a.method === "PUT" && String(a.path) === `${AREA}/spaces/invitations/${inv.body.code}`);
      expect(accept, client).toMatchObject({ body: { decision: "accept", consent: true } });
      expect(await routesExist(f, v.s), client).toBeGreaterThan(0);
      // An older build: today's Spaces, nothing of the new blocks.
      const old = await draw(f, K_, "bots.spaces", client, { can: OLD });
      expect(has3i(old.nodes), client).toBe(false);
    }
    // Accept, as the screen sends it: she is in, and her Spaces lists Home.
    const acc = await f.call("PUT", `${AREA}/spaces/invitations/${inv.body.code}`, K_, { decision: "accept", consent: true });
    expect(acc.body).toMatchObject({ status: "joined", id: f.home, name: "Home" });
    const joined = await draw(f, K_, "bots.spaces", "phone");
    expect(joined.texts).toContain("Your spaces");
    expect(joined.nodes.filter((n) => n.type === "BotCrowd")).toHaveLength(0);
  });

  it("Call Your People, then Name your space, then Done: the draft's Sent rows, and the space made", async () => {
    const f = await family();
    const r = await f.call("POST", `${AREA}/spaces/draft/invite`, X_, { email: "friend@example.in" });
    expect(r.status).toBe(201);
    for (const client of ["phone", "desktop"] as const) {
      const v = await draw(f, X_, "bots.spaces", client);
      expect(v.s.state, client).toMatchObject({ creating: true, step: "people" });
      expect(v.texts, client).toContain("Call Your People");
      expect(v.texts, client).toContain("friend@example.in");
      expect(actionsIn(v.s).some((a) => a.kind === "callEndpoint" && a.method === "DELETE" && a.path === `${AREA}/spaces/draft`), client).toBe(true);
      await routesExist(f, v.s);
    }
    const done = await f.call("POST", `${AREA}/spaces/draft/done`, X_, { name: "Friends" });
    expect(done.status).toBe(200);
    for (const client of ["phone", "desktop"] as const) {
      const v = await draw(f, X_, "bots.spaces", client, { params: { made: done.body.id } });
      expect(v.texts, client).toContain("Friends is ready");
      expect(v.texts.some((t) => t.includes("invited. You are its admin.")), client).toBe(true);
      expect(v.s.state, client).toMatchObject({ made: true, creating: false });
    }
  });

  it("joined: the admin's list with its last line, the request from a code, and Accept wired to it", async () => {
    const f = await family();
    const detail = await f.call("GET", `${AREA}/spaces/${f.home}`, A_);
    const code = String(detail.body.space.code).replace("-", "");
    const asked = await f.call("POST", `${AREA}/spaces/join`, X_, { code, consent: true });
    expect(asked.body).toMatchObject({ status: "requested" });
    await f.call("POST", `${AREA}/spaces/${f.home}/feed`, M_, { text: "Dinner at 8" });
    for (const client of ["phone", "desktop"] as const) {
      const v = await draw(f, A_, "bots.spaces", client);
      expect(v.texts, client).toContain("Your spaces");
      expect(v.texts, client).toContain("Make a new space");
      expect(v.texts.some((t) => t.includes("Dinner at 8")), `${client}: the last line`).toBe(true);
      expect(v.texts.some((t) => t.includes("wants to join Home")), client).toBe(true);
      expect(actionsIn(v.s).some((a) => a.kind === "callEndpoint" && a.method === "PUT" && String(a.path).startsWith(`${AREA}/spaces/${f.home}/requests/`)), client).toBe(true);
      await routesExist(f, v.s);
      // The person asking sees that they asked.
      const x = await draw(f, X_, "bots.spaces", client);
      expect(x.texts.some((t) => t.startsWith(`Asked to join with the code ${detail.body.space.code}.`)), client).toBe(true);
      expect(x.texts.some((t) => t.includes("Home")), `${client}: a code alone never names the space`).toBe(false);
    }
  });

  it("inside a space: \"To Rohan\" for the sender and the admin, a plain line for Rohan, nothing for Dev, the card for the unconsented", async () => {
    const f = await family();
    const sent = await f.call("POST", `${AREA}/spaces/${f.home}/feed`, M_, { text: "Bring the reports", to: R_ });
    expect(sent.status).toBe(201);
    const shared = await f.call("POST", `${AREA}/spaces/${f.home}/feed`, M_, { text: "Can you take me?", to: R_, thing: { bot: "plan", id: f.doctor } });
    expect(shared.status).toBe(201);
    for (const client of ["phone", "desktop"] as const) {
      const params = { id: f.home };
      const mom = await draw(f, M_, "bots.spaces", client, { params });
      expect(mom.texts, `${client}: Mom`).toContain("To Rohan");
      expect(mom.texts, client).toContain("Bring the reports");
      expect(mom.nodes.filter((n) => n.type === "MentionField"), client).toHaveLength(1);
      expect(!!mom.s.talkTo, `${client}: the one key only on the window`).toBe(client === "desktop");
      const admin = await draw(f, A_, "bots.spaces", client, { params });
      expect(admin.texts, `${client}: the admin`).toContain("To Rohan");
      const rohan = await draw(f, R_, "bots.spaces", client, { params });
      expect(rohan.texts, client).toContain("Bring the reports");
      expect(rohan.texts, `${client}: the recipient`).not.toContain("To Rohan");
      // The card opens the thing in its bot, for the person it was shared with.
      const open = actionsIn(rohan.s).find((a) => a.kind === "navigate" && a.screenId === "bots.work") as { params: Record<string, string> } | undefined;
      expect(open?.params, client).toMatchObject({ bot: "plan", space: f.home, owner: M_, item: f.doctor });
      const dev = await draw(f, D_, "bots.spaces", client, { params });
      expect(dev.texts, `${client}: Dev`).not.toContain("Bring the reports");
      expect(dev.texts, client).toContain("The space's admin can see your work and messages here.");
      expect(dev.nodes.filter((n) => n.type === "MentionField"), client).toHaveLength(0);
      expect(dev.s.talkTo, client).toBeUndefined();
      await routesExist(f, mom.s);
      // An older build reads the same space through today's screens.
      const old = await draw(f, M_, "bots.spaces", client, { params, can: OLD });
      expect(has3i(old.nodes), client).toBe(false);
    }
  });

  it("Work in space: the shared thing opens with Change time; one person's things; the space's people with the admin's code", async () => {
    const f = await family();
    await f.call("POST", `${AREA}/spaces/${f.home}/feed`, M_, { to: R_, thing: { bot: "plan", id: f.doctor } });
    for (const client of ["phone", "desktop"] as const) {
      const item = await draw(f, R_, "bots.work", client, { params: { bot: "plan", space: f.home, owner: M_, item: f.doctor } });
      expect(item.texts, client).toContain("Doctor visit");
      expect(item.texts, client).toContain("Change time");
      await routesExist(f, item.s);
      const person = await draw(f, R_, "bots.work", client, { params: { bot: "plan", space: f.home, owner: M_ } });
      expect(person.texts, client).toContain("Mom");
      expect(person.texts.some((t) => t.includes("Shared with you")), client).toBe(true);
      // Mom's own page for it says who has it, with Stop sharing (a route that is there).
      const own = await draw(f, M_, "bots.work", client, { params: { bot: "plan", space: f.home, owner: M_, item: f.doctor } });
      for (const w of ["Shared with", "Rohan", "Stop sharing"]) expect(own.texts, `${client}: ${w}`).toContain(w);
      await routesExist(f, own.s);
      // Dev has no grant: the same honest page as a thing that isn't there.
      const dev = await draw(f, D_, "bots.work", client, { params: { bot: "plan", space: f.home, owner: M_, item: f.doctor } });
      expect(dev.texts, client).not.toContain("Doctor visit");
      const admin = await draw(f, A_, "bots.space.people", client, { params: { id: f.home } });
      expect(admin.texts, client).toContain("Make a new code");
      expect(admin.texts.some((t) => /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(t)), `${client}: the code, shown 3-3`).toBe(true);
      await routesExist(f, admin.s);
      const mom = await draw(f, M_, "bots.space.people", client, { params: { id: f.home } });
      expect(mom.texts, client).not.toContain("Make a new code");
    }
  });

  it("people as their own tiny bots: one look per person in a space, the same to everyone, the viewer's own ink Blip", async () => {
    const f = await family();
    const can = (client: Client) => [...canOf(client, NEW), "PersonBot", "FontBricolage"];
    const looks = async (who: string) => new Map(((await f.call("GET", `${AREA}/spaces/${f.home}`, who)).body.space.members as Array<{ userId: string; bot: { seed: string; avatar: string; color: string } }>).map((m) => [m.userId, m.bot]));
    const byAanya = await looks(A_), byMom = await looks(M_);
    // Four people in Home (Aanya, Mom, Rohan, Dev): four colours, four avatars.
    const others = [M_, R_, D_].map((id) => byAanya.get(id)!);
    expect(new Set([...others, byMom.get(A_)!].map((b) => b.color)).size).toBe(4);
    expect(new Set([...others, byMom.get(A_)!].map((b) => b.avatar)).size).toBe(4);
    // Mom is the same bot to Aanya and to Dev; to herself she is her own X0 bot.
    expect((await looks(D_)).get(M_)).toEqual(byAanya.get(M_));
    expect(byMom.get(M_)).toEqual({ seed: M_, avatar: "blip", color: "#0a0a0a" });
    // Outside the space (a one to one chat, the contacts) Rohan is the bot he is in Home, not the one his id alone would give him.
    expect(byAanya.get(R_)).not.toEqual(P.lookOf(R_));
    const direct = (await f.call("POST", `${AREA}/threads/direct`, A_, { person: R_ })).body.id as string;
    const inList = ((await f.call("GET", `${AREA}/threads`, A_)).body.threads as Array<{ id: string; people: Array<{ userId: string; bot?: unknown }> }>).find((t) => t.id === direct)!;
    expect(inList.people.find((p) => p.userId === R_)!.bot).toEqual(byAanya.get(R_));
    expect(inList.people.find((p) => p.userId === A_)!.bot).toEqual({ seed: A_, avatar: "blip", color: "#0a0a0a" });
    const opened = (await f.call("GET", `${AREA}/threads/${direct}`, A_)).body.thread as { people: Array<{ userId: string; bot?: unknown }> };
    expect(opened.people.find((p) => p.userId === R_)!.bot).toEqual(byAanya.get(R_));
    const contacts = (await f.call("GET", `${AREA}/threads/contacts`, A_)).body.people as Array<{ userId: string; bot: unknown }>;
    expect(contacts.find((p) => p.userId === R_)!.bot).toEqual(byAanya.get(R_));
    // A space's own chat names no faces: its people carry none.
    const spaceChat = ((await f.call("GET", `${AREA}/threads`, A_)).body.threads as Array<{ kind: string; people: Array<{ bot?: unknown }> }>).find((t) => t.kind === "space")!;
    expect(spaceChat.people.every((p) => p.bot === undefined)).toBe(true);
    for (const client of ["phone", "desktop"] as const) {
      const people = await draw(f, M_, "bots.space.people", client, { params: { id: f.home }, can: can(client) });
      const drawn = people.nodes.filter((n) => n.type === "PersonBot").map((n) => n.props as { seed: string; avatar: string; color: string });
      expect(drawn.map(({ seed, avatar, color }) => ({ seed, avatar, color })), client).toEqual([A_, M_, R_, D_].map((id) => byMom.get(id)));
      expect(people.texts.filter((t) => /^[A-Z]$/.test(t)), client).toEqual([]);
      // The "@" list carries them too.
      const feed = await draw(f, M_, "bots.spaces", client, { params: { id: f.home }, can: can(client) });
      const field = feed.nodes.find((n) => n.type === "MentionField")!;
      expect(field.props!.people, client).toEqual([A_, R_, D_].map((id) => expect.objectContaining({ id, bot: byMom.get(id) })));
      expect(feed.nodes.filter((n) => n.type === "PersonBot"), `${client}: no faces in the feed`).toHaveLength(0);
    }
    // Home's Space card reads each space's last line, and none of the full list's extras.
    await f.call("POST", `${AREA}/spaces/${f.home}/feed`, M_, { text: "Dinner at 8?" });
    const last = (await f.call("GET", `${AREA}/spaces?last=1`, A_)).body;
    expect(last.spaces[0]).toMatchObject({ last: { from: expect.any(String), text: "Dinner at 8?" }, unread: expect.any(Number) });
    expect(last.invitations).toBeUndefined();
    expect((await f.call("GET", `${AREA}/spaces`, A_)).body.spaces[0].last).toBeUndefined();
    // Someone asking with the code: the bot they would be once in, after everyone there now.
    const code = String((await f.call("GET", `${AREA}/spaces/${f.home}`, A_)).body.space.code).replace("-", "");
    await f.call("POST", `${AREA}/spaces/join`, X_, { code, consent: true });
    const full = (await f.call("GET", `${AREA}/spaces?full=1`, A_)).body;
    expect(full.requests[0].bot).toEqual(P.looksIn([A_, M_, R_, D_, X_]).get(X_));
    // An invitation waiting: the admin who sent it, as Home has them.
    await f.call("POST", `${AREA}/spaces/${f.home}/invite`, A_, { email: "mom.k@example.in" });
    const k = (await f.call("GET", `${AREA}/spaces?full=1`, K_)).body;
    expect(k.invitations[0].byBot).toEqual(byMom.get(A_));
  });

  it("a bot page has Work in space for anyone in a space, and lists who shared with you there", async () => {
    const f = await family();
    for (const client of ["phone", "desktop"] as const) {
      const before = await draw(f, R_, "bots.plan", client);
      expect(before.texts, client).toContain("Work in space");
      expect(before.texts.some((t) => t.startsWith("Nothing here yet.")), client).toBe(true);
    }
    await f.call("POST", `${AREA}/spaces/${f.home}/feed`, M_, { to: R_, thing: { bot: "plan", id: f.doctor } });
    for (const client of ["phone", "desktop"] as const) {
      const rohan = await draw(f, R_, "bots.plan", client);
      expect(rohan.texts, client).toContain("Work in space");
      expect(rohan.texts, client).toContain("1 plan shared with you");
      const old = await draw(f, R_, "bots.plan", client, { can: OLD });
      expect(old.texts, client).not.toContain("Work in space");
    }
  });
});
