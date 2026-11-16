/**
 * ONE PLACE BLENDER CAN RUN: this machine. It is the Render port (ports.ts) over a process, and the simplest of the places
 * the loop can send a script — the same code serves a container on the VPS, since both are "there is a blender here".
 *
 *   blenderRunner(o)   → a Render the loop can use
 *
 * How it runs it: a folder of its own per render, the script written into it, and `blender --background --factory-startup
 * --python <script>`. Nothing goes through a shell, so nothing in a script can become an argument. The script is told where
 * to write and where the assets are through the environment, never through the scene (types.ts says why).
 *
 * Past its time it is killed, hard, and what it had written is still read: a render that got most of the way is worth more
 * than nothing. The log comes back cut to its last few thousand characters, which is where a Blender error always is.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Render, RenderJob, RenderOut, Shot } from "./ports.js";

/**
 * ONE AT A TIME, unless told otherwise. Two renders on the same machine do not go twice as fast: they share the same cores
 * and the same memory, and the pair takes longer than the two would have taken in turn — and on a box that is also serving
 * the app, they take the app down with them. So a render waits its turn.
 */
class Lanes {
  private free: number;
  private queue: Array<() => void> = [];
  constructor(n: number) { this.free = Math.max(1, n); }
  async take(): Promise<() => void> {
    if (this.free > 0) { this.free--; } else await new Promise<void>((go) => this.queue.push(go));
    let given = false;
    return () => {
      if (given) return;
      given = true;
      const next = this.queue.shift();
      if (next) next(); else this.free++;
    };
  }
  /** How many are waiting, for a caller that would rather say "in a minute" than queue. */
  get waiting(): number { return this.queue.length; }
}

export interface BlenderOpts {
  /** The binary. The default is whatever `blender` is on the path. */
  bin?: string;
  /** Where the per-render folders go. The default is the system's temporary place. */
  workDir?: string;
  /** Keep the folder after it runs (for working out why something looks wrong). */
  keepWork?: boolean;
  /** How many renders may run at once on this machine. One, unless the box is big and does nothing else. */
  lanes?: number;
}

/** The end of the log, which is where the reason is. */
const tail = (s: string, n = 4_000): string => (s.length > n ? `…${s.slice(-n)}` : s);

/** What a render wrote, as the loop wants it: a picture, or the one clip. */
async function gather(out: string): Promise<Shot[]> {
  let names: string[] = [];
  try { names = await readdir(out); } catch { return []; }
  const shots: Shot[] = [];
  const clip = names.find((f) => f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".mov"));
  if (clip) {
    shots.push({ frame: 1, bytes: await readFile(path.join(out, clip)), mime: "video/mp4" });
    return shots;
  }
  const pics = names.filter((f) => f.endsWith(".png")).sort();
  for (const [i, f] of pics.entries()) {
    shots.push({ frame: i + 1, bytes: await readFile(path.join(out, f)), mime: "image/png" });
  }
  return shots;
}

export function blenderRunner(o: BlenderOpts = {}): Render & { waiting: () => number } {
  const bin = o.bin && o.bin.trim() ? o.bin.trim() : "blender";
  const lanes = new Lanes(o.lanes ?? 1);
  const run = async (job: RenderJob): Promise<RenderOut> => {
    const began = Date.now();
    const done = await lanes.take();
    const base = o.workDir ?? tmpdir();
    await mkdir(base, { recursive: true });
    const work = await mkdtemp(path.join(base, "cinema-"));
    const out = path.join(work, "out");
    const scriptPath = path.join(work, "scene.py");
    let log = "";
    try {
      await mkdir(out, { recursive: true });
      await writeFile(scriptPath, job.script, "utf8");

      const code = await new Promise<number | null>((resolve) => {
        const child = spawn(bin, ["--background", "--factory-startup", "--python", scriptPath, "--python-exit-code", "9"], {
          env: {
            ...process.env,
            CINEMA_OUT: out,
            CINEMA_ASSETS: JSON.stringify(job.assets ?? {}),
            // Blender's own start-up noise is not worth the log it fills.
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const add = (b: Buffer): void => { log = tail(log + b.toString("utf8"), 8_000); };
        child.stdout.on("data", add);
        child.stderr.on("data", add);
        const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* it had already gone */ } }, Math.max(5_000, job.timeoutMs));
        child.on("error", (e) => { log = tail(`${log}\n${String(e)}`); clearTimeout(killer); resolve(null); });
        child.on("close", (c) => { clearTimeout(killer); resolve(c); });
      });

      const shots = await gather(out);
      const blend = job.wantBlend ? await readFile(path.join(out, "scene.blend")).catch(() => undefined) : undefined;
      const ms = Date.now() - began;
      if (!shots.length) {
        const why = code === null ? `${bin} could not be started` : code === 0 ? "it finished but wrote no picture" : `it stopped with code ${code}`;
        return { ok: false, error: why, ms, log: tail(log) };
      }
      return { ok: true, shots, ...(blend ? { blend } : {}), ms, log: tail(log) };
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err), ms: Date.now() - began, log: tail(log) };
    } finally {
      done();
      if (!o.keepWork) await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  };
  return Object.assign(run, { waiting: () => lanes.waiting });
}

/**
 * THE RENDERER THIS MACHINE IS, as the switches describe it (config.ts CINEMA_BLENDER, CINEMA_WORK) — the backend on its
 * own, with no app anywhere. `ready()` says whether there is a Blender here at all and which one, so a machine that has
 * none can say so instead of failing a job.
 */
export function renderHere(o: { bin?: string; workDir?: string; lanes?: number } = {}): {
  render: Render;
  ready: () => Promise<{ ok: boolean; version: string | null }>;
  waiting: () => number;
} {
  const bin = o.bin?.trim() || "blender";
  const runner = blenderRunner({
    bin,
    ...(o.workDir?.trim() ? { workDir: o.workDir.trim() } : {}),
    ...(o.lanes ? { lanes: o.lanes } : {}),
  });
  return {
    render: runner,
    ready: async () => { const version = await blenderVersion(bin); return { ok: !!version, version }; },
    waiting: runner.waiting,
  };
}

/** Whether a Blender is there at all, and which version — what a machine says about itself before it is sent work. */
export async function blenderVersion(bin = "blender"): Promise<string | null> {
  return new Promise((resolve) => {
    let said = "";
    const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (b: Buffer) => { said += b.toString("utf8"); });
    child.on("error", () => resolve(null));
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(null); }, 10_000);
    child.on("close", () => {
      clearTimeout(killer);
      const m = /Blender\s+(\d+\.\d+(?:\.\d+)?)/i.exec(said);
      resolve(m ? m[1]! : null);
    });
  });
}
