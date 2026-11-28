/**
 * ADDING SOMEONE BY USERNAME (src/botsBots/{spaces,spaceJoin}.ts, routes/bots/botsSpaces.ts; docs/social.md §3, migration 0113):
 *
 *   - into a space: Call Your People and a space's Invite take a username in the same box as an email; the invite names the
 *     account, never an address, waits in their invitations with a push, and Accept joins as an email invite does
 *   - one to one ("Add a person"): a two-person space hidden from the spaces list, asked and then accepted; asking back is a yes;
 *     once in, they can message each other; either leaving ends it
 *   - a name nobody holds and a name whose holder has a block with you read the same; look-ups are braked
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { A_, M_, R_, X_, AREA, spacesServer } = await import("./spaces-rig.js");
const { claim, resetUsernamesForTests } = await import("../src/profile/username.js");

const served = () => spacesServer({ pushes });
type S = Awaited<ReturnType<typeof served>>;
const full = async (s: S, who: string) => (await s.call("GET", `${AREA}/spaces?full=1`, who)).body;

beforeEach(async () => {
  pushes.length = 0;
  resetUsernamesForTests();
  await claim(A_, "aanya");
  await claim(M_, "meera");
  await claim(R_, "rohan");
  await claim(X_, "stranger");
});

describe("into a space, by username", () => {
  it("Call Your People: the account is invited, never an address; it waits in their invitations; Accept joins", async () => {
    const s = await served();
    const r = await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: "@Meera" });
    expect(r.status).toBe(201);
    // The maker sees the name they typed; no mail is queued for it.
    expect(r.body.draft.invites).toEqual([expect.objectContaining({ email: "@meera", mail: null })]);
    expect(pushes).toEqual([expect.objectContaining({ userId: M_, kind: "space_invited", data: { thought: "1" } })]);
    // A draft is nobody's to join yet: Meera sees nothing until it is named.
    expect((await full(s, M_)).invitations).toEqual([]);
    const done = await s.call("POST", `${AREA}/spaces/draft/done`, A_, { name: "Home" });
    const inv = (await full(s, M_)).invitations;
    expect(inv).toEqual([expect.objectContaining({ spaceId: done.body.id, spaceName: "Home", by: expect.any(String) })]);
    expect(inv[0].pair).toBeUndefined();
    // Twice: refused in words.
    expect((await s.call("POST", `${AREA}/spaces/${done.body.id}/invite`, A_, { email: "meera" })).body.code).toBe("already_invited");
    const yes = await s.call("PUT", `${AREA}/spaces/invitations/${inv[0].code}`, M_, { decision: "accept" });
    expect(yes.body).toMatchObject({ status: "joined", id: done.body.id });
    expect((await full(s, M_)).spaces.map((x: { id: string }) => x.id)).toEqual([done.body.id]);
  });

  it("a space's Invite: a username goes to the account (shown as @name, waiting in X0 Bot); an email still mails", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    const r = await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "rohan" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ email: null, mail: null });
    const space = (await s.call("GET", `${AREA}/spaces/${id}`, A_)).body.space;
    expect(space.invites).toEqual([expect.objectContaining({ email: "@rohan", toAccount: true })]);
    // An address is the email invite it always was.
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "someone@example.in" })).body).toMatchObject({ email: "someone@example.in", mail: "queued" });
  });

  it("nobody, a block and yourself: nobody's name and a blocked one read the same", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "nobody-here" })).body.code).toBe("no_user");
    // Blocking needs a space in common: Meera comes into Home by her username, then blocks Aanya, who tries her again for Studio.
    await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "meera" });
    const inv = (await full(s, M_)).invitations;
    await s.call("PUT", `${AREA}/spaces/invitations/${inv[0].code}`, M_, { decision: "accept" });
    expect((await s.call("POST", `${AREA}/blocks`, M_, { person: A_ })).status).toBe(200);
    const studio = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Studio" })).body.id as string;
    const blocked = await s.call("POST", `${AREA}/spaces/${studio}/invite`, A_, { email: "meera" });
    expect(blocked.body.code).toBe("no_user");
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "aanya" })).body.code).toBe("bad_request");
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "no spaces allowed" })).body.code).toBe("bad_username");
  });
});

describe("one to one: Add a person", () => {
  it("asks; they say yes; never in the spaces list; they can message each other; either leaving ends it", async () => {
    const s = await served();
    const r = await s.call("POST", `${AREA}/spaces/people`, A_, { username: "@meera" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "asked" });
    expect(pushes).toEqual([expect.objectContaining({ userId: M_, kind: "space_person" })]);
    // Aanya sees Meera as asked, by the name she typed; no space in her list.
    const mine = await full(s, A_);
    expect(mine.spaces).toEqual([]);
    expect(mine.people).toEqual([expect.objectContaining({ userId: M_, name: "@meera", waiting: true })]);
    // Asking twice is refused.
    expect((await s.call("POST", `${AREA}/spaces/people`, A_, { username: "meera" })).body.code).toBe("already_invited");
    // Meera has it as an invitation that says who, with no space name.
    const inv = (await full(s, M_)).invitations;
    expect(inv).toEqual([expect.objectContaining({ pair: true, spaceId: r.body.id })]);
    await s.call("PUT", `${AREA}/spaces/invitations/${inv[0].code}`, M_, { decision: "accept" });
    const hers = await full(s, M_);
    expect(hers.spaces).toEqual([]);
    expect(hers.people).toEqual([expect.objectContaining({ userId: A_, waiting: false })]);
    expect((await full(s, A_)).people).toEqual([expect.objectContaining({ userId: M_, waiting: false })]);
    // Connected: a one-to-one chat opens.
    expect((await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).status).toBe(200);
    expect((await s.call("POST", `${AREA}/spaces/people`, A_, { username: "meera" })).body.code).toBe("already_in");
    // Nobody comes in by a code.
    expect((await s.call("POST", `${AREA}/spaces/people`, X_, { username: "meera" })).status).toBe(201);
    // Meera leaving ends it for both.
    await s.call("DELETE", `${AREA}/spaces/${r.body.id}`, M_);
    expect((await full(s, A_)).people).toEqual([]);
  });

  it("asking someone who already asked you is your yes", async () => {
    const s = await served();
    await s.call("POST", `${AREA}/spaces/people`, A_, { username: "rohan" });
    const back = await s.call("POST", `${AREA}/spaces/people`, R_, { username: "aanya" });
    expect(back.body).toMatchObject({ status: "joined" });
    expect((await full(s, A_)).people).toEqual([expect.objectContaining({ userId: R_, waiting: false })]);
  });

  it("a declined ask leaves nothing behind, and they can be asked again", async () => {
    const s = await served();
    await s.call("POST", `${AREA}/spaces/people`, A_, { username: "rohan" });
    const inv = (await full(s, R_)).invitations;
    await s.call("PUT", `${AREA}/spaces/invitations/${inv[0].code}`, R_, { decision: "dismiss" });
    expect((await full(s, A_)).people).toEqual([]);
    expect((await s.call("POST", `${AREA}/spaces/people`, A_, { username: "rohan" })).body).toMatchObject({ status: "asked" });
  });

  it("look-ups are braked: 60 an hour", async () => {
    const s = await served();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await s.call("POST", `${AREA}/spaces/people`, X_, { username: `nobody${i}` })).status;
    expect(last).toBe(429);
  });
});

describe("Add a person as they type (GET /people/search)", () => {
  it("lists the usernames that start with what was typed: name and tiny bot only, never yourself, never across a block", async () => {
    const s = await served();
    await claim("00000000-0000-4000-8000-0000000000ee", "meerakat");
    const r = await s.call("GET", `${AREA}/people/search?q=MEE`, A_);
    expect(r.status).toBe(200);
    expect(r.body.people.map((p: { username: string }) => p.username)).toEqual(["meera", "meerakat"]);
    // Nothing about them but the name and their tiny bot: no id, no name, no email.
    for (const p of r.body.people) expect(Object.keys(p).sort()).toEqual(["bot", "username"]);
    // An @ is fine; fewer than three letters finds nothing; you are never in your own list.
    expect((await s.call("GET", `${AREA}/people/search?q=@rohan`, A_)).body.people.map((p: { username: string }) => p.username)).toEqual(["rohan"]);
    expect((await s.call("GET", `${AREA}/people/search?q=me`, A_)).body.people).toEqual([]);
    expect((await s.call("GET", `${AREA}/people/search?q=aan`, A_)).body.people).toEqual([]);
    // A block, either way round: they are not listed. (Blocking needs a space in common: Meera comes into Home first.)
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "meera" });
    const inv = (await full(s, M_)).invitations;
    await s.call("PUT", `${AREA}/spaces/invitations/${inv[0].code}`, M_, { decision: "accept" });
    expect((await s.call("POST", `${AREA}/blocks`, M_, { person: A_ })).status).toBe(200);
    expect((await s.call("GET", `${AREA}/people/search?q=mee`, A_)).body.people.map((p: { username: string }) => p.username)).toEqual(["meerakat"]);
  });

  it("is braked on its own: a keystroke is a search, so 240 an hour, then the server's words", async () => {
    const s = await served();
    let last = 0;
    for (let i = 0; i < 241; i++) last = (await s.call("GET", `${AREA}/people/search?q=mee${i % 10}`, X_)).status;
    expect(last).toBe(429);
    // Look-ups by a whole name have their own brake, untouched.
    expect((await s.call("POST", `${AREA}/spaces/people`, X_, { username: "meera" })).status).toBe(201);
  });
});
