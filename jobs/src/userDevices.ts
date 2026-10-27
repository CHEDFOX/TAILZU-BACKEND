/**
 * WHICH OF A PERSON'S PCS ARE ONLINE, KEPT ON CLOUDFLARE: ONE DURABLE OBJECT PER PERSON.
 *
 * The known gap this closes: with the jobs on the Worker, "which PCs are online" lived in the VPS's memory (tulmi/src/code/jobs/devices.ts
 * DeviceBook), so the Worker's router could never choose a person's own computer. Now the desktop app keeps a WebSocket open to
 * `wss://<jobs>/v1/devices/connect`, and this object is the book:
 *
 *   ONLINE means a socket is open. There is no 60-second heartbeat to forget to send: close the lid, lose the network, quit the app, and the socket
 *   goes. A PC says what it is and what it allows with `hello` and `state` frames (docs/desktop-runner-session.md); `online()` lists them and
 *   `capable(projectId)` is the router's question (online, "run commands" on, the project allowed, not busy).
 *
 *   HIBERNATION. Every socket is accepted with `ctx.acceptWebSocket`, so a PC that is online and quiet costs nothing: the object is not running
 *   and nothing is billed for duration while it waits. The keepalive is the plain text "ping", answered with "pong" by the runtime itself
 *   (`setWebSocketAutoResponse`) without waking the object. What a device is lives in its socket's attachment (16 KB), not in a field, so it
 *   survives a sleep. There are no timers here.
 *
 *   THE CONNECTION IS A TICKET. The app asks the VPS for one (POST /v1/code/runner/ticket, signed in as the person); the Worker checks it
 *   (tulmi/src/code/live/tickets.ts: signature, expiry, kind "device", used once) and sends the request here with the person and the device in
 *   headers. This object trusts those headers because only the Worker can reach it.
 *
 *   OFFERS. The router places a step on a PC by calling `offer(deviceId, step)`; the PC is sent `{"t":"offer", ...}` on its socket and takes it.
 *   A PC that cannot be reached (no socket) makes `offer` return false, and the router chooses again.
 */
import { DurableObject } from "cloudflare:workers";
import { allows } from "../../tulmi/src/code/jobs/devices.js";
import { parseFromDevice, type DeviceInfo, type DeviceOffer, type ToDevice } from "../../tulmi/src/code/live/protocol.js";
import type { Env } from "./env.js";
import { getWorld } from "./world.js";

/** A device as `online()` lists it. */
export interface DeviceView extends DeviceInfo {
  /** When the socket was opened, epoch ms. */
  since: number;
  /** The last frame that said something, epoch ms. */
  lastSeen: number;
  /** The app's own words about itself. */
  app?: string;
}

interface Attachment extends DeviceView {
  /** The PC has said hello (a socket that has not is not listed). */
  hello: boolean;
  /** Whose it is, from the ticket. */
  userId: string;
}

/** One person has at most this many devices connected. */
const DEVICES_MAX = 20;

