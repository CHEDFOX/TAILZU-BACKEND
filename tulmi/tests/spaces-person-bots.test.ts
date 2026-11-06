/**
 * PEOPLE AS THEIR OWN TINY BOTS, AND THE FEED'S MESSAGES WITH NO BOX (src/botsBots/personLook.ts; experience/bots/kit.ts personBot,
 * messageText; the Spaces screens, Work in space, Home's one Space card; shared/types/sdui.ts 3j; docs/spaces.md "How people look").
 *
 * No initials anywhere: a person is a PersonBot with the look the server picked (unique in a space, the viewer their own ink Blip), a
 * plain circle in their colour for a build without PersonBot. In the feed, no faces and no box: a grey name over theirs, a 2 px line
 * down the left of theirs in their own colour and down the right of yours in ink, and the words in Bricolage (Geist without
 * FontBricolage). Home has one card, "Space".
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, ctxFor } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { BRICOLAGE, C, FACE, botsFonts, messageText, personBot } = await import("../src/experience/bots/kit.js");
const P = await import("../src/botsBots/personLook.js");
const { buildBootstrap } = await import("../src/experience/bootstrap/bootstrap.js");
const { sampleApi } = await import("./bots-bots-data.js");
const D = await import("./spaces-data.js");

const A = "/v1/botsapp/bots";
type Client = "phone" | "desktop";

/** The new Spaces' blocks (sdui 3i), as spaces-family-screens.test.ts names them. */
const SPACES2 = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras"];
/** And 3j: people as tiny bots, and the messages' face. */
const ALL = [...SPACES2, "PersonBot", "FontBricolage"];
const OLD = ["BotsKit", "FileUpload"];
const canOf = (client: Client, base: string[]): string[] => [...base, ...(base === OLD ? [] : client === "phone" ? ["ActionParams"] : ["DeskTalkTo"])];

async function build(screenId: string, client: Client, o: { params?: Record<string, string>; api?: Record<string, unknown>; can?: string[]; calls?: Array<{ method: string; path: string }> } = {}) {
  const api = o.api ?? { ...(await sampleApi()), ...D.spacesApi() };
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya" }, can: new Set(o.can ?? canOf(client, ALL)), desk: { pages: client === "desktop", notes: client === "desktop" } },
    fakeDeps({ api, ...(o.calls ? { calls: o.calls } : {}) }),
  );
  const nodes = walk(s.root!);
  expect(lintTree(s.root!), `${screenId} ${client}`).toEqual([]);
  return { s, nodes };
}
const texts = (nodes: Node[]): string[] => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
const ofType = (nodes: Node[], type: string) => nodes.filter((n) => n.type === type);
/** A single capital letter on its own: an initial. None anywhere in these screens. */
const initials = (nodes: Node[]) => texts(nodes).filter((t) => /^[A-Z]{1,2}$/.test(t.trim()));
const bots = (nodes: Node[]) => ofType(nodes, "PersonBot").map((n) => n.props as { seed: string; avatar: string; color: string; size: number });
const ME = { seed: "u", avatar: "blip", color: "#0a0a0a" };
/** The node whose child is this exact text. */
const parentOf = (root: Node, child: Node): Node | undefined => walk(root).find((n) => n.children?.includes(child));
const textNode = (nodes: Node[], content: string) => nodes.find((n) => n.type === "Text" && n.props?.content === content);
/** No box: no ground, no edge all round, no rounded corners (a line down one side is not a box). */
const noBox = (n: Node): boolean => !n.style?.backgroundColor && !n.style?.background && !n.style?.borderWidth && !n.style?.borderRadius;

// ===================================================================== the looks

