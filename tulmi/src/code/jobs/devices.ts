/**
 * WHICH OF A PERSON'S PCS ARE ONLINE, AND WHAT EACH ONE HAS ALLOWED.
 *
 * A Tailzu desktop app that can run commands for Xode sends a
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

/**
 * WHICH PROJECTS A COMPUTER HAS ALLOWED: every one, a list of them, or every one but a list (protocol version 2; a version 1 app
 * can say only the first two). The lists are of project ids and are not capped at 200 any more (PROJECTS_ALLOW_MAX is a guard for
 * memory and for the frame, not a limit on what a person can mean).
 */
export type ProjectAllow = readonly string[] | "all" | { allExcept: readonly string[] };

/** What a computer says it is, in `hello` (protocol version 2). Placement reads it (placement.ts, providers). */
export interface DeviceCaps {
  /** It can take a live session (a socket to a job's room) and nothing else: an ordinary step with commands is never offered. */
  liveOnly: boolean;
  /** The app runs inside a container or a VM that is not the person's own machine: a computer that is not one is preferred. */
  container: boolean;
  /** "darwin", "linux", "win32", or "" when it did not say. */
  os: string;
  /** "arm64", "x64", or "" when it did not say. */
  arch: string;
}

export const NO_CAPS: Readonly<DeviceCaps> = { liveOnly: false, container: false, os: "", arch: "" };

export interface DeviceBeat {
  deviceId: string;
  name: string;
  allowRun: boolean;
  /** Which projects it has allowed. */
  projects: ProjectAllow;
  busy: boolean;
  /** What it can do; a computer that says nothing is a plain one (NO_CAPS). */
  capabilities?: Partial<DeviceCaps>;
}

export interface Device extends Omit<DeviceBeat, "capabilities"> {
  userId: string;
  /** Epoch ms of the last heartbeat. */
  lastSeen: number;
  capabilities: DeviceCaps;
}

/** The most ids one allow list holds. A person has 50 projects at most; this is a guard for the frame and for memory. */
export const PROJECTS_ALLOW_MAX = 5000;

/** The capabilities as they are kept: every field present, the strings short and plain. */
export function capsOf(c: Partial<DeviceCaps> | undefined): DeviceCaps {
  const word = (v: unknown, max: number): string => (typeof v === "string" && /^[A-Za-z0-9._-]+$/.test(v) ? v.slice(0, max) : "");
  return { liveOnly: c?.liveOnly === true, container: c?.container === true, os: word(c?.os, 40), arch: word(c?.arch, 40) };
}

const copyAllow = (p: ProjectAllow): ProjectAllow => (p === "all" ? "all" : Array.isArray(p) ? [...p] : { allExcept: [...(p as { allExcept: readonly string[] }).allExcept] });

/** What a step needs of a computer, for choosing one. */
export interface CapableOpts {
  /** The step is a live session: a live-only computer may take it. Any other step is never given to one. */
  session?: boolean;
  /** Computers that declined this step already. */
  skip?: ReadonlySet<string>;
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
      projects: copyAllow(b.projects), lastSeen: now, capabilities: capsOf(b.capabilities),
    };
    this.items.set(key, next);
    this.trim(userId, now);
    if (!before || !wasUsable) return true;
    return before.allowRun !== next.allowRun || before.busy !== next.busy || !sameProjects(before.projects, next.projects)
      || before.capabilities.liveOnly !== next.capabilities.liveOnly;
  }

  /** The device, if it is online at `now`. */
  online(userId: string, deviceId: string, now: number): Device | null {
    const d = this.items.get(DeviceBook.key(userId, deviceId));
    return d && now - d.lastSeen <= DEVICE_ONLINE_MS ? cloneDevice(d) : null;
  }

  /** This person's devices that are online at `now`, newest heartbeat first. */
  onlineFor(userId: string, now: number): Device[] {
    return [...this.items.values()]
      .filter((d) => d.userId === userId && now - d.lastSeen <= DEVICE_ONLINE_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen || (a.deviceId < b.deviceId ? -1 : 1))
      .map(cloneDevice);
  }

  /**
   * Online devices that may run a step of this project: allowRun on, the project allowed, not busy, one that did not decline this step, and
   * one whose capabilities fit: a live-only computer takes a live session and nothing else. A computer that is not in a container comes
   * first (the person's own machine), then the most recently heard from.
   */
  capable(userId: string, projectId: string, now: number, o: CapableOpts = {}): Device[] {
    return this.onlineFor(userId, now)
      .filter((d) => d.allowRun && !d.busy && allows(d, projectId) && (o.session === true || !d.capabilities.liveOnly) && !o.skip?.has(d.deviceId))
      .map((d, i) => ({ d, i }))
      .sort((a, b) => Number(a.d.capabilities.container) - Number(b.d.capabilities.container) || a.i - b.i)
      .map((x) => x.d);
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

const cloneDevice = (d: Device): Device => ({ ...d, projects: copyAllow(d.projects), capabilities: { ...d.capabilities } });

/** Whether the device has allowed this project: "all", a list that has it, or "all except" a list that does not. */
export function allows(d: { projects: ProjectAllow }, projectId: string): boolean {
  const p = d.projects;
  if (p === "all") return true;
  if (Array.isArray(p)) return p.includes(projectId);
  return !(p as { allExcept: readonly string[] }).allExcept.includes(projectId);
}

function sameProjects(a: ProjectAllow, b: ProjectAllow): boolean {
  if (a === "all" || b === "all") return a === b;
  const listA = Array.isArray(a) ? a : (a as { allExcept: readonly string[] }).allExcept;
  const listB = Array.isArray(b) ? b : (b as { allExcept: readonly string[] }).allExcept;
  if (Array.isArray(a) !== Array.isArray(b) || listA.length !== listB.length) return false;
  const set = new Set(listA);
  return listB.every((p) => set.has(p));
}
