/**
 * The runner's side of the live session: `.tailzu/run.mjs` when step.json carries a `session` (src/code/jobs/runScript.ts). A fake room (a WebSocket
 * server on 127.0.0.1) plays the Durable Object: it checks the ticket in the address, reads the runner's hello, sends exec / grep / glob / cancel /
 * ping / close frames and reads what comes back. The checkout is a temporary git repo. Nothing reaches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { RUN_MJS } = await import("../src/code/jobs/runScript.js");
const { stepJson } = await import("../src/code/jobs/workflow.js");
const { parseFromRunner } = await import("../src/code/live/protocol.js");

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "tailzu-live-run-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/** A checkout as the runner has it: these files committed, node_modules ignored. */
function checkout(files: Record<string, string> = {}): string {
  const dir = scratch();
  git(dir, "init", "-q", "-b", "main");
  const all: Record<string, string> = {
    ".gitignore": "node_modules/\n", "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n// TODO: later\n",
    "README.md": "# app\nthe Readme\n", ...files,
  };
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "checkpoint");
  return dir;
}

async function loadScript(): Promise<any> {
  const dir = scratch();
  const file = join(dir, "run.mjs");
  writeFileSync(file, RUN_MJS);
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}

// ----------------------------------------------------------------- the fake room

type Frame = Record<string, any>;

/** The Durable Object's side of the socket: one runner at a time, every frame it sends kept, and a way to wait for one. */
async function fakeRoom(path = "/v1/rooms/job-1/runner") {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", r));
  cleanups.push(() => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }));
  const port = (wss.address() as AddressInfo).port;
  const frames: Frame[] = [];
  const urls: string[] = [];
  let sock: ServerSocket | null = null;
  const closes: Array<{ code: number }> = [];
  wss.on("connection", (s, req) => {
    sock = s;
    urls.push(req.url ?? "");
    s.on("message", (d) => { try { frames.push(JSON.parse(String(d))); } catch { frames.push({ raw: String(d) }); } });
    s.on("close", (code) => closes.push({ code }));
  });
  const wait = async (test: () => boolean, what: string, ms = 8000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; frames: ${JSON.stringify(frames).slice(0, 800)}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const room = {
    url: `ws://127.0.0.1:${port}${path}`, frames, urls, closes,
    send(m: object) { sock!.send(JSON.stringify(m)); },
    async next(test: (f: Frame) => boolean, what = "a frame", ms = 8000): Promise<Frame> { await wait(() => frames.some(test), what, ms); return frames.find(test)!; },
    async hello(): Promise<Frame> { return room.next((f) => f.t === "hello", "the hello"); },
    /** One command round trip: sends exec, waits for done or error, returns what came back. */
    async exec(id: string, commands: string[], o: { timeoutSec?: number; overlay?: unknown[] } = {}) {
      room.send({ t: "exec", id, commands, timeoutSec: o.timeoutSec ?? 30, overlay: o.overlay ?? [] });
      const end = await room.next((f) => (f.t === "done" || f.t === "error") && f.id === id, `the end of ${id}`);
      return { end, output: room.output(id) };
    },
    output: (id: string) => frames.filter((f) => f.t === "out" && f.id === id).map((f) => f.data).join(""),
    drop(code = 1011) { sock!.close(code); },
    kill() { sock!.terminate(); },
  };
  return room;
}

type Room = Awaited<ReturnType<typeof fakeRoom>>;

/** A ticket that is not a ticket: the script passes it on without reading it, so a plain string does. Built at run time. */
const fakeTicket = (): string => ["not", "a", "real", "ticket", String(Date.now())].join(".");

interface Started { done: Promise<{ exitCode: number; reason: string; commands: number }>; room: Room; dir: string; spec: any; env: NodeJS.ProcessEnv }

/** Starts runSession in a checkout against a fake room, and waits until the runner has said hello. */
async function start(o: { files?: Record<string, string>; silentMs?: number; idleSec?: number; env?: Record<string, string> } = {}): Promise<Started> {
  const m = await loadScript();
  const room = await fakeRoom();
  const dir = checkout(o.files);
  const spec = { jobId: "job-1", stepIdx: 5, epoch: 1, commands: [], session: { url: room.url, ticket: fakeTicket(), idleSec: o.idleSec ?? 120, maxSec: 1200 } };
  const env = { ...process.env, ...(o.env ?? {}) } as NodeJS.ProcessEnv;
  const done = m.runSession(spec, { cwd: dir, env, silentMs: o.silentMs });
  await room.hello();
  return { done, room, dir, spec, env };
}

