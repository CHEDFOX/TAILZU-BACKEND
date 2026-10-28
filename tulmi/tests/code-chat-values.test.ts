/**
 * THE VALUES A CODE ANSWER MUST CARRY (src/code/chat/facts.ts, chat/answer.ts, agent/phases.ts).
 *
 * The second real-model test, smoke item 3: "where is the rate limit applied, what are the default limit and window, and what does a client that goes over it
 * get back?" The answer was right, and said "a 60-second window": never `windowMs`, the name the person asked about, though it was read in src/config.js.
 * What these hold down:
 *   - the configuration and constants a file holds are found: config objects, defaults, constants, default parameters, environment fallbacks, settings files;
 *     and never a secret (a name that says so, a line the scan flags, a secret file);
 *   - the facts the question asks about, and the ones on the lines the answer cites, must be in the answer by name and by value; one that is not is added with
 *     its file and line (no model is asked);
 *   - the answer to a question about code (the chat's, and a question job's) is checked that way, and is given the values besides the summary.
 */
import fs from "node:fs";
import path from "node:path";
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

const F = await import("../src/code/chat/facts.js");
const { readQuestion } = await import("../src/code/chat/question.js");
const { pathsRead } = await import("../src/code/agent/phases.js");
const { projectContext } = await import("../src/code/agent/context.js");
const { agentRig, call, done } = await import("./agent-rig.js");
const { sym } = await import("./work-fixtures.js");
const chatMod = await import("../src/code/chat/index.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");

const FIXTURE = path.resolve(import.meta.dirname, "../e2e/fixtures/smoke-api");
const src = (p: string): string => fs.readFileSync(path.join(FIXTURE, p), "utf8");
const QUESTION = "Where in the code is the rate limit applied, what are the default limit and window, and what does a client that goes over it get back?";
const names = (facts: Array<{ name: string; value: string }>): string[] => facts.map((f) => `${f.name}=${f.value}`);

describe("what the code holds", () => {
  it("finds a config object's settings, with the line each is on", () => {
    expect(F.constantsOf("src/config.js", src("src/config.js"))).toEqual([
      { name: "port", value: "3000", path: "src/config.js", line: 7 },
      { name: "serviceName", value: "smoke-api", path: "src/config.js", line: 8 },
      { name: "limit", value: "60", path: "src/config.js", line: 9 },
      { name: "windowMs", value: "60000", path: "src/config.js", line: 10 },
    ]);
  });

  it("finds the default parameters of a function, a constant, and an environment fallback", () => {
    expect(names(F.constantsOf("src/ratelimit.js", src("src/ratelimit.js")))).toEqual(["limit=60", "windowMs=60000"]);
    expect(names(F.constantsOf("src/pagination.js", src("src/pagination.js")))).toEqual(["MAX_LIMIT=100", "page=1", "limit=10"]);
    expect(names(F.constantsOf("server.ts", "const PORT = Number(process.env.PORT ?? 8080)\nexport const TIMEOUT_MS = 30_000\n"))).toEqual(["PORT=8080", "TIMEOUT_MS=30000"]);
    expect(names(F.constantsOf("app.py", 'import os\nMAX_RETRIES = 3\nDEFAULTS = {\n    "page_size": 20,\n    "mode": "fast",\n}\nTOKEN = os.getenv("REGION", "eu")\ndef page(size=10, name="x"):\n    pass\n'))).toEqual(
      ["MAX_RETRIES=3", "page_size=20", "mode=fast", "REGION=eu", "size=10", "name=x"],
    );
  });

  it("reads a settings file's scalar leaves, and nothing in a package.json", () => {
    expect(names(F.constantsOf("config/app.json", '{\n  "port": 8080,\n  "name": "demo",\n  "nested": {\n    "retries": 3\n  }\n}\n'))).toEqual(["port=8080", "name=demo", "retries=3"]);
    expect(names(F.constantsOf("settings.yaml", "port: 8080\nmode: fast\n"))).toEqual(["port=8080", "mode=fast"]);
    expect(F.constantsOf("package.json", '{ "version": "1.0.0" }')).toEqual([]);
  });

  it("never takes a secret: not a secret file, not a name that says it is one, not a line the scan flags", () => {
    const key = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    expect(F.constantsOf(".env", "PORT=3000\n")).toEqual([]);
    expect(names(F.constantsOf("config/local.json", `{\n  "port": 8080,\n  "apiKey": "${key}"\n}\n`))).toEqual(["port=8080"]);
    expect(names(F.constantsOf("src/config.js", `const defaults = {\n  port: 1,\n  password: 'hunter2hunter2',\n  other: '${key}',\n}\n`))).toEqual(["port=1"]);
    expect(F.constantsOf("README.md", "const LIMIT = 5\n")).toEqual([]);
  });

  it("knows a config file by its name", () => {
    for (const p of ["src/config.js", "config/app.json", "src/settings.ts", "lib/constants.py", "src/defaults.ts"]) expect(F.isConfigPath(p), p).toBe(true);
    for (const p of ["src/app.js", "src/ratelimit.js", ".env", "src/auth/session.ts"]) expect(F.isConfigPath(p), p).toBe(false);
  });
});

