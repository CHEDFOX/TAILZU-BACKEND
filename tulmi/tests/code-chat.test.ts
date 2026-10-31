/**
 * TALKING ABOUT CODE (src/code/chat, docs/code-chat.md): the brain first, a few reads only when it must, every claim with path:line.
 *
 *   - a question the project's index can answer is answered from the index: the model is sent FACTS, no file is read, the citations that stay are the ones seen
 *   - otherwise only the located spans are read (3 files, 5,000 characters at most), never a secret file, never one nothing pointed at
 *   - a citation that does not resolve (a file that is not there, a line past the end) is taken out, and the notes say so
 *   - a flow is drawn from the import graph by code, with no model and no cost
 *   - a follow-up is looked up together with the question before it, and the model is shown the thread's short summary as data
 *   - "ok, change it" starts a job with the place the conversation found, and the agent does not look for it again
 *   - cheap by default; strong only for a deep why or an impact question
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, APP_FILES, APP_FEATURES } = await import("./agent-rig.js");
const { route, sym } = await import("./work-fixtures.js");
const chatMod = await import("../src/code/chat/index.js");
const { defaultHandlers } = await import("../src/front/handlers.js");
const { stableBlock } = await import("../src/principles/roles.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;
type Row = import("./work-fixtures.js").FileSpec;

const LOGIN = 'import { startSession } from "../auth/session";\nimport { hash } from "../auth/hash";\n\nexport async function login(req, res) {\n  const user = await find(req.body.email);\n  if (!hash.verify(req.body.password, user.pw)) return res.status(401);\n  await startSession(res, user.id);\n}\n';
const SESSION = 'import { sign } from "./token";\n\nexport function startSession(res, userId) {\n  const token = sign({ sub: userId });\n  res.cookie("sid", token, { httpOnly: true, sameSite: "lax" });\n}\n\nexport function endSession(res) {\n  res.clearCookie("sid");\n}\n';
const FILES: Record<string, string> = {
  ...APP_FILES,
  "src/routes/login.ts": LOGIN,
  "src/routes/logout.ts": 'import { endSession } from "../auth/session";\n\nexport async function logout(req, res) {\n  endSession(res);\n}\n',
  "src/auth/session.ts": SESSION,
  "src/auth/hash.ts": 'export const hash = { verify: (a: string, b: string) => a === b };\n',
  "src/auth/token.ts": 'export function sign(claims: object) {\n  return JSON.stringify(claims);\n}\n',
  ".env": "SESSION_SECRET=abc123\n",
};
const ROWS: Row[] = [
  { path: "src/util.ts", symbols: [sym("slug")], tests: ["src/util.test.ts"], summary: "String helpers: slug turns a title into a URL slug.", rank: 0.3 },
  { path: "src/routes/login.ts", imports: ["src/auth/session.ts", "src/auth/hash.ts"], symbols: [sym("login", "function", 4), route("POST", "/login", 4)], summary: "The login route: checks the password and starts a session.", rank: 0.9 },
  { path: "src/routes/logout.ts", imports: ["src/auth/session.ts"], symbols: [sym("logout", "function", 3), route("POST", "/logout", 3)], summary: "The logout route: ends the session.", rank: 0.6 },
  { path: "src/auth/session.ts", imports: ["src/auth/token.ts"], symbols: [sym("startSession", "function", 3), sym("endSession", "function", 8)], summary: "Starts and ends a session: sets and clears the sid cookie.", rank: 0.8, tests: [] },
  { path: "src/auth/hash.ts", symbols: [sym("hash", "const", 1)], summary: "Password hashing and checking.", rank: 0.4 },
  { path: "src/auth/token.ts", symbols: [sym("sign", "function", 1)], summary: "Signs the session token.", rank: 0.4 },
  { path: ".env", summary: "Secrets.", rank: 0.1 },
];
const FEATURES = [
  ...APP_FEATURES,
  { name: "Login", summary: "Signing in and out with an email and password.", files: ["src/routes/login.ts", "src/routes/logout.ts", "src/auth/session.ts", "src/auth/hash.ts", "src/auth/token.ts"], fileCount: 5, routes: [], texts: [] },
];

beforeEach(() => { resetSettingsStoreForTests(); });

async function chatRig(over: { rooms?: Parameters<typeof chatMod.CodeChat.prototype.answer> extends never ? never : unknown; personal?: (userId: string, about: string) => Promise<string[]> } = {}) {
  const a = await agentRig({ files: FILES, rows: ROWS, features: FEATURES });
  const threads = new chatMod.MemoryThreadStore();
  const chat = new chatMod.CodeChat({ projects: a.d, brain: { open: async () => a.fixture.brain } as never, call: a.model.call as never, threads, now: () => a.now(), ...(over.rooms ? { rooms: over.rooms as never } : {}), ...(over.personal ? { personal: over.personal } : {}) });
  const ask = (question: string, o: Partial<Parameters<typeof chat.answer>[0]> = {}) =>
    chat.answer({ userId: "alice", projectId: a.project.id, question, tier: "cheap", length: "short", diagram: false, maxPaise: 150, ...o });
  /** GitHub reads of file contents since the rig was made. */
  const contentReads = () => a.fake.calls.filter((c) => /\/contents\//.test(c.url.pathname)).map((c) => decodeURIComponent(c.url.pathname.split("/contents/")[1]!));
  return { a, chat, threads, ask, contentReads };
}
type ChatRig = Awaited<ReturnType<typeof chatRig>>;
const said = (r: ChatRig, n = 0) => r.a.json.of("front.code_answer")[n]!;

