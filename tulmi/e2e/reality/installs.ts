/**
 * WHEN A SESSION MAY NOT INSTALL: SKIP THE TASKS THAT NEED AN INSTALL, SAY SO, AND LIST WHAT TO RUN WHERE INSTALLS ARE ALLOWED.
 *
 * Most tasks run on a real open-source project (express, click, flask, ...) whose dependencies must be installed once (`e2e/repos.ts install`), and the contestants
 * (aider, opencode, codex, openhands, mini-swe-agent) are tools installed from hash-locked files (`e2e/agents/tools.ts install`). A session that is not allowed to run
 * other people's install scripts (the first two real runs' sessions were refused: "external code") cannot do either. That is not a failure of the product, and a
 * run must not read as one: the plan leaves those tasks and contestants out, names each with the reason
 *
 *     needs a session where installs are allowed
 *
 * and writes the commands that run the big comparisons in a session that can (`commandList`).
 *
 * The plan never installs by itself. It looks (is the project installed? is the tool there?); with `--install` it tries, and an install that is REFUSED (a permission
 * error, a policy, a read-only disk, no network) is classified here and treated the same as an install nobody tried.
 */
import { contestantRows, type ContestantRow } from "../bakeoff/contestants.js";
import { getRepo, installRepo, isInstalled, loadRepos } from "../repos.js";
import type { Task } from "../tasks/schema.js";
import type { PlanName } from "./types.js";

export const NEEDS_INSTALLS = "needs a session where installs are allowed";

export type InstallFailure = "refused" | "network" | "disk" | "other";

/** What kind of failure an install error was: a refusal (permission, policy, sandbox), no network, no disk, or something else. */
export function classifyInstallFailure(text: string): InstallFailure {
  const t = text.toLowerCase();
  if (/enospc|no space left|not enough disk/.test(t)) return "disk";
  if (/eacces|eperm|permission denied|operation not permitted|(?<!econn)refused|not allowed|policy|forbidden|blocked by|read-only file system|erofs|external code|sandbox|\b40[37]\b/.test(t)) return "refused";
  if (/enotfound|econnrefused|econnreset|etimedout|getaddrinfo|socket hang up|fetch failed|network/.test(t)) return "network";
  return "other";
}

const WHY: Record<InstallFailure, string> = {
  refused: `${NEEDS_INSTALLS} (this session refused to run the project's install)`,
  network: `${NEEDS_INSTALLS} (no network to fetch its packages)`,
  disk: `${NEEDS_INSTALLS} (not enough disk for its packages)`,
  other: `${NEEDS_INSTALLS} (the install failed)`,
};

export interface RepoStatus { id: string; installed: boolean; blocked?: string }

/**
 * Which projects the tasks need and whether each can be used here. A project that is installed is usable. One that is not is left out with the reason, unless
 * `install` is set, in which case the install is tried and a failure is classified.
 */
export async function checkRepos(tasks: readonly Pick<Task, "repo">[], o: { install: boolean; log: (s: string) => void; installFn?: (id: string) => Promise<void> }): Promise<Map<string, RepoStatus>> {
  const out = new Map<string, RepoStatus>();
  for (const id of [...new Set(tasks.map((t) => t.repo))].sort()) {
    if (id === "synthetic") { out.set(id, { id, installed: true }); continue; }
    let spec;
    try { spec = getRepo(id); } catch { out.set(id, { id, installed: false, blocked: `${id} is not in repos.json` }); continue; }
    if (isInstalled(spec)) { out.set(id, { id, installed: true }); continue; }
    if (!o.install) { out.set(id, { id, installed: false, blocked: `${NEEDS_INSTALLS}: ${id} is not installed (npm run e2e:repos -- install ${id})` }); continue; }
    try {
      o.log(`installing ${id} (--install)`);
      await (o.installFn ? o.installFn(id) : installRepo(spec, { log: (s) => o.log(`  ${s}`) }).then(() => undefined));
      out.set(id, { id, installed: true });
    } catch (err) {
      const why = (err as Error).message;
      out.set(id, { id, installed: false, blocked: `${WHY[classifyInstallFailure(why)]}: ${why.slice(0, 120)}` });
    }
  }
  return out;
}

/** The tasks that cannot run, with the reason, by task id. */
export function blockedTasks(tasks: readonly Pick<Task, "id" | "repo">[], repos: ReadonlyMap<string, RepoStatus>): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tasks) { const r = repos.get(t.repo); if (r?.blocked) out.set(t.id, r.blocked); }
  return out;
}

