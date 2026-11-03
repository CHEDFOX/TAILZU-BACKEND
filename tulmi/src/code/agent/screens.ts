/**
 * THE SCREENS ROUND: A JOB THAT CHANGED WHAT PEOPLE SEE SHOWS IT, AS REAL SCREENSHOTS OF THE RUNNING APP, WITH ITS REPORT.
 *
 * When: the checks passed; the job is not one built from an approved design (that one looks at the page in its own round, design.ts); the staged
 * changes touch a file people see (a component, a page, a stylesheet); the project is a web app with a dev script; and this server has a browser for
 * shots and a place for the pictures (deps.screens). Then, as a person would before saying "done":
 *
 *   1. session   opens the job's runner with the staged edits laid over the checkout (a trivial command)
 *   2. start     starts the project's own dev server there (design.ts previewCommand), behind the preview's door
 *   3. wait      until it answers (the room wakes the job's Workflow the moment it does)
 *   4. shoot     the page the change shows on (design.ts targetRoute, from the changed files), at the project's sizes (a phone and a computer, or a
 *                phone only for a phone-first app); each picture is kept in the job's store (jobShots.ts: R2, the owner's key) and its id goes
 *                in the report, which the app shows by a signed link
 *
 * NO MODEL IS ASKED and nothing is compared: these are the pictures, not a judgement. IT NEVER BLOCKS THE COMMIT: no runner, no dev script, a dev server
 * that will not start, no browser or a failed shot, and the round ends with one sentence the report says ("No real screens: ..."), so the person knows
 * to ask for a drawn one, clearly marked as drawn. Each stage is saved, so a restart or a wait picks it up where it was and nothing is shot twice.
 */
import { getConfig } from "../../config.js";
import { cut, oneLine } from "../work/model.js";
import { Refused } from "./changeset.js";
import { isWebProject, previewCommand, targetRoute, viewportsFor } from "./design.js";
import { LostClaim, Yield, type Run } from "./run.js";
import { RunPending } from "./runner.js";
import { DESIGN_START_MS, type ScreenShot, type ScreensState } from "./types.js";

/** A file people see: a component, a page, a template or a stylesheet. */
const UI_FILE = /\.(?:tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|mdx)$/i;
/** Tests, stories and type files are not what people see. */
const NOT_UI = /(?:^|\/)(?:__tests__|tests?|e2e|cypress|\.storybook)\/|\.(?:test|spec|stories|d)\.[a-z]+$/i;

/** The staged files people see. */
export function seenFiles(paths: readonly string[]): string[] {
  return paths.filter((p) => UI_FILE.test(p) && !NOT_UI.test(p));
}

/** Whether the screens round is still to be done for this job. */
export function screensDue(r: Run): boolean {
  const s = r.state;
  // A helper never (its lead's job shows the whole); a job from a design has its own look.
  if (s.team && s.team.stage !== "final") return false;
  if (s.part && !s.part.repo) return false;
  if (s.spec || s.screens?.stage === "done" || !getConfig().CODE_SCREENS) return false;
  return seenFiles(r.tools.changes.paths()).length > 0;
}

/** The round is over: say why if there are no real screens, close the preview, go on to commit. Never throws for the preview. */
async function finish(r: Run, why?: string): Promise<void> {
  const sc = r.state.screens!;
  if (why && !sc.skipped && !sc.shots.length) {
    sc.skipped = oneLine(why, 300);
    await r.log.note(`Screens: ${sc.skipped}`);
  }
  sc.stage = "done";
  try { await r.deps.live?.preview?.stop(r.jobId, "screens"); } catch { /* the room closes it when it has had no request for a while */ }
  r.state.phase = "commit";
  await r.save();
}

/** The report's words for the screens: where they were taken, or why there are none. Links are added by whoever shows them. */
export function screensLines(sc: ScreensState | undefined, link?: (shotId: string) => string | null): string[] {
  if (!sc) return [];
  if (!sc.shots.length) return sc.skipped ? [`No real screens: ${sc.skipped} Ask for a drawn one if a picture helps; it will say it is drawn.`] : [];
  const sizes = [...new Set(sc.shots.map((s) => (s.viewport === "mobile" ? "a phone" : "a computer")))].join(" and ");
  const out = [`Real screens: ${sc.route ?? "/"} on ${sizes}, taken from the running app.`];
  for (const s of sc.shots) {
    const url = link?.(s.id);
    if (url) out.push(`- ${s.viewport === "mobile" ? "Phone" : "Computer"}: ${url}`);
  }
  return out;
}

