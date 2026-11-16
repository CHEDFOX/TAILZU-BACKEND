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
 * AND THE FLOOR (floor.ts). While the app is still running, the page is read as the browser drew it, and the things a page needs whatever its design
 * says are checked on it: a viewport tag, alt text, labels on the fields, a name on every button, a language, an outline whose levels do not skip.
 * Nobody asks for those and everybody wants them, so they are checked rather than hoped for. Free (no model, no second run), and like the pictures it
 * never blocks anything: a server with no renderer, or a page that will not answer, and the floor is simply not checked and not mentioned.
 *
 * NO MODEL IS ASKED and nothing is compared: these are the pictures, not a judgement. IT NEVER BLOCKS THE COMMIT: no runner, no dev script, a dev server
 * that will not start, no browser or a failed shot, and the round ends with one sentence the report says ("No real screens: ..."), so the person knows
 * to ask for a drawn one, clearly marked as drawn. Each stage is saved, so a restart or a wait picks it up where it was and nothing is shot twice.
 */
import { getConfig } from "../../config.js";
import { cut, oneLine } from "../work/model.js";
import { Refused } from "./changeset.js";
import { isWebProject, previewCommand, targetRoute, viewportsFor } from "./design.js";
import { checkFloor, floorLines, seenByPeople } from "./floor.js";
import { runProbe } from "./probe.js";
import { REPAIR_ROUNDS_MAX, coherenceLines, repairBrief, repairDelta, worthRepairing } from "./coherence.js";
import { LostClaim, Yield, type Run } from "./run.js";
import { RunPending } from "./runner.js";
import { DESIGN_START_MS, type ScreenShot, type ScreensState } from "./types.js";

/** The staged files people see (floor.ts holds the one definition, because the brief the model is given fires on the same thing). */
export function seenFiles(paths: readonly string[]): string[] {
  return paths.filter(seenByPeople);
}

/** Whether the screens round is still to be done for this job. */
export function screensDue(r: Run): boolean {
  const s = r.state;
  // A helper never (its lead's job shows the whole); a job from a design has its own look.
  if (s.team && s.team.stage !== "final") return false;
  if (s.part && !s.part.repo) return false;
  if (s.spec || !getConfig().CODE_SCREENS) return false;
  // "done" normally means the round is over — unless a repair round sent the job back to work, which reopens it to measure the fix.
  if (s.screens?.stage === "done") return false;
  return seenFiles(r.tools.changes.paths()).length > 0;
}

/** What a repair round needs left in the budget before it is worth starting, in paise. */
export const REPAIR_PAISE_MIN = 400;

/** The round is over: say why if there are no real screens, close the preview, go on to commit. Never throws for the preview. */
async function finish(r: Run, why?: string): Promise<void> {
  const sc = r.state.screens!;
  r.state.work.pageFeedback = undefined;
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
  const floor = [
    ...floorLines(sc.floor ?? []),
    ...(sc.probe ? coherenceLines(sc.probe) : []),
    ...(sc.first && sc.probe ? ["", ...repairDelta(sc.first as never, worthRepairing(sc.probe))] : []),
  ];
  // No pictures: say why, and still say what the floor found, because a page that would not photograph may still have been read.
  if (!sc.shots.length) {
    const why = sc.skipped ? [`No real screens: ${sc.skipped} Ask for a drawn one if a picture helps; it will say it is drawn.`] : [];
    return floor.length ? [...why, ...(why.length ? [""] : []), ...floor] : why;
  }
  const sizes = [...new Set(sc.shots.map((s) => (s.viewport === "mobile" ? "a phone" : "a computer")))].join(" and ");
  const out = [`Real screens: ${sc.route ?? "/"} on ${sizes}, taken from the running app.`];
  for (const s of sc.shots) {
    const url = link?.(s.id);
    if (url) out.push(`- ${s.viewport === "mobile" ? "Phone" : "Computer"}: ${url}`);
  }
  if (floor.length) out.push("", ...floor);
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
    const page = new URL(sc.route ?? "/", st.url).href;
    await theFloor(r, page);
    await theMeasure(r, page);
    if (await theRepair(r)) return;
    return finish(r, failed || undefined);
  }
}

/**
 * The floor, on the page the pictures were taken of, while the app is still running. Never throws and never blocks: no renderer here, or a page that
 * will not answer, and `floor` stays absent, which the report says nothing about. A sound page records an empty list, which is also nothing to say.
 */
