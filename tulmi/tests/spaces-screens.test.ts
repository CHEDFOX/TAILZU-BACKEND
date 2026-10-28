/**
 * SPACES' SCREENS (experience/bots/screens/spaces.ts), from the boards' day (tests/spaces-data.ts): every screen builds for the phone and
 * the window, lint-clean, with the person's own data and its writes wired to the routes; honest empty states when a read fails; and the
 * screens listen to their live topics.
 */
import { describe, expect, it, vi } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { shareTo } = await import("../src/experience/bots/shareAction.js");
const { spacesApi } = await import("./spaces-data.js");

const A = "/v1/botsapp/bots";
type Client = "phone" | "desktop";

async function build(screenId: string, client: Client, params: Record<string, string | number> = {}, api: Record<string, unknown> = spacesApi()) {
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit", "FileUpload"]), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ jobs: [], tasks: [], api }));
  return { s, nodes: walk(s.root!) };
}
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")).join("\n");
function actions(nodes: Node[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const o = a as Record<string, unknown>;
    out.push(o);
    for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach(visit); else visit(v); }
  };
  for (const n of nodes) for (const v of Object.values(n.on ?? {})) visit(v);
  return out;
}
const calls = (nodes: Node[]) => actions(nodes).filter((a) => a.kind === "callEndpoint").map((a) => `${a.method} ${a.path}`);