describe("how a person looks (botsBots/personLook.ts)", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../shared/bots/looks.json", import.meta.url), "utf8")) as { avatars: Record<string, unknown> };

  it("every avatar is in the catalog, the palette is the group's, the viewer is their own ink Blip", () => {
    for (const a of P.PERSON_AVATARS) expect(catalog.avatars[a], a).toBeTruthy();
    expect(catalog.avatars[P.SELF_AVATAR]).toBeTruthy();
    expect([...P.PERSON_AVATARS]).toEqual(["pip", "dot", "bolt", "sage", "scout", "dapper", "nova"]);
    expect([...P.PERSON_COLORS]).toEqual(["#5B7DB1", "#B5654A", "#6B8E4E", "#8A6BB1", "#B18A3D"]);
    expect(P.seen(P.lookOf("mom"), "mom")).toEqual({ seed: "mom", avatar: "blip", color: "#0a0a0a" });
    expect(P.seen(P.lookOf("mom"), "dad")).toEqual(P.lookOf("mom"));
  });

  it("the same id has the same look every time", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `user-${i}`);
    for (const id of ids) {
      expect(P.lookOf(id)).toEqual(P.lookOf(id));
      expect(P.lookOf(id).seed).toBe(id);
      expect(P.PERSON_AVATARS).toContain(P.lookOf(id).avatar);
      expect(P.PERSON_COLORS).toContain(P.lookOf(id).color);
    }
    // Spread over the lists, not all one look.
    expect(new Set(ids.map((id) => P.lookOf(id).avatar)).size).toBeGreaterThan(4);
    expect(new Set(ids.map((id) => P.lookOf(id).color)).size).toBe(5);
  });

  it("in a space: everyone's colour of their own up to five, avatar up to seven; a clash goes to the one who joined later", () => {
    const five = ["a1", "b2", "c3", "d4", "e5"];
    const looks5 = P.looksIn(five);
    expect(new Set([...looks5.values()].map((l) => l.color)).size).toBe(5);
    const seven = [...five, "f6", "g7"];
    expect(new Set([...P.looksIn(seven).values()].map((l) => l.avatar)).size).toBe(7);
    // Two people whose own colours clash: the first keeps theirs, the second moves on.
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const first = ids[0]!;
    const twin = ids.find((id) => id !== first && P.lookOf(id).color === P.lookOf(first).color && P.lookOf(id).avatar === P.lookOf(first).avatar)
      ?? ids.find((id) => id !== first && P.lookOf(id).color === P.lookOf(first).color)!;
    const pair = P.looksIn([first, twin]);
    expect(pair.get(first)).toEqual(P.lookOf(first));
    expect(pair.get(twin)!.color).not.toBe(P.lookOf(first).color);
    // The order is the join order: the other way round, the other one keeps theirs.
    expect(P.looksIn([twin, first]).get(twin)).toEqual(P.lookOf(twin));
    // Nobody is dropped past the lists' end: eight people, eight looks.
    expect(P.looksIn([...seven, "h8"]).size).toBe(8);
    // shownLook: the viewer as their own bot, someone not in it with their own look.
    expect(P.shownLook(looks5, "a1", "a1")).toEqual({ seed: "a1", avatar: "blip", color: "#0a0a0a" });
    expect(P.shownLook(looks5, "zz", "a1")).toEqual(P.lookOf("zz"));
  });
});

// ===================================================================== the kit

describe("the kit's PersonBot and message text (sdui 3j)", () => {
  const look = { seed: "m", avatar: "sage", color: "#6B8E4E" };
  it("a PersonBot for a build that draws it; a plain circle in their colour (no letter) for any other", () => {
    const can = (names: string[]) => ctxFor("bots.x", "phone", undefined, { can: new Set(names) });
    const bot = personBot(can(["BotsKit", "PersonBot"]), look, { size: 28 });
    expect(bot).toEqual({ type: "PersonBot", props: { seed: "m", avatar: "sage", color: "#6B8E4E", size: 28 }, style: { width: 28, height: 28, flexShrink: 0 } });
    expect(personBot(can(["PersonBot"]), look).props).toMatchObject({ size: 32 });
    expect(personBot(can(["PersonBot"]), look, { live: false, label: "Mom" }).props).toMatchObject({ live: false, label: "Mom" });
    const dot = personBot(can(["BotsKit"]), look, { size: 30 });
    expect(dot.type).toBe("Stack");
    expect(dot.children ?? []).toEqual([]);
    expect(dot.style).toMatchObject({ width: 30, height: 30, borderRadius: 15, backgroundColor: "#6B8E4E" });
    for (const n of [bot, dot]) expect(lintTree(n)).toEqual([]);
  });

  it("a message's words: Bricolage 400 at 16/23, tracking -0.1, ink; Geist in the same place without FontBricolage", () => {
    const withIt = messageText(ctxFor("bots.x", "phone", undefined, { can: new Set(["FontBricolage"]) }), "Dinner at 8?");
    expect(withIt.style).toMatchObject({ fontFamily: "Tailzu Bricolage", fontSize: 16, lineHeight: 23, letterSpacing: -0.1, color: C.ink, fontWeight: "normal" });
    const without = messageText(ctxFor("bots.x", "phone"), "Dinner at 8?");
    expect(without.style).toMatchObject({ fontFamily: FACE.regular, fontSize: 16, lineHeight: 23, letterSpacing: -0.1 });
    expect(lintTree(withIt)).toEqual([]);
    expect(BRICOLAGE).toEqual({ regular: "Tailzu Bricolage", medium: "Tailzu Bricolage Medium", semibold: "Tailzu Bricolage SemiBold" });
  });

  it("the faces: three Bricolage files served beside Geist, named only to a build that sets them", () => {
    const fonts = botsFonts({ bricolage: true });
    expect(Object.keys(botsFonts())).not.toContain("Tailzu Bricolage");
    for (const [family, file] of [["Tailzu Bricolage", "bricolage.ttf"], ["Tailzu Bricolage Medium", "bricolage-medium.ttf"], ["Tailzu Bricolage SemiBold", "bricolage-semibold.ttf"]]) {
      expect(fonts[family!], family).toMatch(new RegExp(`^https://.+/fonts/${file!.replace(".", "\\.")}\\?v=\\d+$`));
      const path = new URL(`../fonts/${file}`, import.meta.url);
      expect(existsSync(path), file).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString("hex"), file).toBe("00010000");
    }
    expect(readFileSync(new URL("../fonts/OFL.txt", import.meta.url), "utf8")).toContain("bricolage*.ttf");
    const boot = (o: Record<string, unknown>) => (buildBootstrap(o as never) as { fonts?: Record<string, string> }).fonts ?? {};
    expect(boot({ botsApp: true, fontBricolage: true })["Tailzu Bricolage SemiBold"]).toMatch(/bricolage-semibold\.ttf/);
    expect(boot({ botsApp: true })["Tailzu Bricolage"]).toBeUndefined();
  });
});

