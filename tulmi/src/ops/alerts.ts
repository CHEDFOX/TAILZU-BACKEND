/**
 * THE SERVER WATCHES ITSELF: disk, memory and CPU, and tells the owner before any of them runs out.
 *
 *   readHealth()             this machine now: disk used (of the disk the server runs on), memory in use, CPU load per core
 *   problemsOf(health)       what is over its line: disk past 80%, memory past 85%, CPU load past 0.7 a core
 *   startOpsAlerts(o)        every 5 minutes: a push to OPS_ALERT_USER_ID for each problem (CPU only once it has lasted 15 minutes),
 *                            at most once in 6 hours for the same problem, and one "back to normal" when it clears
 *
 * Off until OPS_ALERT_USER_ID is set (the owner's own account id: Supabase → Authentication → Users). Inside Docker the disk and the
 * load are the machine's own; memory is read from /proc/meminfo, which is the machine's too.
 */
import fs from "node:fs/promises";
import os from "node:os";

export interface Health { diskUsed: number; diskTotalGb: number; memUsed: number; load: number }
export type Problem = "disk" | "memory" | "cpu";

const LINES = { disk: 0.8, memory: 0.85, cpu: 0.7 } as const;
const EVERY_MS = 5 * 60_000;
const AGAIN_MS = 6 * 3_600_000;
/** CPU is noisy: only a load that lasts this many checks (15 minutes) is a problem. */
const CPU_CHECKS = 3;

export async function readHealth(path = "/"): Promise<Health> {
  const st = await fs.statfs(path);
  const total = st.blocks * st.bsize, free = st.bavail * st.bsize;
  let memUsed = 1 - os.freemem() / os.totalmem();
  try {
    const info = await fs.readFile("/proc/meminfo", "utf8");
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(info)?.[1] ?? NaN);
    const t = kb("MemTotal"), a = kb("MemAvailable");
    if (t > 0 && a >= 0) memUsed = 1 - a / t;
  } catch { /* not Linux: Node's own numbers */ }
  return { diskUsed: total ? 1 - free / total : 0, diskTotalGb: total / 1024 ** 3, memUsed, load: os.loadavg()[0]! / Math.max(1, os.cpus().length) };
}

export function problemsOf(h: Health): Problem[] {
  return [
    ...(h.diskUsed > LINES.disk ? ["disk" as const] : []),
    ...(h.memUsed > LINES.memory ? ["memory" as const] : []),
    ...(h.load > LINES.cpu ? ["cpu" as const] : []),
  ];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
export function alertLine(p: Problem, h: Health): { title: string; body: string } {
  if (p === "disk") return { title: `Server disk ${pct(h.diskUsed)} full`, body: `${Math.round(h.diskUsed * h.diskTotalGb)} GB of ${Math.round(h.diskTotalGb)} GB used. Free some space or grow the disk.` };
  if (p === "memory") return { title: `Server memory ${pct(h.memUsed)} in use`, body: "Big jobs may start failing. Check what is running, or move the runner off this server." };
  return { title: "Server CPU busy for 15 minutes", body: `Load ${h.load.toFixed(2)} a core. The app may feel slow. Check what is running.` };
}

export type AlertSend = (msg: { title: string; body: string; key: string }) => Promise<void>;

/** One check; returns what it sent. `state` carries what was sent and the CPU streak between checks. */
export async function checkOnce(read: () => Promise<Health>, send: AlertSend, state: { sent: Map<Problem, number>; cpuStreak: number }, now = Date.now()): Promise<string[]> {
  const h = await read();
  const found = problemsOf(h);
  state.cpuStreak = found.includes("cpu") ? state.cpuStreak + 1 : 0;
  const live = found.filter((p) => p !== "cpu" || state.cpuStreak >= CPU_CHECKS);
  const out: string[] = [];
  for (const p of live) {
    const last = state.sent.get(p);
    if (last !== undefined && now - last < AGAIN_MS) continue;
    const m = alertLine(p, h);
    await send({ ...m, key: `ops:${p}:${Math.floor(now / AGAIN_MS)}` });
    state.sent.set(p, now);
    out.push(p);
  }
  for (const p of [...state.sent.keys()]) {
    if (live.includes(p)) continue;
    state.sent.delete(p);
    await send({ title: `Server ${p === "cpu" ? "CPU" : p} back to normal`, body: "Nothing to do.", key: `ops:${p}:ok:${now}` });
    out.push(`${p}:ok`);
  }
  return out;
}

export function startOpsAlerts(o: { send: AlertSend; read?: () => Promise<Health>; log?: { warn(o: object, m: string): void } }): () => void {
  const state = { sent: new Map<Problem, number>(), cpuStreak: 0 };
  const t = setInterval(() => {
    checkOnce(o.read ?? (() => readHealth()), o.send, state).catch((err) => o.log?.warn({ err: (err as Error)?.message }, "ops: health check failed"));
  }, EVERY_MS);
  t.unref();
  return () => clearInterval(t);
}
