/**
 * THE DESIGN CHECK FOR A SCREEN: RENDER WHAT THE BOT LEFT BEHIND IN A REAL BROWSER AND COMPARE IT TO THE REFERENCE PICTURE.
 *
 * The result commit is checked out, the task's hidden preview entry is laid over it (a page that mounts the component the task asked for, at a
 * conventional path the request names), the project's own dev server is started on a free port, Chromium (Playwright, from this machine's global
 * install) opens the page and takes a picture of the component's box. That picture goes through the product's own cheap gate (artifacts/pixels.ts):
 * when the two pictures are the same by that measure the design is matched. When they are not, and a model is available, the product's own compare
 * step (artifacts/compare.ts, the vision tier) says how close it is and what differs; without one the gate's number decides, against the task's bar.
 *
 * The reference pictures are in e2e/images/. For a task built from a screenshot the same picture is what the bot is shown.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { compareShots } from "../../src/artifacts/compare.js";
import { gate } from "../../src/artifacts/pixels.js";
import type { Task } from "../tasks/schema.js";
import { workTree } from "./hidden.js";
import { checkoutEnv } from "../repos.js";
import { IMAGES_DIR, mkdirp, sleep } from "../util.js";

export interface DesignResult { ok: boolean; detail: string; similarity: number; shot?: Uint8Array }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

type PwBrowser = { newPage(o: object): Promise<PwPage>; close(): Promise<void> };
type PwPage = { goto(url: string, o: object): Promise<unknown>; screenshot(o: object): Promise<Uint8Array>; locator(sel: string): { screenshot(o: object): Promise<Uint8Array>; waitFor(o: object): Promise<void> }; close(): Promise<void> };

let pw: { chromium: { launch(o: object): Promise<PwBrowser> } } | null = null;
function playwright(): NonNullable<typeof pw> {
  if (!pw) {
    const dirs = [process.env.PLAYWRIGHT_MODULES, "/opt/node22/lib/node_modules/", "/usr/lib/node_modules/", "/usr/local/lib/node_modules/"].filter((d): d is string => !!d && fs.existsSync(d));
    for (const d of dirs) { try { pw = createRequire(d.endsWith("/") ? d : `${d}/`)("playwright"); break; } catch { /* try the next */ } }
    if (!pw) throw new Error("Playwright is not installed on this machine (the design check needs it, and a Chromium)");
  }
  return pw;
}

/** The dev server of a project, started in a checkout; resolves with a way to stop it. */
export async function startDevServer(command: string, cwd: string, env: Record<string, string>, port: number, o: { timeoutMs?: number } = {}): Promise<{ stop(): void; log(): string }> {
  const child = spawn("bash", ["-lc", command.replace(/\{port\}/g, String(port))], { cwd, env: { ...env, PORT: String(port), BROWSER: "none" } as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  child.stdout.on("data", (d: Buffer) => { out = (out + d.toString()).slice(-4000); });
  child.stderr.on("data", (d: Buffer) => { out = (out + d.toString()).slice(-4000); });
  const stop = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
  const deadline = Date.now() + (o.timeoutMs ?? 90_000);
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the dev server stopped: ${out.slice(-300)}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return { stop, log: () => out };
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { stop(); throw new Error(`the dev server did not answer in time: ${out.slice(-300)}`); }
    await sleep(500);
  }
}

/** A picture of the page's `selector` box, at the given viewport. */
export async function shoot(url: string, selector: string, viewport = { width: 800, height: 600 }): Promise<Uint8Array> {
  const browser = await playwright().chromium.launch({ args: ["--no-sandbox", "--font-render-hinting=none", "--disable-lcd-text"] });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    const el = page.locator(selector);
    await el.waitFor({ state: "visible", timeout: 20_000 });
    await sleep(300);
    return await el.screenshot({ animations: "disabled", type: "png" });
  } finally { await browser.close(); }
}

/** Renders what an agent left (the base project with its changes laid over it, and the hidden preview page) and compares it to the task's reference picture. */
export async function designScore(task: Task, changes: Record<string, string | null>, o: { call?: Parameters<typeof compareShots>[2]["call"] } = {}): Promise<DesignResult> {
  const d = task.checks.design!;
  const ref = fs.readFileSync(path.join(IMAGES_DIR, d.reference));
  const co = await workTree(task, changes, task.hidden?.files ?? {});
  let server: Awaited<ReturnType<typeof startDevServer>> | null = null;
  try {
    const spec = co.spec;
    if (!spec?.ui) return { ok: false, detail: "this project has no dev server configured for previews", similarity: 0 };
    const port = await freePort();
    server = await startDevServer(spec.ui.dev, co.dir, checkoutEnv(spec, {}, co.dir), port);
    const shot = await shoot(`http://127.0.0.1:${port}${d.route ?? "/"}`, "#e2e-target");
    const g = gate(ref, shot);
    const min = d.minSimilarity ?? 0.85;
    if (g.same) return { ok: true, detail: "the picture is the same as the reference by the pixel gate", similarity: 1, shot };
    let similarity = Math.max(0, 1 - g.difference);
    let detail = `the pixel gate: ${g.changedCells} regions differ (difference ${g.difference.toFixed(2)})`;
    if (o.call) {
      try {
        const v = await compareShots(ref, shot, { component: task.title, location: "the preview page", viewport: "desktop", userId: "e2e", budget: { maxPaise: 100 }, call: o.call } as never);
        similarity = v.match;
        detail = `the vision compare says ${Math.round(v.match * 100)}% (${v.issues.length} issue(s))`;
      } catch (err) { detail += `; the vision compare failed (${(err as Error).message.slice(0, 60)})`; }
    }
    return { ok: similarity >= min, detail: `${detail}; the bar is ${Math.round(min * 100)}%`, similarity, shot };
  } finally {
    server?.stop();
    co.dispose();
  }
}

/** Writes a picture where a person can look at it (the report links it). */
export function keepShot(dir: string, name: string, png: Uint8Array): string {
  mkdirp(dir);
  const f = path.join(dir, name);
  fs.writeFileSync(f, png);
  return f;
}