// ===================================================================== the screens

describe("no initials in Spaces: each person is their own tiny bot", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`Your spaces on the ${client}: up to three tiny bots a row (and "+N"); the invitation's and the request's people too`, async () => {
      const { nodes } = await build("bots.spaces", client, { params: { thought: "1" } });
      expect(initials(nodes)).toEqual([]);
      const b = bots(nodes);
      // Home: Mom and Rohan, then Aanya (her own ink Blip). Studio: Dev, Ishita, Kabir, and "+1" for Aanya.
      expect(b).toEqual(expect.arrayContaining([
        { ...D.LOOK.m, size: 28 }, { ...D.LOOK.r, size: 28 }, { ...ME, size: 28 }, { ...D.LOOK.d, size: 28 }, { ...D.LOOK.i, size: 28 }, { ...D.LOOK.k, size: 28 },
      ]));
      expect(texts(nodes)).toContain("+1");
      // Kabir's invitation, Ishita's request: the bots the server gave them.
      expect(b).toEqual(expect.arrayContaining([{ ...D.LOOK.k, size: 36 }, { ...D.LOOK.i, size: 36 }]));
    });
  }

  it("Call Your People: each email sent has a tiny bot of its own", async () => {
    const { nodes } = await build("bots.spaces", "phone", { api: { [`GET ${A}/spaces?full=1`]: D.FULL_CREATE } });
    expect(initials(nodes)).toEqual([]);
    expect(bots(nodes).map((x) => x.seed)).toEqual(expect.arrayContaining(["meera@example.in", "rohan@example.in"]));
    expect(bots(nodes).find((x) => x.seed === "rohan@example.in")).toMatchObject({ ...P.lookOf("rohan@example.in"), size: 28 });
  });

  it("the people page, a member's page, sharing to a person, a new chat, someone's page", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const people = await build("bots.space.people", client, { params: { id: "s1" } });
      expect(initials(people.nodes)).toEqual([]);
      expect(bots(people.nodes)).toEqual([{ ...ME, size: 32 }, { ...D.LOOK.m, size: 32 }, { ...D.LOOK.r, size: 32 }]);
      const mom = await build("bots.space.member", client, { params: { id: "s1", member: "m" } });
      expect(bots(mom.nodes)).toEqual([{ ...D.LOOK.m, size: 48 }]);
      expect(initials(mom.nodes)).toEqual([]);
      const share = await build("bots.share", client, { params: { kind: "list", title: "Groceries" } });
      expect(bots(share.nodes)).toEqual([{ ...D.LOOK.m, size: 32 }, { ...D.LOOK.r, size: 32 }]);
      const chat = await build("bots.chats", client, { params: { new: "chat" } });
      expect(bots(chat.nodes)).toEqual(expect.arrayContaining([{ ...D.LOOK.m, size: 32 }, { ...D.LOOK.r, size: 32 }]));
      expect(initials(chat.nodes)).toEqual([]);
      const person = await build("bots.person", client, { params: { id: "m" }, api: { [`GET ${A}/people/m`]: { person: { userId: "m", name: "Mom", spaces: ["Home"], blockedByYou: false, canMessage: true, bot: D.LOOK.m } } } });
      expect(bots(person.nodes)).toEqual([{ ...D.LOOK.m, size: 48 }]);
      expect(initials(person.nodes)).toEqual([]);
    }
  });

  it("Work in space on a bot's page, someone's things and one of them: their tiny bots, never a letter", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const tab = await build("bots.plan", client);
      expect(initials(tab.nodes)).toEqual([]);
      expect(bots(tab.nodes)).toEqual(expect.arrayContaining([{ ...D.LOOK.m, size: 28 }, { ...D.LOOK.m, size: 36 }, { ...D.LOOK.r, size: 36 }]));
      const person = await build("bots.work", client, { params: { bot: "plan", space: "s1", owner: "m" } });
      expect(bots(person.nodes)).toEqual([{ ...D.LOOK.m, size: 48 }]);
      const item = await build("bots.work", client, { params: { bot: "plan", space: "s1", owner: "m", item: "e:doctor@2026-11-14" } });
      expect(bots(item.nodes)).toEqual([{ ...D.LOOK.r, size: 28 }]);
      expect(initials(item.nodes)).toEqual([]);
    }
  });

  it("a build without PersonBot: plain circles in each person's colour, no letter; an older build the same, in today's screens", async () => {
    for (const can of [canOf("phone", SPACES2), OLD]) {
      const { nodes } = await build("bots.spaces", "phone", { can, params: { id: "" } });
      expect(ofType(nodes, "PersonBot")).toHaveLength(0);
      expect(initials(nodes)).toEqual([]);
      const circles = nodes.filter((n) => n.type === "Stack" && !n.children?.length && n.style?.backgroundColor === D.LOOK.m.color);
      expect(circles.length, can.join()).toBeGreaterThan(0);
      expect(circles[0]!.style).toMatchObject({ borderRadius: Number(circles[0]!.style!.width) / 2 });
    }
    const oldDetail = await build("bots.spaces", "desktop", { can: OLD });
    expect(initials(oldDetail.nodes)).toEqual([]);
    expect(ofType(oldDetail.nodes, "PersonBot")).toHaveLength(0);
  });

  it("a space's faces just touch: tiny bots overlap far more than circles, in a column as wide as three and \"+N\"", async () => {
    // 28 px faces: a bot's box over the one before by 0.55 of it (15 px), a circle by 0.22 (6 px).
    const OVER = { bot: 15, circle: 6 };
    for (const [can, over] of [[canOf("phone", ALL), OVER.bot], [canOf("phone", SPACES2), OVER.circle]] as const) {
      const { s } = await build("bots.spaces", "phone", { can: [...can] });
      // Home's row: three faces, the second and third pulled over the one before.
      const face = (n: Node) => n.type === "PersonBot" || (n.type === "Stack" && !n.children?.length && n.style?.width === 28 && n.style?.borderRadius === 14);
      const rows = walk(s.root!).filter((n) => n.type === "Stack" && (n.children ?? []).length >= 3 && (n.children ?? []).slice(0, 3).every((c) => c.children?.length === 1 && face(c.children[0]!)));
      expect(rows.length, can.join()).toBeGreaterThan(0);
      const kids = rows[0]!.children!;
      expect(kids[0]!.style?.marginLeft).toBeUndefined();
      expect(kids[1]!.style?.marginLeft).toBe(-over);
      expect(kids[2]!.style?.marginLeft).toBe(-over);
      // The column it sits in: 28 + two steps + room for "+N".
      expect(parentOf(s.root!, rows[0]!)!.style?.width).toBe(28 + 2 * (28 - over) + 20);
    }
  });

  it("a one to one chat: the other person as the bot the server gave them, never a letter", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { nodes } = await build("bots.chats", client);
      expect(initials(nodes)).toEqual([]);
      expect(bots(nodes)).toEqual(expect.arrayContaining([{ ...D.LOOK.m, size: 40 }]));
    }
  });

  it("a person with no look in the answer gets the one their id always has", async () => {
    const plain = { ...D.FULL_JOINED, spaces: D.FULL_JOINED.spaces.map((s) => ({ ...s, members: s.members.map(({ bot: _b, ...m }) => m) })) };
    const { nodes } = await build("bots.spaces", "phone", { api: { [`GET ${A}/spaces?full=1`]: plain } });
    expect(bots(nodes)).toEqual(expect.arrayContaining([{ ...P.lookOf("m"), size: 28 }, { ...ME, size: 28 }]));
  });
});