describe("the fast path", () => {
  it("answers a lookup from the project's index alone: facts to the model, no file read, citations that were seen", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "startSession is defined at src/auth/session.ts:3 and sets the sid cookie, httpOnly and sameSite lax.");
    const out = await r.ask("where is startSession defined?");
    expect(out.road).toBe("fast");
    expect(out.reads).toEqual([]);
    expect(r.contentReads()).toEqual([]);
    expect(out.cites).toEqual(["src/auth/session.ts:3"]);
    expect(out.notes).toEqual([]);
    // The model got the question and the index's facts as data, the role's own block, and no excerpts.
    const sent = said(r);
    expect(sent).toMatchObject({ tier: "cheap", system: stableBlock("front_code_answer") });
    expect(sent.user).toContain("<question>\nwhere is startSession defined?\n</question>");
    expect(sent.user).toContain("<facts>\nsrc/auth/session.ts:");
    expect(sent.user).toContain("symbols:");
    expect(sent.user).not.toContain("<excerpts>");
    // Where a change would go is kept for "ok, change it".
    expect(out.located.targets.map((t) => t.path)).toContain("src/auth/session.ts");
  });

  it("is one model call, charged to the question's own cap", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "In src/auth/session.ts:3.");
    const out = await r.ask("where is startSession defined?", { maxPaise: 90 });
    expect(r.a.json.of("front.code_answer")).toHaveLength(1);
    expect(r.a.json.of("front.code_answer")[0]!.budget).toEqual({ maxPaise: expect.any(Number) });
    expect(out.paise).toBeGreaterThan(0);
    expect((said(r).budget as { maxPaise: number }).maxPaise).toBeLessThanOrEqual(90);
  });
});

