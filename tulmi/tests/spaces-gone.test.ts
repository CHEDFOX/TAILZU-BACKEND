/**
 * SOMEONE NO LONGER HERE (the owner's answer, 8.9.1): their account was deleted, or they are no longer connected to the viewer
 * (they share no space any more). The message STAYS. The server says `gone`, and the screens draw the name faded, with one short
 * hint that is true either way, and nothing about that person opens: no page, no profile, no mention.
 *
 * Both halves are checked here: what the server answers (src/botsBots/threads.ts, spaceFeed.ts) and what the phone and the window
 * draw from it (experience/bots/screens/spaces.ts, spaces/feed.ts).
 */
import { describe, expect, it, vi } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

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
  pushEngine: () => ({ notify: async () => null }),
}));

const { A_, M_, R_, AREA, spacesServer } = await import("./spaces-rig.js");
const { GONE_AVATAR, GONE_COLOR } = await import("../src/botsBots/personLook.js");
const { spaceTable } = await import("../src/botsBots/spaceRows.js");
const { Spaces } = await import("../src/botsBots/spaces.js");

type S = Awaited<ReturnType<typeof spacesServer>>;
interface Said { id: string; text: string; from: { userId: string | null; name: string; you: boolean; gone?: boolean } }
const feedOf = async (s: S, id: string, who: string): Promise<Said[]> => (await s.call("GET", `${AREA}/spaces/${id}/feed`, who)).body.messages;
const goneIn = (ms: Said[]) => ms.map((m) => `${m.from.name}${m.from.gone ? " (gone)" : ""}: ${m.text}`);