export class UserDevices extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return Response.json({ code: "upgrade_required", message: "This is a WebSocket." }, { status: 426 });
    const deviceId = request.headers.get("x-device-id") ?? "";
    if (!deviceId) return Response.json({ code: "bad_ticket", message: "That ticket is not valid." }, { status: 401 });
    const sockets = this.ctx.getWebSockets();
    // One socket per device: a PC that reconnects replaces its old (half-dead) one.
    for (const old of sockets) {
      if (this.ctx.getTags(old).includes(deviceId)) {
        try { old.send(JSON.stringify({ t: "replaced" } satisfies ToDevice)); old.close(4000, "replaced"); } catch { /* gone */ }
      }
    }
    if (sockets.filter((w) => !this.ctx.getTags(w).includes(deviceId)).length >= DEVICES_MAX) {
      return Response.json({ code: "too_many", message: `At most ${DEVICES_MAX} computers can be connected.` }, { status: 429 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [deviceId]);
    const now = Date.now();
    const a: Attachment = { deviceId, userId: request.headers.get("x-user-id") ?? "", name: "This computer", allowRun: false, projects: [], busy: false, since: now, lastSeen: now, hello: false };
    server.serializeAttachment(a);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const m = parseFromDevice(typeof message === "string" ? message : new TextDecoder().decode(message));
    if (!m) { this.send(ws, { t: "error", code: "bad_message", message: "That frame was not understood." }); return; }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    const now = Date.now();
    switch (m.t) {
      case "hello": {
        // The device the ticket was for is the device this socket is.
        if (m.deviceId !== a.deviceId) { this.send(ws, { t: "error", code: "wrong_device", message: "That is not the device this connection was made for." }); try { ws.close(4003, "wrong device"); } catch { /* gone */ } return; }
        ws.serializeAttachment({ ...a, name: m.name, allowRun: m.allowRun, projects: m.projects, busy: m.busy, ...(m.app ? { app: m.app } : {}), hello: true, lastSeen: now } satisfies Attachment);
        this.send(ws, { t: "ack", v: 1, deviceId: a.deviceId });
        await this.changed(a.userId);
        return;
      }
      case "state": {
        if (!a.hello) { this.send(ws, { t: "error", code: "hello_first", message: "Say hello first." }); return; }
        const next: Attachment = {
          ...a, lastSeen: now, ...(m.name !== undefined ? { name: m.name } : {}), ...(m.allowRun !== undefined ? { allowRun: m.allowRun } : {}),
          ...(m.projects !== undefined ? { projects: m.projects } : {}), ...(m.busy !== undefined ? { busy: m.busy } : {}),
        };
        ws.serializeAttachment(next);
        const freed = (next.allowRun && !next.busy && !(a.allowRun && !a.busy)) || next.projects !== a.projects;
        if (freed) await this.changed(a.userId);
        return;
      }
      case "decline":
        // Informational: the router moves a step whose PC does not take it when the lease runs out.
        return;
      case "bye":
        try { ws.close(1000, "bye"); } catch { /* gone */ }
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason.slice(0, 100)); } catch { /* already closed */ }
  }

  async webSocketError(): Promise<void> { /* the socket is gone; online() reads the sockets that are left */ }

  /** A PC became able to take work: this person's waiting jobs are looked at now, not at the next cron. */
  private async changed(userId: string): Promise<void> {
    if (!userId) return;
    try { await (await getWorld(this.env)).ticker.wake?.(userId); } catch { /* the cron looks again within a minute */ }
  }

  // ---------------------------------------------------------------- RPC

  /** The PCs that are connected and have said hello, the most recently seen first. */
  async online(): Promise<DeviceView[]> {
    const out: DeviceView[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.hello) continue;
      const { hello: _hello, userId: _user, ...view } = a;
      out.push(view);
    }
    return out.sort((x, y) => y.lastSeen - x.lastSeen || (x.deviceId < y.deviceId ? -1 : 1));
  }

  /** The PCs that may take a step of this project: online, "run commands" on, the project allowed, not busy. */
  async capable(projectId: string): Promise<DeviceView[]> {
    return (await this.online()).filter((d) => d.allowRun && !d.busy && allows(d, projectId));
  }

  /** Sends a PC a step. False when it has no socket here, or the send failed. */
  async offer(deviceId: string, offer: DeviceOffer): Promise<boolean> {
    return this.sendTo(deviceId, { t: "offer", offer });
  }

  /** Tells a PC to let go of a step (the router moved it, or the job ended). Best effort. */
  async cancel(deviceId: string, jobId: string, epoch: number): Promise<boolean> {
    return this.sendTo(deviceId, { t: "cancel", jobId, epoch });
  }

  private sendTo(deviceId: string, m: ToDevice): boolean {
    for (const ws of this.ctx.getWebSockets(deviceId)) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.hello) continue;
      try { ws.send(JSON.stringify(m)); return true; } catch { /* try the next */ }
    }
    return false;
  }

  private send(ws: WebSocket, m: ToDevice): void {
    try { ws.send(JSON.stringify(m)); } catch { /* gone */ }
  }
}