describe("the read path", () => {
  it("reads only the located spans when the index is not enough, and never a secret file or a file nothing pointed at", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "It uses sameSite lax so the cookie is not sent on cross-site POSTs: src/auth/session.ts:5.");
    const out = await r.ask("why does startSession use sameSite lax for the cookie?");
    expect(out.road).toBe("read");
    expect(out.reads.length).toBeGreaterThan(0);
    expect(out.reads.length).toBeLessThanOrEqual(chatMod.READ_FILES_MAX);
    expect(out.reads).toContain("src/auth/session.ts");
    // Everything read was a located file; the secret file and the rest of the project were not touched.
    const located = new Set(out.located.targets.map((t) => t.path));
    expect(r.contentReads().every((p) => located.has(p))).toBe(true);
    expect(r.contentReads()).not.toContain(".env");
    expect(r.contentReads()).not.toContain("src/util.ts");
    const sent = said(r);
    expect(sent.user).toContain("<excerpts>\nsrc/auth/session.ts\n");
    expect(sent.user).toMatch(/\d+: .*sameSite: "lax"/);
    expect(sent.user.length).toBeLessThan(chatMod.READ_CHARS_MAX + 3000);
    expect(out.cites).toEqual(["src/auth/session.ts:5"]);
  });

  it("never reads a secret file even when the question names it", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "I do not see that in what I was shown.");
    await r.ask("why does .env hold SESSION_SECRET and what is in it?");
    expect(r.contentReads()).not.toContain(".env");
    expect(said(r).user).not.toContain("abc123");
  });

  it("uses the job's room, when the person has one open, instead of GitHub: read and grep with no GitHub call", async () => {
    const reads: string[] = [];
    const greps: string[] = [];
    const rooms = async () => ({
      read: async (p: string) => { reads.push(p); const text = FILES[p] ?? ""; return { kind: "ok", out: { text: text.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n"), total: text.split("\n").length - 1 } }; },
      grep: async (pattern: string) => { greps.push(pattern); return { kind: "ok", out: { text: 'src/auth/session.ts:5:  res.cookie("sid", token, { httpOnly: true, sameSite: "lax" });' } }; },
    });
    const r = await chatRig({ rooms });
    r.a.json.on("front.code_answer", "sameSite lax: src/auth/session.ts:5.");
    const out = await r.ask("why does startSession use sameSite lax for the cookie?");
    expect(out.road).toBe("read");
    expect(reads).toContain("src/auth/session.ts");
    expect(greps.length).toBeGreaterThan(0);
    expect(out.greps).toEqual(greps);
    expect(r.contentReads()).toEqual([]);
    expect(said(r).user).toContain("grep startSession");
    expect(out.cites).toEqual(["src/auth/session.ts:5"]);
  });

  it("says when it was not sure which part of the code the question is about, and rests on the closest files", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "Probably startSession: src/auth/session.ts:3.");
    const out = await r.ask("where is the session cookie set?");
    expect(out.road).toBe("read");
    expect(out.notes).toContain("I was not sure which part of the code this is about, so this rests on the closest files.");
  });

  it("answers from the project's overview when nothing in the code matches, and says so", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "The overview does not show a zeppelin scheduler.");
    const out = await r.ask("how does the zeppelin scheduler decide?");
    expect(out.road).toBe("overview");
    expect(out.notes).toEqual(["Nothing in the code matched, so this answer is from the project's overview."]);
    expect(out.reads).toEqual([]);
  });
});

describe("every claim cites path:line", () => {
  it("strips a citation to a file that is not there and one to a line past the end, and says so", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "The cookie is set in startSession (src/auth/session.ts:3), and cleared in src/auth/ghost.ts:9 and at src/auth/session.ts:999, then see src/auth/session.ts:8.");
    const out = await r.ask("why does startSession use sameSite lax for the cookie?");
    expect(out.text).toContain("src/auth/session.ts:3");
    expect(out.text).toContain("src/auth/session.ts:8");
    expect(out.text).not.toContain("ghost");
    expect(out.text).not.toContain(":999");
    expect(out.cites.sort()).toEqual(["src/auth/session.ts:3", "src/auth/session.ts:8"]);
    expect(out.notes).toEqual(["I took out 2 references to code I could not find."]);
  });

  it("checks the citations of a fast answer against the index, which names a symbol's line", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "startSession is at src/auth/session.ts:3 and signs with sign (src/auth/token.ts:1); it also calls src/nowhere.ts:1.");
    const out = await r.ask("where is startSession defined?");
    expect(out.road).toBe("fast");
    // The index names the file the session code uses, so that one stands too; the file that is not in the project does not.
    expect(out.cites).toEqual(["src/auth/session.ts:3", "src/auth/token.ts:1"]);
    expect(out.text).not.toContain("nowhere");
    expect(out.notes).toEqual(["I took out 1 reference to code I could not find."]);
  });
});

