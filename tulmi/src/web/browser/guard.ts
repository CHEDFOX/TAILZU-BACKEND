/**
 * THE BROWSER'S SSRF GUARD: A FORWARD PROXY THAT ONLY DIALS PUBLIC ADDRESSES.
 *
 * A page the browser opens is arbitrary code from the internet, running next
 * to this server. It can ask for http://169.254.169.254/ (cloud metadata),
 * http://localhost:5432/ or anything on the network behind us, by link, by
 * redirect, by script, or through a name that answers a public address once
 * and a private one a moment later (DNS rebinding). connectors/egress.ts
 * guards the reader's own fetches; Chrome makes its own, so Chrome's every
 * request goes through this instead: chrome.ts starts it with
 * --proxy-server pointing here and the loopback exception switched off.
 *
 * What it takes: `CONNECT host:port` (everything https, and websockets) and
 * plain `GET http://host/path` in absolute form. For each, in this order:
 *
 *   - port 80 or 443 only, else 403;
 *   - the name is resolved HERE, every address it answers is checked with
 *     isBlockedAddress (the same list the reader uses), and one private
 *     address among them refuses the lot, else 403;
 *   - the connection is made to the address that was checked, never to the
 *     name again, so nothing can change between the check and the dial.
 *     A host written as an address is checked directly, with no lookup;
 *   - then it is a plain tunnel (CONNECT) or a one-request forward (GET).
 *
 * A refusal is a 403 with `X-Tailzu-Guard: blocked`, which the engine reads.
 * Nothing is logged here; `onRefuse` (host and port, never a path or a query)
 * is for whoever started the guard. It listens on 127.0.0.1 only, on a port
 * the system picks.
 *
 * `allow` and `resolve` are the test seam, as setEgressTestHooks is: `allow`
 * says "this host and port may be dialled whatever they are" (a test's own
 * server on 127.0.0.1), `resolve` answers DNS in place of the system. Given
 * outside a test run, startGuard throws, so a production process cannot be
 * talked into them.
 *
 * Free of the app except isBlockedAddress, so it can be bundled elsewhere.
 */
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { isBlockedAddress } from "../../connectors/egress.js";

export type GuardReason = "port" | "private_address" | "no_address" | "bad_request";

export interface GuardOptions {
  /** Tests only: hosts and ports that may be dialled whatever they are. */
  allow?: (host: string, port: number) => boolean;
  /** Tests only: DNS answers, in place of the system's. */
  resolve?: (host: string) => string[] | Promise<string[]>;
  /** Told of every refusal: where to (never what), and why. */
  onRefuse?: (host: string, port: number, reason: GuardReason) => void;
  /** Time to connect to one address. Default 8 s. */
  connectTimeoutMs?: number;
  /** A tunnel or request that goes this long without a byte is cut. Default 2 minutes. */
  idleMs?: number;
}

export interface Guard {
  /** The port on 127.0.0.1. */
  readonly port: number;
  readonly stats: { allowed: number; refused: number };
  close(): Promise<void>;
}

class Refused extends Error {
  constructor(readonly reason: GuardReason) { super(reason); }
}

const HOP_BY_HOP = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]);

/** "host:port" or "[v6]:port" as a CONNECT line gives it. */
function authority(s: string): { host: string; port: number } | null {
  const m = /^(?:\[([0-9a-fA-F:.]+)\]|([^:\s[\]/]+)):(\d{1,5})$/.exec(s.trim());
  if (!m) return null;
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return null;
  return { host: (m[1] ?? m[2]!).toLowerCase().replace(/\.$/, ""), port };
}

const FORBIDDEN = "HTTP/1.1 403 Forbidden\r\nX-Tailzu-Guard: blocked\r\nContent-Type: text/plain\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const BAD_GATEWAY = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