export interface Contestant { id: string; usable: boolean; why?: string; row?: ContestantRow }

/** The agents of a comparison and whether each can run here: Tailzu always; the others when their tool is installed and needs no Docker. */
export function contestants(wanted: readonly string[], rows: readonly ContestantRow[] = contestantRows()): Contestant[] {
  return wanted.map((id): Contestant => {
    if (id === "tailzu" || id === "tailzu-phased") return { id, usable: true };
    const row = rows.find((r) => r.id === id);
    if (!row) return { id, usable: false, why: `no agent called ${id}` };
    if (row.skipped) return { id, usable: false, why: row.requiresDocker ? row.skipped : `${NEEDS_INSTALLS}: ${row.skipped}`, row };
    return { id, usable: true, row };
  });
}

/** Whether a task can be given to an agent that is not ours: a disruption (a crash, a word mid-task, a budget that runs out) is a scenario of Tailzu's own flow. */
export function runsOnAnyAgent(t: Pick<Task, "category" | "scenario">): boolean {
  const s = t.scenario;
  return t.category !== "disruption" && t.category !== "long" && !(s?.crash || s?.message || s?.budget || s?.milestoneJobs);
}

export interface CommandInput { plan: PlanName; budgetInr: number; missingRepos: string[]; missingTools: string[]; estimateByStage: Record<number, number> }

/**
 * The commands that run the big comparisons in a session where installs are allowed, in order: install what is missing, prove the wiring for nothing, say what it
 * costs, run the comparisons with a cap. Every paid command carries its own --budget-inr.
 */
export function commandList(i: CommandInput): string[] {
  const L: string[] = [];
  L.push("# In a session where installs are allowed (and OPENROUTER_API_KEY is set for the paid steps). From tulmi/:");
  L.push("npm ci");
  L.push("npm run e2e:repos -- clone");
  if (i.missingRepos.length) L.push(`npm run e2e:repos -- install ${i.missingRepos.join(" ")}`);
  else L.push("# every project the tasks use is already installed");
  if (i.missingTools.length) { L.push(`npm run e2e:tools -- install ${i.missingTools.join(" ")}`); L.push(`npm run e2e:tools -- verify ${i.missingTools.join(" ")}`); }
  else L.push("# every contestant is already installed");
  L.push("npm run e2e:agents -- --prove          # no key: each contestant against a scripted model through the recording proxy");
  L.push("");
  L.push("# What it costs, from the live prices (no key needed). A paid run refuses to start without this having been run for the same plan:");
  L.push(`npm run reality -- --plan ${i.plan} --estimate`);
  L.push("");
  L.push("# Free: stage 0 (the offline suite, every cassette replayed, the free parts) and nothing else");
  L.push("npm run reality -- --stages 0");
  L.push("");
  L.push("# The comparisons, each under its own cap (stage 4 alone, the two groups apart):");
  const s4 = Math.max(1, Math.ceil((i.estimateByStage[4] ?? 0) * 1.5));
  L.push(`npm run reality -- --plan ${i.plan} --stages 4 --groups agents --install --budget-inr ${s4}`);
  L.push(`npm run reality -- --plan ${i.plan} --stages 1,4 --groups models --budget-inr ${s4}`);
  L.push("");
  L.push("# Or the whole plan, adaptive, under one cap (stages 0 to 5; each stage stops at 30% over its estimate):");
  L.push(`npm run reality -- --plan ${i.plan} --install --budget-inr ${Math.max(1, Math.ceil(i.budgetInr))}`);
  L.push("");
  L.push("# The parts that need the projects installed:");
  L.push(`npm run reality -- --plan ${i.plan} --stages 5 --install --budget-inr ${Math.max(1, Math.ceil((i.estimateByStage[5] ?? 0) * 1.5))}`);
  return L;
}

/** The repos.json projects not installed here. */
export function missingRepos(ids?: readonly string[]): string[] {
  return loadRepos().filter((r) => (!ids || ids.includes(r.id)) && !r.fixture && !isInstalled(r)).map((r) => r.id);
}

/** The contestants whose tool is not installed here (Docker-only ones are not installable by a command). */
export function missingTools(rows: readonly ContestantRow[] = contestantRows()): string[] {
  return rows.filter((r) => r.id !== "tailzu" && !r.installed && !r.requiresDocker).map((r) => r.tool ?? r.id);
}