describe("a flow", () => {
  it("is drawn from the import graph by code, with no model asked for it", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "Login checks the password, then starts a session: src/routes/login.ts:4, src/auth/session.ts:3.");
    const out = await r.ask("how does login work?", { diagram: true, length: "medium" });
    expect(out.diagram).toBeDefined();
    expect(out.diagram!.startsWith("flowchart TD")).toBe(true);
    expect(out.diagram).toContain("routes/login.ts");
    expect(out.diagram).toContain("auth/session.ts");
    expect(out.diagram).toMatch(/N\d+ --> N\d+/);
    // The answer is one model call; the picture cost nothing.
    expect(r.a.json.calls.map((c) => c.purpose).filter((p) => p.startsWith("front.") || p.startsWith("work.")).filter((p) => p !== "work.locate" && !p.startsWith("work.locate"))).toEqual(["front.code_answer"]);
    expect((out.diagram!.match(/\["/g) ?? []).length).toBeLessThanOrEqual(10);
    // The boxes are files, not tests or secrets.
    expect(out.diagram).not.toContain(".env");
  });

  it("is not drawn unless the decision planned it, and not when the graph shows one file", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "src/routes/login.ts:4.");
    expect((await r.ask("how does login work?")).diagram).toBeUndefined();
    expect((await r.ask("what does the slug helper do?", { diagram: true })).diagram).toBeUndefined();
  });
});