describe("what the answer must say", () => {
  const facts = [...F.constantsOf("src/config.js", src("src/config.js")), ...F.constantsOf("src/ratelimit.js", src("src/ratelimit.js"))];
  /** The answer the real model gave: right, and no `windowMs`. */
  const PARAPHRASE = "It is applied in src/app.js: every request goes through rateLimit() first. The default is 60 requests per 60-second window (set in src/config.js). A client over the limit gets 429 with a Retry-After header.";

  it("asks for the facts whose name shares a word with the question, and for nothing else", () => {
    expect(F.requiredFacts(facts, QUESTION, PARAPHRASE).map((f) => f.name)).toEqual(["limit", "windowMs", "limit", "windowMs"].slice(0, 2));
  });

  it("finds that the paraphrase left out windowMs and adds it, with its file and line", () => {
    const missing = F.missingFacts(facts, QUESTION, PARAPHRASE);
    expect(missing.map((f) => f.name)).toEqual(["windowMs"]);
    const fixed = F.withMissing(PARAPHRASE, missing);
    expect(fixed).toContain("windowMs");
    expect(fixed).toContain("60000");
    expect(fixed).toMatch(/From the code: `windowMs` is 60000 \(src\/config\.js:10\)\.$/);
    expect(F.missingFacts(facts, QUESTION, fixed)).toEqual([]);
  });

  it("leaves an answer that has the name and the value alone", () => {
    const good = "The limit is 60 and `windowMs` is 60000 ms (src/config.js:10).";
    expect(F.missingFacts(facts, QUESTION, good)).toEqual([]);
    expect(F.withMissing(good, [])).toBe(good);
  });

  it("counts a value written another way: with separators, or as a duration, and a name written another way", () => {
    const f = { name: "windowMs", value: "60000", path: "a.js", line: 1 };
    for (const a of ["windowMs is 60,000", "window_ms = 60 000", "the window ms: 60000", "windowMs of 60 seconds", "windowMs: 1 minute", "windowMs=60s"]) expect(F.covers(a, f), a).toBe(true);
    // The name without the value, the value without the name, and a different number do not.
    for (const a of ["windowMs is long", "the window is 60000 ms", "windowMs is 600000", "windowMs is 6000"]) expect(F.covers(a, f), a).toBe(false);
    // A boolean is carried by its name.
    expect(F.covers("strict mode is on", { name: "strict", value: "true", path: "a.js", line: 1 })).toBe(true);
  });

  it("asks for what the answer cites too: a value on a cited line is a value it rests on", () => {
    const more = [...facts, { name: "burst", value: "5", path: "src/config.js", line: 12 }];
    expect(F.requiredFacts(more, "how is it set up?", "See src/config.js:12 for how it is set up.").map((f) => f.name)).toEqual(["burst"]);
    // A long range is a pointer to a region, not a claim about every line in it.
    expect(F.requiredFacts(more, "how is it set up?", "See src/config.js:1-40 for how it is set up.")).toEqual([]);
  });

  it("asks for at most six", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `limit${"ABCDEFGHIJKL"[i]}`, value: String(i), path: "a.js", line: i + 1 }));
    expect(F.requiredFacts(many, "what is the limit", "")).toHaveLength(6);
  });

  it("reads a question for a value", () => {
    for (const q of [QUESTION, "what is the default timeout?", "how many retries are there", "which port does it listen on", "what's the max page size"]) expect(readQuestion(q).values, q).toBe(true);
    for (const q of ["where is startSession defined?", "how does login work?", "why is checkout slow"]) expect(readQuestion(q).values, q).toBe(false);
  });
});

