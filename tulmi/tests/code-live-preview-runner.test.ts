/**
 * The runner's side of the PREVIEW: `.tailzu/run.mjs` in session mode starts the project's dev server in the background when the room sends `preview`,
 * serves the `http` frames the room sends it, and kills it on `preview-stop`, on a command, and when the session ends. The "dev server" here is a
 * tiny Node HTTP server in the checkout; the room is a WebSocket server on 127.0.0.1 that plays the Durable Object. Nothing reaches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
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
const { parseFromRunner, parseToRunner } = await import("../src/code/live/protocol.js");

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "tailzu-preview-run-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/** The "dev server": listens on $PORT (or the port in argv[2], which it prints and nothing else, like a server that ignores PORT), prints Vite's line. */
const DEV_SERVER = String.raw`
const http = require("node:http");
const fs = require("node:fs");
const fixed = Number(process.argv[2]) || 0;
const port = fixed || Number(process.env.PORT);
const host = process.env.HOST || "127.0.0.1";
if (process.env.PIDFILE) fs.writeFileSync(process.env.PIDFILE, String(process.pid));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.setHeader("x-frame-options", "DENY");
      res.setHeader("content-security-policy", "default-src 'self'; frame-ancestors 'none'");
      res.end('<!doctype html><script type="module" src="/src/main.js"></script><h1>Hello from the dev server</h1>');
    } else if (url.pathname === "/src/main.js") {
      res.setHeader("content-type", "text/javascript");
      res.end('document.title = "main";');
    } else if (url.pathname === "/env") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ PORT: process.env.PORT, HOST: process.env.HOST, BROWSER: process.env.BROWSER, host: req.headers.host, hasToken: !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }));
    } else if (url.pathname === "/echo") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ method: req.method, query: url.search, body: body.toString("utf8"), headers: req.headers }));
    } else if (url.pathname === "/redirect") {
      res.statusCode = 302;
      res.setHeader("location", "http://localhost:" + port + "/target?x=1");
      res.end();
    } else if (url.pathname === "/cookie") {
      res.setHeader("set-cookie", ["a=1; Path=/; Domain=.preview.example; HttpOnly", "b=2; Path=/"]);
      res.end("cookies");
    } else if (url.pathname === "/big") {
      const n = Number(url.searchParams.get("mb") || 1) * 1024 * 1024;
      res.setHeader("content-type", "application/octet-stream");
      res.write(Buffer.alloc(n, 97));
      res.end();
    } else if (url.pathname === "/slow") {
      // never answers
    } else if (url.pathname === "/missing") {
      res.statusCode = 404;
      res.end("nope");
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
});
server.listen(port, host, () => {
  console.log("  VITE v5.4.0  ready in 123 ms");
  console.log("  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m" + port + "\u001b[22m/\u001b[39m");
  if (process.env.LEAK) console.log("token " + process.env.LEAK);
});
`;

