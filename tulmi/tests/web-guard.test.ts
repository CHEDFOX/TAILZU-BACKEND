/**
 * THE BROWSER'S SSRF GUARD (src/web/browser/guard.ts), talked to the way Chrome talks to it.
 *
 * Chrome's every request goes to this proxy, so what it refuses is the whole of
 * what a hostile page cannot reach. What these hold down, with raw sockets and
 * a local server of our own behind it (never the network):
 *
 *   - CONNECT to a loopback or private address is a 403 with X-Tailzu-Guard,
 *     whether it is written as an address or is a name whose DNS answers one
 *     (the lookup is the guard's test seam: `resolve`), and one private answer
 *     among public ones refuses the lot;
 *   - a port other than 80 and 443 is refused before any lookup is made;
 *   - with `allow` naming one local server, CONNECT is a tunnel that carries
 *     bytes both ways, including the ones that arrive in the same packet as the
 *     CONNECT line; the connection goes to the address that was checked, and
 *     the name is looked up once;
 *   - plain `GET http://host/path` is forwarded as one request (the proxy
 *     headers go, the path and query stay), and the same refusals apply; a
 *     request that is not in absolute form, or not http, is a 403;
 *   - a target that does not answer is a 502, not a 403;
 *   - the test hooks refuse to exist outside a test run; close() ends tunnels;
 *     an idle tunnel is cut; onRefuse hears the host and port and never a path.
 */
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { startGuard } = await import("../src/web/browser/guard.js");
type Guard = Awaited<ReturnType<typeof startGuard>>;
type GuardOptions = NonNullable<Parameters<typeof startGuard>[0]>;

// ------------------------------------------------------------------ the fakes

const listen = (server: net.Server | http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
const shut = (server: net.Server | http.Server): Promise<void> => new Promise((resolve) => { server.close(() => resolve()); (server as http.Server).closeAllConnections?.(); });

/** A port nothing listens on. */
async function deadPort(): Promise<number> {
  const s = net.createServer();
  const port = await listen(s);
  await shut(s);
  return port;
}

/** A TCP server that says "hi;" when you connect and answers every chunk with "echo:" and the chunk. */
function echoServer() {
  const seen = { connections: 0 };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    seen.connections += 1;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
    s.write("hi;");
    s.on("data", (d) => s.write(`echo:${d.toString("utf8")}`));
  });
  return {
    seen,
    server,
    start: () => listen(server),
    stop: async () => { for (const s of sockets) s.destroy(); await shut(server); },
  };
}

/** A socket and everything it has been sent, with a way to wait for some text to arrive. */
function reader(socket: net.Socket) {
  let buf = "";
  let closed = false;
  const waiters: Array<() => void> = [];
  const wake = () => { for (const w of waiters.splice(0)) w(); };
  socket.on("data", (d) => { buf += d.toString("utf8"); wake(); });
  socket.on("close", () => { closed = true; wake(); });
  socket.on("error", () => {});
  return {
    get text() { return buf; },
    get closed() { return closed; },
    async until(done: (text: string) => boolean, ms = 4_000): Promise<string> {
      const end = Date.now() + ms;
      while (!done(buf)) {
        if (closed || Date.now() >= end) break;
        await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 50); });
      }
      return buf;
    },
    async untilClosed(ms = 4_000): Promise<boolean> {
      await this.until(() => closed, ms);
      return closed;
    },
  };
}

interface Answer { status: number; headers: Record<string, string>; rest: string; socket: net.Socket; r: ReturnType<typeof reader> }

/** Sends `payload` to the guard as it stands and waits for the answer's head. */
async function talk(guard: Guard, payload: string): Promise<Answer> {
  const socket = net.connect({ host: "127.0.0.1", port: guard.port });
  const r = reader(socket);
  await new Promise<void>((resolve, reject) => { socket.once("connect", () => resolve()); socket.once("error", reject); });
  socket.write(payload);
  const text = await r.until((t) => t.includes("\r\n\r\n"));
  const [head = "", ...more] = text.split("\r\n\r\n");
  const [line = "", ...hs] = head.split("\r\n");
  const headers: Record<string, string> = {};
  for (const h of hs) { const at = h.indexOf(":"); if (at > 0) headers[h.slice(0, at).toLowerCase()] = h.slice(at + 1).trim(); }
  return { status: Number(line.split(" ")[1]), headers, rest: more.join("\r\n\r\n"), socket, r };
}