describe("the feed: no faces, no box, a grey name, a line in their colour, Bricolage", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`inside Home on the ${client}`, async () => {
      const { s, nodes } = await build("bots.spaces", client, { params: { id: "s1" } });
      expect(initials(nodes)).toEqual([]);
      // No tiny bot for anyone in the feed (his own stage is the box he writes in).
      expect(ofType(nodes, "PersonBot")).toHaveLength(0);
      // The sender's name over theirs: Geist SemiBold 12/16, #8a8a8a, set in 12 (the line and its gap) to sit over the words. Their
      // own messages carry none.
      for (const name of ["Mom", "Rohan"]) {
        const n = textNode(nodes, name)!;
        expect(n.style, name).toMatchObject({ fontFamily: FACE.semibold, fontSize: 12, lineHeight: 16, color: "#8a8a8a" });
        expect(parentOf(s.root!, n)!.style, name).toMatchObject({ paddingLeft: 12 });
      }
      expect(texts(nodes)).not.toContain("Aanya");
      expect(textNode(nodes, "To Mom")?.style).toMatchObject({ fontFamily: FACE.semibold, fontSize: 12, lineHeight: 16, color: "#8a8a8a" });
      // Theirs: no ground, no box: a 2 px solid line down the left in their own colour, 10 from the words; Bricolage 16/23.
      const theirs = textNode(nodes, "Dinner at 8? Bring the dahi")!;
      expect(theirs.style).toMatchObject({ fontFamily: "Tailzu Bricolage", fontSize: 16, lineHeight: 23, letterSpacing: -0.1, color: C.ink });
      const theirLine = parentOf(s.root!, theirs)!;
      expect(theirLine.style).toMatchObject({ borderLeftWidth: 2, borderLeftColor: D.LOOK.m.color, paddingLeft: 10, alignItems: "flex-start" });
      expect(noBox(theirLine)).toBe(true);
      expect(parentOf(s.root!, textNode(nodes, "Can someone drop me at practice tomorrow?")!)!.style).toMatchObject({ borderLeftWidth: 2, borderLeftColor: D.LOOK.r.color });
      // Yours: on the right, an ink line down the right, 10 from the words, ink words (no black bubble), no name.
      const mine = textNode(nodes, "Your check-up is Friday 7:40, I'll drive you")!;
      expect(mine.style).toMatchObject({ fontFamily: "Tailzu Bricolage", color: C.ink });
      const myLine = parentOf(s.root!, mine)!;
      expect(myLine.style).toMatchObject({ borderRightWidth: 2, borderRightColor: "#0a0a0a", paddingRight: 10, alignItems: "flex-end" });
      expect(myLine.style?.borderLeftWidth).toBeUndefined();
      expect(noBox(myLine)).toBe(true);
      const myRow = walk(s.root!).find((n) => n.style?.justifyContent === "flex-end" && walk(n).includes(mine));
      expect(myRow).toBeTruthy();
      expect(nodes.filter((n) => n.style?.backgroundColor === C.ink && walk(n).some((x) => x.type === "Text" && x.style?.color === C.paper && D.FEED.messages.some((m) => m.text === x.props?.content)))).toHaveLength(0);
      // No message sits on a ground or in an edge any more: nothing between its row in the feed and its words.
      for (const m of D.FEED.messages.filter((x) => x.text)) {
        const words = textNode(nodes, m.text)!;
        const holders = walk(s.root!).filter((n) => n !== words && walk(n).includes(words));
        const row = holders.filter((n) => n.style?.flexDirection === "row" && (n.style?.justifyContent === "flex-start" || n.style?.justifyContent === "flex-end")).at(-1)!;
        expect(walk(row).filter((n) => holders.includes(n)).every(noBox), m.text).toBe(true);
      }
      // The shared thing: no box either, by the same line as its message (yours: ink, on the right), its title as words, Open in
      // its bot a plain link.
      const title = textNode(nodes, "Doctor, knee check-up")!;
      expect(title.style).toMatchObject({ fontSize: 15, lineHeight: 20 });
      const cardLine = parentOf(s.root!, title)!;
      expect(cardLine.style).toMatchObject({ borderRightWidth: 2, borderRightColor: "#0a0a0a" });
      expect(noBox(cardLine)).toBe(true);
      expect(texts(walk(cardLine))).toEqual(expect.arrayContaining(["You shared", "Doctor, knee check-up", "from Plan Ease · Fri, 7:40 pm", "Open in Plan Ease", "Stop sharing"]));
      const openLink = walk(cardLine).find((n) => n.on?.onPress && walk(n).includes(textNode(nodes, "Open in Plan Ease")!))!;
      expect(noBox(openLink)).toBe(true);
      expect(walk(cardLine).some((n) => n.style?.width === 256)).toBe(false);
      // The "@" list: each person's own tiny bot, as the server picked it.
      const field = ofType(nodes, "MentionField")[0]!;
      expect(field.props!.people).toEqual([{ id: "m", name: "Mom", bot: D.LOOK.m }, { id: "r", name: "Rohan", bot: D.LOOK.r }]);
    });
  }

  it("a member's thing the admin shared: no box, by the admin's line, \"Aanya shared Mom's\", Open in Plan Ease; only the admin's \"/\" lists others' things", async () => {
    const at = D.FEED.messages[0]!.at + 60_000;
    const thing = { grantId: "g9", bot: "plan", botName: "Plan Ease", ownerId: "m", ownerName: "Mom", id: "e:knee", title: "Doctor, knee check-up", line: "Event" };
    const goes = { kind: "navigate", screenId: "bots.work", params: { bot: "plan", space: "s1", owner: "m", item: "e:knee" } };
    const opens = (root: Node) => walk(root).some((n) => JSON.stringify(n.on?.onPress) === JSON.stringify(goes));
    // Rohan, who it was shared with: the admin's name over it, a line in her colour on the left, no Stop sharing, no "To".
    const rohan = { ...D.FEED_ROHAN, messages: [{ id: "f9", at, from: { userId: "u", name: "Aanya", you: false }, to: { userId: "r", name: "Rohan", you: true }, text: "", files: [], item: null, thing }] };
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build("bots.spaces", client, { params: { id: "s1" }, api: { ...(await sampleApi()), ...D.spacesApi(), [`GET ${A}/spaces/s1/feed`]: rohan } });
      const line = parentOf(s.root!, textNode(nodes, "Doctor, knee check-up")!)!;
      expect(line.style, client).toMatchObject({ borderLeftWidth: 2, borderLeftColor: D.LOOK.u.color, paddingLeft: 10 });
      expect(noBox(line)).toBe(true);
      expect(texts(walk(line))).toEqual(["Aanya shared Mom's", "Doctor, knee check-up", "from Plan Ease · Event", "Open in Plan Ease"]);
      expect(textNode(nodes, "Aanya")?.style).toMatchObject({ fontFamily: FACE.semibold, fontSize: 12, color: "#8a8a8a" });
      expect(texts(nodes)).not.toContain("To Rohan");
      expect(opens(s.root!)).toBe(true);
      expect(ofType(nodes, "MentionField")[0]!.props!.thingsPath).toBe(`${A}/work/:bot/mine`);
    }
    // The admin: "You shared Mom's", "To Rohan" over it, an ink line on the right, and Stop sharing.
    const admin = { ...D.FEED, messages: [{ id: "f9", at, from: { userId: "u", name: "Aanya", you: true }, to: { userId: "r", name: "Rohan", you: false }, text: "", files: [], item: null, thing }] };
    const { s, nodes } = await build("bots.spaces", "phone", { params: { id: "s1" }, api: { ...(await sampleApi()), ...D.spacesApi(), [`GET ${A}/spaces/s1/feed`]: admin } });
    const line = parentOf(s.root!, textNode(nodes, "Doctor, knee check-up")!)!;
    expect(line.style).toMatchObject({ borderRightWidth: 2, borderRightColor: "#0a0a0a", paddingRight: 10 });
    expect(texts(walk(line))).toEqual(["You shared Mom's", "Doctor, knee check-up", "from Plan Ease · Event", "Open in Plan Ease", "Stop sharing"]);
    expect(textNode(nodes, "To Rohan")?.style).toMatchObject({ fontFamily: FACE.semibold, fontSize: 12, lineHeight: 16, color: "#8a8a8a" });
    expect(parentOf(s.root!, parentOf(s.root!, textNode(nodes, "To Rohan")!)!)!.style).toMatchObject({ paddingRight: 12 });
    expect(opens(s.root!)).toBe(true);
  });

  it("each of their messages carries their name, a run of them too (no faces to say who); yours carry none", async () => {
    const at = D.FEED.messages[0]!.at;
    const run = {
      ...D.FEED,
      messages: [
        { id: "r1", at, from: { userId: "m", name: "Mom", you: false }, to: null, text: "Dinner at 8?", files: [], thing: null, item: null },
        { id: "r2", at: at + 60_000, from: { userId: "m", name: "Mom", you: false }, to: null, text: "Bring the dahi", files: [], thing: null, item: null },
        { id: "r3", at: at + 120_000, from: { userId: "u", name: "Aanya", you: true }, to: null, text: "On it", files: [], thing: null, item: null },
        { id: "r4", at: at + 180_000, from: { userId: "u", name: "Aanya", you: true }, to: null, text: "Eggless?", files: [], thing: null, item: null },
      ],
    };
    for (const client of ["phone", "desktop"] as const) {
      const { nodes } = await build("bots.spaces", client, { params: { id: "s1" }, api: { ...(await sampleApi()), ...D.spacesApi(), [`GET ${A}/spaces/s1/feed`]: run } });
      const names = nodes.filter((n) => n.type === "Text" && n.props?.content === "Mom" && n.style?.color === "#8a8a8a");
      expect(names, client).toHaveLength(2);
      expect(texts(nodes)).not.toContain("Aanya");
    }
  });

  it("a group chat on a build with the new Spaces names every message of theirs, as the feed does; an older build the first of a run", async () => {
    const twice = {
      ...(D.spacesApi()[`GET ${A}/threads/th-home`] as { messages: Array<Record<string, unknown>> }),
    };
    const first = twice.messages.find((m) => !(m.from as { you: boolean }).you)!;
    const thread = { ...twice, messages: [first, { ...first, id: "again", at: Number(first.at) + 60_000, text: "And the dahi" }] };
    const api = { ...(await sampleApi()), ...D.spacesApi(), [`GET ${A}/threads/th-home`]: thread };
    const who = String((first.from as { name: string }).name);
    const fresh = await build("bots.thread", "phone", { params: { id: "th-home" }, api });
    expect(texts(fresh.nodes).filter((t) => t === who)).toHaveLength(2);
    const old = await build("bots.thread", "phone", { params: { id: "th-home" }, api, can: OLD });
    expect(texts(old.nodes).filter((t) => t === who)).toHaveLength(1);
  });

  it("without FontBricolage: Geist in the same place; without PersonBot: no bot in the \"@\" list", async () => {
    const { nodes } = await build("bots.spaces", "phone", { params: { id: "s1" }, can: canOf("phone", [...SPACES2, "PersonBot"]) });
    expect(textNode(nodes, "Dinner at 8? Bring the dahi")!.style).toMatchObject({ fontFamily: FACE.regular, fontSize: 16, lineHeight: 23 });
    expect(nodes.some((n) => /Bricolage/.test(String(n.style?.fontFamily ?? "")))).toBe(false);
    const quiet = await build("bots.spaces", "phone", { params: { id: "s1" }, can: canOf("phone", [...SPACES2, "FontBricolage"]) });
    expect(ofType(quiet.nodes, "MentionField")[0]!.props!.people).toEqual([{ id: "m", name: "Mom" }, { id: "r", name: "Rohan" }]);
  });

  it("a chat reads the same way for a build with the new Spaces; an older build keeps today's chat", async () => {
    for (const client of ["phone", "desktop"] as const) {
      // The server sends a group's people with their bots, as their space has them (threads.ts read).
      const base = D.spacesApi()[`GET ${A}/threads/th-home`] as { thread: { people: Array<{ userId: string }> } };
      const withLooks = { ...base, thread: { ...base.thread, people: base.thread.people.map((p) => ({ ...p, bot: p.userId === "u" ? ME : D.LOOK[p.userId as "m" | "r"] })) } };
      const fresh = await build("bots.thread", client, { params: { id: "th-home" }, api: { ...(await sampleApi()), ...D.spacesApi(), [`GET ${A}/threads/th-home`]: withLooks } });
      const words = textNode(fresh.nodes, "That one. Eggless please!")!;
      expect(words.style).toMatchObject({ fontFamily: "Tailzu Bricolage", color: C.ink });
      const mine = parentOf(fresh.s.root!, words)!;
      expect(mine.style, client).toMatchObject({ borderRightWidth: 2, borderRightColor: "#0a0a0a", paddingRight: 10 });
      expect(noBox(mine)).toBe(true);
      const theirs = parentOf(fresh.s.root!, textNode(fresh.nodes, "Dinner at 8, everyone home?")!)!;
      expect(theirs.style, client).toMatchObject({ borderLeftWidth: 2, borderLeftColor: D.LOOK.m.color, paddingLeft: 10 });
      expect(noBox(theirs)).toBe(true);
      // Their name over theirs, set in to sit over the words; a shared list by the same line, with no box of its own.
      const name = fresh.nodes.find((n) => n.type === "Text" && n.props?.content === "Mom" && n.style?.color === "#8a8a8a")!;
      expect(parentOf(fresh.s.root!, name)!.style).toMatchObject({ paddingLeft: 12 });
      const list = walk(fresh.s.root!).find((n) => n.on?.onPress && walk(n).includes(textNode(fresh.nodes, "Groceries")!))!;
      expect(noBox(list)).toBe(true);
      // A sender the answer has no bot for: the colour their id always has.
      const bare = await build("bots.thread", client, { params: { id: "th-home" } });
      expect(parentOf(bare.s.root!, textNode(bare.nodes, "Dinner at 8, everyone home?")!)!.style).toMatchObject({ borderLeftColor: P.lookOf("m").color });
    }
    const old = await build("bots.thread", "phone", { params: { id: "th-home" }, can: OLD });
    const oldWords = textNode(old.nodes, "That one. Eggless please!")!;
    expect(oldWords.style).toMatchObject({ fontFamily: FACE.regular, color: C.paper });
    expect(parentOf(old.s.root!, oldWords)!.style).toMatchObject({ backgroundColor: C.ink });
    expect(old.nodes.some((n) => n.style?.borderLeftWidth || n.style?.borderRightWidth)).toBe(false);
    // An older build's shared list keeps its white card with a line round it.
    const oldList = walk(old.s.root!).find((n) => n.on?.onPress && walk(n).includes(textNode(old.nodes, "Groceries")!))!;
    expect(oldList.style).toMatchObject({ borderWidth: 1, backgroundColor: C.paper });
  });
});