// ------------------------------------------------------------------ the pieces

describe("run.mjs, session mode: the small pieces", () => {
  it("builds the room's address with the ticket in the query, which is the name the Worker's door reads", async () => {
    const m = await loadScript();
    expect(m.sessionAddress({ url: "wss://jobs.example/v1/rooms/j/runner", ticket: "t1.abc.def" })).toBe("wss://jobs.example/v1/rooms/j/runner?ticket=t1.abc.def");
    expect(m.sessionAddress({ url: "wss://x/y?a=1", ticket: "a b/c" })).toBe("wss://x/y?a=1&ticket=a%20b%2Fc");
  });

  it("knows which paths are secrets, the same kinds the room never holds", async () => {
    const m = await loadScript();
    for (const p of [".env", ".env.production", "app/.env.local", "certs/server.pem", "keys/id_rsa", "id_ed25519", ".npmrc", "config/secrets.json", "secret.yaml", "x/credentials.json", "terraform.tfstate"]) {
      expect(m.secretish(p), p).toBe(true);
    }
    for (const p of [".env.example", "app/.env.sample", "src/secrets.ts", "README.md", "src/keyboard.ts", "docs/environment.md", ".envrc.md"]) expect(m.secretish(p), p).toBe(false);
  });

  it("streams a command's output a whole line at a time, with a half line held until its end, and flush sends the rest", async () => {
    const m = await loadScript();
    const sent: string[] = [];
    const s = m.lineStreamer((d: string) => sent.push(d), []);
    s.write("one\ntw");
    s.tick();
    expect(sent.join("")).toBe("one\n");
    s.write("o\nthree");
    s.tick();
    expect(sent.join("")).toBe("one\ntwo\n");
    s.flush();
    expect(sent.join("")).toBe("one\ntwo\nthree");
  });

  it("replaces secrets in a streamed line, the runner's own values too, and a whole private key however it is split across chunks", async () => {
    const m = await loadScript();
    const sent: string[] = [];
    const own = ["runner", "own", "value", "9f8e7d6c5b4a"].join("-");
    const s = m.lineStreamer((d: string) => sent.push(d), [own]);
    const ghp = ["ghp", "_", "Q1w2E3r4T5".repeat(4)].join("");
    s.write(`token ${ghp}\n`);
    s.write(`value is ${own} here\n`);
    const begin = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
    const end = ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");
    s.write(`${begin}\nMIIEowIBAAKCAQEA0123456789abcdef\nsecondlineofthekey\n${end}\nafter the key\n`);
    s.flush();
    const out = sent.join("");
    expect(out).not.toContain(ghp);
    expect(out).not.toContain(own);
    expect(out).not.toContain("MIIEow");
    expect(out).not.toContain("secondlineofthekey");
    expect(out).toContain("after the key");
    expect(out.match(/\[redacted\]/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it("puts the checkout back as the branch has it, between commands: tracked files restored, the files an overlay made removed, ignored files kept", async () => {
    const m = await loadScript();
    const dir = checkout();
    writeFileSync(join(dir, "src/a.ts"), "changed by a command\n");
    writeFileSync(join(dir, "src/made.ts"), "made by the overlay\n");
    writeFileSync(join(dir, "kept.txt"), "untracked and not laid\n");
    mkdirSync(join(dir, "node_modules/x"), { recursive: true });
    writeFileSync(join(dir, "node_modules/x/i.js"), "installed\n");
    const laid = new Set(["src/made.ts", "src/a.ts", "../outside", ".git/config"]);
    m.resetCheckout(dir, laid);
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(existsSync(join(dir, "src/made.ts"))).toBe(false);
    expect(existsSync(join(dir, "kept.txt"))).toBe(true);
    expect(existsSync(join(dir, "node_modules/x/i.js"))).toBe(true);
    expect(existsSync(join(dir, ".git/config"))).toBe(true);
    expect(laid.size).toBe(0);
  });
});

describe("run.mjs, session mode: git grep and git glob for a repo too big for the room's copy", () => {
  const files = {
    "src/util.ts": "export function add(a, b) {\n  return a + b;\n}\n// TODO: add subtract\n", "src/util.test.ts": "import { add } from './util';\nadd(1, 2);\n",
    "docs/guide.md": "Use add() to add.\n", ".env": "API_KEY=abcdefgh12345678add\n", "config/secrets.json": "{\"add\":\"x\"}\n", ".env.example": "API_KEY=\n",
  };

  it("finds lines in ripgrep's form, with the path and line number, and never in a secret file", async () => {
    const m = await loadScript();
    const dir = checkout(files);
    const r = m.gitGrep({ pattern: "add", maxResults: 100 }, dir);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("src/util.ts:1:export function add(a, b) {");
    expect(r.text).toContain("src/util.test.ts:1:import { add } from './util';");
    expect(r.text).toContain("docs/guide.md:1:Use add() to add.");
    expect(r.text).not.toContain(".env:");
    expect(r.text).not.toContain("abcdefgh12345678");
    expect(r.text).not.toContain("secrets.json");
    expect(r.matches).toBeGreaterThanOrEqual(5);
    expect(r.partial).toBe(false);
  });

  it("takes ignoreCase, filesOnly, a glob and a path, context lines, and a cap that says it cut", async () => {
    const m = await loadScript();
    const dir = checkout(files);
    expect(m.gitGrep({ pattern: "todo" }, dir).matches).toBe(0);
    expect(m.gitGrep({ pattern: "todo", ignoreCase: true }, dir).text).toContain("src/util.ts:4:// TODO: add subtract");
    expect(m.gitGrep({ pattern: "TODO" }, dir).text).toContain("src/util.ts:4:");
    const only = m.gitGrep({ pattern: "add", filesOnly: true }, dir);
    expect(only.text.split("\n").sort()).toEqual(["docs/guide.md", "src/util.test.ts", "src/util.ts"]);
    expect(m.gitGrep({ pattern: "add", glob: "*.test.ts" }, dir).text.split("\n").every((l: string) => l.startsWith("src/util.test.ts:"))).toBe(true);
    expect(m.gitGrep({ pattern: "add", path: "docs" }, dir).text).toBe("docs/guide.md:1:Use add() to add.");
    const ctx = m.gitGrep({ pattern: "subtract", context: 1 }, dir).text;
    expect(ctx).toContain("src/util.ts-3-}");
    expect(ctx).toContain("src/util.ts:4:// TODO: add subtract");
    const cut = m.gitGrep({ pattern: "add", maxResults: 2 }, dir);
    expect(cut.matches).toBe(2);
    expect(cut.partial).toBe(true);
  });

  it("says plainly when git would not run the pattern, and finds nothing without an error", async () => {
    const m = await loadScript();
    const dir = checkout(files);
    const bad = m.gitGrep({ pattern: "(unclosed" }, dir);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/git grep would not run that pattern/);
    expect(m.gitGrep({ pattern: "zzzznotthere" }, dir)).toMatchObject({ ok: true, text: "", matches: 0, partial: false });
  });

  it("lists files for a glob, a bare name meaning any folder, the most recently changed first, and never a secret file", async () => {
    const m = await loadScript();
    const dir = checkout(files);
    const old = new Date("2020-01-01T00:00:00Z");
    for (const p of ["src/util.ts", "docs/guide.md"]) { const full = join(dir, p); execFileSync("touch", ["-d", old.toISOString(), full]); }
    const g = m.gitGlob({ pattern: "*.ts" }, dir);
    expect(g.ok).toBe(true);
    expect(g.paths.sort()).toEqual(["src/a.ts", "src/b.ts", "src/util.test.ts", "src/util.ts"]);
    expect(g.paths.at(-1)).toBe("src/util.ts");
    expect(g.total).toBe(4);
    expect(m.gitGlob({ pattern: "src/**/*.test.ts" }, dir).paths).toEqual(["src/util.test.ts"]);
    const everything = m.gitGlob({ pattern: "**" }, dir).paths as string[];
    expect(everything).not.toContain(".env");
    expect(everything).not.toContain("config/secrets.json");
    expect(everything).toContain(".env.example");
  });
});

// -------------------------------------------------------------------- the session

describe("run.mjs, session mode: against a fake room", () => {
  it("connects to the room's address with the ticket and says hello as a GitHub runner, in a frame the room's parser accepts", async () => {
    const s = await start();
    expect(s.room.urls).toHaveLength(1);
    expect(s.room.urls[0]).toBe(`/v1/rooms/job-1/runner?ticket=${encodeURIComponent(s.spec.session.ticket)}`);
    const hello = s.room.frames.find((f) => f.t === "hello")!;
    expect(hello).toMatchObject({ t: "hello", v: 1, kind: "github" });
    expect(parseFromRunner(JSON.stringify(hello))).not.toBeNull();
    s.room.send({ t: "close", reason: "job_end" });
    expect(await s.done).toEqual({ exitCode: 0, reason: "job_end", commands: 0 });
  });

  it("answers a ping", async () => {
    const s = await start();
    s.room.send({ t: "ping", at: 12345 });
    expect(await s.room.next((f) => f.t === "pong")).toEqual({ t: "pong", at: 12345 });
    s.room.send({ t: "close", reason: "idle" });
    await s.done;
  });

  it("runs a command in the checkout, streams what it prints, and ends with the exit code, the time it took and nothing about timing out", async () => {
    const s = await start();
    const r = await s.room.exec("e1", ["echo first", "pwd", "echo second >&2", "exit 0"]);
    expect(r.end).toMatchObject({ t: "done", id: "e1", exitCode: 0, timedOut: false });
    expect(typeof r.end.ms).toBe("number");
    expect(r.output).toContain("$ echo first\nfirst\n");
    expect(r.output).toContain(`$ pwd\n${execFileSync("realpath", [s.dir], { encoding: "utf8" }).trim()}\n`);
    expect(r.output).toContain("second");
    for (const f of s.room.frames.filter((x) => x.t === "out" || x.t === "done")) expect(parseFromRunner(JSON.stringify(f)), JSON.stringify(f)).not.toBeNull();
    s.room.send({ t: "close", reason: "job_end" });
    expect(await s.done).toMatchObject({ exitCode: 0, commands: 1 });
  });

  it("reports the exit code of a command that fails, stops at it, and takes the next command at once", async () => {
    const s = await start();
    const bad = await s.room.exec("e1", ["echo before", "sh -c 'exit 3'", "echo never"]);
    expect(bad.end).toMatchObject({ t: "done", exitCode: 3, timedOut: false });
    expect(bad.output).toContain("before");
    expect(bad.output).not.toContain("never");
    const good = await s.room.exec("e2", ["echo again"]);
    expect(good.end).toMatchObject({ t: "done", exitCode: 0 });
    expect(good.output).toContain("again");
    s.room.send({ t: "close", reason: "job_end" });
    expect(await s.done).toMatchObject({ commands: 2 });
  });

  it("is quick for the second command: nothing is installed or fetched again between commands", async () => {
    const s = await start();
    await s.room.exec("e1", ["mkdir -p node_modules/dep && echo installed > node_modules/dep/index.js"]);
    const t0 = Date.now();
    const r = await s.room.exec("e2", ["cat node_modules/dep/index.js"]);
    expect(r.output).toContain("installed");
    expect(Date.now() - t0).toBeLessThan(3000);
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("lays the staged edits for the command, and the next command sees the branch again, with what was installed kept", async () => {
    const s = await start();
    const first = await s.room.exec("e1", ["cat src/a.ts", "ls src", "echo scribble >> src/b.ts", "mkdir -p node_modules/x && echo i > node_modules/x/i.js"], {
      overlay: [{ path: "src/a.ts", content: "export const a = 42;\n" }, { path: "src/new.ts", content: "export const n = 1;\n" }, { path: "src/b.ts", content: null }, { path: ".github/workflows/ci.yml", content: "evil" }],
    });
    expect(first.end).toMatchObject({ exitCode: 0 });
    expect(first.output).toContain("export const a = 42;");
    expect(first.output).toContain("new.ts");
    expect(first.output).toContain("[Tailzu: could not lay .github/workflows/ci.yml]");
    expect(existsSync(join(s.dir, ".github/workflows/ci.yml"))).toBe(false);
    const second = await s.room.exec("e2", ["cat src/a.ts", "ls src", "cat src/b.ts", "ls node_modules/x"]);
    expect(second.output).toContain("export const a = 1;");
    expect(second.output).not.toContain("export const a = 42;");
    expect(second.output).not.toContain("new.ts");
    expect(second.output).toContain("export const b = 2;");
    expect(second.output).not.toContain("scribble");
    expect(second.output).toContain("i.js");
    // an overlay that is sent again, the full set each time, is laid again
    const third = await s.room.exec("e3", ["cat src/a.ts"], { overlay: [{ path: "src/a.ts", content: "export const a = 43;\n" }] });
    expect(third.output).toContain("export const a = 43;");
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("does not put a symlink's target in the room's hands, or write through one", async () => {
    const outside = scratch();
    writeFileSync(join(outside, "target.txt"), "original\n");
    const s = await start();
    execFileSync("ln", ["-s", outside, join(s.dir, "linked")]);
    const r = await s.room.exec("e1", ["true"], { overlay: [{ path: "linked/target.txt", content: "overwritten\n" }] });
    expect(r.end).toMatchObject({ exitCode: 0 });
    expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("original\n");
    expect(r.output).toContain("could not lay linked/target.txt");
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("keeps secrets out of what it streams, and hides the way to ask GitHub for an identity from the commands", async () => {
    const own = ["session", "env", "secret", "value", "0123456789"].join("-");
    const idToken = ["id", "request", "value", "abcdef123456"].join("-");
    const s = await start({ env: { MY_API_TOKEN: own, ACTIONS_ID_TOKEN_REQUEST_TOKEN: idToken, ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:1/token" } });
    const ghp = ["ghp", "_", "Z9y8X7w6V5".repeat(4)].join("");
    const r = await s.room.exec("e1", [`echo ${ghp}`, "echo $MY_API_TOKEN", "echo password=correcthorsebatterystaple", "env | grep -c ACTIONS_ID_TOKEN || true", "echo a normal line"]);
    expect(r.output).not.toContain(ghp);
    expect(r.output).not.toContain(own);
    expect(r.output).not.toContain("correcthorsebatterystaple");
    expect(r.output).toContain("[redacted]");
    expect(r.output).toContain("a normal line");
    expect(r.output).toMatch(/\$ env \| grep -c ACTIONS_ID_TOKEN \|\| true\n0\n/);
    expect(JSON.stringify(s.room.frames)).not.toContain(idToken);
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("stops a command that runs past its time: exit 124, timedOut, the next command still works", async () => {
    const s = await start();
    const t0 = Date.now();
    const r = await s.room.exec("e1", ["echo start", "sleep 30", "echo never"], { timeoutSec: 1 });
    expect(Date.now() - t0).toBeLessThan(12_000);
    expect(r.end).toMatchObject({ t: "done", exitCode: 124, timedOut: true });
    expect(r.output).toContain("start");
    expect(r.output).toMatch(/stopped after 1 seconds/);
    expect(r.output).not.toContain("never");
    const next = await s.room.exec("e2", ["echo still here"]);
    expect(next.end).toMatchObject({ exitCode: 0 });
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("gives a command that comes with no time a long default, rather than killing it at once", async () => {
    const s = await start();
    s.room.send({ t: "exec", id: "e1", commands: ["echo ok"] });
    const end = await s.room.next((f) => f.t === "done" && f.id === "e1");
    expect(end).toMatchObject({ exitCode: 0, timedOut: false });
    expect(s.room.output("e1")).toContain("ok");
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("stops a command on cancel, and one command at a time: a second exec while one runs is refused as busy", async () => {
    const s = await start();
    s.room.send({ t: "exec", id: "slow", commands: ["echo started", "sleep 30"], timeoutSec: 60 });
    await s.room.next((f) => f.t === "out" && f.id === "slow" && String(f.data).includes("started"));
    s.room.send({ t: "exec", id: "second", commands: ["echo no"], timeoutSec: 5 });
    expect(await s.room.next((f) => f.t === "error" && f.id === "second")).toMatchObject({ code: "busy" });
    const t0 = Date.now();
    s.room.send({ t: "cancel", id: "slow" });
    const end = await s.room.next((f) => f.t === "done" && f.id === "slow");
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(end.exitCode).toBe(130);
    expect(s.room.output("slow")).toContain("[Tailzu: stopped]");
    expect(s.room.output("second")).toBe("");
    // a cancel for another id does nothing
    const next = await s.room.exec("e3", ["echo fine"]);
    expect(next.end).toMatchObject({ exitCode: 0 });
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("answers a grep and a glob from the checkout, for the room to pass on", async () => {
    const s = await start({ files: { "src/util.ts": "export function add() {}\n", ".env": "SECRET_ADD=1\n" } });
    s.room.send({ t: "grep", id: "g1", pattern: "add", maxResults: 10 });
    const found = await s.room.next((f) => f.t === "found" && f.id === "g1");
    expect(found.ok).toBe(true);
    expect(found.text).toContain("src/util.ts:1:export function add() {}");
    expect(found.text).not.toContain(".env");
    s.room.send({ t: "glob", id: "g2", pattern: "src/*.ts" });
    const globbed = await s.room.next((f) => f.t === "found" && f.id === "g2");
    expect(globbed.paths.sort()).toEqual(["src/a.ts", "src/b.ts", "src/util.ts"]);
    for (const f of [found, globbed]) expect(parseFromRunner(JSON.stringify(f)), JSON.stringify(f)).not.toBeNull();
    s.room.send({ t: "close", reason: "job_end" });
    await s.done;
  });

  it("leaves when the room closes, saying why, and closes its end of the socket", async () => {
    const s = await start();
    s.room.send({ t: "close", reason: "needs_you" });
    expect(await s.done).toEqual({ exitCode: 0, reason: "needs_you", commands: 0 });
    await vi.waitFor(() => expect(s.room.closes.length).toBeGreaterThan(0));
    expect(s.room.closes[0]!.code).toBe(1000);
  });

  it("leaves when the room has said nothing for the idle time and a grace (the room's own alarm should have closed it first)", async () => {
    const s = await start({ silentMs: 300 });
    const t0 = Date.now();
    const ended = await s.done;
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(ended).toMatchObject({ exitCode: 0, reason: "the room was silent" });
  });

  it("is not made to leave by a long command: the time the room has been silent counts from the command's end", async () => {
    const s = await start({ silentMs: 1500 });
    const r = await s.room.exec("e1", ["sleep 2.5", "echo long one"], { timeoutSec: 20 });
    expect(r.end).toMatchObject({ exitCode: 0 });
    s.room.send({ t: "close", reason: "job_end" });
    expect(await s.done).toMatchObject({ reason: "job_end", commands: 1 });
  });

  it("ends with a failure when the socket drops without a close, and when the room is not there at all", async () => {
    const s = await start();
    s.room.kill();
    expect(await s.done).toMatchObject({ exitCode: 1, reason: "closed" });
    const m = await loadScript();
    const none = await fakeRoom();
    const url = none.url;
    await new Promise((r) => setTimeout(r, 10));
    for (const c of cleanups.splice(0)) await c();
    const dir = checkout();
    const ended = await m.runSession({ jobId: "j", stepIdx: 1, epoch: 1, commands: [], session: { url, ticket: fakeTicket(), idleSec: 5, maxSec: 60 } }, { cwd: dir, env: process.env });
    expect(ended.exitCode).toBe(1);
  });

  it("is refused by a room that wants another ticket: the socket never opens and the step ends red", async () => {
    const m = await loadScript();
    const http = createServer((_req, res) => { res.statusCode = 401; res.end("no"); });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    cleanups.push(() => { http.close(); http.closeAllConnections?.(); });
    const port = (http.address() as AddressInfo).port;
    const dir = checkout();
    const ended = await m.runSession({ jobId: "j", stepIdx: 1, epoch: 1, commands: [], session: { url: `ws://127.0.0.1:${port}/v1/rooms/j/runner`, ticket: fakeTicket(), idleSec: 5, maxSec: 60 } }, { cwd: dir, env: process.env });
    expect(ended).toMatchObject({ exitCode: 1, reason: "the socket failed" });
  });

  it("says so if this Node has no WebSocket, rather than hanging", async () => {
    const m = await loadScript();
    const ended = await m.runSession({ jobId: "j", stepIdx: 1, epoch: 1, commands: [], session: { url: "ws://127.0.0.1:1/x", ticket: "t", idleSec: 5, maxSec: 60 } }, { cwd: checkout(), env: process.env, WebSocket: "nope" });
    expect(ended).toMatchObject({ exitCode: 1 });
    expect(ended.reason).toContain("need 22");
  });
});

// ----------------------------------------------------------- the whole script, run by node

interface Reported { tokenRequests: Array<{ url: string; auth?: string }>; results: Array<{ auth?: string; body: any }> }

async function stub(o: { resultStatus?: number } = {}) {
  const seen: Reported = { tokenRequests: [], results: [] };
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET" && req.url?.startsWith("/token")) {
        seen.tokenRequests.push({ url: req.url, auth: req.headers.authorization });
        res.end(JSON.stringify({ value: "fake.oidc.token" }));
      } else if (req.method === "POST" && req.url === "/result") {
        seen.results.push({ auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
        res.statusCode = o.resultStatus ?? 200;
        res.end("{}");
      } else { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => { server.close(); server.closeAllConnections?.(); });
  return { port: (server.address() as AddressInfo).port, seen };
}

/** `node .tailzu/run.mjs` in a checkout whose step.json has a session, started and left running, with the room and the report address standing by. */
async function wholeRun(o: { identity?: boolean; resultStatus?: number } = {}) {
  const room = await fakeRoom();
  const srv = await stub({ resultStatus: o.resultStatus });
  const dir = checkout();
  mkdirSync(join(dir, ".tailzu"), { recursive: true });
  const spec = {
    jobId: "job-1", stepIdx: 5, epoch: 1, commands: ["tailzu:live-session"], timeoutSec: 1200, baseSha: git(dir, "rev-parse", "HEAD"),
    resultUrl: `http://127.0.0.1:${srv.port}/result`, audience: "tailzu", discard: true,
    session: { url: room.url, ticket: fakeTicket(), idleSec: 120, maxSec: 1200 },
  };
  writeFileSync(join(dir, ".tailzu/step.json"), stepJson(spec));
  writeFileSync(join(dir, ".tailzu/run.mjs"), RUN_MJS);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "shadow");
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (o.identity !== false) {
    env.ACTIONS_ID_TOKEN_REQUEST_URL = `http://127.0.0.1:${srv.port}/token?api-version=2.0`;
    env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "request-token-0123456789";
  }
  const exit = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile("node", [".tailzu/run.mjs"], { cwd: dir, env, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, stdout, stderr });
    });
  });
  return { room, seen: srv.seen, dir, exit };
}

describe("run.mjs, session mode: the whole script run by node", () => {
  it("opens the session, runs what the room sends in the checkout, and reports to Tailzu with the identity token when the room closes it", async () => {
    const r = await wholeRun();
    await r.room.hello();
    const ran = await r.room.exec("e1", ["echo from the live session", "echo written > made.txt"]);
    expect(ran.end).toMatchObject({ exitCode: 0 });
    expect(ran.output).toContain("from the live session");
    r.room.send({ t: "close", reason: "job_end" });
    const ended = await r.exit;
    expect(ended.code).toBe(0);
    expect(r.seen.tokenRequests).toHaveLength(1);
    expect(new URL(`http://x${r.seen.tokenRequests[0]!.url}`).searchParams.get("audience")).toBe("tailzu");
    expect(r.seen.results).toHaveLength(1);
    const { auth, body } = r.seen.results[0]!;
    expect(auth).toBe("Bearer fake.oidc.token");
    expect(Object.keys(body).sort()).toEqual(["changes", "epoch", "exitCode", "jobId", "minutes", "outputTail", "stepIdx"]);
    expect(body).toMatchObject({ jobId: "job-1", stepIdx: 5, epoch: 1, exitCode: 0, changes: [] });
    expect(body.outputTail).toBe("[Tailzu: live session ended (job_end); 1 command(s) run]");
    expect(typeof body.minutes).toBe("number");
    expect(body.minutes).toBeGreaterThan(0);
    expect(body.minutes).toBeLessThan(1);
  });

  it("does not run the step's commands as a command line: the session command is not a program", async () => {
    const r = await wholeRun();
    await r.room.hello();
    r.room.send({ t: "close", reason: "idle" });
    await r.exit;
    expect(r.seen.results[0]!.body.outputTail).toContain("0 command(s) run");
    expect(r.seen.results[0]!.body.outputTail).not.toContain("not found");
  });

  it("says the room was not reached when it ends because the socket dropped, with a failure exit", async () => {
    const r = await wholeRun();
    await r.room.hello();
    r.room.kill();
    const ended = await r.exit;
    expect(ended.code).toBe(1);
    expect(r.seen.results[0]!.body.exitCode).toBe(1);
  });

  it("without an identity token cannot report: it says so and fails", async () => {
    const r = await wholeRun({ identity: false });
    await r.room.hello();
    r.room.send({ t: "close", reason: "idle" });
    const ended = await r.exit;
    expect(ended.code).toBe(1);
    expect(ended.stderr).toMatch(/not given an identity token/);
    expect(r.seen.results).toHaveLength(0);
  });

  it("treats a 409 (the step went to another computer) as not its failure", async () => {
    const r = await wholeRun({ resultStatus: 409 });
    await r.room.hello();
    r.room.send({ t: "close", reason: "idle" });
    expect((await r.exit).code).toBe(0);
  });
});