/** A checkout as the runner has it: a git repo with the dev server in it. */
function checkout(files: Record<string, string> = {}): string {
  const dir = scratch();
  git(dir, "init", "-q", "-b", "main");
  const all: Record<string, string> = { ".gitignore": "node_modules/\n", "server.js": DEV_SERVER, "package.json": '{"name":"app"}\n', "src/a.ts": "export const a = 1;\n", ...files };
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

type Frame = Record<string, any>;

async function fakeRoom() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", r));
  cleanups.push(() => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }));
  const port = (wss.address() as AddressInfo).port;
  const frames: Frame[] = [];
  let sock: ServerSocket | null = null;
  wss.on("connection", (s) => {
    sock = s;
    s.on("message", (d) => { try { frames.push(JSON.parse(String(d))); } catch { frames.push({ raw: String(d) }); } });
  });
  const wait = async (test: () => boolean, what: string, ms = 15000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; frames: ${JSON.stringify(frames.map((f) => ({ ...f, data: f.data ? "…" : undefined }))).slice(0, 1500)}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  let n = 0;
  const room = {
    url: `ws://127.0.0.1:${port}/v1/rooms/job-1/runner`, frames,
    send(m: object) { sock!.send(JSON.stringify(m)); },
    async next(test: (f: Frame) => boolean, what = "a frame", ms?: number): Promise<Frame> { await wait(() => frames.some(test), what, ms); return frames.find(test)!; },
    /** Starts the preview and waits for the runner to say how it went. */
    async preview(o: Partial<Frame> = {}): Promise<Frame> {
      const id = `p${(n += 1)}`;
      room.send({ t: "preview", id, cmd: "node server.js", readySec: 30, idleSec: 300, overlay: [], ...o });
      return room.next((f) => f.t === "preview" && f.id === id, "the preview's answer", ((o.readySec ?? 30) + 15) * 1000);
    },
    /** One request through the preview: the head, the body, or the error. */
    async http(path: string, o: { method?: string; headers?: Array<[string, string]>; body?: string } = {}): Promise<{ head?: Frame; body: Buffer; pieces: number; error?: Frame }> {
      const id = `h${(n += 1)}`;
      room.send({ t: "http", id, method: o.method ?? "GET", path, headers: o.headers ?? [], ...(o.body !== undefined ? { body: Buffer.from(o.body).toString("base64") } : {}) });
      await room.next((f) => f.id === id && ((f.t === "res-data" && f.last) || f.t === "res-error"), `the end of ${id}`);
      const mine = frames.filter((f) => f.id === id);
      const data = mine.filter((f) => f.t === "res-data");
      return { head: mine.find((f) => f.t === "res"), body: Buffer.concat(data.map((f) => Buffer.from(f.data, "base64"))), pieces: data.length, error: mine.find((f) => f.t === "res-error") };
    },
    async hello(): Promise<Frame> { return room.next((f) => f.t === "hello", "the hello"); },
    close() { room.send({ t: "close", reason: "job_end" }); },
  };
  return room;
}

type Room = Awaited<ReturnType<typeof fakeRoom>>;
const fakeTicket = (): string => ["not", "a", "real", "ticket", String(Date.now())].join(".");

async function start(o: { files?: Record<string, string>; env?: Record<string, string>; silentMs?: number } = {}) {
  const m = await loadScript();
  const room = await fakeRoom();
  const dir = checkout(o.files);
  const spec = { jobId: "job-1", stepIdx: 5, epoch: 1, commands: [], session: { url: room.url, ticket: fakeTicket(), idleSec: 120, maxSec: 1200 } };
  const env = { ...process.env, ...(o.env ?? {}) } as NodeJS.ProcessEnv;
  const done = m.runSession(spec, { cwd: dir, env, silentMs: o.silentMs });
  await room.hello();
  return { m, done, room, dir, env };
}

const freePort = (): Promise<number> => new Promise((r) => { const srv = net.createServer(); srv.listen(0, "127.0.0.1", () => { const p = (srv.address() as AddressInfo).port; srv.close(() => r(p)); }); });
const json = (b: Buffer): any => JSON.parse(b.toString("utf8"));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async (pid: number, ms = 6000): Promise<boolean> => { const t0 = Date.now(); while (alive(pid)) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };

// ------------------------------------------------------------------ the pieces

