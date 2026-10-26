/**
 * WHICH OF A PERSON'S PCS ARE ONLINE, AND WHAT EACH ONE HAS ALLOWED.
 *
 * A Tailzu desktop app that can run commands for the Code bot sends a
 * heartbeat (POST /v1/code/runner/heartbeat) every half minute or so, saying:
 *
 *   deviceId   a stable id the app made for this install
 *   name       what to call it ("Work laptop")
 *   allowRun   the person's own switch: this app may run commands for the bot
 *   projects   the projects it may run, as a list of project ids, or "all"
 *   busy       it is doing something already and can't take a step
 *
 * A heartbeat makes the device ONLINE for 60 seconds. This book holds the
 * latest one per device, in the server's memory and nowhere else: a restart
 * only means every app's next heartbeat puts it back, and a device is never
 * written to the database. (So presence is per server process, like the
 * approvals in code/approvals.ts: run one backend, as docker-compose does, or
 * keep a person's requests on one.)
 *
 * A device can take a step only if it is online, allowRun is on, its project
 * list has the step's project (or is "all"), it says it is not busy and it
 * isn't already holding a step the router gave it (the provider checks that
 * last one, since the router's records know it).
 */
import { DEVICES_MAX, DEVICE_ONLINE_MS } from "./types.js";

export interface DeviceBeat {
  deviceId: string;
  name: string;
  allowRun: boolean;
  /** Project ids, or "all". */
  projects: readonly string[] | "all";
  busy: boolean;
}

export interface Device extends DeviceBeat {
  userId: string;
  /** Epoch ms of the last heartbeat. */
  lastSeen: number;
}

/** Entries older than this are dropped altogether (they were offline long ago). */
const FORGET_MS = 10 * 60_000;

export class DeviceBook {
  private readonly items = new Map<string, Device>();

  private static key(userId: string, deviceId: string): string { return `${userId}|${deviceId}`; }

  /**
   * Records a heartbeat. Returns whether this changed what the router can do
   * with the device (new, or back from offline, or allowRun, the projects or
   * busy changed), which is when waiting jobs are worth another look.
   */
  beat(userId: string, b: DeviceBeat, now: number): boolean {
    const key = DeviceBook.key(userId, b.deviceId);
    const before = this.items.get(key);
    const wasUsable = !!before && now - before.lastSeen <= DEVICE_ONLINE_MS;
    const next: Device = {
      userId, deviceId: b.deviceId, name: b.name, allowRun: b.allowRun, busy: b.busy,
      projects: b.projects === "all" ? "all" : [...b.projects], lastSeen: now,
    };
    this.items.set(key, next);
    this.trim(userId, now);
    if (!before || !wasUsable) return true;
    return before.allowRun !== next.allowRun || before.busy !== next.busy || !sameProjects(before.projects, next.projects);
  }

  /** The device, if it is online at `now`. */
  online(userId: string, deviceId: string, now: number): Device | null {
    const d = this.items.get(DeviceBook.key(userId, deviceId));
    return d && now - d.lastSeen <= DEVICE_ONLINE_MS ? { ...d } : null;
  }

  /** This person's devices that are online at `now`, newest heartbeat first. */
  onlineFor(userId: string, now: number): Device[] {
    return [...this.items.values()]
      .filter((d) => d.userId === userId && now - d.lastSeen <= DEVICE_ONLINE_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen || (a.deviceId < b.deviceId ? -1 : 1))
      .map((d) => ({ ...d }));
  }

  /** Online devices that may run a step of this project: allowRun on, the project allowed, not busy. */
  capable(userId: string, projectId: string, now: number): Device[] {
    return this.onlineFor(userId, now).filter((d) => d.allowRun && !d.busy && allows(d, projectId));
  }

  /** Forgets devices not heard from for ten minutes. */
  prune(now: number): number {
    let n = 0;
    for (const [key, d] of this.items) if (now - d.lastSeen > FORGET_MS) { this.items.delete(key); n += 1; }
    return n;
  }

  /** How many devices are held (for tests). */
  get size(): number { return this.items.size; }

  /** One person never holds more than DEVICES_MAX: the one heard from longest ago goes first. */
  private trim(userId: string, now: number): void {
    const mine = [...this.items.values()].filter((d) => d.userId === userId);
    if (mine.length > DEVICES_MAX) {
      mine.sort((a, b) => a.lastSeen - b.lastSeen);
      for (const d of mine.slice(0, mine.length - DEVICES_MAX)) this.items.delete(DeviceBook.key(userId, d.deviceId));
    }
    // Old entries are dropped here too, so a server nobody ticks still stays small.
    if (this.items.size > 5000) this.prune(now);
  }
}

/** Whether the device has allowed this project. */
export function allows(d: Pick<Device, "projects">, projectId: string): boolean {
  return d.projects === "all" || d.projects.includes(projectId);
}

function sameProjects(a: readonly string[] | "all", b: readonly string[] | "all"): boolean {
  if (a === "all" || b === "all") return a === b;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((p) => set.has(p));
}
