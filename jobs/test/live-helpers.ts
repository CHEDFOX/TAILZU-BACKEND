/**
 * What the live session's tests share: a tarball made in memory, GitHub replaced by a map, signed tickets, and a runner / device / viewer that
 * connects to the Worker's door the way the real ones do. Tokens and tickets are built here at run time, never written as literals.
 */
import { signTicket, type SignTicket } from "../../tulmi/src/code/live/tickets.js";
import { roomDeps, type TarSource } from "../src/jobRoom.js";
import { handleRequest } from "../src/http.js";
import { roomOf } from "../src/rooms.js";
import { SECRET, testEnv, uuid } from "./helpers.js";

// ------------------------------------------------------------------ tarballs

const enc = new TextEncoder();

function octal(n: number, width: number): string {
  return `${n.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number, mtime: number, type: string): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc.encode(s), at);
  put(name, 0);
  put(octal(0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(mtime, 12), 136);
  put("        ", 148);
  put(type, 156);
  put("ustar\0", 257);
  put("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}

/** A gzipped tar of these files under one top folder, as GitHub's tarball is. A file's value may be bytes (a binary file) or a string. */
export async function tarball(files: Record<string, string | Uint8Array>, o: { top?: string; mtime?: Record<string, number> } = {}): Promise<Uint8Array> {
  const top = o.top ?? "acme-app-abc1234";
  const parts: Uint8Array[] = [header(`${top}/`, 0, 0, "5")];
  for (const [path, value] of Object.entries(files)) {
    const bytes = typeof value === "string" ? enc.encode(value) : value;
    parts.push(header(`${top}/${path}`, bytes.length, o.mtime?.[path] ?? 1_700_000_000, "0"), bytes, new Uint8Array((512 - (bytes.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { tar.set(p, at); at += p.length; }
  const gz = new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(gz).arrayBuffer());
}

/** GitHub, for the room: answers the tarball request with this body (or with a redirect to a signed link first, as the real one does). */
export function fakeGithub(body: Uint8Array, o: { redirect?: boolean; status?: number } = {}) {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const real = roomDeps.fetch;
  roomDeps.fetch = async (url, init) => {
    const h = new Headers(init.headers);
    seen.push({ url, authorization: h.get("authorization") });
    if (o.status && o.status !== 200) return new Response("no", { status: o.status });
    if (o.redirect && url.startsWith("https://api.github.com/")) return new Response(null, { status: 302, headers: { location: "https://codeload.example/signed-link" } });
    return new Response(body, { status: 200, headers: { "content-type": "application/x-gzip" } });
  };
  return { seen, restore: () => { roomDeps.fetch = real; } };
}

export const SHA40 = "b".repeat(40);
/** A token for the read-only access, made at run time so that no token-shaped literal is in the source. */
export const fakeReadToken = (): string => ["fake", "read", "access", String(Date.now())].join("-");
export const github = (token = fakeReadToken()): TarSource => ({ kind: "github", owner: "acme", repo: "app", token });

// ------------------------------------------------------------------- tickets

export function ticket(o: Omit<SignTicket, "secret"> & { secret?: string }): string {
  return signTicket({ secret: SECRET, ...o }).ticket;
}

export const runnerTicket = (jobId: string, step: number, epoch: number, over: Partial<SignTicket> = {}): string =>
  ticket({ kind: "runner", job: jobId, step, epoch, ttlMs: 10 * 60_000, ...over });

// ----------------------------------------------------------------- sockets

export interface Client {
  ws: WebSocket;
  /** Every frame received, parsed. */
  frames: Array<Record<string, unknown>>;
  send(m: object | string): void;
  /** Waits for a frame that passes the test; returns it. */
  next(test: (m: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: string }>;
}

function client(ws: WebSocket): Client {
  const frames: Array<Record<string, unknown>> = [];
  const waiting: Array<() => void> = [];
  ws.addEventListener("message", (ev) => {
    try { frames.push(JSON.parse(String(ev.data))); } catch { frames.push({ raw: String(ev.data) }); }
    for (const w of waiting.splice(0)) w();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.addEventListener("close", (ev) => resolve({ code: ev.code, reason: ev.reason })));
  return {
    ws, frames, closed,
    send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
    async next(test, ms = 4000) {
      const t0 = Date.now();
      for (;;) {
        const hit = frames.find(test);
        if (hit) return hit;
        if (Date.now() - t0 > ms) throw new Error(`no such frame; got ${JSON.stringify(frames).slice(0, 600)}`);
        await new Promise<void>((r) => { waiting.push(r); setTimeout(r, 25); });
      }
    },
  };
}

/** Connects to the Worker's door as a WebSocket client would. A refusal comes back as the HTTP answer. */
export async function connect(path: string, o: { ticket?: string; header?: boolean } = {}): Promise<{ ok: true; client: Client } | { ok: false; status: number; code: string }> {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  let url = `https://jobs.example${path}`;
  if (o.ticket) { if (o.header) headers.Authorization = `Bearer ${o.ticket}`; else url += `?ticket=${encodeURIComponent(o.ticket)}`; }
  const res = await handleRequest(new Request(url, { headers }), testEnv);
  if (res.status !== 101 || !res.webSocket) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    return { ok: false, status: res.status, code: body.code ?? "" };
  }
  res.webSocket.accept();
  return { ok: true, client: client(res.webSocket) };
}

/** A runner that has connected with a good ticket for this step and said hello. */
export async function runnerFor(jobId: string, step = 5, epoch = 1, kind: "github" | "desktop" = "github") {
  const c = await connect(`/v1/rooms/${jobId}/runner`, { ticket: runnerTicket(jobId, step, epoch) });
  if (!c.ok) throw new Error(`runner refused: ${c.status} ${c.code}`);
  c.client.send({ t: "hello", v: 1, kind, name: "test runner" });
  await c.client.next((m) => m.t === "ready");
  return c.client;
}

/** Opens a room's session the way the Worker does for the first command: expect the runner, bind the step. */
export async function openRoom(jobId: string, o: { step?: number; idleMs?: number; remainingMs?: number } = {}) {
  const room = roomOf(testEnv, jobId);
  await room.expectRunner({ jobId, idleMs: o.idleMs ?? 120_000, remainingMs: o.remainingMs ?? 20 * 60_000, ticketTtlMs: 10 * 60_000 });
  await room.bindStep(o.step ?? 5);
  return room;
}

export const newJob = (n: number): string => uuid(n);
