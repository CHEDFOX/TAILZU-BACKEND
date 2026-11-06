/**
 * COMING INTO A SPACE (src/botsBots/{spaces,spaceJoin}.ts, routes/bots/botsSpaces.ts; docs/spaces.md):
 *
 *   - Create on the new Spaces screen: a draft nobody else sees, its invite mails go at once without a name and with the space's code;
 *     Done names it; Back deletes it and stops its mail; a draft left a day is swept, by the Spaces screen only
 *   - invitations wait for the invited address, once it is confirmed, and only when the admin made them; Accept joins (with the line
 *     about the admin seen), Dismiss hides it; a block with the admin hides it
 *   - a code: the invited address joins at once, anyone else asks the admin; the admin accepts or dismisses (pushed and told live);
 *     a dismissed person waits a week; ten asks a day; a draft is not ready
 *   - the space's one code: made the first time it is asked for (never by a list), the admin's alone, made new on demand; the browser
 *     page names no space for it
 *   - no roles: old routes answer 410, members can't invite, old builds' shapes still read
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

const { A_, M_, R_, X_, D_, K_, AREA, PEOPLE, spacesServer } = await import("./spaces-rig.js");
const { showCode } = await import("../src/botsBots/spaces.js");
const { table } = await import("../src/botsBots/rows.js");
const { live } = await import("../src/live/bus.js");

const served = () => spacesServer({ pushes });
type S = Awaited<ReturnType<typeof served>>;
const full = async (s: S, who: string) => (await s.call("GET", `${AREA}/spaces?full=1`, who)).body;
const codeOfSpace = async (s: S, id: string) => ((await s.call("GET", `${AREA}/spaces/${id}`, A_)).body.space.code as string).replace("-", "");

describe("Create: a draft, Call Your People, Name your space", () => {
  it("is invisible to everyone else until it is named, and its mail has no name but has the code", async () => {
    const s = await served();
    const r = await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: PEOPLE[M_]!.email });
    expect(r.status).toBe(201);
    expect(r.body.draft).toMatchObject({ name: null, invites: [{ email: "mom@example.in", mail: "queued" }] });
    const draftId = r.body.draft.id as string;
    const mail = (await s.outbox.byRef("space_invite", r.body.draft.invites[0].code))!;
    expect(mail.subject).toBe("Aanya S. invited you to their space on X0 Bot");
    expect(mail.body_text).not.toContain("New space");
    const code = (await s.spaces.codeFor(draftId));
    expect(mail.body_text).toContain(`type this code: ${showCode(code)}. Aanya S. will let you in.`);
    expect(mail.body_text).toContain("Sign in to X0 Bot with this email (mom@example.in) and the invite is waiting");
    expect(mail.body_text).toContain("The space's admin can see and share your work and messages there.");
    expect(mail.body_text).toContain(`Get X0 Bot: https://app.example.in/s/bots.spaces?join=${code}`);
    // Nobody else sees it: not Mom's invitations, not a list, not a code (409), not the link's peek.
    expect((await full(s, M_)).invitations).toEqual([]);
    expect((await full(s, A_)).spaces).toEqual([]);
    expect((await s.call("GET", `${AREA}/share/targets`, A_)).body.spaces).toEqual([]);
    const join = await s.call("POST", `${AREA}/spaces/join`, X_, { code });
    expect(join).toMatchObject({ status: 409, body: { code: "not_ready" } });
    expect((await s.call("GET", `${AREA}/spaces/join/${code}`, X_)).body).toEqual({ invite: null });
    // The maker sees it on the Spaces screen, with who it invited.
    expect((await full(s, A_)).draft).toMatchObject({ id: draftId, name: null, invites: [{ email: "mom@example.in" }] });
    // Twice the same address: refused in words.
    expect((await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: "MOM@example.in" })).body.code).toBe("already_invited");
    expect((await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: "not an email" })).body.code).toBe("bad_email");
  });

  it("Done names it, and then the invitation waits for Mom", async () => {
    const s = await served();
    await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: PEOPLE[M_]!.email });
    expect((await s.call("POST", `${AREA}/spaces/draft/done`, A_, {})).status).toBe(400);
    const done = await s.call("POST", `${AREA}/spaces/draft/done`, A_, { name: "Sharma Family" });
    expect(done.body).toEqual({ id: expect.any(String), name: "Sharma Family" });
    expect((await full(s, A_)).draft).toBeNull();
    expect((await full(s, A_)).spaces.map((x: { name: string }) => x.name)).toEqual(["Sharma Family"]);
    const inv = (await full(s, M_)).invitations;
    expect(inv).toEqual([expect.objectContaining({ spaceId: done.body.id, spaceName: "Sharma Family", by: "Aanya S.", people: 1 })]);
  });

  it("Make a new space names it first, and Continue finishes it without a name in the body", async () => {
    const s = await served();
    const d = await s.call("POST", `${AREA}/spaces/draft`, A_, { name: "Cousins" });
    expect(d.body.draft).toMatchObject({ name: "Cousins", invites: [] });
    // Still a draft: no list has it.
    expect((await full(s, A_)).spaces).toEqual([]);
    expect((await s.call("POST", `${AREA}/spaces/draft/done`, A_, {})).body).toEqual({ id: d.body.draft.id, name: "Cousins" });
    expect((await full(s, A_)).spaces.map((x: { name: string }) => x.name)).toEqual(["Cousins"]);
  });

  it("Back deletes it, takes its invites back and stops their mail", async () => {
    const s = await served();
    const r = await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: PEOPLE[M_]!.email });
    const code = r.body.draft.invites[0].code as string;
    expect((await s.call("DELETE", `${AREA}/spaces/draft`, A_)).body).toEqual({ ok: true });
    expect((await s.outbox.byRef("space_invite", code))!.status).toBe("cancelled");
    expect(await s.spaces.spaceRow(r.body.draft.id)).toBeNull();
    expect((await full(s, A_)).draft).toBeNull();
  });

  it("sweeps a draft left a day, from the Spaces screen only (a plain list never writes)", async () => {
    const s = await served();
    const r = await s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: PEOPLE[M_]!.email });
    s.clock.t += 25 * 3600_000;
    // Home and launches read GET /spaces: today's shape, no new keys, and nothing swept.
    const plain = (await s.call("GET", `${AREA}/spaces`, A_)).body;
    expect(Object.keys(plain).sort()).toEqual(["spaces", "unread", "you"]);
    expect(await s.spaces.spaceRow(r.body.draft.id)).not.toBeNull();
    expect((await full(s, A_)).draft).toBeNull();
    expect(await s.spaces.spaceRow(r.body.draft.id)).toBeNull();
    expect((await s.outbox.byRef("space_invite", r.body.draft.invites[0].code))!.status).toBe("cancelled");
  });

  it("screens a space's name", async () => {
    const s = await served();
    expect((await s.call("POST", `${AREA}/spaces/draft`, A_, { name: "send nudes" })).body.code).toBe("blocked_content");
    expect((await s.call("POST", `${AREA}/spaces`, A_, { name: "send nudes" })).body.code).toBe("blocked_content");
  });
});

describe("invitations", () => {
  it("wait for the invited address only; Accept joins with the line seen, Dismiss hides it", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: PEOPLE[M_]!.email })).body;
    expect((await full(s, R_)).invitations).toEqual([]);
    expect((await full(s, M_)).invitations).toEqual([expect.objectContaining({ code: inv.code, spaceName: "Home", by: "Aanya S." })]);
    // Someone else can't take Mom's invitation.
    expect((await s.call("PUT", `${AREA}/spaces/invitations/${inv.code}`, R_, { decision: "accept" })).body.code).toBe("bad_code");
    pushes.length = 0;
    const acc = await s.call("PUT", `${AREA}/spaces/invitations/${inv.code}`, M_, { decision: "accept", consent: true, consentV: 2 });
    expect(acc.body).toEqual({ status: "joined", id, name: "Home" });
    expect(await s.spaces.consented(id, M_)).toBe(true);
    // Aanya, who made the invite, is told who came in with it.
    expect(pushes.filter((p) => p.kind === "space_joined")).toEqual([expect.objectContaining({ userId: A_, vars: expect.objectContaining({ space: "Home", name: "Mom" }) })]);
    expect((await full(s, M_)).invitations).toEqual([]);
    // Dismiss: Rohan's is gone, and Aanya's count of who she invited goes down.
    const inv2 = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: PEOPLE[R_]!.email })).body;
    expect((await full(s, A_)).spaces[0].invited).toBe(1);
    expect((await s.call("PUT", `${AREA}/spaces/invitations/${inv2.code}`, R_, { decision: "dismiss" })).body).toEqual({ status: "dismissed", name: "Home" });
    expect((await full(s, R_)).invitations).toEqual([]);
    expect((await full(s, A_)).spaces[0].invited).toBe(0);
  });

  it("need a confirmed address and an invite the admin made; a block with the admin hides them", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.bringIn(id, M_);
    // Not confirmed: no invitation, and its code makes a request.
    PEOPLE[R_]!.confirmed = false;
    try {
      const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: PEOPLE[R_]!.email })).body;
      expect((await full(s, R_)).invitations).toEqual([]);
      expect((await s.call("POST", `${AREA}/spaces/join`, R_, { code: inv.code })).body).toEqual({ status: "requested" });
    } finally { PEOPLE[R_]!.confirmed = true; }
    // An invite Mom made under the old roles: not an invitation; its code asks the admin.
    await table("space_invites").insert({ code: "MOMINV22", space_id: id, created_by: M_, created_ms: s.clock.t, expires_ms: s.clock.t + 86_400_000, email: PEOPLE[D_]!.email, perms: [], role: "family", used_by: null, used_ms: null });
    expect((await full(s, D_)).invitations).toEqual([]);
    expect((await s.call("POST", `${AREA}/spaces/join`, D_, { code: "MOMINV22" })).body).toEqual({ status: "requested" });
    // Blocked the admin: the invitation is hidden.
    await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: PEOPLE[K_]!.email });
    expect((await full(s, K_)).invitations).toHaveLength(1);
    await s.parts.threads.blocks.block(K_, A_, "Aanya S.");
    expect((await full(s, K_)).invitations).toEqual([]);
  });
});

describe("a code, and the admin letting people in", () => {
  it("joins the invited address at once, and makes anyone else ask (once); the admin accepts, with a push", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: PEOPLE[M_]!.email });
    const code = await codeOfSpace(s, id);
    // Mom, signed in with the invited address, types the code: in (old builds read id and name).
    expect((await s.call("POST", `${AREA}/spaces/join`, M_, { code: showCode(code).toLowerCase() })).body).toEqual({ status: "joined", id, name: "Home" });
    expect((await s.call("POST", `${AREA}/spaces/join`, M_, { code })).body).toEqual({ status: "member", id, name: "Home" });
    // A stranger asks; asking again is the same request.
    const heard: string[] = [];
    const stop = live.subscribe(A_, (e) => heard.push(e.topic));
    pushes.length = 0;
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code, consent: true, consentV: 2 })).body).toEqual({ status: "requested" });
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code })).body).toEqual({ status: "requested" });
    stop();
    expect(heard).toContain("spaces");
    expect(pushes).toEqual([{ userId: A_, kind: "space_request", vars: { name: "X", space: "Home" }, data: { thought: "1" } }]);
    // Their waiting line is the code they typed: a code alone never says whose space it is.
    expect((await full(s, X_)).asked).toEqual([{ id: expect.any(String), code: showCode(code), at: expect.any(Number) }]);
    const reqs = (await full(s, A_)).requests;
    expect(reqs).toEqual([expect.objectContaining({ spaceId: id, spaceName: "Home", name: "X" })]);
    // Only the admin decides.
    expect((await s.call("PUT", `${AREA}/spaces/${id}/requests/${reqs[0].id}`, M_, { decision: "accept" })).status).toBe(403);
    const told: string[] = [];
    const stop2 = live.subscribe(X_, (e) => told.push(e.topic));
    pushes.length = 0;
    expect((await s.call("PUT", `${AREA}/spaces/${id}/requests/${reqs[0].id}`, A_, { decision: "accept" })).body).toEqual({ status: "joined", name: "X" });
    stop2();
    expect(told).toContain("spaces");
    expect(pushes.filter((p) => p.kind === "space_accepted")).toEqual([{ userId: X_, kind: "space_accepted", vars: { space: "Home", admin: "Aanya S." }, data: { id } }]);
    expect(await s.spaces.consented(id, X_)).toBe(true);
    expect((await full(s, A_)).requests).toEqual([]);
    expect((await full(s, X_)).asked).toEqual([]);
  });

  it("checks a request is the space's own; a dismissed person waits a week", async () => {
    const s = await served();
    const home = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    const other = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Office" })).body.id;
    await s.call("POST", `${AREA}/spaces/join`, X_, { code: await codeOfSpace(s, home) });
    const [req] = (await full(s, A_)).requests;
    expect((await s.call("PUT", `${AREA}/spaces/${other}/requests/${req.id}`, A_, { decision: "accept" })).status).toBe(404);
    expect((await s.call("PUT", `${AREA}/spaces/${home}/requests/${req.id}`, A_, { decision: "dismiss" })).body).toEqual({ status: "dismissed", name: "X" });
    expect(await s.spaces.isMember(home, X_)).toBe(false);
    expect((await s.call("PUT", `${AREA}/spaces/${home}/requests/${req.id}`, A_, { decision: "accept" })).status).toBe(404);
    const again = await s.call("POST", `${AREA}/spaces/join`, X_, { code: await codeOfSpace(s, home) });
    expect(again).toMatchObject({ status: 409, body: { code: "asked_recently", message: "You asked already. Try again next week." } });
    s.clock.t += 8 * 86_400_000;
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: await codeOfSpace(s, home) })).body).toEqual({ status: "requested" });
  });

  it("takes ten asks a day from one person; the eleventh waits for tomorrow", async () => {
    const s = await served();
    const codes: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const owner = i < 6 ? A_ : M_;
      const id = (await s.call("POST", `${AREA}/spaces`, owner, { name: `Space ${i}` })).body.id;
      codes.push(((await s.call("GET", `${AREA}/spaces/${id}`, owner)).body.space.code as string).replace("-", ""));
    }
    for (const c of codes.slice(0, 10)) expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: c })).body.status).toBe("requested");
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: codes[10] })).body.code).toBe("request_limit");
  });

  it("leaves a request open when the space is full", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.call("POST", `${AREA}/spaces/join`, X_, { code: await codeOfSpace(s, id) });
    const [req] = (await full(s, A_)).requests;
    for (let i = 0; i < 19; i += 1) await table("space_members").insert({ space_id: id, user_id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, name: `P${i}`, can_approve: true, joined_ms: 1 });
    expect((await s.call("PUT", `${AREA}/spaces/${id}/requests/${req.id}`, A_, { decision: "accept" })).body.code).toBe("space_full");
    expect((await full(s, A_)).requests).toHaveLength(1);
  });

  it("says nothing more than a bad code to someone with a block with the admin", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.parts.threads.blocks.block(A_, X_, "X");
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: await codeOfSpace(s, id) })).body.code).toBe("bad_code");
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: "ZZZZZZ" })).body).toEqual({ code: "bad_code", message: "That code doesn't work. Check it and try again." });
  });
});

describe("the space's code", () => {
  it("is made the first time it is asked for, never by a list, and is the admin's alone", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.call("GET", `${AREA}/spaces`, A_);
    await s.call("GET", `${AREA}/spaces?full=1`, A_);
    expect((await s.spaces.spaceRow(id))!.join_code ?? null).toBeNull();
    await s.bringIn(id, M_);
    const mine = (await s.call("GET", `${AREA}/spaces/${id}`, A_)).body.space.code;
    expect(mine).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect((await s.call("GET", `${AREA}/spaces/${id}`, M_)).body.space.code).toBeNull();
    // The list never carries it.
    expect(JSON.stringify((await s.call("GET", `${AREA}/spaces?full=1`, A_)).body)).not.toContain(mine.replace("-", ""));
  });

  it("is made new by the admin only, and the old one stops working", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.bringIn(id, M_);
    const old = await codeOfSpace(s, id);
    expect((await s.call("POST", `${AREA}/spaces/${id}/code`, M_)).status).toBe(403);
    const fresh = (await s.call("POST", `${AREA}/spaces/${id}/code`, A_)).body.code as string;
    expect(fresh).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(fresh.replace("-", "")).not.toBe(old);
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: old })).body.code).toBe("bad_code");
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: fresh })).body.status).toBe("requested");
  });

  it("opens a browser page that names no space for it (an email invite's own code still does)", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    const code = await codeOfSpace(s, id);
    const page = await s.call("GET", `/s/bots.spaces?join=${code}`, null);
    expect(page.status).toBe(200);
    expect(page.body).toContain("You're invited to a space on X0 Bot.");
    expect(page.body).not.toContain("Home");
    expect(page.body).toContain("Open X0 Bot, open Spaces, tap your bot, and type this code:");
    expect(page.body).toContain(`>${showCode(code)}<`);
    expect(page.body).toContain(`href="tulmi://screen/bots.spaces?join=${code}"`);
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: PEOPLE[M_]!.email })).body;
    expect((await s.call("GET", `${AREA}/invite/${inv.code}`, null)).body).toContain("<b>Home</b>");
    expect((await s.call("GET", `${AREA}/invite/${inv.code}`, null)).body).not.toContain("mom@");
    // Signed in, a space's own code is never named either; an email invite's own code is.
    expect((await s.call("GET", `${AREA}/spaces/join/${code}`, X_)).body).toEqual({ invite: null });
    expect((await s.call("GET", `${AREA}/spaces/join/${inv.code}`, X_)).body).toEqual({ invite: { name: "Home", members: 1 } });
  });
});

describe("no roles", () => {
  it("answers 410 to roles and member changes, and keeps the admin's acts the admin's", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.bringIn(id, M_);
    await s.bringIn(id, R_);
    for (const [m, u, b] of [["PUT", `${AREA}/spaces/${id}/members/${M_}`, { role: "kid" }], ["POST", `${AREA}/spaces/${id}/roles`, { name: "Nani", perms: [] }], ["PUT", `${AREA}/spaces/${id}/roles/r1`, { name: "x" }], ["DELETE", `${AREA}/spaces/${id}/roles/r1`, undefined]] as const) {
      const r = await s.call(m, u, A_, b);
      expect(r.status).toBe(410);
      expect(r.body).toEqual({ code: "gone", message: "Roles are gone. Everyone in a space can do the same things; its admin can do a few more." });
    }
    // A member can't invite, rename, remove, or make a code; the admin can't be removed.
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, M_, { email: "z@example.in" })).body).toEqual({ code: "not_allowed", message: "Only Home's admin can invite people." });
    expect((await s.call("PUT", `${AREA}/spaces/${id}`, M_, { name: "Mine" })).status).toBe(403);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${R_}`, M_)).status).toBe(403);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${A_}`, M_)).status).toBe(403);
    // Old builds still read the shape: no roles, everyone may approve, the admin is "Admin".
    const d = (await s.call("GET", `${AREA}/spaces/${id}`, M_)).body.space;
    expect(d.roles).toEqual([]);
    expect(d.members.map((m: { name: string; roleName: string; canApprove: boolean; role: string | null }) => [m.name, m.roleName, m.canApprove, m.role])).toEqual([
      ["Aanya S.", "Admin", true, "admin"], ["Mom", "Member", true, null], ["Rohan", "Member", true, null],
    ]);
    // The admin removes someone.
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${R_}`, A_)).body).toEqual({ deleted: false });
  });

  it("gives an old build's link invite the space's own code, which asks the admin", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    const r = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { role: "family" })).body;
    expect(r).toMatchObject({ code: expect.stringMatching(/^[A-Z0-9]{6}$/), email: null, mail: null, mailReady: false });
    expect(r.link).toBe(`https://app.example.in/s/bots.spaces?join=${r.code}`);
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: r.code })).body).toEqual({ status: "requested" });
  });
});

describe("the gaps a review found", () => {
  it("counts invite mails a day by who sent them: deleting a draft never starts the count again", async () => {
    const s = await served();
    const invite = (n: number) => s.call("POST", `${AREA}/spaces/draft/invite`, A_, { email: `p${n}@example.in` });
    for (let i = 0; i < 20; i += 1) expect((await invite(i)).status, `invite ${i}`).toBe(201);
    expect((await s.call("DELETE", `${AREA}/spaces/draft`, A_)).status).toBe(200);
    for (let i = 20; i < 30; i += 1) expect((await invite(i)).status, `invite ${i}`).toBe(201);
    expect((await invite(30)).body).toEqual({ code: "invite_limit", message: "That's 30 invites today. Try again tomorrow." });
    // A real space is the same count.
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Office" })).body.id;
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "q@example.in" })).status).toBe(429);
    s.clock.t += 24 * 3600_000 + 1000;
    expect((await invite(31)).status).toBe(201);
  });

  it("stops guessing: after 20 codes that don't work in a day every code is refused, a good one too, until the day is over", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    const good = await codeOfSpace(s, id);
    for (let i = 0; i < 19; i += 1) expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: `ZZZZ${String(i).padStart(2, "2")}`.slice(0, 6) })).status).toBe(404);
    // A peek at an email invite's code that doesn't work counts too.
    expect((await s.call("GET", `${AREA}/spaces/join/NOPE2345`, X_)).body).toEqual({ invite: null });
    const stopped = await s.call("POST", `${AREA}/spaces/join`, X_, { code: good });
    expect(stopped).toMatchObject({ status: 429, body: { code: "code_limit" } });
    expect((await s.call("GET", `${AREA}/spaces/join/NOPE2345`, X_)).status).toBe(429);
    expect((await full(s, A_)).requests).toEqual([]);
    // Someone else is not held up by it.
    expect((await s.call("POST", `${AREA}/spaces/join`, D_, { code: good })).body).toEqual({ status: "requested" });
    s.clock.t += 24 * 3600_000 + 1000;
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: good })).body).toEqual({ status: "requested" });
  });

  it("shows a name the screen would flag as Someone, instead of stopping a real person from ever asking", async () => {
    const RANDI = "77777777-7777-4777-8777-777777777777";
    PEOPLE[RANDI] = { email: "randi.smith@example.in", confirmed: true };
    try {
      const s = await served();
      const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
      expect((await s.call("POST", `${AREA}/spaces/join`, RANDI, { code: await codeOfSpace(s, id) })).body).toEqual({ status: "requested" });
      expect((await full(s, A_)).requests).toEqual([expect.objectContaining({ spaceId: id, name: "Someone" })]);
    } finally {
      delete PEOPLE[RANDI];
    }
  });

  it("never lets someone in who made a block with the admin after asking", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    await s.call("POST", `${AREA}/spaces/join`, X_, { code: await codeOfSpace(s, id) });
    const [req] = (await full(s, A_)).requests;
    await s.parts.threads.blocks.block(X_, A_, "Aanya S.");
    expect((await s.call("PUT", `${AREA}/spaces/${id}/requests/${req.id}`, A_, { decision: "accept" })).body).toEqual({ code: "not_found", message: "That request isn't there any more." });
    expect(await s.spaces.isMember(id, X_)).toBe(false);
  });

  it("gives the browser page the same answer for any code of a space's code's shape", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id;
    const good = await codeOfSpace(s, id);
    const page = async (c: string, ua = "Mozilla/5.0 (Macintosh)") => {
      const r = await s.app.inject({ method: "GET", url: `/s/bots.spaces?join=${c}`, headers: { "user-agent": ua } });
      return { status: r.statusCode, body: r.body.replaceAll(c, "CODE").replaceAll(showCode(c), "CODE"), location: r.headers.location ? String(r.headers.location).replaceAll(c, "CODE") : "" };
    };
    expect(await page("ZZZ222")).toEqual(await page(good));
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
    expect(await page("ZZZ222", iphone)).toEqual(await page(good, iphone));
  });
});