export async function startGuard(o: GuardOptions = {}): Promise<Guard> {
  if ((o.allow || o.resolve) && !process.env.VITEST) throw new Error("the guard's allow and resolve hooks are for tests only");
  const stats = { allowed: 0, refused: 0 };
  const sockets = new Set<Duplex>();
  const idleMs = o.idleMs ?? 120_000;

  const track = (s: net.Socket) => {
    sockets.add(s);
    s.setTimeout(idleMs, () => s.destroy());
    s.once("close", () => sockets.delete(s));
    s.on("error", () => {});
    return s;
  };

  /** The addresses that may be dialled for this host and port, or a Refused. */
  async function vet(host: string, port: number): Promise<string[]> {
    const permitted = o.allow?.(host, port) === true;
    if (!permitted && port !== 80 && port !== 443) throw new Refused("port");
    if (!host || /[\s\u0000-\u001f]/.test(host)) throw new Refused("bad_request");
    let addrs: string[];
    if (net.isIP(host)) addrs = [host];
    else {
      try {
        addrs = o.resolve ? await o.resolve(host) : (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
      } catch {
        throw new Refused("no_address");
      }
      if (!addrs.length) throw new Refused("no_address");
    }
    // One private address among the answers refuses the lot: which one is dialled must not be a matter of luck.
    if (!permitted && addrs.some((a) => isBlockedAddress(a))) throw new Refused("private_address");
    return [...addrs].sort((a, b) => Number(net.isIPv6(a)) - Number(net.isIPv6(b))); // IPv4 first
  }

  /** Connects to the first of the (already checked) addresses that answers. */
  async function dial(addrs: string[], port: number): Promise<net.Socket> {
    let last: unknown;
    for (const host of addrs) {
      try {
        return await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect({ host, port });
          const timer = setTimeout(() => { s.destroy(); reject(new Error("connect timeout")); }, o.connectTimeoutMs ?? 8_000);
          s.once("connect", () => { clearTimeout(timer); resolve(s); });
          s.once("error", (e) => { clearTimeout(timer); reject(e); });
        });
      } catch (err) {
        last = err;
      }
    }
    throw last ?? new Error("no address");
  }

  const refuse = (host: string, port: number, reason: GuardReason) => {
    stats.refused += 1;
    try { o.onRefuse?.(host, port, reason); } catch { /* the callback is not ours to fail on */ }
  };

  const server = http.createServer();
  server.maxConnections = 512;
  server.on("connection", (s) => { track(s); });

  // Plain http: the request line carries the whole address.
  server.on("request", async (req, res) => {
    let u: URL;
    try { u = new URL(req.url ?? ""); } catch { u = new URL("about:blank"); }
    if (u.protocol !== "http:") { // origin-form (a request to the proxy itself) or anything that is not http
      refuse("", 0, "bad_request");
      res.writeHead(403, { "X-Tailzu-Guard": "blocked", "Content-Length": "0", Connection: "close" }).end();
      return;
    }
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    const port = u.port ? Number(u.port) : 80;
    let sock: net.Socket;
    try {
      const addrs = await vet(host, port);
      sock = track(await dial(addrs, port));
    } catch (err) {
      if (err instanceof Refused) {
        refuse(host, port, err.reason);
        if (!res.headersSent) res.writeHead(403, { "X-Tailzu-Guard": "blocked", "Content-Length": "0", Connection: "close" });
      } else if (!res.headersSent) res.writeHead(502, { "Content-Length": "0", Connection: "close" });
      res.end();
      return;
    }
    if (req.destroyed) { sock.destroy(); return; }
    stats.allowed += 1;

    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k) && v !== undefined) headers[k] = v;
    headers.host = u.host;
    headers.connection = "close";

    // The connection is the one already made to the checked address; nothing is looked up again.
    // (With createConnection given and no agent, Node uses the socket as it is.)
    const up = http.request({ createConnection: () => sock, method: req.method, path: `${u.pathname}${u.search}`, headers });
    up.on("response", (pres) => {
      const out: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(pres.headers)) if (!HOP_BY_HOP.has(k) && v !== undefined) out[k] = v;
      res.writeHead(pres.statusCode ?? 502, pres.statusMessage, out);
      pres.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Length": "0", Connection: "close" });
      res.end();
    });
    res.on("close", () => { up.destroy(); sock.destroy(); });
    req.pipe(up);
  });

  // https and websockets: a tunnel to a vetted address.
  server.on("connect", async (req, client: net.Socket, head: Buffer) => {
    client.on("error", () => {});
    const target = authority(req.url ?? "");
    if (!target) {
      refuse("", 0, "bad_request");
      client.end(FORBIDDEN);
      return;
    }
    let up: net.Socket;
    try {
      const addrs = await vet(target.host, target.port);
      up = track(await dial(addrs, target.port));
    } catch (err) {
      if (err instanceof Refused) {
        refuse(target.host, target.port, err.reason);
        client.end(FORBIDDEN);
      } else client.end(BAD_GATEWAY);
      return;
    }
    if (client.destroyed) { up.destroy(); return; }
    stats.allowed += 1;
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
    up.once("close", () => client.destroy());
    client.once("close", () => up.destroy());
  });

  server.on("clientError", (_err, socket) => { socket.destroy(); });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    stats,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}
