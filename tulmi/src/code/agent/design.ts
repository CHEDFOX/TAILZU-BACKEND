/**
 * THE DESIGN ROUND: THE APP THAT WAS BUILT, RUN AND LOOKED AT, AGAINST THE DESIGN THE PERSON APPROVED (docs/artifacts.md section 11).
 *
 * A job made by "build it" (artifacts/build.ts) has a SPEC: the design, at the version they said yes to. When the checks have passed, and before the commit,
 * this phase does what a person would do before saying "done":
 *
 *   1. opens the job's runner (a trivial command, so the staged edits are laid over the checkout) and starts the project's own dev server on it,
 *      from the brain's scripts (`dev`, `serve`, `start`, with the package manager's prefix);
 *   2. waits for it to answer, and opens the page the design is for: the route found from where it goes (the brain's routes, the files that import it),
 *      else `/`;
 *   3. shoots that page and the approved design, at mobile and desktop (mobile only for a project whose main target is mobile), and compares them
 *      (artifacts/compare.ts: a cheap check in pure TypeScript first, the vision tier only if they differ, metered in the job's budget);
 *   4. MAJOR differences send the job back to work with the issues and the fix hints in front of the model, at most DESIGN_ROUNDS_MAX (2) times, and the
 *      checks run again before the next look. After the last, one more look is taken, and what still differs is REPORTED (it does not loop again).
 *
 * THE REPORT carries the match, the side-by-side shots (signed links, 7 days, the owner's only) and the minor differences that remain.
 *
 * IT NEVER BLOCKS THE COMMIT. No runner, a dev server that will not start, a project that is not a web app, no browser for screenshots, a failed shot or a
 * model that said nothing usable: the round is skipped or ended with a sentence the report says, and the job goes on to commit what the checks passed.
 * The stages are saved one by one (DesignState.stage), so a restart or a wait picks it up where it was and nothing is done twice.
 */
import { getConfig } from "../../config.js";
import type { DesignIssue, ViewportResult } from "../../artifacts/build.js";
import type { Command, SymbolInfo } from "../project/types.js";
import { cut, oneLine } from "../work/model.js";
import { Refused } from "./changeset.js";
import { LostClaim, Yield, type Run } from "./run.js";
import { RunPending } from "./runner.js";
import { DESIGN_ROUNDS_MAX, DESIGN_START_MS, type DesignIssueRecord, type DesignState, type DesignViewState, type DesignViewport } from "./types.js";

// ------------------------------------------------------------ what to run