describe("Spaces' screens", () => {
  const CASES: Array<[string, Record<string, string>, string[], string[]]> = [
    ["bots.spaces", {}, ["Spaces", "Chats", "Given to you", "Home", "Studio", "Who can approve payments"], [`POST ${A}/spaces`, `POST ${A}/spaces/join`]],
    ["bots.spaces", { id: "s1" }, ["Home", "Needs you", "₹1,240 to Fresh Basket", "Call Nani", "Groceries", "2 of 5 done", "Pick up the cake for Mom", "Who can approve payments", "Open invites", "nani.sharma@gmail.com", "Email waits to go out", "Activity"],
      [`PUT ${A}/spaces/s1/payments/p-groceries`, `POST ${A}/spaces/s1/lists`, `PUT ${A}/spaces/s1/tasks/t-nani`, `DELETE ${A}/spaces/s1/invites/QW3RT7YP`, `POST ${A}/threads/group`, `POST ${A}/threads/direct`, `PUT ${A}/spaces/s1`, `DELETE ${A}/spaces/s1`]],
    ["bots.space.member", { id: "s1", member: "r" }, ["What Rohan can do", "Kid", "Give tasks to others", "Plan for others", "Approve payments", "Remove Rohan from Home"], [`PUT ${A}/spaces/s1/members/r`, `DELETE ${A}/spaces/s1/members/r`]],
    ["bots.space.member", { id: "s1", member: "u" }, ["What you can do", "You made this space, so you can do everything."], []],
    ["bots.space.invite", { id: "s1" }, ["Invite to Home", "Family", "Kid", "Grandparent", "Pick one by one", "Send the invite", "Email isn't switched on yet"], [`POST ${A}/spaces/s1/invite`]],
    ["bots.space.roles", { id: "s1" }, ["Roles in Home", "Grandparent", "Family", "A new role"], [`POST ${A}/spaces/s1/roles`]],
    ["bots.space.roles", { id: "s1", role: "r-nani" }, ["Change Grandparent", "Delete it"], [`PUT ${A}/spaces/s1/roles/r-nani`, `DELETE ${A}/spaces/s1/roles/r-nani`]],
    ["bots.space.item", { item: "i-groceries" }, ["Groceries", "Mom: For the week", "Chakki atta · 5 kg", "Paneer · 400 g"], [`PUT ${A}/items/i-groceries`, `DELETE ${A}/items/i-groceries`]],
    ["bots.space.pay", { id: "s1" }, ["Ask for a payment", "Pay to (UPI ID)", "Tailzu never pays by itself"], [`POST ${A}/spaces/s1/payments`]],
    ["bots.space.tasks", {}, ["Given to you", "Call Nani", "Home · For you"], [`PUT ${A}/spaces/s1/tasks/t-nani`]],
    ["bots.space.tasks", { id: "s1" }, ["Tasks in Home", "Give a task", "Plan for someone", "Pick up the cake for Mom"], [`DELETE ${A}/spaces/s1/tasks/t-cake`]],
    ["bots.space.tasks", { id: "s1", new: "task" }, ["Give a task", "Mom", "Rohan", "Tomorrow", "Give the task"], [`POST ${A}/spaces/s1/tasks`]],
    ["bots.space.tasks", { id: "s1", new: "plan" }, ["Plan for someone", "How long", "Put it on their day"], [`POST ${A}/spaces/s1/tasks`]],
    ["bots.share", { kind: "list", title: "Packing for Pune", items: "Charger\nAadhaar" }, ["Share", "Packing for Pune", "To a space", "Home", "You can't share things here", "To a person", "Mom", "Change it"], [`POST ${A}/shares`]],
    ["bots.chats", {}, ["Chats", "Home", "Mom", "Diwali party", "Muted"], []],
    ["bots.chats", { new: "chat" }, ["New chat", "Message someone", "Start a group", "Whole space"], [`POST ${A}/threads/direct`, `POST ${A}/threads/group`]],
    ["bots.thread", { id: "th-home" }, ["Home", "Older messages", "Groceries", "Eggless please", "Dinner at 8, everyone home?"], [`POST ${A}/threads/th-home/messages`, `PUT ${A}/threads/th-home`]],
  ];
  for (const [id, params, want, wired] of CASES) {
    for (const client of ["phone", "desktop"] as const) {
      it(`${id} ${JSON.stringify(params)} on the ${client}: lint-clean, the person's data, wired`, async () => {
        const { s, nodes } = await build(id, client, params);
        expect(lintTree(s.root!)).toEqual([]);
        const t = texts(nodes);
        for (const w of want) expect(t, w).toContain(w);
        const c = calls(nodes);
        for (const w of wired) expect(c, w).toContain(w);
      });
    }
  }

  it("draws honest empty states when reads fail", async () => {
    for (const [id, params] of [["bots.spaces", {}], ["bots.spaces", { id: "s1" }], ["bots.space.member", { id: "s1", member: "r" }], ["bots.space.invite", { id: "s1" }], ["bots.space.item", { item: "x" }],
      ["bots.space.tasks", {}], ["bots.space.tasks", { id: "s1" }], ["bots.share", { kind: "text", title: "Hi" }], ["bots.chats", {}], ["bots.thread", { id: "th-home" }]] as const) {
      for (const client of ["phone", "desktop"] as const) {
        const { s, nodes } = await build(id, client, params, {});
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        expect(texts(nodes), id).not.toMatch(/Fresh Basket|Groceries|Nani/);
      }
    }
  });

  it("shows a photo in a chat by its signed link, in a sized box", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { nodes } = await build("bots.thread", client, { id: "th-home" });
      const img = nodes.find((n) => n.type === "Image" && String((n.props?.source as { url?: string })?.url).includes("/threads/th-home/files/msg2/f-cake?"));
      expect(img, client).toBeTruthy();
    }
  });

  it("approving a request hands the UPI payment to bots.approve, and money never moves here", async () => {
    const { nodes } = await build("bots.spaces", "phone", { id: "s1" });
    const approve = actions(nodes).find((a) => a.kind === "callEndpoint" && a.path === `${A}/spaces/s1/payments/p-groceries` && (a.body as { decision?: string }).decision === "approve");
    expect(approve?.assignTo).toBe("decided");
    expect(JSON.stringify(approve?.onSuccess)).toContain('"screenId":"bots.approve"');
    expect(JSON.stringify(approve?.onSuccess)).toContain("$state.decided.payment.upi");
  });

  it("sends the chosen permissions as switches, and only those the person can give", async () => {
    const { nodes, s } = await build("bots.space.member", "phone", { id: "s2", member: "k" }, spacesApi());
    // In Studio, Aanya is Family: she can't change anyone (no "Change what others can do").
    expect(texts(nodes)).toContain("Only someone who can change what others can do may change this.");
    expect(calls(nodes).filter((c) => c.startsWith("PUT"))).toEqual([]);
    const home = await build("bots.space.member", "desktop", { id: "s1", member: "m" });
    const put = actions(home.nodes).find((a) => a.kind === "callEndpoint" && String(a.path).endsWith("/members/m") && (a.body as { perms?: unknown }).perms);
    expect((put!.body as { perms: Record<string, string> }).perms).toMatchObject({ approve: "$state.p_approve", rename: "$state.p_rename" });
    expect(home.s.state).toMatchObject({ p_approve: true, p_rename: false });
    void s;
  });

  it("an invite's link opens Spaces at joining: what it is for and Join at the top, the code in Join with a code too", async () => {
    const api = { ...spacesApi(), [`GET ${A}/spaces/join/QW3RT7YP`]: { invite: { name: "Cousins", members: 4, email: null } }, [`GET ${A}/spaces/join/NOPE1234`]: { invite: null } };
    for (const client of ["phone", "desktop"] as const) {
      const { nodes, s } = await build("bots.spaces", client, { join: "qw3rt7yp" }, api);
      expect(lintTree(s.root!), client).toEqual([]);
      expect(texts(nodes), client).toContain("You're invited to Cousins");
      expect(texts(nodes), client).toContain("4 people so far");
      expect(s.state, client).toMatchObject({ code: "QW3RT7YP" });
      const join = actions(nodes).find((a) => a.kind === "callEndpoint" && a.path === `${A}/spaces/join` && (a.body as { code?: string }).code === "QW3RT7YP");
      expect(join, client).toBeTruthy();
      // In, then that space.
      expect(JSON.stringify(join!.onSuccess), client).toContain('"params":{"id":"$state.joined.id"}');
      // The code box stays, the way that always works.
      expect(calls(nodes), client).toContain(`POST ${A}/spaces/join`);
      expect(texts(nodes), client).toContain("Join with a code");
      // One that doesn't work says so, and offers no Join of its own.
      const bad = await build("bots.spaces", client, { join: "NOPE1234" }, api);
      expect(texts(bad.nodes), client).toContain("This invite doesn't work any more. Ask for a new one.");
      expect(texts(bad.nodes), client).not.toContain("You're invited");
    }
    // No invite in the link: Spaces as it was.
    expect(texts((await build("bots.spaces", "phone")).nodes)).not.toContain("You're invited");
  });

  it("listens to the live topics of what it shows", async () => {
    expect((await build("bots.spaces", "phone", { id: "s1" })).s.liveTopics).toEqual(expect.arrayContaining(["space:s1", "spaces"]));
    expect((await build("bots.thread", "phone", { id: "th-home" })).s.liveTopics).toEqual(["thread:th-home"]);
    expect((await build("bots.chats", "desktop")).s.liveTopics).toEqual(expect.arrayContaining(["threads", "thread:th-home"]));
  });

  it("opens Share from any item with what it is", () => {
    expect(shareTo({ kind: "trip", ref: "t1", title: "Trip to Pune" })).toEqual({ kind: "navigate", screenId: "bots.share", params: { kind: "trip", ref: "t1", title: "Trip to Pune" } });
    expect(shareTo({ kind: "list", title: "Packing", items: ["Charger", "Aadhaar"] }).params).toMatchObject({ items: "Charger\nAadhaar" });
  });
});