const connect = (guard: Guard, target: string, after = "") => talk(guard, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n${after}`);

/** A GET in absolute form, as Chrome sends one to a proxy. */
function proxiedGet(guard: Guard, absolute: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: guard.port, method: init.method ?? "GET", path: absolute, headers: init.headers, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

/** An http server that keeps what it was asked. */
function originServer() {
  const requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      res.writeHead(200, { "Content-Type": "text/plain", "X-Origin": "yes", "Keep-Alive": "timeout=5" });
      res.end(`you asked for ${req.url}`);
    });
  });
  return { requests, server, start: () => listen(server), stop: () => shut(server) };
}

// ---------------------------------------------------------------------- the rig

let guard: Guard | null = null;
let refusals: Array<[string, number, string]> = [];
let echo: ReturnType<typeof echoServer>;
let echoPort = 0;
const sockets: net.Socket[] = [];

const track = <T extends Answer>(a: T): T => { sockets.push(a.socket); return a; };

async function start(o: GuardOptions = {}): Promise<Guard> {
  guard = await startGuard({ ...o, onRefuse: (host, port, reason) => { refusals.push([host, port, reason]); o.onRefuse?.(host, port, reason); } });
  return guard;
}

beforeEach(async () => {
  refusals = [];
  echo = echoServer();
  echoPort = await echo.start();
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await guard?.close();
  guard = null;
  await echo.stop();
});

const isRefusal = (a: Answer) => {
  expect(a.status).toBe(403);
  expect(a.headers["x-tailzu-guard"]).toBe("blocked");
};

// ----------------------------------------------------------------------- tests

describe("the guard refuses what a page must not reach", () => {
  it("CONNECT to 127.0.0.1 on the port of a local server is a 403, and nothing is dialled", async () => {
    const g = await start();
    const a = track(await connect(g, `127.0.0.1:${echoPort}`));
    isRefusal(a);
    expect(await a.r.untilClosed()).toBe(true);
    expect(echo.seen.connections).toBe(0);
    expect(g.stats).toEqual({ allowed: 0, refused: 1 });
    expect(refusals).toEqual([["127.0.0.1", echoPort, "port"]]);
  });

  it("CONNECT to a private or loopback address on 443 is refused without a lookup, whatever way it is written", async () => {
    let lookups = 0;
    const g = await start({ resolve: () => { lookups += 1; return ["93.184.216.34"]; } });
    const targets = [
      "127.0.0.1:443", "10.1.2.3:443", "192.168.0.10:443", "172.16.5.5:443", "169.254.169.254:443",
      "100.64.0.1:443", "0.0.0.0:443", "[::1]:443", "[fe80::1]:443", "[fd00::1]:443", "[::ffff:127.0.0.1]:443", "[::ffff:a9fe:a9fe]:443", "[64:ff9b::a00:1]:443",
    ];
    for (const t of targets) isRefusal(track(await connect(g, t)));
    expect(lookups).toBe(0); // an address is judged as written; DNS is never asked about it
    expect(g.stats.refused).toBe(targets.length);
    expect(g.stats.allowed).toBe(0);
    expect(refusals.every(([, , why]) => why === "private_address")).toBe(true);
    expect(refusals.map(([h]) => h)).toContain("::1"); // brackets off, as a host
  });

  it("a name whose DNS answers a private address is refused", async () => {
    const asked: string[] = [];
    const answers: Record<string, string[]> = {
      "internal.example": ["10.0.0.5"],
      "metadata.example": ["169.254.169.254"],
      "loop.example": ["127.0.0.1"],
      "loop6.example": ["::1"],
      "mapped.example": ["::ffff:127.0.0.1"],
      // One private address among public ones refuses the lot: which is dialled must not be luck.
      "mixed.example": ["93.184.216.34", "10.0.0.5"],
      "mixed6.example": ["2606:2800:220:1:248:1893:25c8:1946", "fd12::1"],
    };
    const g = await start({ resolve: (h) => { asked.push(h); return answers[h] ?? []; } });
    for (const name of Object.keys(answers)) isRefusal(track(await connect(g, `${name}:443`)));
    expect(asked.sort()).toEqual(Object.keys(answers).sort());
    expect(echo.seen.connections).toBe(0);
    expect(refusals.every(([, port, why]) => port === 443 && why === "private_address")).toBe(true);
    expect(refusals.map(([h]) => h).sort()).toEqual(Object.keys(answers).sort());
  });

  it("the name is matched the way a person would write it (case, trailing dot)", async () => {
    const g = await start({ resolve: (h) => (h === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"]) });
    isRefusal(track(await connect(g, "INTERNAL.Example.:443")));
    expect(refusals).toEqual([["internal.example", 443, "private_address"]]);
  });

  it("a name that does not resolve, or whose lookup fails, is refused as no_address", async () => {
    const g = await start({ resolve: (h) => { if (h === "boom.example") throw new Error("ESERVFAIL"); return []; } });
    isRefusal(track(await connect(g, "nowhere.example:443")));
    isRefusal(track(await connect(g, "boom.example:443")));
    expect(refusals.map(([, , why]) => why)).toEqual(["no_address", "no_address"]);
  });

  it("the system's own lookup is used when none is injected: localhost is refused", async () => {
    const g = await start();
    isRefusal(track(await connect(g, "localhost:443")));
    expect(refusals).toEqual([["localhost", 443, "private_address"]]);
  });

  it("a port other than 80 and 443 is refused, and before any lookup is made", async () => {
    let lookups = 0;
    const g = await start({ resolve: () => { lookups += 1; return ["93.184.216.34"]; } });
    for (const p of [8080, 8443, 22, 5432, 3000, 81, 442]) isRefusal(track(await connect(g, `public.example:${p}`)));
    expect(lookups).toBe(0);
    expect(refusals.every(([, , why]) => why === "port")).toBe(true);
    expect(refusals).toHaveLength(7);
  });

  it("an allowance for one host and port is not an allowance for the others", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort });
    isRefusal(track(await connect(g, `127.0.0.1:${echoPort + 1}`)));
    isRefusal(track(await connect(g, `localhost:${echoPort}`))); // another name, and localhost is private
    isRefusal(track(await connect(g, "169.254.169.254:80")));
    expect(echo.seen.connections).toBe(0);
  });

  it("a CONNECT line that is not host:port is a 403, and a port out of range too", async () => {
    const g = await start();
    for (const target of ["justahost", "host:0", "host:65536", "host:abc", "[::1]", ":443", "http://host:443"]) {
      isRefusal(track(await connect(g, target)));
    }
    expect(refusals.every(([, , why]) => why === "bad_request")).toBe(true);
    expect(g.stats.refused).toBe(7);
  });
});

describe("CONNECT, for what is allowed", () => {
  it("tunnels bytes both ways to the allowed server", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort });
    const a = track(await connect(g, `127.0.0.1:${echoPort}`));
    expect(a.status).toBe(200);
    expect(a.headers["x-tailzu-guard"]).toBeUndefined();
    // The server speaks first (server to client)…
    await a.r.until((t) => t.endsWith("hi;"));
    expect(a.r.text.endsWith("hi;")).toBe(true);
    // …and answers what it is sent (client to server, and back).
    a.socket.write("one");
    await a.r.until((t) => t.includes("echo:one"));
    a.socket.write("two");
    const all = await a.r.until((t) => t.includes("echo:two"));
    expect(all).toContain("echo:one");
    expect(all).toContain("echo:two");
    expect(echo.seen.connections).toBe(1);
    expect(g.stats).toEqual({ allowed: 1, refused: 0 });
    expect(refusals).toEqual([]);
  });

  it("carries the bytes that arrive in the same packet as the CONNECT line", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort });
    const a = track(await connect(g, `127.0.0.1:${echoPort}`, "early-bytes"));
    expect(a.status).toBe(200);
    const all = await a.r.until((t) => t.includes("echo:early-bytes"));
    expect(all).toContain("echo:early-bytes");
  });

  it("dials the address it checked, not the name again, and looks the name up once", async () => {
    // "tunnel.example" is not in anyone's DNS: only the injected answer can get a connection made.
    // The second answer, if the guard asked twice, would be a private address.
    const answers = [["127.0.0.1"], ["10.0.0.9"]];
    let lookups = 0;
    const g = await start({
      allow: (h, p) => h === "tunnel.example" && p === echoPort,
      resolve: () => answers[Math.min(lookups++, answers.length - 1)]!,
    });
    const a = track(await connect(g, `tunnel.example:${echoPort}`));
    expect(a.status).toBe(200);
    a.socket.write("ping");
    await a.r.until((t) => t.includes("echo:ping"));
    expect(a.r.text).toContain("echo:ping");
    expect(lookups).toBe(1);
    expect(echo.seen.connections).toBe(1);
  });

  it("tries the next address when the first does not answer (IPv4 before IPv6)", async () => {
    const g = await start({
      allow: (h, p) => h === "two.example" && p === echoPort,
      // ::1 is listed first and would be dialled first if the order were the DNS's; IPv4 is tried first.
      resolve: () => ["::1", "127.0.0.1"],
    });
    const a = track(await connect(g, `two.example:${echoPort}`));
    expect(a.status).toBe(200);
    a.socket.write("x");
    await a.r.until((t) => t.includes("echo:x"));
    expect(a.r.text).toContain("echo:x");
  });

  it("a target that does not answer is a 502, not a refusal", async () => {
    const port = await deadPort();
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === port });
    const a = track(await connect(g, `127.0.0.1:${port}`));
    expect(a.status).toBe(502);
    expect(a.headers["x-tailzu-guard"]).toBeUndefined();
    expect(g.stats.refused).toBe(0);
    expect(refusals).toEqual([]);
  });

  it("when the server hangs up, so does the client side; and the other way round", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort });
    const a = track(await connect(g, `127.0.0.1:${echoPort}`));
    expect(a.status).toBe(200);
    a.socket.end(); // the browser is done
    await a.r.untilClosed();
    const b = track(await connect(g, `127.0.0.1:${echoPort}`));
    expect(b.status).toBe(200);
    await echo.stop(); // the server goes away
    expect(await b.r.untilClosed()).toBe(true);
    echo = echoServer();
    echoPort = await echo.start();
  });
});

describe("plain http in absolute form", () => {
  it("is forwarded as one request to the allowed server: path and query kept, proxy headers gone", async () => {
    const origin = originServer();
    const port = await origin.start();
    try {
      const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === port });
      const res = await proxiedGet(g, `http://127.0.0.1:${port}/hello/world?x=1&y=two`, {
        headers: { "Proxy-Connection": "keep-alive", "Proxy-Authorization": "Basic abc", "X-Page": "yes", Accept: "text/html" },
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe("you asked for /hello/world?x=1&y=two");
      expect(res.headers["x-origin"]).toBe("yes");
      expect(res.headers["keep-alive"]).toBeUndefined(); // hop by hop, on the way back too

      expect(origin.requests).toHaveLength(1);
      const seen = origin.requests[0]!;
      expect(seen.url).toBe("/hello/world?x=1&y=two"); // origin-form to the server, not the absolute address
      expect(seen.headers.host).toBe(`127.0.0.1:${port}`);
      expect(seen.headers["x-page"]).toBe("yes");
      expect(seen.headers.accept).toBe("text/html");
      expect(seen.headers["proxy-connection"]).toBeUndefined();
      expect(seen.headers["proxy-authorization"]).toBeUndefined();
      expect(g.stats).toEqual({ allowed: 1, refused: 0 });
    } finally {
      await origin.stop();
    }
  });

  it("carries a request body", async () => {
    const origin = originServer();
    const port = await origin.start();
    try {
      const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === port });
      const res = await proxiedGet(g, `http://127.0.0.1:${port}/submit`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "payload-123" });
      expect(res.status).toBe(200);
      expect(origin.requests[0]).toMatchObject({ method: "POST", url: "/submit", body: "payload-123" });
    } finally {
      await origin.stop();
    }
  });

  it("is refused for a local server that is not allowed, with the header the engine reads", async () => {
    const origin = originServer();
    const port = await origin.start();
    try {
      const g = await start();
      const res = await proxiedGet(g, `http://127.0.0.1:${port}/secret?token=hunter2`);
      expect(res.status).toBe(403);
      expect(res.headers["x-tailzu-guard"]).toBe("blocked");
      expect(origin.requests).toHaveLength(0);
      // The host and the port are told; the path and the query never are.
      expect(refusals).toEqual([["127.0.0.1", port, "port"]]);
      expect(JSON.stringify(refusals)).not.toContain("hunter2");
      expect(g.stats).toEqual({ allowed: 0, refused: 1 });
    } finally {
      await origin.stop();
    }
  });

  it("is refused for a private address on port 80, and for a name that resolves to one", async () => {
    const g = await start({ resolve: (h) => (h === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"]) });
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://[::1]/", "http://internal.example/admin"]) {
      const res = await proxiedGet(g, url);
      expect(res.status).toBe(403);
      expect(res.headers["x-tailzu-guard"]).toBe("blocked");
    }
    expect(refusals.map(([h, p, why]) => [h, p, why])).toEqual([
      ["169.254.169.254", 80, "private_address"],
      ["127.0.0.1", 80, "private_address"],
      ["::1", 80, "private_address"],
      ["internal.example", 80, "private_address"],
    ]);
  });

  it("is refused on a port other than 80, written in the address or not", async () => {
    const g = await start({ resolve: () => ["93.184.216.34"] });
    expect((await proxiedGet(g, "http://public.example:8080/")).status).toBe(403);
    expect((await proxiedGet(g, "http://public.example:22/")).status).toBe(403);
    expect(refusals.map(([, , why]) => why)).toEqual(["port", "port"]);
  });

  it("is a 403 when it is not in absolute http form: origin-form, https, or something else", async () => {
    const g = await start({ allow: () => true });
    for (const path of ["/just/a/path", "https://127.0.0.1/", "ftp://example.com/x", "not a url"]) {
      const res = await proxiedGet(g, path).catch(() => ({ status: 0, headers: {} as http.IncomingHttpHeaders, body: "" }));
      if (res.status === 0) continue; // Node refused to even send a path with a space in it
      expect(res.status).toBe(403);
      expect(res.headers["x-tailzu-guard"]).toBe("blocked");
    }
    expect(refusals.length).toBeGreaterThanOrEqual(3);
    expect(refusals.every(([h, p, why]) => h === "" && p === 0 && why === "bad_request")).toBe(true);
  });

  it("is a 502 when the server does not answer", async () => {
    const port = await deadPort();
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === port });
    const res = await proxiedGet(g, `http://127.0.0.1:${port}/`);
    expect(res.status).toBe(502);
    expect(res.headers["x-tailzu-guard"]).toBeUndefined();
  });
});