// ------------------------------------------------------------------ the chat's answer

const FILES: Record<string, string> = {
  "package.json": '{ "name": "demo" }\n',
  "src/app.ts": "import { rateLimit } from './ratelimit';\nimport { defaults } from './config';\n\nexport function createApp() {\n  const check = rateLimit({ limit: defaults.limit, windowMs: defaults.windowMs });\n  return (req) => (check(req.ip).allowed ? 200 : 429);\n}\n",
  "src/ratelimit.ts": "export function rateLimit({ limit = 60, windowMs = 60000 } = {}) {\n  return (key: string) => ({ allowed: key !== '' && limit > 0 && windowMs > 0 });\n}\n",
  "src/config.ts": "export const defaults = {\n  port: 3000,\n  limit: 60,\n  windowMs: 60000,\n};\n",
  "src/util.ts": "export const slug = (s: string) => s.toLowerCase();\n",
};
const ROWS = [
  { path: "src/app.ts", imports: ["src/ratelimit.ts", "src/config.ts"], symbols: [sym("createApp", "function", 4)], summary: "The app: puts the rate limit in front of every request and answers 429 when a client is over it.", rank: 0.9 },
  { path: "src/ratelimit.ts", symbols: [sym("rateLimit", "function", 1)], summary: "A fixed-window rate limit per client address.", rank: 0.8 },
  { path: "src/config.ts", symbols: [sym("defaults", "const", 1)], summary: "The settings and their defaults.", rank: 0.5 },
  { path: "src/util.ts", symbols: [sym("slug", "function", 1)], summary: "String helpers.", rank: 0.2 },
];
const FEATURES = [{ name: "Rate limit", summary: "A fixed-window rate limit in front of every request.", files: ["src/app.ts", "src/ratelimit.ts", "src/config.ts"], fileCount: 3, routes: [], texts: [] }];

beforeEach(() => { resetSettingsStoreForTests(); });

async function chatRig() {
  const a = await agentRig({ files: FILES, rows: ROWS, features: FEATURES });
  const chat = new chatMod.CodeChat({ projects: a.d, brain: { open: async () => a.fixture.brain } as never, call: a.model.call as never, threads: new chatMod.MemoryThreadStore(), now: () => a.now() });
  const ask = (question: string) => chat.answer({ userId: "alice", projectId: a.project.id, question, tier: "cheap", length: "short", diagram: false, maxPaise: 150 });
  const contentReads = () => a.fake.calls.filter((c) => /\/contents\//.test(c.url.pathname)).map((c) => decodeURIComponent(c.url.pathname.split("/contents/")[1]!));
  return { a, ask, contentReads };
}

describe("the chat's answer to a question about a value", () => {
  it("shows the model the values in the code beside the summary, and adds the one the answer left out", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "The limit is applied in src/app.ts:5. The default is 60 requests per 60-second window, from src/config.ts.");
    const out = await r.ask("Where is the rate limit applied, and what are the default limit and window?");
    const sent = r.a.json.of("front.code_answer")[0]!.user;
    expect(sent).toContain("values in the code:");
    expect(sent).toContain("src/config.ts:4 — windowMs = 60000");
    expect(sent).toContain("src/config.ts:3 — limit = 60");
    expect(out.text).toMatch(/From the code: `windowMs` is 60000 \(src\/config\.ts:4\)\.$/);
    expect(out.notes).toContain("The answer left out a value the code holds (windowMs), so it was added.");
    expect(out.cites).toContain("src/config.ts:4");
    // Reading them is bounded: the located files and the config file beside them, never a file nothing pointed at.
    expect(r.contentReads()).not.toContain("src/util.ts");
    // ...and a file is asked of GitHub once, however many steps want it.
    expect(r.contentReads().length).toBe(new Set(r.contentReads()).size);
  });

  it("leaves an answer that already names the value as the model wrote it", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "Applied in src/app.ts:5. Defaults: limit = 60 and windowMs = 60000 (src/config.ts:4).");
    const out = await r.ask("Where is the rate limit applied, and what are the default limit and window?");
    expect(out.text).toBe("Applied in src/app.ts:5. Defaults: limit = 60 and windowMs = 60000 (src/config.ts:4).");
    expect(out.notes.filter((n) => /left out/.test(n))).toEqual([]);
  });

  it("takes no values for a question that asks where something is and has no config file in sight", async () => {
    const r = await chatRig();
    r.a.json.on("front.code_answer", "slug is in src/util.ts:1.");
    const out = await r.ask("where is slug defined?");
    expect(r.contentReads().every((p) => p === "src/util.ts")).toBe(true);
    expect(r.a.json.of("front.code_answer")[0]!.user).not.toContain("values in the code:");
    expect(out.text).toBe("slug is in src/util.ts:1.");
  });
});