describe("the preview, the small pieces", () => {
  it("reads the port from what a dev server prints, the newest last, never one it was refused", async () => {
    const m = await loadScript();
    expect(m.detectPorts("  VITE v5.4.0  ready in 123 ms\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose\n")).toEqual([5173]);
    expect(m.detectPorts("\u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m4321\u001b[22m/\u001b[39m")).toEqual([4321]);
    // Vite's "in use" line names a port that is somebody else's; the one it moved to is ours.
    expect(m.detectPorts("Port 5173 is in use, trying another one...\n  Local:   http://localhost:5174/\n")).toEqual([5174]);
    expect(m.detectPorts("Server listening on port 3000\n")).toEqual([3000]);
    expect(m.detectPorts("Express app ready on 0.0.0.0:3001\n")).toEqual([3001]);
    expect(m.detectPorts("▲ Next.js 14.2.3\n   - Local:        http://localhost:3002\n ✓ Ready in 1.9s\n")).toEqual([3002]);
    expect(m.detectPorts("webpack compiled\nProject is running at:\nLoopback: http://localhost:8080/, http://[::1]:8080/\n")).toEqual([8080]);
    expect(m.detectPorts("Listening on :9000")).toEqual([9000]);
    expect(m.detectPorts("Error: listen EADDRINUSE: address already in use :::3000\n")).toEqual([]);
    expect(m.detectPorts("nothing here, no port, version 22.4.1")).toEqual([]);
    expect(m.detectPorts("http://localhost:3000 then http://localhost:3001")).toEqual([3000, 3001]);
  });

  it("strips colour codes", async () => {
    const m = await loadScript();
    expect(m.stripAnsi("\u001b[1m\u001b[32mok\u001b[39m\u001b[22m \u001b]0;title\u0007done")).toBe("ok done");
  });
});

describe("the protocol's frames for the preview", () => {
  it("the runner's frames parse, and a frame that is not one is refused", () => {
    expect(parseFromRunner(JSON.stringify({ t: "preview", id: "p1", ok: true, port: 5173, ms: 812.4 }))).toEqual({ t: "preview", id: "p1", ok: true, port: 5173, ms: 812 });
    expect(parseFromRunner(JSON.stringify({ t: "preview", id: "p1", ok: false, error: "it stopped" }))).toEqual({ t: "preview", id: "p1", ok: false, error: "it stopped" });
    expect(parseFromRunner(JSON.stringify({ t: "preview", id: "p1", ok: true, port: 0, ms: 1 }))).toBeNull();
    expect(parseFromRunner(JSON.stringify({ t: "res", id: "h1", status: 200, headers: [["content-type", "text/html"], ["set-cookie", "a=1"]] }))?.t).toBe("res");
    expect(parseFromRunner(JSON.stringify({ t: "res", id: "h1", status: 99, headers: [] }))).toBeNull();
    expect(parseFromRunner(JSON.stringify({ t: "res", id: "h1", status: 200, headers: [["bad name", "x"]] }))).toBeNull();
    expect(parseFromRunner(JSON.stringify({ t: "res", id: "h1", status: 200, headers: [["x", "line\nbreak"]] }))).toBeNull();
    expect(parseFromRunner(JSON.stringify({ t: "res-data", id: "h1", data: "aGk=", last: true }))?.t).toBe("res-data");
    expect(parseFromRunner(JSON.stringify({ t: "res-data", id: "h1", data: "aGk=" }))).toBeNull();
    expect(parseFromRunner(JSON.stringify({ t: "res-error", id: "h1", code: "too_large" }))?.t).toBe("res-error");
    expect(parseFromRunner(JSON.stringify({ t: "res-error", id: "h1", code: "whatever" }))).toBeNull();
    expect(parseFromRunner(JSON.stringify({ t: "preview-ended", id: "p1", reason: "exit" }))?.t).toBe("preview-ended");
  });

  it("the room's frames parse: a path must be root-relative, a method one we know, a header well formed", () => {
    const ok = { t: "http", id: "h1", method: "POST", path: "/api/x?y=1", headers: [["content-type", "application/json"]], body: Buffer.from("{}").toString("base64") };
    expect(parseToRunner(JSON.stringify(ok))?.t).toBe("http");
    for (const bad of [{ path: "api" }, { path: "//evil.example/x" }, { path: "/a b" }, { path: "/a\\b" }, { method: "TRACE" }, { method: "CONNECT" }, { headers: [["x", "a\r\nb: c"]] }, { headers: "no" }, { body: "***" }]) {
      expect(parseToRunner(JSON.stringify({ ...ok, ...bad })), JSON.stringify(bad)).toBeNull();
    }
    expect(parseToRunner(JSON.stringify({ t: "preview", id: "p1", cmd: "npm run dev", readySec: 90, idleSec: 300, overlay: [{ path: "a.ts", content: "x" }] }))?.t).toBe("preview");
    expect(parseToRunner(JSON.stringify({ t: "preview", id: "p1", cmd: "  ", readySec: 90, idleSec: 300, overlay: [] }))).toBeNull();
    expect(parseToRunner(JSON.stringify({ t: "preview", id: "p1", cmd: "npm run dev", readySec: 1, idleSec: 300, overlay: [] }))).toBeNull();
    expect(parseToRunner(JSON.stringify({ t: "preview-stop" }))?.t).toBe("preview-stop");
    expect(parseToRunner(JSON.stringify({ t: "http-cancel", id: "h1" }))?.t).toBe("http-cancel");
  });
});