export async function screensPhase(r: Run): Promise<void> {
  const s = r.state;
  const deps = r.deps;

  // ---- the first time in: can it be done at all?
  if (!s.screens) {
    const view = await r.brain.status().catch(() => null);
    const frameworks = view?.structure?.frameworks ?? [];
    s.screens = { stage: "session", viewports: viewportsFor(frameworks), shots: [] };
    const plan = previewCommand(view?.structure?.commands ?? []);
    if (!deps.screens) return finish(r, "this server has no browser and picture store set up for screenshots.");
    if (!deps.live?.preview) return finish(r, "there is no live runner here to run the app on.");
    if (!isWebProject(frameworks)) return finish(r, `this is not a web app (${frameworks.slice(0, 3).join(", ")}), so there is no page to open.`);
    if (!plan) return finish(r, "I found no dev script (dev, serve or start) to run the app with.");
    const seen = seenFiles(r.tools.changes.paths()).map((path) => ({ path }));
    const found = await targetRoute(r, seen).catch(() => ({ route: "/", note: "no page was found for it, so the home page was used" }));
    s.screens.route = found.route;
    s.screens.routeNote = found.note;
    await r.log.note(`Screens: running the app to take real screenshots of ${found.route} (${found.note}).`);
    await r.save();
  }
  const sc = s.screens;
  if (sc.stage === "done") { s.phase = "commit"; await r.save(); return; }
  const preview = deps.live!.preview!;
  const live = { id: r.jobId, userId: r.userId, projectId: r.projectId, branch: r.branch };

  // ---- 1. a runner, with the staged edits laid
  if (sc.stage === "session") {
    let overlay;
    try { overlay = r.tools.changes.toOverlay(); } catch (err) {
      if (err instanceof Refused) return finish(r, `${err.message}`);
      throw err;
    }
    const out = await r.runStep("screens:session", {
      commands: ["node -e \"process.exit(0)\""], timeoutSec: 180, estimateMinutes: 1, overlay, why: "Open the runner to take screenshots of the change",
    });
    if (out.status === "cancelled") throw new LostClaim();
    if (out.status !== "done") return finish(r, `no computer was free to run the app on (${cut(out.reason, 120)}).`);
    if (out.exitCode !== 0) return finish(r, "the runner could not be opened.");
    sc.stage = "start";
    await r.save();
  }

  // ---- 2. the dev server
  if (sc.stage === "start") {
    const view = await r.brain.status().catch(() => null);
    const plan = previewCommand(view?.structure?.commands ?? []);
    if (!plan) return finish(r, "I found no dev script to run the app with.");
    let overlay;
    try { overlay = r.tools.changes.toOverlay(); } catch (err) {
      if (err instanceof Refused) return finish(r, `${err.message}`);
      throw err;
    }
    const started = await preview.start(live, { cmd: plan.cmd, ...(plan.prepare ? { prepare: plan.prepare } : {}), overlay, readySec: 90 });
    if (!started.ok) return finish(r, `the app could not be run (${cut(started.message, 200)}).`);
    sc.startedAt = r.now();
    sc.stage = "wait";
    await r.save();
  }

  // ---- 3. until it answers
  if (sc.stage === "wait") {
    for (;;) {
      if (r.signal.aborted) throw new LostClaim();
      const st = await preview.status(r.jobId).catch(() => null);
      if (st?.state === "ready" && st.url) { sc.stage = "shoot"; await r.save(); break; }
      if (!st || st.state === "none" || st.state === "closed") {
        return finish(r, `the app's dev server did not start${st?.error ? `: ${cut(st.error, 200)}` : st?.closeReason ? ` (${st.closeReason})` : ""}.`);
      }
      const waited = r.now() - (sc.startedAt ?? r.now());
      if (waited > DESIGN_START_MS) return finish(r, "the app's dev server did not answer in time.");
      if (r.env.pollOnce) throw new RunPending(Math.min(15_000, Math.max(3_000, DESIGN_START_MS - waited)), 0);
      await r.renew();
      await r.deps.sleep(2_000);
    }
  }

  // ---- 4. the pictures, one size at a time
  if (sc.stage === "shoot") {
    const st = await preview.status(r.jobId).catch(() => null);
    if (!st || st.state !== "ready" || !st.url) return finish(r, "the app stopped before it could be looked at.");
    const todo = sc.viewports.filter((v) => !sc.shots.some((x) => x.viewport === v));
    let failed = "";
    for (const [i, viewport] of todo.entries()) {
      if (r.signal.aborted) throw new LostClaim();
      try {
        const png = await deps.screens!.shoot(new URL(sc.route ?? "/", st.url).href, viewport);
        const { id } = await deps.screens!.store.put(r.userId, r.jobId, png);
        const shot: ScreenShot = { id, route: sc.route ?? "/", viewport };
        sc.shots.push(shot);
        await r.save();
      } catch (err) {
        if (err instanceof LostClaim) throw err;
        failed ||= `the screenshot failed (${cut(oneLine(String((err as Error)?.message ?? err), 160), 160)}).`;
        continue;
      }
      // One picture is an advance's work.
      if (r.env.turnsPerAdvance !== undefined && i < todo.length - 1) throw new Yield();
    }
    return finish(r, failed || undefined);
  }
}