describe("the server says who is no longer here", () => {
  it("a space's feed: someone removed from the space is gone; everyone still in it is not", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family([M_, R_]);
    expect((await s.call("POST", `${AREA}/spaces/${id}/feed`, M_, { text: "Dinner at 8" })).status).toBe(201);
    expect((await s.call("POST", `${AREA}/spaces/${id}/feed`, R_, { text: "I'll be late" })).status).toBe(201);
    // Still in the space: nobody is gone, for the admin or for a member.
    for (const who of [A_, R_]) expect(goneIn(await feedOf(s, id, who)), who).toEqual(["Mom: Dinner at 8", "Rohan: I'll be late"]);
    // The admin removes Mom. Her message stays, and only she is gone.
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${M_}`, A_)).status).toBe(200);
    expect(goneIn(await feedOf(s, id, A_))).toEqual(["Mom (gone): Dinner at 8", "Rohan: I'll be late"]);
    // Rohan shares no space with Mom any more either, so she is gone for him too — and he is not gone to himself.
    expect(goneIn(await feedOf(s, id, R_))).toEqual(["Mom (gone): Dinner at 8", "Rohan: I'll be late"]);
  });

  it("a deleted account: the message stays, the words and all, and its sender is gone", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family([M_]);
    expect((await s.call("POST", `${AREA}/spaces/${id}/feed`, M_, { text: "Bring the dahi" })).status).toBe(201);
    const [said] = await feedOf(s, id, A_);
    // What deleting an account does to a message (migration 0051): the sender id goes, the name and the words stay.
    await spaceTable("thread_messages").update({ id: said!.id }, { sender_id: null } as never);
    const after = await feedOf(s, id, A_);
    expect(after).toHaveLength(1);
    expect(after[0]!.text).toBe("Bring the dahi");
    expect(after[0]!.from).toMatchObject({ userId: null, name: "Mom", gone: true });
  });

  it("a one-to-one chat: the other person goes faded and neutral, and their messages with them", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family([M_]);
    const th = (await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).body.id as string;
    expect((await s.call("POST", `${AREA}/threads/${th}/messages`, M_, { text: "On my way" })).status).toBe(201);
    const read = async () => (await s.call("GET", `${AREA}/threads/${th}`, A_)).body;
    const before = await read();
    expect(before.thread.people.find((p: { userId: string }) => p.userId === M_)).not.toHaveProperty("gone");
    expect(before.messages[0].from).not.toHaveProperty("gone");
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${M_}`, A_)).status).toBe(200);
    const after = await read();
    // Her message is still readable, and still hers by name.
    expect(after.messages.map((m: Said) => m.text)).toEqual(["On my way"]);
    expect(after.messages[0].from).toMatchObject({ name: "Mom", gone: true });
    // In the chat's own people too, with a neutral look: no colour of her own left.
    const mom = after.thread.people.find((p: { userId: string }) => p.userId === M_);
    expect(mom).toMatchObject({ gone: true, bot: { seed: M_, avatar: GONE_AVATAR, color: GONE_COLOR } });
    // The viewer is never gone to themself.
    expect(after.thread.people.find((p: { you: boolean }) => p.you)).not.toHaveProperty("gone");
  });

  it("a message TO someone no longer here: the message stays, and its \"To Mom\" line is gone too", async () => {
    // to_id has no foreign key (0068_spaces_family.sql), by design, so a message addressed to her stays for its sender and
    // for the admin after she goes. The line over it has to fade with her name, or it reads as a line to someone still here.
    const s = await spacesServer({ pushes });
    const id = await s.family([M_, R_]);
    expect((await s.call("POST", `${AREA}/spaces/${id}/feed`, A_, { text: "Your check-up is Friday", to: M_ })).status).toBe(201);
    const first = async () => (await feedOf(s, id, A_))[0] as Said & { to: { name: string; gone?: boolean } | null };
    expect((await first()).to).toMatchObject({ name: "Mom", you: false });
    expect((await first()).to).not.toHaveProperty("gone");
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${M_}`, A_)).status).toBe(200);
    const after = await first();
    expect(after.text).toBe("Your check-up is Friday");
    expect(after.to).toMatchObject({ name: "Mom", gone: true });
  });

  it("the viewer's other spaces are walked only when the page needs them", async () => {
    // Everyone still in this chat's space is connected to the viewer by definition, so a feed read whose senders are all in
    // it needs no walk of Spaces.mine (about 30 reads on the most read surface there is). Someone from outside it does.
    const s = await spacesServer({ pushes });
    const id = await s.family([M_, R_]);
    expect((await s.call("POST", `${AREA}/spaces/${id}/feed`, M_, { text: "Dinner at 8" })).status).toBe(201);
    const mine = vi.spyOn(Spaces.prototype, "mine");
    try {
      expect(await feedOf(s, id, A_)).toHaveLength(1);
      expect(mine, "nobody on the page is from outside the space").not.toHaveBeenCalled();
      expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${M_}`, A_)).status).toBe(200);
      mine.mockClear();
      expect(goneIn(await feedOf(s, id, A_))).toEqual(["Mom (gone): Dinner at 8"]);
      expect(mine, "her message is from outside the space now").toHaveBeenCalled();
    } finally {
      mine.mockRestore();
    }
  });

  it("a one-to-one chat whose other person DELETED their account: the name is still theirs, faded, not \"Someone\"", async () => {
    // What deleting an account really does: thread_members.user_id references auth.users ON DELETE CASCADE (migration 0051),
    // so their membership row goes with the account, everywhere — which is the one case removing them from a space does not
    // reach. The message keeps its sender_name and loses its sender_id (the same migration), so the name is read back off it.
    const s = await spacesServer({ pushes });
    const id = await s.family([M_]);
    const th = (await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).body.id as string;
    expect((await s.call("POST", `${AREA}/threads/${th}/messages`, M_, { text: "On my way" })).status).toBe(201);
    const said = (await s.call("GET", `${AREA}/threads/${th}`, A_)).body.messages[0].id as string;
    await spaceTable("thread_messages").update({ id: said }, { sender_id: null } as never);
    await spaceTable("thread_members").remove({ thread_id: th, user_id: M_ });
    await spaceTable("space_members").remove({ space_id: id, user_id: M_ });
    const after = (await s.call("GET", `${AREA}/threads/${th}`, A_)).body;
    expect(after.messages.map((m: Said) => m.text)).toEqual(["On my way"]);
    expect(after.thread.name).toBe("Mom");
    const mom = after.thread.people.find((p: { you: boolean }) => !p.you);
    expect(mom).toMatchObject({ name: "Mom", gone: true, bot: { avatar: GONE_AVATAR, color: GONE_COLOR } });
    expect(after.thread.people.find((p: { you: boolean }) => p.you)).not.toHaveProperty("gone");
  });
});