describe("the conversation", () => {
  it("keeps a short rolling summary: questions and files, not the code and not the answers' words", async () => {
    const r = await chatRig();
    const threadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    r.a.json.on("front.code_answer", "The cookie is set in startSession: src/auth/session.ts:3. Secret words in the answer.");
    const out = await r.ask("where is the session cookie set?", { threadId });
    expect(out.thread).toMatchObject({ id: threadId, turns: 1, lastQuestion: "where is the session cookie set?", lastCites: ["src/auth/session.ts:3"] });
    const kept = await r.threads.get("alice", r.a.project.id, threadId);
    expect(kept!.summary).toBe("- where is the session cookie set? (src/auth/session.ts)");
    expect(kept!.summary).not.toContain("Secret words");
    expect(kept!.lastLocated!.targets.map((t) => t.path)).toContain("src/auth/session.ts");
    // Another person's id for it, or another project's, finds nothing.
    expect(await r.threads.get("bob", r.a.project.id, threadId)).toBeNull();
  });

  it("looks a follow-up up together with the question before it, and shows the model the summary as data", async () => {
    const r = await chatRig();
    const threadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    r.a.json.on("front.code_answer", "In startSession: src/auth/session.ts:3.");
    await r.ask("where is the session cookie set?", { threadId });
    r.a.json.on("front.code_answer", "endSession clears it: src/auth/session.ts:8.");
    const second = await r.ask("and where is it cleared?", { threadId });
    const sent = said(r, 1);
    expect(sent.user).toContain("<thread>\n- where is the session cookie set? (src/auth/session.ts)\n</thread>");
    expect(second.located.targets.map((t) => t.path)).toContain("src/auth/session.ts");
    expect(second.thread).toMatchObject({ turns: 2 });
    expect(second.thread!.summary.split("\n")).toEqual(["- where is the session cookie set? (src/auth/session.ts)", "- and where is it cleared? (src/auth/session.ts)"]);
    // A question that stands alone is looked up as it is, and without a thread nothing is kept.
    const alone = await r.ask("where is the login route?");
    expect(alone.thread).toBeNull();
  });

  it("keeps the turns word for word for the chat to show, and a follow-up is answered knowing the last answer (as Claude Code does)", async () => {
    const r = await chatRig();
    const threadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    r.a.json.on("front.code_answer", "In startSession: src/auth/session.ts:3.");
    await r.ask("where is the session cookie set?", { threadId });
    // "??" after it: the front door writes out what it asks; the model is asked that, with the last answer; the chat shows "??".
    r.a.json.on("front.code_answer", "Simply: startSession sets the cookie.");
    const again = await r.ask("??", { threadId, context: "where is the session cookie set?", ask: "I did not follow that. Explain your last answer again, simpler." });
    const sent = said(r, 1);
    expect(sent.user).toContain("<question>\nwhere is the session cookie set?\n\nI did not follow that.");
    expect(sent.user).toContain("<last_answer>\nIn startSession: src/auth/session.ts:3.\n</last_answer>");
    expect(again.thread!.history.map((t) => t.q)).toEqual(["where is the session cookie set?", "??"]);
    expect(again.thread!.history[1]!.a).toBe("Simply: startSession sets the cookie.");
    // The thread keeps the real question, so the next "why?" is about it, not about "??".
    expect(again.thread!.lastQuestion).toBe("where is the session cookie set?");
    // A question that stands alone is not shown the last answer.
    r.a.json.on("front.code_answer", "The login route: src/routes/login.ts:4.");
    await r.ask("where is the login route defined in the routes folder?", { threadId });
    expect(said(r, 2).user).not.toContain("<last_answer>");
  });

  it("looks a follow-up up as the person meant it, completed by the tiny model, and shows the model what was meant", async () => {
    const r = await chatRig();
    const threadId = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
    r.a.json.on("front.code_answer", "In startSession: src/auth/session.ts:3.");
    await r.ask("where is the session cookie set?", { threadId });
    r.a.json.on("front.complete", "Where is the session cookie cleared?");
    r.a.json.on("front.code_answer", "endSession clears it: src/auth/session.ts:8.");
    const second = await r.ask("and cleared?", { threadId });
    expect(r.a.json.of("front.complete")).toHaveLength(1);
    expect(said(r, 1).user).toContain("<meant>\nWhere is the session cookie cleared?\n</meant>");
    expect(second.located.targets.map((t) => t.path)).toContain("src/auth/session.ts");
    // the chat keeps the person's own words
    expect(second.thread!.history.at(-1)!.q).toBe("and cleared?");
  });

  it("shows the model what the person told their bots, as data, and nothing when there is none", async () => {
    const asked: string[] = [];
    const r = await chatRig({ personal: async (userId, about) => { asked.push(`${userId}: ${about}`); return ["I write TypeScript, not Python"]; } });
    r.a.json.on("front.code_answer", "In startSession: src/auth/session.ts:3.");
    await r.ask("where is the session cookie set?");
    expect(asked).toEqual(["alice: where is the session cookie set?"]);
    expect(said(r, 0).user).toContain("<about_them>\n- I write TypeScript, not Python\n</about_them>");
    const bare = await chatRig({ personal: async () => [] });
    bare.a.json.on("front.code_answer", "In startSession: src/auth/session.ts:3.");
    await bare.ask("where is the session cookie set?");
    expect(said(bare, 0).user).not.toContain("<about_them>");
  });

  it("brings back an earlier answer the question is about again, beyond the last turn, for nothing", () => {
    let t = chatMod.newThread("alice", "p", "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", 0);
    const turn = (q: string, a: string, at: number) => { t = chatMod.afterTurn(t, { question: q, cites: [], located: null, now: at, answer: a }); };
    turn("how is the session cookie signed?", "sign() in src/auth/token.ts:1 serialises the claims; the session cookie carries them.", 1);
    turn("where is the pricing page?", "In src/pages/pricing.tsx.", 2);
    turn("what does slug do?", "It lowercases a title for a URL.", 3);
    expect(chatMod.earlierTurns(t, "can the session cookie be signed with a secret?")).toEqual([
      { q: "how is the session cookie signed?", a: "sign() in src/auth/token.ts:1 serialises the claims; the session cookie carries them." },
    ]);
    // the last turn is shown on its own (last_answer); one shared word is not enough
    expect(chatMod.earlierTurns(t, "slug for a title")).toEqual([]);
    expect(chatMod.earlierTurns(t, "pricing")).toEqual([]);
  });

  it("keeps at most HISTORY_TURNS turns, however long the chat goes", () => {
    let t = chatMod.newThread("alice", "p", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", 0);
    for (let i = 0; i < chatMod.HISTORY_TURNS + 7; i += 1) t = chatMod.afterTurn(t, { question: `q${i}`, cites: [], located: null, now: i, answer: "a".repeat(9000) });
    expect(t.history).toHaveLength(chatMod.HISTORY_TURNS);
    expect(t.history[0]!.q).toBe("q7");
    expect(t.history.at(-1)!.a.length).toBeLessThanOrEqual(4000);
  });

  it("reads the whole project the way a newcomer does for a question about all of it: README and manifest first, whatever words matched", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "A small app (README.md:3).");
    const out = await r.ask("what do you under stand of the project");
    expect(out.reads).toEqual(expect.arrayContaining(["README.md", "package.json"]));
    expect(out.reads.length).toBeLessThanOrEqual(4);
    expect(said(r).user).toContain("README.md\n1: # app");
    expect(out.cites).toEqual(["README.md:3"]);
    expect(chatMod.readQuestion("what does this app do?").whole).toBe(true);
    expect(chatMod.readQuestion("project samjhao").whole).toBe(true);
    expect(chatMod.readQuestion("where in the project is the login route?").whole).toBe(false);
  });

  it("takes the answer's own \"Next:\" line off it as what to ask next, and keeps it with the turn; the words as they come never show it", async () => {
    const r = await chatRig();
    const threadId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    r.a.json.on("front.code_answer", "The cookie is set in startSession: src/auth/session.ts:3.\n\n**Next:** Where is it cleared? | What signs the token?");
    const pieces: string[] = [];
    const out = await r.ask("where is the session cookie set?", { threadId, onText: (p: string) => pieces.push(p) });
    expect(out.text).toBe("The cookie is set in startSession: src/auth/session.ts:3.");
    expect(out.next).toEqual(["Where is it cleared?", "What signs the token?"]);
    expect(out.thread!.history.at(-1)).toMatchObject({ a: "The cookie is set in startSession: src/auth/session.ts:3.", n: ["Where is it cleared?", "What signs the token?"] });
    expect(pieces.join("")).not.toMatch(/Next/);
    // No line, no suggestions: nothing is made up.
    expect(chatMod.splitNext("Just an answer.")).toEqual({ text: "Just an answer.", next: [] });
    expect(chatMod.splitNext("A.\nnext: one thing | x | another thing").next).toEqual(["one thing", "another thing"]);
    // Streamed in small pieces, the words stop where "Next:" starts.
    const shown: string[] = [];
    const w = chatMod.withoutNext((p) => shown.push(p));
    for (const ch of "It is set in a.ts:3.\n\nNext: Why? | Where else?") w.onText(ch);
    expect(shown.join("")).toBe("It is set in a.ts:3.");
  });

  it("holds the summary to its limit, the oldest turn going first", async () => {
    const t = chatMod.rollSummary("", "q0", []);
    let s = t;
    for (let i = 1; i <= 12; i += 1) s = chatMod.rollSummary(s, `question number ${i} ${"x".repeat(160)}`, [`src/f${i}.ts:1`]);
    expect(s.length).toBeLessThanOrEqual(chatMod.SUMMARY_MAX);
    expect(s.split("\n").length).toBeLessThanOrEqual(chatMod.SUMMARY_TURNS);
    expect(s).toContain("question number 12");
    expect(s).not.toContain("question number 1 ");
  });
});