const JS_MANAGER = /^(?:npm|pnpm|yarn|bun)\b/;
const shq = (s: string): string => (/^[\w./@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export interface PreviewPlan {
  /** The command that starts the dev server. */
  cmd: string;
  /** The install to run first, when there is no node_modules. */
  prepare?: string;
}

/**
 * The dev server's command from the brain's scripts: `dev` (the scan's name for dev, start:dev, develop and serve), else `start`, with the package
 * manager's own prefix (`npm run dev`, `pnpm run dev`, `yarn dev`, `bun run dev`). null for a project with no such script, or that is not a JavaScript one.
 */
export function previewCommand(commands: readonly Command[]): PreviewPlan | null {
  const js = commands.filter((c) => JS_MANAGER.test(c.cmd));
  const first = (kind: Command["kind"]): Command | undefined => js.find((c) => c.kind === kind && c.cwd === "") ?? js.find((c) => c.kind === kind);
  const dev = first("dev") ?? first("run");
  if (!dev) return null;
  const wrap = (c: Command): string => (c.cwd ? `cd ${shq(c.cwd)} && ${c.cmd}` : c.cmd);
  // A workspace package installs from the root; a lone one from its own folder.
  const install = js.find((c) => c.kind === "install" && c.cwd === "") ?? js.find((c) => c.kind === "install" && c.cwd === dev.cwd);
  return { cmd: wrap(dev), ...(install ? { prepare: install.cmd.length < 1900 ? wrap(install) : install.cmd } : {}) };
}

const WEB = /^(?:Next\.js|Nuxt|Remix|Gatsby|Astro|SvelteKit|React|Vue|Svelte|Angular|Solid|Preact|Vite|webpack|Parcel|Expo|Storybook)$/;
const WEB_FIRST = /^(?:Next\.js|Nuxt|Remix|Gatsby|Astro|SvelteKit|Vue|Svelte|Angular|Solid|Preact)$/;

/** Whether the project can show a page in a browser: some web framework is in it, or the brain knows none at all (then the dev script is tried). */
export function isWebProject(frameworks: readonly string[]): boolean {
  return frameworks.length === 0 || frameworks.some((f) => WEB.test(f));
}

/** The viewports to compare: mobile only when mobile is the project's main target (an Expo or React Native app and no web framework), else both. */
export function viewportsFor(frameworks: readonly string[]): DesignViewport[] {
  const mobileMain = frameworks.some((f) => f === "Expo" || f === "React Native") && !frameworks.some((f) => WEB_FIRST.test(f));
  return mobileMain ? ["mobile"] : ["mobile", "desktop"];
}

// ------------------------------------------------------------- which page

/** A route a browser can open as it is written: no `[id]`, `:id`, `*` or `{x}` in it. */
const STATIC_ROUTE = /^\/[\w\-./~%@]*$/;

const routeOf = (symbols: readonly SymbolInfo[]): string | null => {
  const r = symbols.find((s) => s.kind === "route" && (s.method === undefined || s.method === "GET" || s.method === "ANY") && typeof s.path === "string" && s.path.startsWith("/") && !/^\/api(?:\/|$)/.test(s.path));
  return r?.path ?? null;
};

const pascal = (file: string): string => (file.split("/").pop() ?? "").replace(/\.[^.]+$/, "").replace(/(?:^|[-_.])(\w)/g, (_m, c: string) => c.toUpperCase());

/**
 * The page of the app the design is shown on. From where it goes: the file's own routes (Next's `app/` and `pages/`), else the routes of the files that
 * import it, a few hops up, else a `<Route path="/x" element={<Name />}>` in one of them (React Router); else `/`. A route that needs a value
 * (`/users/[id]`) is not opened. Says how it was found, for the report.
 */
export async function targetRoute(r: Run, targets: ReadonlyArray<{ path: string }>): Promise<{ route: string; note: string }> {
  const brain = r.brain;
  let sawDynamic = "";
  const consider = (route: string | null): string | null => {
    if (!route) return null;
    if (STATIC_ROUTE.test(route)) return route;
    sawDynamic ||= route;
    return null;
  };
  for (const t of targets.slice(0, 3)) {
    const seen = new Set<string>([t.path]);
    let frontier = [t.path];
    for (let hop = 0; hop < 3 && frontier.length; hop += 1) {
      const next: string[] = [];
      for (const path of frontier) {
        const file = await brain.file(path).catch(() => null);
        const own = consider(file ? routeOf(file.symbols) : null);
        if (own) return { route: own, note: hop === 0 ? `the route ${own} is the file's own` : `the route ${own} of a page that shows it` };
        const importers = (await brain.neighbors(path).catch(() => ({ imports: [], importedBy: [] }))).importedBy.slice(0, 12);
        const name = pascal(t.path);
        for (const imp of importers) {
          if (seen.has(imp)) continue;
          seen.add(imp);
          next.push(imp);
          if (!name) continue;
          const text = await r.ws.read(imp).then((x) => x.text).catch(() => "");
          const m = new RegExp(`<Route\\b[^>]*\\bpath=["'{\`]+(/[^"'}\`]*)["'}\`]+[^>]*(?:element|component)=\\{?\\s*<?\\s*${name}\\b`, "s").exec(text);
          const found = consider(m?.[1] ?? null);
          if (found) return { route: found, note: `the route ${found} in ${imp}` };
        }
      }
      frontier = next;
    }
  }
  return { route: "/", note: sawDynamic ? `its page (${sawDynamic}) needs a value, so the home page was used` : "no page was found for it, so the home page was used" };
}

// --------------------------------------------------------------- the phase

const COMPARE_WORST_PAISE = 120;

const fresh = (viewports: DesignViewport[]): DesignState => ({ stage: "session", round: 0, viewports, views: [], history: [], paise: 0 });

/** Whether the design round is still to be done for this job. */
export function designDue(r: Run): boolean {
  const s = r.state;
  // A lead looks at the design once, when everything is merged and checked together; a helper never (the lead does, for the whole).
  if (s.team && s.team.stage !== "final") return false;
  if (s.part && !s.part.repo) return false;
  return !!s.spec && s.design?.stage !== "done" && getConfig().CODE_DESIGN_CHECK;
}

/** The check is over: say why if it did not run, close the preview, and go on to commit. Never throws for the preview. */
async function finish(r: Run, why?: string): Promise<void> {
  const d = r.state.design!;
  if (why && !d.skipped) {
    d.skipped = oneLine(why, 400);
    await r.log.decision(`Design check: ${d.skipped}`);
  }
  d.stage = "done";
  r.state.work.designFeedback = undefined;
  try { await r.deps.live?.preview?.stop(r.jobId, "done"); } catch { /* the room closes it when it has had no request for a while */ }
  r.state.phase = "commit";
  await r.save();
}

const average = (views: readonly DesignViewState[]): number => {
  const ok = views.filter((v) => v.gate !== "failed");
  return ok.length ? Math.round((ok.reduce((n, v) => n + v.match, 0) / ok.length) * 100) / 100 : 0;
};

export function designFeedback(views: readonly DesignViewState[]): string {
  const lines: string[] = [];
  for (const v of views) {
    for (const i of v.issues) {
      lines.push(`- [${i.severity}] ${v.viewport}: ${i.area}: ${i.issue}${i.fixHint ? ` Fix: ${i.fixHint}` : ""}`);
    }
  }
  return lines.join("\n");
}

const record = (i: DesignIssue): DesignIssueRecord => ({ area: i.area, issue: i.issue, severity: i.severity, fixHint: i.fixHint, viewport: i.viewport });

export async function designPhase(r: Run): Promise<void> {
  const s = r.state;
  const deps = r.deps;
  if (!s.spec) { s.phase = "commit"; await r.save(); return; }

  // ---- the first time in: can it be done at all?
  if (!s.design) {
    const view = await r.brain.status().catch(() => null);
    const frameworks = view?.structure?.frameworks ?? [];
    s.design = fresh(viewportsFor(frameworks));
    const d = s.design;
    const preview = deps.live?.preview;
    const plan = previewCommand(view?.structure?.commands ?? []);
    if (!deps.design) return finish(r, "This server has no screenshot step set up, so the built page was not compared to the design.");
    if (!preview) return finish(r, "There is no live runner to run the app on here (the live session is off), so the built page was not compared to the design.");
    if (!isWebProject(frameworks)) return finish(r, `This does not look like a web app (${frameworks.slice(0, 3).join(", ")}), so there was no page to compare.`);
    if (!plan) return finish(r, "I found no dev script (dev, serve or start) to run this project's app with, so the built page was not compared to the design.");
    const money = await r.money();
    if (money.remaining < COMPARE_WORST_PAISE * 2) return finish(r, "The budget left was too small for the design check, so it was skipped.");
    const found = await targetRoute(r, s.located?.targets.length ? s.located.targets : s.spec.target).catch(() => ({ route: "/", note: "no page was found for it, so the home page was used" }));
    d.route = found.route;
    d.routeNote = found.note;
    d.location = s.located?.targets[0]?.path ?? s.spec.target[0]?.path ?? "";
    await r.log.note(`Design check: running the app to compare ${found.route} with the approved design (${found.note}).`);
    await r.save();
  }
  const d = s.design!;
  if (d.stage === "done") { s.phase = "commit"; await r.save(); return; }

  const preview = deps.live!.preview!;
  const live = { id: r.jobId, userId: r.userId, projectId: r.projectId, branch: r.branch };

  // ---- 1. a runner, with the staged edits laid, and the dev server on it
  if (d.stage === "session") {
    let overlay;
    try { overlay = r.tools.changes.toOverlay(); } catch (err) {
      if (err instanceof Refused) return finish(r, `${err.message} The design check was skipped.`);
      throw err;
    }
    const out = await r.runStep(`design:session:${d.round}`, {
      commands: ["node -e \"process.exit(0)\""], timeoutSec: 180, estimateMinutes: 1, overlay, why: "Open the runner for the design check",
    });
    if (out.status === "cancelled") throw new LostClaim();
    if (out.status !== "done") return finish(r, `No computer was free to run the app on (${cut(out.reason, 120)}), so the built page was not compared to the design.`);
    if (out.exitCode !== 0) return finish(r, "The runner could not be opened, so the built page was not compared to the design.");
    d.stage = "start";
    await r.save();
  }

  if (d.stage === "start") {
    const view = await r.brain.status().catch(() => null);
    const plan = previewCommand(view?.structure?.commands ?? []);
    if (!plan) return finish(r, "I found no dev script to run this project's app with, so the built page was not compared to the design.");
    let overlay;
    try { overlay = r.tools.changes.toOverlay(); } catch (err) {
      if (err instanceof Refused) return finish(r, `${err.message} The design check was skipped.`);
      throw err;
    }
    const started = await preview.start(live, { cmd: plan.cmd, ...(plan.prepare ? { prepare: plan.prepare } : {}), overlay, readySec: 90 });
    if (!started.ok) return finish(r, `The app could not be run for the design check (${cut(started.message, 200)}).`);
    d.startedAt = r.now();
    d.stage = "wait";
    await r.save();
  }

  // ---- 2. until it answers
  if (d.stage === "wait") {
    for (;;) {
      if (r.signal.aborted) throw new LostClaim();
      const st = await preview.status(r.jobId).catch(() => null);
      if (st?.state === "ready" && st.url) { d.stage = "check"; await r.save(); break; }
      if (!st || st.state === "none" || st.state === "closed") {
        return finish(r, `The app's dev server did not start${st?.error ? `: ${cut(st.error, 300)}` : st?.closeReason ? ` (${st.closeReason})` : ""}, so the built page was not compared to the design.`);
      }
      const waited = r.now() - (d.startedAt ?? r.now());
      if (waited > DESIGN_START_MS) return finish(r, "The app's dev server did not answer in time, so the built page was not compared to the design.");
      // The room wakes the job's Workflow the moment the dev server answers; otherwise it looks again.
      if (r.env.pollOnce) throw new RunPending(Math.min(15_000, Math.max(3_000, DESIGN_START_MS - waited)), 0);
      await r.renew();
      await deps.sleep(2_000);
    }
  }

  // ---- 3. the shots and the compare, one viewport at a time
  if (d.stage === "check") {
    const st = await preview.status(r.jobId).catch(() => null);
    if (!st || st.state !== "ready" || !st.url) return finish(r, "The app stopped before it could be looked at, so the built page was not compared to the design.");
    const todo = d.viewports.filter((v) => !d.views.some((x) => x.viewport === v));
    for (const [i, viewport] of todo.entries()) {
      if (r.signal.aborted) throw new LostClaim();
      const money = await r.money();
      if (money.remaining < COMPARE_WORST_PAISE) return finish(r, "The budget left was too small to finish the design check, so it stopped there.");
      let res;
      try {
        res = await deps.design!.compare.compare({
          job: { jobId: r.jobId, userId: r.userId, projectId: r.projectId, branch: r.branch },
          spec: { artifactId: s.spec.artifactId, version: s.spec.version, type: s.spec.type, title: s.spec.title },
          builtUrl: st.url, route: d.route ?? "/", location: d.location || undefined, kit: s.spec.kit || undefined, viewports: [viewport],
        });
      } catch (err) {
        // The job's money is its own: a call it cannot afford ends the check, not the job.
        if ((err as { code?: unknown } | null)?.code === "budget_exceeded") return finish(r, "The budget ran out during the design check, so it stopped there.");
        if (err instanceof LostClaim) throw err;
        return finish(r, "The design check could not be made (the screenshot step failed).");
      }
      if (res.skipped) {
        if (d.views.some((v) => v.gate !== "failed")) { d.views.push({ viewport, match: 0, issues: [], gate: "failed", error: oneLine(res.notes[0] ?? "skipped", 200) }); continue; }
        return finish(r, oneLine(res.notes[0] ?? "The screenshot step did not run.", 300));
      }
      const v: ViewportResult | undefined = res.viewports?.[0];
      if (!v) return finish(r, "The design check gave no answer.");
      d.paise += v.paise;
      d.views.push({ viewport, match: v.match, issues: v.issues.map(record), gate: v.gate, ...(v.shots ? { shots: v.shots } : {}), ...(v.error ? { error: oneLine(v.error, 200) } : {}) });
      await r.save();
      // One viewport is an advance's work: two shots, and perhaps a model.
      if (r.env.turnsPerAdvance !== undefined && i < todo.length - 1) throw new Yield();
    }
    d.stage = "decide";
    await r.save();
  }

  // ---- 4. is it close enough?
  if (d.stage === "decide") {
    const compared = d.views.filter((v) => v.gate !== "failed");
    if (!compared.length) return finish(r, d.views.find((v) => v.error)?.error ?? "None of the shots could be compared, so the built page was not compared to the design.");
    const issues = d.views.flatMap((v) => v.issues);
    const major = issues.filter((i) => i.severity === "major");
    d.history.push({ round: d.round, match: average(d.views), major: major.length, minor: issues.length - major.length });
    const money = await r.money();
    if (major.length && d.round < DESIGN_ROUNDS_MAX && money.remaining >= 400) {
      // Back to work, with what differs in front of the model; the checks run again before the next look.
      const w = s.work;
      w.designFeedback = designFeedback(d.views);
      w.feedback = undefined;
      w.finished = false;
      w.runs = 0;
      w.nudged = false;
      w.badTurns = 0;
      w.roundStartPaise = money.spent;
      w.roundStartedAt = r.now();
      d.round += 1;
      d.stage = "session";
      d.views = [];
      try { await preview.stop(r.jobId, "design round"); } catch { /* it closes by itself */ }
      await r.log.decision(`The built page does not match the design yet (${major.length} major difference${major.length === 1 ? "" : "s"}). Design round ${d.round} of ${DESIGN_ROUNDS_MAX}.`);
      s.phase = "work";
      await r.save();
      return;
    }
    if (major.length) r.note(`The built page still differs from the design in ${major.length} major way${major.length === 1 ? "" : "s"}${d.round >= DESIGN_ROUNDS_MAX ? ` after ${DESIGN_ROUNDS_MAX} rounds of fixes` : " (the budget left was too small for another round)"}; the differences are listed in the design check.`);
    await r.log.decision(`Design check: the built page matches the design at ${Math.round(average(d.views) * 100)}%${issues.length ? `, with ${issues.length} difference${issues.length === 1 ? "" : "s"} left` : ""}.`);
    return finish(r);
  }
}

// ---------------------------------------------------------------- the words

/** The design check as the report and the pull request say it. Empty for a job with no design check. `link` makes the link to a kept shot. */
export function designLines(d: DesignState | undefined, link?: (shotId: string) => string | null): string[] {
  if (!d) return [];
  const out: string[] = [];
  const last = d.history.at(-1);
  if (d.skipped && !last) return [`Design check: not done. ${d.skipped}`];
  if (!last) return [];
  out.push(`Design check: the built page matches the approved design at ${Math.round(last.match * 100)}%${d.round ? ` after ${d.round} round${d.round === 1 ? "" : "s"} of fixes` : ""}.`);
  if (d.history.length > 1) out.push(`Rounds: ${d.history.map((h) => `${Math.round(h.match * 100)}%`).join(" → ")}.`);
  const where = d.route ? ` (the page ${d.route}${d.routeNote ? `: ${d.routeNote}` : ""})` : "";
  for (const v of d.views) {
    if (v.gate === "failed") { out.push(`- ${v.viewport}: not compared (${v.error ?? "the shot failed"})${where && v === d.views[0] ? where : ""}`); continue; }
    const a = v.shots ? link?.(v.shots.approved) : null;
    const b = v.shots ? link?.(v.shots.built) : null;
    out.push(`- ${v.viewport}: ${Math.round(v.match * 100)}%${v.gate === "same" ? " (the two shots were alike, so no model was asked)" : ""}${a && b ? `. Side by side: design ${a} | built ${b}` : ""}${where && v === d.views[0] ? where : ""}`);
  }
  const issues = d.views.flatMap((v) => v.issues);
  const major = issues.filter((i) => i.severity === "major");
  const minor = issues.filter((i) => i.severity === "minor");
  if (major.length) out.push("Still different (major):", ...major.slice(0, 6).map((i) => `- ${i.viewport}: ${i.area}: ${cut(i.issue, 200)}`));
  if (minor.length) out.push("Still different (minor):", ...minor.slice(0, 8).map((i) => `- ${i.viewport}: ${i.area}: ${cut(i.issue, 200)}`));
  if (d.skipped) out.push(`The check stopped early: ${d.skipped}`);
  return out;
}