// ===================================================================== what the screens draw

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { spacesApi, FEED, HOME_CHAT_GONE, FEED_GONE, MOM_CHAT_GONE, THREADS_GONE } = await import("./spaces-data.js");
const { GONE_COLOR: GONE_INK, GONE_FADE, GONE_HINT } = await import("../src/experience/bots/screens/spaces/feed.js");

const A = "/v1/botsapp/bots";
/** A build that draws the new Spaces (the feed, the "@" field): the capabilities canSpaces2 asks for. */
const NEW = ["BotsKit", "FileUpload", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "KitExtras"];
async function build(screenId: string, client: "phone" | "desktop", params: Record<string, string> = {}, api: Record<string, unknown> = spacesApi()) {
  const can = new Set([...NEW, ...(client === "phone" ? ["ActionParams"] : ["DeskTalkTo"])]);
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "u" }, can, desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ jobs: [], tasks: [], api }));
  return { s, nodes: walk(s.root!) };
}
/** Every node that says this name. A chat's head and the chats list say it too, so a faded one is "one of them". */
const named = (nodes: Node[], name: string) => nodes.filter((n) => n.type === "Text" && n.props?.content === name);
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")).join("\n");
/** THE FADED LINE ITSELF: the one row that holds the name and the hint, and nothing else. */
function fadedLine(nodes: Node[], name: string): Node | undefined {
  return nodes.find((n) => (n.children ?? []).length === 2
    && n.children![0]!.props?.content === name
    && String(n.children![1]!.props?.content ?? "").includes(GONE_HINT));
}
/** Every action in the tree, through the shapes that hold others. */
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
/** Whose page the tree can open (bots.person): never someone no longer here. */
const opensPerson = (nodes: Node[]) => actions(nodes).filter((a) => a.screenId === "bots.person").map((a) => (a.params as { id?: string } | undefined)?.id);

