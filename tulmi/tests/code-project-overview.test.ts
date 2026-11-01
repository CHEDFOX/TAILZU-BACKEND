/**
 * THE PROJECT'S OVERVIEW (code/project/overview.ts): what kind of application it is, what it does, its parts and flows; written on the first
 * read, tuned only when the project has moved far enough from what it was written from, the owner's new words at once.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

import {
  basisOf, checkedOverview, commitsSince, driftOf, fallbackOverview, kindsOf, overviewDue, overviewFacts, overviewLines, ownUsed, ownWords, namesIn, readmeAge,
  trajectoryOf, tuneOverview, upkeep, focusOf, TUNE_AT, TUNE_GAP_MS, type Overview, type OverviewInput,
} from "../src/code/project/overview.js";
import { EMPTY_STRUCTURE, type Feature, type Structure } from "../src/code/project/types.js";
import { Meter } from "../src/code/project/summarize.js";
import { bookCard, buildBook } from "../src/code/project/book.js";
const { built, projectRig } = await import("./project-rig.js");

const structure = (o: Partial<Structure> = {}): Structure => ({ ...EMPTY_STRUCTURE, fileCount: 200, ...o } as Structure);
const feature = (name: string, files: string[], o: Partial<Feature> = {}): Feature => ({ key: name.toLowerCase(), name, summary: `What ${name} does.`, files, fileCount: files.length, routes: [], texts: [], ...o });
const input = (o: Partial<OverviewInput> = {}): OverviewInput => ({
  name: "acme/shop", structure: structure({ frameworks: ["Fastify", "React"], entryPoints: [{ path: "server/index.ts", why: "conventional entry file" }], readme: { path: "README.md", title: "Acme", blurb: "A shop." } }),
  features: [feature("Orders", ["server/orders.ts", "server/index.ts"], { routes: ["POST /orders", "GET /orders", "GET /orders/:id"] }), feature("Web", ["web/App.tsx", "web/Cart.tsx"])],
  paths: ["server/index.ts", "server/orders.ts", "web/App.tsx", "web/Cart.tsx", "README.md"], history: [], messages: ["Add cart"], owner: null, ...o,
});
const written = (i: OverviewInput, at = 0, o: Partial<Overview> = {}): Overview => ({
  essence: "Acme: a shop that takes orders for its own bread.", kind: "a web service and its web app", what: "A shop.", parts: [{ name: "Orders", does: "Takes orders.", start: "server/orders.ts" }, { name: "Web", does: "The shop in the browser.", start: "web/App.tsx" }],
  flows: [], direction: "", via: "model", at, commit: "c0", basis: basisOf(i), earlier: [], ...o,
});

describe("what kind of application it is, by code", () => {
  it("reads the kinds from what the code says: a server framework and routes, a phone or desktop framework, a bin, a Worker", () => {
    expect(kindsOf(input()).map((k) => k.id)).toEqual(["service", "webapp"]);
    expect(kindsOf(input()).find((k) => k.id === "service")!.why).toBe("Fastify, 3 routes");
    const phone = input({ structure: structure({ frameworks: ["Expo", "React Native", "React"] }), features: [], paths: ["App.tsx"] });
    expect(kindsOf(phone).map((k) => k.id)).toEqual(["mobile"]);
    expect(kindsOf(input({ structure: structure({ frameworks: ["Electron"] }), features: [], paths: ["main.js"] })).map((k) => k.id)).toEqual(["desktop"]);
    expect(kindsOf(input({ structure: structure({ frameworks: ["Next.js", "React"] }), features: [], paths: ["app/page.tsx"] })).map((k) => k.id)).toEqual(["fullstack"]);
    const cli = input({ structure: structure({ core: { "package.json": { kind: "npm", sha: "s", data: { bin: ["cli.js"] } } } as never }), features: [], paths: ["cli.js"] });
    expect(kindsOf(cli).map((k) => k.id)).toEqual(["cli"]);
    expect(kindsOf(input({ structure: structure(), features: [], paths: ["src/index.ts", "wrangler.toml"] })).map((k) => k.id)).toEqual(["edge"]);
    const lib = input({ structure: structure({ core: { "package.json": { kind: "npm", sha: "s", data: { main: "dist/index.js" } } } as never }), features: [], paths: ["src/index.ts"] });
    expect(kindsOf(lib).map((k) => k.id)).toEqual(["library"]);
  });
});

describe("how far the project has moved from what its overview says", () => {
  const i = input();
  it("is nothing when nothing that matters moved", () => {
    expect(driftOf(written(i), basisOf(i), 3)).toEqual({ score: 0, reasons: [] });
    expect(overviewDue(written(i), basisOf(i), 3, TUNE_GAP_MS * 2, true)).toBeNull();
  });

  it("is a change of course when a new kind of application appears, the owner says something new, or the README does", () => {
    const phone = input({ structure: structure({ ...i.structure, frameworks: ["Fastify", "React", "Expo", "React Native"] }) });
    const d = driftOf(written(i), basisOf(phone), 0);
    expect(d.score).toBeGreaterThanOrEqual(TUNE_AT);
    expect(d.reasons).toEqual(expect.arrayContaining(["it is now also a phone app"]));
    const owner = input({ owner: { for: "A marketplace for many bakeries.", at: 5 } });
    expect(driftOf(written(i), basisOf(owner), 0).reasons).toContain("the owner said what it is or where it goes");
    const readme = input({ structure: structure({ ...i.structure, readme: { path: "README.md", title: "Acme", blurb: "A marketplace." } }) });
    expect(driftOf(written(i), basisOf(readme), 0)).toEqual({ score: 1, reasons: ["its README or manifest says something new about what it is"] });
  });

  it("sees a direction taking shape: a new part that grows, and the latest work landing where the overview says nothing", () => {
    const bots = Array.from({ length: 30 }, (_, k) => `bots/b${k}.ts`);
    const now = input({ features: [...i.features, feature("Bots", bots)], history: Array.from({ length: 20 }, (_, k) => ({ sha: `s${k}`, at: k, files: [bots[k]!] })) });
    const d = driftOf(written(i), basisOf(now), 20);
    expect(d.reasons).toEqual(expect.arrayContaining(["new parts: bots (30 files)", "the latest work is mostly in bots, which the overview does not cover"]));
    expect(d.score).toBeGreaterThanOrEqual(TUNE_AT);
    // A small new part alone is not yet enough: it adds up across builds, because the basis stays the one it was written from.
    const small = input({ features: [...i.features, feature("Docs", ["docs/a.md", "docs/b.md"])] });
    expect(driftOf(written(i), basisOf(small), 0).score).toBeLessThan(TUNE_AT);
    const bigger = input({ features: [...i.features, feature("Docs", Array.from({ length: 80 }, (_, k) => `docs/${k}.md`))] });
    expect(driftOf(written(i), basisOf(bigger), 0).score).toBeGreaterThanOrEqual(TUNE_AT);
  });

  it("is tuned at most once in a while, except when the owner speaks; written when there is none or only the code's own", () => {
    const moved = basisOf(input({ structure: structure({ ...i.structure, frameworks: ["Fastify", "React", "Expo"] }) }));
    expect(overviewDue(written(i, 1000), moved, 0, 1000 + TUNE_GAP_MS - 1, true)).toBeNull();
    expect(overviewDue(written(i, 1000), moved, 0, 1000 + TUNE_GAP_MS, true)).toEqual(expect.arrayContaining(["it is now also a phone app"]));
    const owner = basisOf(input({ owner: { next: "Bots for everyone.", at: 2000 } }));
    expect(overviewDue(written(i, 1000), owner, 0, 1001, true)).toEqual(["the owner said what it is or where it goes"]);
    expect(overviewDue(null, basisOf(i), 0, 0, false)).toEqual(["first read"]);
    expect(overviewDue(written(i, 0, { via: "code" }), basisOf(i), 0, 1, true)).toEqual(["the overview was the code's own, written with no model"]);
    expect(overviewDue(written(i, 0, { via: "code" }), basisOf(i), 0, 1, false)).toBeNull();
    expect(commitsSince(written(i), [{ sha: "n2", at: 2, files: [] }, { sha: "n1", at: 1, files: [] }, { sha: "c0", at: 0, files: [] }])).toBe(2);
  });
});

describe("the overview, checked and shown", () => {
  it("keeps each part's file only when the project has it: a bare name or a folder is put right, a made-up one is dropped", () => {
    const c = checkedOverview({
      kind: "a web service", what: "A shop.", flows: ["An order goes to Orders.", ""], direction: "",
      parts: [{ name: "Orders", does: "Takes orders.", start: "orders.ts:12" }, { name: "Server", does: "Starts it.", start: "server/" }, { name: "Ghost", does: "Nothing.", start: "src/ghost.ts" }, { name: "", does: "x", start: "" }],
    }, input().paths);
    expect(c!.parts).toEqual([{ name: "Orders", does: "Takes orders.", start: "server/orders.ts" }, { name: "Server", does: "Starts it.", start: "server/index.ts" }, { name: "Ghost", does: "Nothing.", start: "" }]);
    expect(c!.flows).toEqual(["An order goes to Orders."]);
    expect(checkedOverview({ kind: "", what: "", parts: [], flows: [], direction: "" }, [])).toBeNull();
    expect(checkedOverview({ kind: "k", what: "w", parts: [], flows: [], direction: "with before: it was a shop; it is a marketplace." }, [])!.direction).toBe("It was a shop; it is a marketplace.");
  });

  it("with no model, is the code's own: the kinds, the README's words, the parts the index named", () => {
    const f = fallbackOverview(input(), basisOf(input()), "c1", 9);
    expect(f).toMatchObject({ kind: "a web service (an HTTP API), and a web app in the browser", what: "A shop.", via: "code", commit: "c1" });
    expect(f.parts[0]).toEqual({ name: "Orders", does: "What Orders does.", start: "server/index.ts" });
    expect(overviewLines(written(input(), 0, { flows: ["An order: Web posts it, Orders saves it."], direction: "It was a shop; it is now a marketplace." }))).toEqual([
      "- Acme: a shop that takes orders for its own bread.", "- A web service and its web app. A shop.", "- Orders: Takes orders. (starts at server/orders.ts)", "- Web: The shop in the browser. (starts at web/App.tsx)",
      "- How it flows: An order: Web posts it, Orders saves it.", "- How its course changed: It was a shop; it is now a marketplace.",
    ]);
  });
});

describe("tuning, not writing afresh", () => {
  const ctxWith = (answer: unknown, sent: string[]) => ({
    userId: "alice", meter: new Meter(100),
    call: (async (c: { messages: Array<{ role: string; content: unknown }> }) => { sent.push(String(c.messages.at(-1)!.content)); return { json: answer, text: JSON.stringify(answer), paise: 2, model: "m", toolCalls: [] }; }) as never,
  });

  it("gives the model the overview as it was and what moved; keeps the old one; says how the course changed when the kind did", async () => {
    const i = input();
    const prior = written(i, 10);
    const now = input({ structure: structure({ ...i.structure, frameworks: ["Fastify", "React", "Expo"] }) });
    const sent: string[] = [];
    const answer = { essence: "Acme: Orders and Web, now on phones too.", kind: "a web service, its web app and a phone app", what: "A shop people order from in the browser or on their phones.", parts: [{ name: "Orders", does: "Takes orders.", start: "server/orders.ts" }], flows: [], direction: "" };
    const o = await tuneOverview(ctxWith(answer, sent) as never, now, prior, ["it is now also a phone app"], "c9", 99, 100);
    expect(sent[0]).toContain("<before>");
    expect(sent[0]).toContain('"what":"A shop."');
    expect(sent[0]).toContain("<changed>\n- it is now also a phone app\n</changed>");
    expect(sent[0]).toContain("kind signal: a phone app (Expo)");
    expect(o).toMatchObject({ kind: answer.kind, via: "model", commit: "c9", at: 99, direction: "It was a web service and its web app; it is now a web service, its web app and a phone app." });
    expect(o.earlier).toEqual([{ at: 10, commit: "c0", kind: "a web service and its web app", what: "A shop.", essence: "Acme: a shop that takes orders for its own bread." }]);
    expect(o.basis.kinds).toContain("mobile");
  });

  it("keeps the overview as it was when no answer comes, and writes the code's own when there is none", async () => {
    const i = input();
    const down = { userId: "alice", meter: new Meter(100), call: (async () => { throw new Error("down"); }) as never };
    const prior = written(i, 10);
    expect(await tuneOverview(down as never, i, prior, ["x"], "c9", 99, 100)).toBe(prior);
    expect((await tuneOverview(down as never, i, null, ["first read"], "c9", 99, 100)).via).toBe("code");
  });
});

describe("the book and the card lead with it", () => {
  it("says what kind of app, what it does, its parts, how they flow, how its course changed and what it was", () => {
    const i = input();
    const ov = written(i, Date.UTC(2026, 10, 1), {
      flows: ["An order: Web posts it, Orders saves it."], direction: "It was a shop; it is now a marketplace.",
      earlier: [{ at: Date.UTC(2026, 9, 1), commit: "abcdef1", kind: "a web app", what: "A shop." }],
    });
    const book = buildBook({
      project: "acme/shop", commit: "c1", now: Date.UTC(2026, 10, 2), view: { welcome: "Welcome words.", structure: i.structure, features: i.features, conventions: null, baseline: null } as never,
      files: [], map: null, commits: null, history: [], merged: null, open: null, issues: null, milestones: null, docs: {}, owner: { for: "A marketplace for bakeries.", at: 5 }, overview: ov,
    });
    const card = bookCard(book);
    expect(card.indexOf("(the owner) A marketplace for bakeries.")).toBeLessThan(card.indexOf("## What it is (the project's overview)"));
    expect(card).toContain("## What it is (the project's overview)\n- Acme: a shop that takes orders for its own bread.\n- A web service and its web app. A shop.\n- Orders: Takes orders. (starts at server/orders.ts)");
    expect(card).not.toContain("Welcome words.");
    expect(card).not.toContain("What Orders does.");
    const facts = book.facts.map((f) => `${f.chapter}: ${f.text}`);
    expect(facts).toEqual(expect.arrayContaining([
      "build: How it flows: An order: Web posts it, Orders saves it.", "direction: Its course changed: It was a shop; it is now a marketplace.",
      "direction: Until 2026-10-01 it was: a web app. A shop.",
      "what: Acme: a shop that takes orders for its own bread.",
    ]));
  });
});

describe("in a build", () => {
  it("is written on the first read, kept through small pushes, and tuned at once when the owner says where it goes", async () => {
    const r = await projectRig();
    await built(r);
    expect(r.model.of("brain.overview")).toHaveLength(1);
    const first = (await r.brainStore.getBrain(r.projectId))!.book!.overview!;
    expect(first).toMatchObject({ via: "model", kind: "a web service (an HTTP API) and the web app it serves" });
    expect(first.parts.map((p) => p.start)).toEqual(["src/lib/api.ts", "src/app/page.tsx"]);
    const handle = await r.code.brain!.open(r.user, r.projectId);
    expect(bookCard((await handle.book())!)).toContain("## What it is (the project's overview)\n- Acme Shop: a shop whose web app and API sell its own goods, signups and settings included.\n- A web service (an HTTP API) and the web app it serves.");

    // A small push: nothing that matters moved, no call.
    r.repo.commit({ "src/lib/util.ts": "export const add = (a: number, b: number) => a + b;\n" }, "tidy");
    await built(r, "incremental");
    expect(r.model.of("brain.overview")).toHaveLength(1);

    // The owner says where it is going: tuned now, told what it was and why.
    r.model.overview = { essence: "Acme Shop, becoming a marketplace: many shops sell through one API and web app.", kind: "a marketplace's web service and web app", what: "A marketplace where many shops sell.", parts: [{ name: "API", does: "Serves every shop's data.", start: "src/lib/api.ts" }], flows: [], direction: "It was one shop; it is becoming a marketplace." };
    await handle.answerBook({ for: "A marketplace where many shops sell, not one shop.", next: "Shops sign up themselves." });
    await vi.waitFor(async () => expect((await r.brainStore.getBrain(r.projectId))!.book!.overview!.kind).toBe("a marketplace's web service and web app"));
    expect(r.model.of("brain.overview")).toHaveLength(2);
    expect(r.model.sent.at(-1)).toContain("<changed>\n- the owner said what it is or where it goes\n</changed>");
    const tuned = (await r.brainStore.getBrain(r.projectId))!.book!;
    expect(tuned.owner!.for).toBe("A marketplace where many shops sell, not one shop.");
    expect(tuned.overview!.earlier[0]!.kind).toBe("a web service (an HTTP API) and the web app it serves");
    expect(bookCard((await handle.book())!)).toContain("How its course changed: It was one shop; it is becoming a marketplace.");
  });

  it("with no money for models, is the code's own, and a later build with money writes it", async () => {
    const r = await projectRig({ budgetPaise: 0 });
    await built(r);
    expect(r.model.of("brain.overview")).toHaveLength(0);
    expect((await r.brainStore.getBrain(r.projectId))!.book!.overview!.via).toBe("code");
  });
});

describe("what the code and its history show it really is", () => {
  const parts = [feature("Speech", ["speech/a.ts", "speech/b.ts"]), feature("Keyboard", ["kb/a.ts"]), feature("Xode", ["code/a.ts", "code/b.ts"]), feature("Bots", ["bots/a.ts"])];
  const commit = (k: number, files: string[]) => ({ sha: `s${k}`, at: 1000 - k, files });
  // Newest first: the latest work is in Xode and Bots; before it, in Speech and Keyboard.
  const history = [
    ...Array.from({ length: 20 }, (_, k) => commit(k, k % 4 === 0 ? ["bots/a.ts"] : ["code/a.ts"])),
    ...Array.from({ length: 20 }, (_, k) => commit(20 + k, k % 2 ? ["speech/a.ts"] : k === 0 ? ["kb/a.ts", "code/b.ts"] : ["kb/a.ts"])),
  ];

  it("reads where the work went: what rose, what is new, what faded, from the commits, not from anyone's words", () => {
    const t = trajectoryOf(parts, history);
    expect(t.recent.map((x) => x.part)).toEqual(["Xode", "Bots"]);
    expect(t.recent[0]!.share).toBe(0.75);
    expect(t.rising).toEqual(["Xode"]);
    expect(t.fresh).toEqual(["Bots"]);
    expect(t.fading.sort()).toEqual(["Keyboard", "Speech"]);
    // Too little history before says nothing of a change.
    expect(trajectoryOf(parts, history.slice(0, 12))).toMatchObject({ rising: [], fresh: [], fading: [] });
  });

  it("finds the names the product goes by on its own screens, not the first word of a sentence or a word of the trade", () => {
    const texts = [
      "You've used what X0 Bot may spend today.", "Ask X0 Bot anything.", "Connect GitHub so X0 Bot can read your code.", "Xode opened a pull request.",
      "Let Xode fix it.", "Start with Xode now.", "Settings", "Delete the API key?", "Open the URL in a browser.", "Open the URL again.", "Open the URL.",
    ].map((text) => ({ text, kind: "jsx" }));
    expect(namesIn([...texts, { text: "label.x: Ask X0 Bot now", kind: "i18n" }, { text: "X0_BOT_KEY: an environment setting", kind: "setting" }])).toEqual([{ name: "X0 Bot", count: 4 }, { name: "Xode", count: 3 }]);
    // A table of proper nouns is data, not the product talking: no names from it.
    expect(namesIn(["Falkland Islands", "Cayman Islands", "Cook Islands", "Faroe Islands"].map((text) => ({ text, kind: "i18n" })))).toEqual([]);
  });

  it("says where each name is said most, and when the screens call the product something its README does not", () => {
    const texts = [
      ...Array.from({ length: 12 }, () => ({ text: "Ask X0 Bot anything you like.", kind: "jsx", path: "web/App.tsx" })),
      ...Array.from({ length: 3 }, () => ({ text: "Let Xode open a pull request.", kind: "jsx", path: "server/orders.ts" })),
    ];
    const facts = overviewFacts(input({ texts }));
    expect(facts).toContain("names its own screens and messages use most (what its people call it, and the services it names): X0 Bot (12, mostly in Web), Xode (3, mostly in Orders)");
    expect(facts).toContain("its own screens call it X0 Bot; its README or folders call it Acme: what its people see is its name now");
  });

  it("knows a README the work has left behind: changed long ago, and the work since went where it says nothing", () => {
    const i = input({ features: parts, history: [...history, commit(99, ["README.md"])], structure: structure({ readme: { path: "README.md", title: "Tailzu", blurb: "A voice keyboard: speak and Speech turns it into text." } }) });
    expect(readmeAge(i)).toEqual({ since: 40, away: ["Xode", "Bots"] });
    expect(overviewFacts(i)).toContain("readme last changed: 40 commits ago; most of the work since went to Xode, Bots, which it does not name: it may be out of date");
    expect(overviewFacts(i)).toMatch(/where the latest work went \(21 commits\): Xode 7\d%, Bots 2\d%/);
    expect(overviewFacts(i)).toMatch(/(?:rising|new): Xode/);
    expect(overviewFacts(i)).toContain("fading: Speech, Keyboard");
  });

  it("asks once more when the overview could be said of any project of its kind, naming the project's own words", async () => {
    const i = input({ texts: Array.from({ length: 3 }, () => ({ text: "Ask Acme Bakery for bread.", kind: "jsx" })) });
    const answers = [
      { essence: "A full-stack web application with a backend API and a frontend.", kind: "a web service", what: "It lets users manage data through an API.", parts: [], flows: [], direction: "" },
      { essence: "Acme Bakery: Orders takes bread orders for pickup, and Web is where people place them.", kind: "a web service", what: "People order bread from Acme Bakery.", parts: [], flows: [], direction: "" },
    ];
    const sent: string[] = [];
    let n = 0;
    const ctx = { userId: "alice", meter: new Meter(100), call: (async (c: { messages: Array<{ content: unknown }> }) => { sent.push(String(c.messages.at(-1)!.content)); const a = answers[Math.min(n++, 1)]; return { json: a, text: JSON.stringify(a), paise: 2, model: "m", toolCalls: [] }; }) as never };
    const o = await tuneOverview(ctx as never, i, null, ["first read"], "c1", 1, 100);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/That says what any project of its kind is\. Say what this one really is, in its own words \(.*bakery.*\)/);
    expect(o.essence).toBe("Acme Bakery: Orders takes bread orders for pickup, and Web is where people place them.");
    expect(ownUsed({ essence: answers[0]!.essence, what: answers[0]!.what }, ownWords(i))).toEqual([]);
  });

  it("sees a rename on its own screens and the work moving to another part as a change of course", () => {
    const i = input({ texts: Array.from({ length: 3 }, () => ({ text: "Ask Tailzu anything.", kind: "jsx" })) });
    const renamed = input({ texts: Array.from({ length: 3 }, () => ({ text: "Ask X0 Bot anything.", kind: "jsx" })) });
    expect(driftOf(written(i), basisOf(renamed), 0).reasons).toContain("its screens now call it X0 Bot (they called it Tailzu)");
  });
});

describe("telling a name from a word, and upkeep from direction", () => {
  it("drops a word the texts mostly write in lower case, and a message's code before its words", () => {
    const texts = [
      ...Array.from({ length: 5 }, () => ({ text: "rate limited: That is too fast. Wait for that minute.", kind: "message" })),
      ...Array.from({ length: 3 }, () => ({ text: "Ask X0 Bot, and say That aloud", kind: "jsx" })),
      ...Array.from({ length: 4 }, () => ({ text: "daily limit: You've used what X0 Bot may spend.", kind: "message" })),
      { text: "you can do that, and that, and that", kind: "jsx" },
    ];
    expect(namesIn(texts)).toEqual([{ name: "X0 Bot", count: 7 }]);
  });

  it("does not take work on CI, docs, translations or tests for where the project is heading", () => {
    const ci = feature("GitHub Automation", [".github/workflows/ci.yml", ".github/workflows/release.yml", "scripts/check.sh"]);
    const docs = feature("Docs", ["docs/a.md", "docs/b.md"]);
    const app = feature("Checkout", ["src/checkout.ts", "src/cart.ts"]);
    expect([ci, docs, app].map(upkeep)).toEqual([true, true, false]);
    const history = Array.from({ length: 30 }, (_, k) => ({ sha: `s${k}`, at: k, files: k % 5 ? [".github/workflows/ci.yml"] : ["src/cart.ts"] }));
    expect(focusOf([ci, docs, app], history)).toEqual(["checkout"]);
    expect(trajectoryOf([ci, docs, app], history).recent.map((x) => x.part)).toEqual(["Checkout"]);
  });
});