async function theFloor(r: Run, url: string): Promise<void> {
  const sc = r.state.screens!;
  if (sc.floor || !r.deps.screens?.read) return;
  let html: string;
  try {
    html = await r.deps.screens.read(url);
  } catch (err) {
    if (err instanceof LostClaim) throw err;
    return;
  }
  sc.floor = checkFloor(html);
  if (sc.floor.length) {
    await r.log.note(`The floor: ${sc.floor.map((f) => f.rule).join(", ")} — ${sc.floor.length} thing(s) the page needs whatever its design says.`);
  }
  await r.save();
}

/**
 * The deeper look, on the page a browser actually drew: the things that exist only after layout and the cascade (agent/probe.ts). Two loads of the
 * same page, one of them with reduced motion emulated, at phone width because that is where a layout breaks. Never throws, never blocks, and
 * absent entirely where this server has no browser that will run an expression in a page.
 */
async function theMeasure(r: Run, url: string): Promise<void> {
  const sc = r.state.screens!;
  if (sc.probe || !r.deps.screens?.measure) return;
  try {
    const got = await runProbe(r.deps.screens.measure, url);
    if (!got.walked && got.trouble.length) {
      r.deps.log?.warn({ jobId: r.jobId, why: got.trouble[0] }, "code agent: the page could not be measured");
      return;
    }
    sc.probe = got;
    const said = coherenceLines(got);
    if (said.length) await r.log.note(`Measured the page as it was drawn: ${said.length - 1} thing(s) worth saying.`);
  } catch (err) {
    if (err instanceof LostClaim) throw err;
    r.deps.log?.warn({ jobId: r.jobId, error: (err as Error)?.name }, "code agent: the page could not be measured");
    return;
  }
  await r.save();
}

/**
 * THE REPAIR ROUND: WHAT IS OBJECTIVELY WRONG GETS FIXED, NOT FILED.
 *
 * Everything else in this round reports. This does not, and that is the point: a linter hands a person a list, and an agent is standing in the
 * project with the app running. Every defect the measurement finds is wrong by any standard — nobody has to be asked whether text nobody can read
 * is a problem — and every one carries the axis that fixes it without touching what the person chose (coherence.ts repairBrief).
 *
 * So the job goes back to work with the measurements in front of it, the checks run again, the page is drawn again and measured again, and the
 * report shows the before and the after instead of the list. Two rounds at most, and only when something objective was actually found: a page that
 * measures clean never costs a job a single turn.
 *
 * Returns true when the job was sent back, in which case this round is over for now and will run again after the checks.
 */
async function theRepair(r: Run): Promise<boolean> {
  const s = r.state;
  const sc = s.screens!;
  if (!sc.probe) return false;
  const found = worthRepairing(sc.probe);
  // The first measurement is kept whatever happens, so the report can show what it was even when nothing could be fixed.
  if (sc.first === undefined) sc.first = found as never;
  const round = (sc.round ?? 0) + 1;
  if (!found.length || round > REPAIR_ROUNDS_MAX) return false;

  // A round costs model turns, so a job that cannot pay for one keeps its measurements and reports them instead.
  const money = await r.money();
  if (money.remaining < REPAIR_PAISE_MIN) {
    await r.log.note(`The page measured ${found.length} thing(s) wrong by any standard, but there is not enough budget left to fix them, so they are in the report.`);
    return false;
  }

  sc.round = round;
  const w = s.work;
  w.pageFeedback = repairBrief(found, round);
  await r.log.note(`Fixing what the page measured wrong (round ${round} of ${REPAIR_ROUNDS_MAX}): ${found.map((d) => d.rule).join(", ")}.`);
  // A fresh work round, as the design round starts one: nothing of the last one's state carries over.
  w.feedback = undefined;
  w.finished = false;
  w.runs = 0;
  w.nudged = false;
  w.badTurns = 0;
  w.roundStartPaise = money.spent;
  w.roundStartedAt = r.now();
  // The page will have changed, so the pictures and the measurements are taken again rather than kept.
  sc.stage = "session";
  sc.shots = [];
  delete sc.probe;
  delete sc.floor;
  delete sc.skipped;
  s.phase = "work";
  try { await r.deps.live?.preview?.stop(r.jobId, "repair"); } catch { /* the room closes it when it has had no request for a while */ }
  await r.save();
  return true;
}