describe("Home's one Space card", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`on the ${client}: one "Space", however many spaces, with their newest thing; a tap opens Your spaces`, async () => {
      const calls: Array<{ method: string; path: string }> = [];
      const { nodes } = await build("bots.home", client, { calls });
      expect(calls.map((c) => c.path)).toContain(`${A}/spaces?last=1`);
      const tiles = ofType(nodes, "BotTiles")[0]!.props!.tiles as Array<{ slug: string; name: string; sub: string; state: string; action: unknown }>;
      const space = tiles.filter((t) => t.name === "Space");
      expect(space).toHaveLength(1);
      expect(tiles.some((t) => t.slug.startsWith("space-"))).toBe(false);
      // A payment waits in Home: that first.
      expect(space[0]).toMatchObject({ slug: "spaces", sub: "1 payment needs your yes", state: "needs", action: { kind: "navigate", screenId: "bots.spaces" } });
      expect((space[0]!.action as { params?: Record<string, unknown> }).params ?? {}).toEqual({});
      // Nothing waiting: the newest line across the spaces.
      const calm = { [`GET ${A}/spaces?last=1`]: { you: "Aanya S.", unread: 3, spaces: D.FULL_JOINED.spaces.map((s) => ({ ...s, waiting: 0 })) } };
      const quiet = await build("bots.home", client, { api: { ...(await sampleApi()), ...D.spacesApi(), ...calm } });
      const t2 = (ofType(quiet.nodes, "BotTiles")[0]!.props!.tiles as Array<{ name: string; sub: string; state: string }>).find((t) => t.name === "Space")!;
      expect(t2).toMatchObject({ sub: "Mom: Dinner at 8? Bring the dahi", state: "idle" });
      // One space: the same one card, "Space" (never the space's own name), with its newest line, else who is in it.
      const one = (spaces: unknown[]) => ({ ...(D.spacesApi()), [`GET ${A}/spaces?last=1`]: { you: "Aanya S.", unread: 0, spaces } });
      const solo = D.FULL_JOINED.spaces[0]!;
      for (const [space, line] of [
        [{ ...solo, waiting: 0 }, "Mom: Dinner at 8? Bring the dahi"],
        [{ ...solo, waiting: 0, last: null }, "You, Mom and Rohan"],
      ] as const) {
        const home = await build("bots.home", client, { api: { ...(await sampleApi()), ...one([space]) } });
        const ts = ofType(home.nodes, "BotTiles")[0]!.props!.tiles as Array<{ slug: string; name: string; sub: string }>;
        expect(ts.filter((t) => t.slug === "spaces" || t.slug.startsWith("space-")).map((t) => [t.name, t.sub]), client).toEqual([["Space", line]]);
      }
      // In no space: no card.
      const none = await build("bots.home", client, { api: { ...(await sampleApi()), ...D.spacesApi(), [`GET ${A}/spaces?last=1`]: { you: "Aanya S.", unread: 0, spaces: [] } } });
      expect((ofType(none.nodes, "BotTiles")[0]!.props!.tiles as Array<{ name: string }>).some((t) => t.name === "Space")).toBe(false);
    });
  }

  it("an older build keeps a tile per group, from the cheap list", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const { nodes } = await build("bots.home", "phone", { can: ["BotsKit", "BotsMotion", "BotMoments"], calls });
    expect(calls.map((c) => c.path)).toContain(`${A}/spaces`);
    expect(calls.map((c) => c.path)).not.toContain(`${A}/spaces?last=1`);
    const tiles = ofType(nodes, "BotTiles")[0]!.props!.tiles as Array<{ slug: string; name: string }>;
    expect(tiles.filter((t) => t.slug.startsWith("space-")).map((t) => t.name)).toEqual(["Home", "Studio"]);
    expect(tiles.some((t) => t.name === "Space")).toBe(false);
  });
});