describe("ok, change it", () => {
  it("hands the job the place the conversation found, as the chat's, and the agent does not look for it again", async () => {
    const r = await chatRig();
    const threadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    r.a.json.on("front.code_answer", "The cookie is set in startSession: src/auth/session.ts:3.");
    await r.ask("where is the session cookie set?", { threadId });
    const handed = await r.chat.handoff("alice", r.a.project.id, threadId, "ok, make it sameSite strict");
    expect(handed!.task).toContain("ok, make it sameSite strict");
    expect(handed!.task).toContain("where is the session cookie set?");
    expect(handed!.task).toContain("The conversation found the place already: src/auth/session.ts");
    expect(handed!.task).not.toContain("Secret");
    expect(handed!.located.targets[0]!.path).toBe("src/auth/session.ts");
    // A thread that found nothing hands over nothing.
    expect(await r.chat.handoff("alice", r.a.project.id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ok")).toBeNull();
    expect(await r.chat.handoff("bob", r.a.project.id, threadId, "ok")).toBeNull();

    // Through the front door's job handler: the job is made with that place, and runs without a search for it.
    r.a.json.on("work.plan", { steps: [{ do: "Make the cookie sameSite strict", files: [{ path: "src/auth/session.ts", action: "edit" }] }], notes: [] });
    r.a.model.push(
      call("read_file", { path: "src/auth/session.ts" }),
      call("edit_file", { path: "src/auth/session.ts", old: 'sameSite: "lax"', new: 'sameSite: "strict"' }),
      done("Made the cookie sameSite strict."),
    );
    const code = { ...r.a.code, brain: { open: async () => r.a.fixture.brain } };
    const h = defaultHandlers({ code: code as never, jobs: r.a.jobs, agent: r.a.orch, call: r.a.model.call as never, threads: r.threads });
    const { decide } = await import("../src/front/decide.js");
    void decide;
    const base = {
      userId: "alice", message: "ok, make it sameSite strict", said: "ok, make it sameSite strict", files: [], maxPaise: 3000,
      ctx: { projectId: r.a.project.id, threadId, recent: [] },
      decision: { intent: "code_task", route: "job", tier: "code", handoff: true, shape: { length: "short" }, budget: { maxPaise: 3000 } },
    };
    const askedBefore = r.a.json.calls.length;
    const out = await h.codeJob(base as never);
    await r.a.orch.idle();
    const s = await r.a.stateNow(out.job.id);
    expect(s.handoff).toBe(true);
    expect(s.located!.targets.map((t) => t.path)).toContain("src/auth/session.ts");
    expect(s.task).toContain("The conversation found the place already");
    // No search for the place: the work core's locate was never asked.
    expect(r.a.json.calls.slice(askedBefore).filter((c) => c.purpose.startsWith("work.locate"))).toEqual([]);
    expect((await r.a.jobNow(out.job.id)).state).toBe("done");
    expect(r.a.fake.files(r.a.repo, out.job.branch)["src/auth/session.ts"]).toContain('sameSite: "strict"');
    expect(s.report).toMatchObject({ outcome: "done" });
    expect(s.notes.join(" ")).not.toContain("not sure");
  });
});

describe("what it costs", () => {
  it("is the cheap tier by default, and the strong tier only where the front door's decision says a question is deep", async () => {
    const { deepCodeQuestion, readQuestion } = chatMod;
    for (const deep of ["why is checkout slow under load?", "why does the cache leak memory?", "why is this test flaky?", "what would break if I rename startSession?", "who calls hash.verify? what is affected if I change it?", "is it safe to remove the token helper"]) {
      expect(deepCodeQuestion(deep), deep).toBe(true);
    }
    for (const plain of ["where is the session cookie set?", "what does the slug helper do?", "how does login work?", "why does startSession use sameSite lax?", "kaun si file login handle karti hai?"]) {
      expect(deepCodeQuestion(plain), plain).toBe(false);
    }
    expect(readQuestion("show me the exact code for startSession").wantsCode).toBe(true);
    expect(readQuestion("how does login work?")).toMatchObject({ kind: "how", flow: true });
    expect(readQuestion("login kaise kaam karta hai")).toMatchObject({ flow: true });
    expect(readQuestion("where is login").kind).toBe("where");
    expect(readQuestion("what is affected if I change hash").kind).toBe("impact");
    expect(chatMod.isFollowUp("and where is it cleared?")).toBe(true);
    expect(chatMod.isFollowUp("where is the login route handled in this project?")).toBe(false);
  });

  it("hands the deep question the tier the decision gave it: the chat sends the model exactly that", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "Impact: src/routes/login.ts:4 and src/routes/logout.ts:3 call it.");
    await r.ask("what would break if I rename startSession?", { tier: "strong" });
    expect(said(r).tier).toBe("strong");
    await r.ask("where is startSession defined?", { tier: "cheap" });
    expect(said(r, 1).tier).toBe("cheap");
  });
});