// ------------------------------------------------------------------ a question job

describe("a question job", () => {
  it("is told to answer with the exact names and values", () => {
    expect(projectContext({ rules: "", memory: "", kind: "question" })).toContain("give the exact names and values it asks for");
    expect(projectContext({ rules: "", memory: "", kind: "bug fix" })).not.toContain("exact names");
  });

  it("knows which files the model read, in order, once each, and no secret file", () => {
    const call = (name: string, args: unknown) => ({ id: name + JSON.stringify(args), name, arguments: JSON.stringify(args) });
    const ex = [
      { calls: [call("read_file", { path: "src/ratelimit.js" }), call("grep", { pattern: "x", path: "src/app.js" })] },
      { calls: [call("read_file", { path: "src/ratelimit.js" }), call("read_file", { path: ".env" }), call("grep", { pattern: "y" }), call("list_dir", { path: "src" })] },
      { calls: [call("read_file", { path: "src/config.js" })] },
    ];
    expect(pathsRead(ex as never)).toEqual(["src/ratelimit.js", "src/app.js", "src/config.js"]);
  });
});

describe("a question job's answer", () => {
  it("gets the value it left out, from the file it read, and nothing from a file it did not", async () => {
    const r = await agentRig({ files: FILES, rows: ROWS, features: FEATURES });
    r.model.push(
      call("read_file", { path: "src/ratelimit.ts" }), call("read_file", { path: "src/config.ts" }),
      done("The limiter is in src/ratelimit.ts. By default it allows 60 requests per 60-second window; over it a client gets a 429."),
    );
    const { job } = await r.start("How does the rate limit work in src/ratelimit.ts, and what are the default limit and window?");
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    const s = await r.stateNow(job.id);
    expect(s.report).toMatchObject({ outcome: "answer" });
    expect(s.report!.text).toMatch(/From the code: .*`windowMs` is 60000 \(src\/config\.ts:4\)\./);
    expect(s.report!.text).not.toContain("src/util.ts");
    expect((await r.worklog.list(job.id)).some((e) => /left out .*windowMs/.test(e.text))).toBe(true);
    expect(r.fake.commitCount(r.repo)).toBe(1);
  });

  it("is left as the model wrote it when it already names the values", async () => {
    const r = await agentRig({ files: FILES, rows: ROWS, features: FEATURES });
    const answer = "The limiter is in src/ratelimit.ts; limit defaults to 60 and windowMs to 60000.";
    r.model.push(call("read_file", { path: "src/ratelimit.ts" }), call("read_file", { path: "src/config.ts" }), done(answer));
    const { job } = await r.start("How does the rate limit work in src/ratelimit.ts, and what are the default limit and window?");
    await r.orch.idle();
    expect((await r.stateNow(job.id)).report!.text).toContain(answer);
    expect((await r.stateNow(job.id)).report!.text).not.toContain("From the code:");
  });
});