describe("the guard itself", () => {
  it("listens on 127.0.0.1 only, on a port the system picked", async () => {
    const g = await start();
    expect(g.port).toBeGreaterThan(0);
    // Its own address: the server was bound to the loopback address and no other.
    const probe = net.connect({ host: "127.0.0.1", port: g.port });
    await new Promise<void>((resolve, reject) => { probe.once("connect", () => resolve()); probe.once("error", reject); });
    expect(probe.remoteAddress).toBe("127.0.0.1");
    probe.destroy();
  });

  it("will not take its test hooks outside a test run", async () => {
    const was = process.env.VITEST;
    delete process.env.VITEST;
    try {
      await expect(startGuard({ allow: () => true })).rejects.toThrow(/tests only/);
      await expect(startGuard({ resolve: () => [] })).rejects.toThrow(/tests only/);
      const bare = await startGuard(); // no hooks: fine anywhere
      await bare.close();
    } finally {
      if (was !== undefined) process.env.VITEST = was;
    }
  });

  it("close() ends the tunnels that are open and stops listening", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort });
    const a = track(await connect(g, `127.0.0.1:${echoPort}`));
    expect(a.status).toBe(200);
    const port = g.port;
    await g.close();
    expect(await a.r.untilClosed()).toBe(true);
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      const s = net.connect({ host: "127.0.0.1", port });
      s.once("error", (e) => resolve(e));
      s.once("connect", () => { s.destroy(); resolve(new Error("still listening")); });
    });
    expect((err as NodeJS.ErrnoException).code).toBe("ECONNREFUSED");
  });

  it("cuts a tunnel that goes idle", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort, idleMs: 200 });
    const a = track(await connect(g, `127.0.0.1:${echoPort}`));
    expect(a.status).toBe(200);
    expect(await a.r.untilClosed(3_000)).toBe(true);
  });

  it("drops a request line Node's own parser cannot read (a space in the target)", async () => {
    const g = await start();
    const a = await talk(g, "CONNECT a b:443 HTTP/1.1\r\n\r\n");
    sockets.push(a.socket);
    expect(a.status).toBeNaN(); // no answer at all: the connection is cut
    expect(await a.r.untilClosed()).toBe(true);
    expect(g.stats).toEqual({ allowed: 0, refused: 0 });
  });

  it("survives a client that sends rubbish and one that vanishes in the middle", async () => {
    const g = await start({ allow: (h, p) => h === "127.0.0.1" && p === echoPort });
    const junk = net.connect({ host: "127.0.0.1", port: g.port });
    junk.on("error", () => {});
    junk.write("\x00\x01\x02 not http at all\r\n\r\n");
    await reader(junk).untilClosed();
    const gone = net.connect({ host: "127.0.0.1", port: g.port });
    gone.on("error", () => {});
    gone.write(`CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\n\r\n`);
    gone.destroy();
    // Still serving.
    const a = track(await connect(g, `127.0.0.1:${echoPort}`));
    expect(a.status).toBe(200);
  });
});