// ------------------------------------------------------------------ a whole preview

describe("run.mjs, preview: the dev server in the background, and HTTP through it", () => {
  it("starts the server with PORT, HOST and BROWSER, reads its port from what it prints, health-checks it, and serves requests with absolute paths", async () => {
    const s = await start({ env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-only-identity-token-value" } });
    const ready = await s.room.preview();
    expect(ready).toMatchObject({ t: "preview", ok: true });
    expect(ready.port).toBeGreaterThan(1024);
    expect(ready.ms).toBeGreaterThanOrEqual(0);

    const page = await s.room.http("/");
    expect(page.head).toMatchObject({ t: "res", status: 200 });
    expect(page.body.toString()).toContain("Hello from the dev server");
    // The absolute path the page asks for next just works.
    const js = await s.room.http("/src/main.js");
    expect(js.body.toString()).toBe('document.title = "main";');
    expect(js.head!.headers.find((h: string[]) => h[0].toLowerCase() === "content-type")![1]).toBe("text/javascript");

    const env = json((await s.room.http("/env")).body);
    expect(env).toMatchObject({ PORT: String(ready.port), HOST: "127.0.0.1", BROWSER: "none", host: `localhost:${ready.port}`, hasToken: false });
    expect((await s.room.http("/missing")).head!.status).toBe(404);

    s.room.close();
    expect((await s.done).exitCode).toBe(0);
  }, 40000);

  it("takes the port from the output when the server ignores PORT, and from the message when it is given", async () => {
    // A server that listens where it likes and says so.
    const free = await freePort();
    const a = await start();
    const ra = await a.room.preview({ cmd: `node server.js ${free}` });
    expect(ra).toMatchObject({ ok: true, port: free });
    expect(json((await a.room.http("/env")).body).PORT).not.toBe(String(free)); // PORT was a different one: the runner followed the output
    a.room.close();
    await a.done;

    const free2 = await freePort();
    const b = await start();
    const rb = await b.room.preview({ cmd: `node server.js ${free2} > /dev/null`, port: free2 });
    expect(rb).toMatchObject({ ok: true, port: free2 });
    b.room.close();
    await b.done;
  }, 60000);

  it("passes the method, the query, the body and the headers through, and tells the server it is localhost", async () => {
    const s = await start();
    await s.room.preview();
    const echo = json((await s.room.http("/echo?a=1&b=two", { method: "POST", headers: [["content-type", "application/json"], ["x-custom", "yes"], ["cookie", "k=v"], ["origin", "https://abc.preview.example"], ["accept-encoding", "gzip"]], body: '{"hello":"world"}' })).body);
    expect(echo).toMatchObject({ method: "POST", query: "?a=1&b=two", body: '{"hello":"world"}' });
    expect(echo.headers).toMatchObject({ "x-custom": "yes", cookie: "k=v", "content-type": "application/json", "accept-encoding": "identity" });
    expect(echo.headers.host).toMatch(/^localhost:\d+$/);
    expect(echo.headers["content-length"]).toBe("17");
    // HEAD has no body but still ends.
    const head = await s.room.http("/", { method: "HEAD" });
    expect(head.head!.status).toBe(200);
    expect(head.body.length).toBe(0);
    s.room.close();
    await s.done;
  }, 40000);

  it("sends a big response in pieces of at most 192 KB, whole, and stops one that passes 10 MB with `too_large`", async () => {
    const s = await start();
    await s.room.preview();
    const big = await s.room.http("/big?mb=2");
    expect(big.body.length).toBe(2 * 1024 * 1024);
    expect(big.body.every((b) => b === 97)).toBe(true);
    expect(big.pieces).toBeGreaterThanOrEqual(11);
    for (const f of s.room.frames.filter((f) => f.t === "res-data")) expect(Buffer.from(f.data, "base64").length).toBeLessThanOrEqual(192 * 1024);

    const tooBig = await s.room.http("/big?mb=11");
    expect(tooBig.error).toMatchObject({ t: "res-error", code: "too_large" });
    // The server is fine afterwards.
    expect((await s.room.http("/")).head!.status).toBe(200);
    // Exactly at the limit is allowed.
    const edge = await s.room.http("/big?mb=10");
    expect(edge.error).toBeUndefined();
    expect(edge.body.length).toBe(10 * 1024 * 1024);
    s.room.close();
    await s.done;
  }, 60000);

  it("answers many requests at once, each to its own id, and cancels one that never ends", async () => {
    const s = await start();
    await s.room.preview();
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    for (const id of ids) s.room.send({ t: "http", id, method: "GET", path: `/echo?n=${id}`, headers: [] });
    s.room.send({ t: "http", id: "slow", method: "GET", path: "/slow", headers: [] });
    await s.room.next((f) => f.id === "c11" && f.t === "res-data" && f.last, "the last of twelve");
    for (const id of ids) {
      const body = Buffer.concat(s.room.frames.filter((f) => f.id === id && f.t === "res-data").map((f) => Buffer.from(f.data, "base64")));
      expect(json(body).query).toBe(`?n=${id}`);
    }
    // /slow is still out; cancelling it ends nothing on the wire, and a new request still works.
    s.room.send({ t: "http-cancel", id: "slow" });
    expect((await s.room.http("/")).head!.status).toBe(200);
    expect(s.room.frames.some((f) => f.id === "slow")).toBe(false);
    s.room.close();
    await s.done;
  }, 40000);

  it("refuses a request that is not a path, or when no preview is running", async () => {
    const s = await start();
    const none = await s.room.http("/");
    expect(none.error).toMatchObject({ code: "unreachable" });
    await s.room.preview();
    // The room's parser would never send these; the runner does not trust it.
    s.room.send({ t: "http", id: "bad1", method: "GET", path: "//evil.example/x", headers: [] });
    await s.room.next((f) => f.id === "bad1", "the refusal");
    expect(s.room.frames.find((f) => f.id === "bad1")).toMatchObject({ t: "res-error", code: "bad_request" });
    s.room.close();
    await s.done;
  }, 40000);

  it("says what went wrong when the server stops before it answers, with the end of what it printed and no secret in it", async () => {
    const s = await start();
    const token = ["ghp", "_", "Q1w2E3r4T5".repeat(4)].join("");
    const r = await s.room.preview({ cmd: `echo "starting"; echo "boom: ${token}" >&2; exit 3` });
    expect(r).toMatchObject({ t: "preview", ok: false });
    expect(r.error).toContain("exit 3");
    expect(r.error).toContain("boom");
    expect(r.error).not.toContain(token);
    // And a server that never answers is given up on and killed.
    const t0 = Date.now();
    const slow = await s.room.preview({ cmd: "sleep 60", readySec: 5 });
    expect(slow).toMatchObject({ ok: false });
    expect(slow.error).toMatch(/did not answer within 5 seconds/);
    expect(Date.now() - t0).toBeLessThan(15000);
    s.room.close();
    await s.done;
  }, 60000);

  it("streams the boot output redacted, and kills the whole tree on preview-stop, on a command and when the session ends", async () => {
    const pidfile = join(scratch(), "pid");
    const leak = ["ghp", "_", "Z9y8X7w6V5".repeat(4)].join("");
    const s = await start({ env: { PIDFILE: pidfile, LEAK: leak } });
    const r = await s.room.preview();
    expect(r.ok).toBe(true);
    const pid = Number(readFileSync(pidfile, "utf8"));
    expect(alive(pid)).toBe(true);
    const out = s.room.frames.filter((f) => f.t === "out").map((f) => f.data).join("");
    expect(out).toContain("Local:");
    expect(out).toContain("$ node server.js");
    expect(out).not.toContain(leak);

    // preview-stop
    s.room.send({ t: "preview-stop", reason: "idle" });
    await s.room.next((f) => f.t === "preview-ended" && /idle/.test(f.reason), "preview-ended");
    expect(await gone(pid)).toBe(true);

    // A command takes the checkout: the server goes, and the runner says so.
    const r2 = await s.room.preview();
    expect(r2.ok).toBe(true);
    const pid2 = Number(readFileSync(pidfile, "utf8"));
    expect(pid2).not.toBe(pid);
    s.room.send({ t: "exec", id: "e1", commands: ["echo hi"], timeoutSec: 30, overlay: [] });
    await s.room.next((f) => f.t === "done" && f.id === "e1", "the command's end");
    expect(s.room.frames.filter((f) => f.t === "preview-ended").length).toBe(2);
    expect(await gone(pid2)).toBe(true);
    expect((await s.room.http("/")).error).toMatchObject({ code: "unreachable" });

    // The session ends: nothing is left running.
    const r3 = await s.room.preview();
    expect(r3.ok).toBe(true);
    const pid3 = Number(readFileSync(pidfile, "utf8"));
    s.room.close();
    expect((await s.done).exitCode).toBe(0);
    expect(await gone(pid3)).toBe(true);
  }, 90000);

  it("tells the room when the dev server dies by itself", async () => {
    const s = await start();
    const pidfile = join(scratch(), "pid");
    const r = await s.room.preview({ cmd: `PIDFILE=${pidfile} node server.js` });
    expect(r.ok).toBe(true);
    process.kill(Number(readFileSync(pidfile, "utf8")), "SIGKILL");
    const ended = await s.room.next((f) => f.t === "preview-ended", "preview-ended");
    expect(ended.reason).toMatch(/exited/);
    s.room.close();
    await s.done;
  }, 40000);

  it("lays the staged edits before it starts, runs the prepare command only when there is no node_modules, and stays while it is waited for", async () => {
    // The server file itself comes from the overlay: the checkout holds a stub.
    const s = await start({ files: { "server.js": "process.exit(9);\n" }, silentMs: 400 });
    const r = await s.room.preview({ overlay: [{ path: "server.js", content: DEV_SERVER }], prepare: "mkdir node_modules && echo prepared > prepared.txt" });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(s.dir, "prepared.txt"), "utf8").trim()).toBe("prepared");
    // The room has said nothing for longer than the silence limit; with a preview open the runner waits for the preview's own idle time.
    await new Promise((res) => setTimeout(res, 1500));
    expect((await s.room.http("/")).head!.status).toBe(200);
    s.room.send({ t: "preview-stop" });
    await s.room.next((f) => f.t === "preview-ended", "preview-ended");
    // Again: node_modules is there now, so prepare does not run.
    rmSync(join(s.dir, "prepared.txt"));
    const again = await s.room.preview({ overlay: [{ path: "server.js", content: DEV_SERVER }], prepare: "echo again > prepared.txt" });
    expect(again.ok).toBe(true);
    expect(existsSync(join(s.dir, "prepared.txt"))).toBe(false);
    s.room.close();
    await s.done;
  }, 60000);
});