describe("the screens draw a faded name that does nothing", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`${client}: a space's feed \u2014 the name faded, the hint beside it, nothing to tap, no page to open`, async () => {
      const { s, nodes } = await build("bots.spaces", client, { id: "s1" }, { ...spacesApi(), [`GET ${A}/spaces/s1/feed`]: FEED_GONE });
      // The message itself is untouched.
      expect(texts(nodes)).toContain("Dinner at 8? Bring the dahi");
      // Her name is there, faded, with one honest hint: never "deleted", because only one of the two cases is.
      const line = fadedLine(nodes, "Mom");
      expect(line, "the faded line").toBeTruthy();
      expect(line!.style?.opacity).toBe(GONE_FADE);
      expect(line!.children![0]!.style?.color).toBe(GONE_INK);
      expect(texts(nodes)).not.toMatch(/deleted/i);
      // Nothing on it, or around it, does anything, and her page cannot be opened from here.
      expect(line!.on ?? null).toBeNull();
      expect(nodes.filter((n) => (n.children ?? []).includes(line!)).every((n) => !n.on)).toBe(true);
      expect(opensPerson(nodes)).not.toContain("m");
      // A message the viewer sent TO her stays (to_id has no key), so "To Mom" is still drawn — faded, with the same hint.
      expect(texts(nodes)).toContain("Your check-up is Friday 7:40, I'll drive you");
      const to = fadedLine(nodes, "To Mom");
      expect(to, "the faded To Mom line").toBeTruthy();
      expect(to!.style?.opacity).toBe(GONE_FADE);
      expect(to!.children![0]!.style?.color).toBe(GONE_INK);
      // Rohan is still here: neither his name nor a line to him is faded.
      expect(fadedLine(nodes, "Rohan")).toBeUndefined();
      expect(fadedLine(nodes, "To Rohan")).toBeUndefined();
      expect(named(nodes, "Rohan").length).toBeGreaterThan(0);
      expect(lintTree(s.root!)).toEqual([]);
    });

    it(`${client}: the chats list — a one-to-one row with someone no longer here is faded, and still opens the chat`, async () => {
      const { s, nodes } = await build("bots.chats", client, {}, { ...spacesApi(), [`GET ${A}/threads`]: THREADS_GONE });
      // Her name IS the row's name (threadRow), so it fades there as it does in the chat's head.
      const mom = named(nodes, "Mom").find((n) => n.style?.opacity === GONE_FADE);
      expect(mom, "the faded row name").toBeTruthy();
      expect(mom!.props?.color ?? mom!.style?.color).toBeTruthy();
      // The row still opens the chat; it never opened her page (the head is where the way to a person is, and the
      // one-to-one test above checks that it is gone there).
      expect(actions(nodes).some((a) => a.screenId === (client === "desktop" ? "bots.chats" : "bots.thread") && (a.params as { id?: string })?.id === "th-mom")).toBe(true);
      // A chat with people still here keeps its full ink.
      expect(named(nodes, "Diwali party").every((n) => n.style?.opacity !== GONE_FADE)).toBe(true);
      expect(lintTree(s.root!)).toEqual([]);
    });

    it(`${client}: a chat \u2014 the faded name opens no page, and a name still here does`, async () => {
      const { s, nodes } = await build("bots.thread", client, { id: "th-home" }, { ...spacesApi(), [`GET ${A}/threads/th-home`]: HOME_CHAT_GONE });
      expect(texts(nodes)).toContain("Dinner at 8, everyone home?");
      const line = fadedLine(nodes, "Mom");
      expect(line, "the faded line").toBeTruthy();
      expect(line!.style?.opacity).toBe(GONE_FADE);
      expect(line!.on ?? null).toBeNull();
      // The viewer's own message to her alone stays, and its "To Mom" line is faded too.
      expect(texts(nodes)).toContain("That one. Eggless please!");
      const to = fadedLine(nodes, "To Mom");
      expect(to, "the faded To Mom line").toBeTruthy();
      expect(to!.style?.opacity).toBe(GONE_FADE);
      // No way through to her, and Rohan (still here) keeps his page.
      expect(opensPerson(nodes)).not.toContain("m");
      expect(opensPerson(nodes)).toContain("r");
      expect(lintTree(s.root!)).toEqual([]);
    });
  }

  it("a one-to-one chat with someone no longer here: the head fades, and there is no page to open", async () => {
    // No message in a one-to-one carries a name, so the chat's own name is the one that fades. Report stays under each message.
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build("bots.thread", client, { id: "th-mom" }, { ...spacesApi(), [`GET ${A}/threads/th-mom`]: MOM_CHAT_GONE });
      expect(texts(nodes), client).toContain("On my way");
      const head = named(nodes, "Mom").find((n) => n.style?.opacity === GONE_FADE);
      expect(head, client).toBeTruthy();
      expect(texts(nodes), client).toContain(GONE_HINT);
      expect(opensPerson(nodes), client).not.toContain("m");
      expect(texts(nodes), client).toContain("Report");
      expect(lintTree(s.root!), client).toEqual([]);
    }
  });

  it("the mention list only ever offers people still in the space", async () => {
    // The "@" list is the space's own members (spaceFeed.ts people), so someone no longer there can never be picked.
    const { nodes } = await build("bots.spaces", "phone", { id: "s1" }, { ...spacesApi(), [`GET ${A}/spaces/s1/feed`]: FEED_GONE });
    const field = nodes.find((n) => n.type === "MentionField");
    const people = (field?.props?.people ?? []) as Array<{ name: string }>;
    expect(people.map((p) => p.name)).toEqual(["Rohan"]);
    expect(FEED.people.some((p) => p.name === "Mom")).toBe(true);
  });
});
