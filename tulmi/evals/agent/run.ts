/**
 * ROZ BENCH, FROM THE COMMAND LINE: how well the phone's Ask does the
 * everyday jobs people give it, measured instead of guessed at.
 *
 *   npm run bench                         replay the recorded runs (free, no network)
 *   npm run bench:scripted                every task with its reference answers (free): can each be passed at all?
 *   npm run bench:live                    the real models, three trials a task (paid, needs OPENROUTER_API_KEY)
 *   npm run bench:record                  live, and keep every answer as a cassette for replay
 *
 *   npm run bench -- [--mode live|replay|scripted] [--record] [--trials N]
 *                    [--lang en,hinglish,hi] [--family calendar,upi,adversarial,injection-doc,…]
 *                    [--split dev|held|all] [--id <substring>] [--shard k/n]
 *                    [--models a,b,c] [--out evals/agent/out] [--fixtures]
 *                    [--baseline <scoreboard.json> --gate] [--verbose]
 *
 * Each task runs through the phone's real path (harness.ts) once per trial,
 * one trial at a time, and is graded (graders/). The run writes
 * <out>/<stamp>/scoreboard.json and scoreboard.md. Before any task file
 * exists (or with --fixtures) it runs the bench's own fixtures instead.
 *
 * Exit codes: 0 when the run finished (failing tasks included); 1 when
 * --gate finds it worse than --baseline (pass@1 down more than two points
 * overall or in a language with twenty tasks, done-ms p95 up more than 15%,
 * or any unsafe action or proposal); 2 for a usage error, or live without a key.
 *
 * Record cassettes only once the prompts are settled: the cassette key hashes
 * the system prompt and the planner's message, so any change to them turns
 * every recorded answer into a miss, and replay then skips rather than lies.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RealDate } from "./clock.js";
import { OFFLINE_KEY, People, benchEnv } from "./env.js";
import { filterTasks, loadFixtures, loadTasks, type TaskFilter } from "./loader.js";
import { hardFailures } from "./graders/index.js";
import { gateAgainst } from "./metrics.js";
import { CASSETTE_DIR, newCassette, readCassette, writeCassette, type Cassette } from "./model/cassette.js";
import type { PlanStreamFn } from "./model/live.js";
import { buildScoreboard, scoreTrial, scoreboardMarkdown, writeScoreboard, type TrialRow } from "./scoreboard.js";
import type { Family, Lang, Mode, Scoreboard, Split, Task } from "./types.js";

export interface BenchArgs {
  mode: Mode;
  record: boolean;
  trials: number;
  filter: TaskFilter;
  models?: string[];
  out: string;
  baseline?: string;
  gate: boolean;
  verbose: boolean;
  fixtures: boolean;
  /** Where cassettes are read and written. Tests point it at a temporary folder. */
  cassettes: string;
}

const LANGS: Lang[] = ["en", "hinglish", "hi"];
const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** The command line, read; a usage error is a sentence. */
export function parseArgs(argv: string[]): BenchArgs | { error: string } {
  const a: BenchArgs = { mode: "replay", record: false, trials: 0, filter: { split: "all" }, out: "evals/agent/out", gate: false, verbose: false, fixtures: false, cassettes: CASSETTE_DIR };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = (): string | null => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return null;
      i++;
      return v;
    };
    const need = (): string => {
      const v = value();
      if (v === null) throw new Error(`${flag} needs a value`);
      return v;
    };
    try {
      switch (flag) {
        case "--mode": {
          const m = need();
          if (m !== "live" && m !== "replay" && m !== "scripted") return { error: `--mode is live, replay or scripted, not ${m}` };
          a.mode = m;
          break;
        }
        case "--record": a.record = true; break;
        case "--trials": {
          const n = Number(need());
          if (!Number.isInteger(n) || n < 1 || n > 50) return { error: "--trials is a whole number from 1 to 50" };
          a.trials = n;
          break;
        }
        case "--lang": {
          const ls = list(need());
          const bad = ls.find((l) => !LANGS.includes(l as Lang));
          if (bad) return { error: `--lang takes en, hinglish and hi, not ${bad}` };
          a.filter.lang = ls as Lang[];
          break;
        }
        case "--family": a.filter.family = list(need()) as Array<Family | "adversarial">; break;
        case "--split": {
          const s = need();
          if (s !== "dev" && s !== "held" && s !== "all") return { error: `--split is dev, held or all, not ${s}` };
          a.filter.split = s as Split | "all";
          break;
        }
        case "--id": a.filter.id = need(); break;
        case "--shard": {
          const m = /^(\d+)\/(\d+)$/.exec(need());
          const k = Number(m?.[1]), n = Number(m?.[2]);
          if (!m || n < 1 || k < 1 || k > n) return { error: "--shard is k/n, like 2/4, with k from 1 to n" };
          a.filter.shard = { k, n };
          break;
        }
        case "--models": a.models = list(need()); break;
        case "--out": a.out = need(); break;
        case "--cassettes": a.cassettes = need(); break;
        case "--baseline": a.baseline = need(); break;
        case "--gate": a.gate = true; break;
        case "--verbose": a.verbose = true; break;
        case "--fixtures": a.fixtures = true; break;
        default: return { error: `unknown option ${flag}` };
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  if (a.record && a.mode !== "live") return { error: "--record records a live run: use it with --mode live" };
  if (a.gate && !a.baseline) return { error: "--gate needs --baseline <scoreboard.json>" };
  if (!a.trials) a.trials = a.mode === "live" ? 3 : 1;
  return a;
}

const USAGE = "npm run bench -- [--mode live|replay|scripted] [--record] [--trials N] [--lang en,hinglish,hi] [--family …] [--split dev|held|all] [--id …] [--shard k/n] [--models a,b,c] [--out dir] [--fixtures] [--baseline file --gate] [--verbose]";

function gitShort(): string {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unknown"; } catch { return "unknown"; }
}

/** The set to run: the task files, or the bench's fixtures when there are none (or when asked). */
async function theSet(a: BenchArgs, log: (s: string) => void): Promise<Task[]> {
  let tasks = a.fixtures ? [] : await loadTasks();
  if (!tasks.length) {
    if (!a.fixtures) log("No task files in evals/agent/tasks yet: running the bench's fixtures.");
    tasks = await loadFixtures();
  }
  return filterTasks(tasks, a.filter);
}

/**
 * The whole run. `pinEnv` sets the bench's environment (env.ts) before
 * anything reads the config: run.ts does, a test that set its own does not,
 * and hands in the `tokens` (people) this run may use.
 */
export async function main(argv: string[], o: {
  pinEnv?: boolean;
  log?: (s: string) => void;
  tokens?: string[];
  /** Tests only: live mode on a planStream that calls no model (and so needs no key). */
  planStream?: PlanStreamFn;
} = {}): Promise<number> {
  const log = o.log ?? ((s: string) => console.log(s));
  const a = parseArgs(argv);
  if ("error" in a) {
    log(`${a.error}\n${USAGE}`);
    return 2;
  }
  const tasks = await theSet(a, log);
  if (o.pinEnv) Object.assign(process.env, benchEnv({ people: Math.max(1, tasks.length * a.trials), offline: a.mode !== "live" }));

  // From here the server's modules are loaded, and with them the config (and, outside tests, .env).
  await import("../../src/config.js");
  if (a.mode === "live" && !o.planStream && (!process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY === OFFLINE_KEY)) {
    log("Live mode calls the real models and needs OPENROUTER_API_KEY. Set it (or put it in tulmi/.env), or run --mode replay or --mode scripted, which are free.");
    return 2;
  }
  if (!tasks.length) {
    log("No tasks match those filters.");
    return 2;
  }
  let baseline: Scoreboard | undefined;
  if (a.baseline) {
    try { baseline = JSON.parse(readFileSync(resolve(a.baseline), "utf8")) as Scoreboard; } catch {
      log(`Couldn't read the baseline scoreboard at ${a.baseline}.`);
      return 2;
    }
  }

  const { runTrial } = await import("./harness.js");
  const { ScriptedAdapter } = await import("./model/scripted.js");
  const { ReplayAdapter } = await import("./model/replay.js");
  const { LiveAdapter } = await import("./model/live.js");
  const { modelLadder } = await import("../../src/agent/llm.js");

  const startedAt = new RealDate().toISOString();
  const git = gitShort();
  const models = a.mode === "scripted" ? ["scripted"] : a.mode === "live" ? (a.models?.length ? a.models : modelLadder()) : [];
  const people = new People(o.tokens ?? process.env.STATIC_BEARER_TOKENS?.split(",") ?? []);
  const systems = new Set<string>();
  const results: Scoreboard["results"] = [];
  let estimated = false;
  log(`Roz Bench, ${a.mode}: ${tasks.length} task(s) x ${a.trials} trial(s)${a.mode === "live" ? ` on ${models.join(", ")}` : ""}`);

  for (const task of tasks) {
    const tape = a.mode === "replay" ? readCassette(a.cassettes, task.id) : null;
    if (tape && "cassette" in tape) for (const m of tape.cassette.models) if (!models.includes(m)) models.push(m);
    const book: Cassette | undefined = a.record ? newCassette(task.id, models, git) : undefined;
    const trials: TrialRow[] = [];
    for (let i = 0; i < a.trials; i++) {
      if (tape && "missing" in tape) {
        trials.push({ pass: false, skipped: tape.missing, graders: [], calls: 0, costUsd: 0 });
        continue;
      }
      const model = a.mode === "scripted" ? new ScriptedAdapter(task.scripted)
        : a.mode === "replay" ? new ReplayAdapter((tape as { cassette: Cassette }).cassette, i)
          : new LiveAdapter({ models, trial: i, ...(book ? { record: book } : {}), ...(o.planStream ? { planStream: o.planStream } : {}) });
      const trace = await runTrial({ task, trial: i, mode: a.mode, model, token: people.take() });
      for (const s of model.systems) systems.add(s);
      const row = scoreTrial(task, trace);
      estimated ||= row.estimated;
      trials.push(row.trial);
      if (book && !trace.error && !trace.skipped) (book.graded ??= {})[String(i)] = hardFailures(row.trial.graders);
    }
    if (book && Object.keys(book.entries).length) writeCassette(a.cassettes, book);
    results.push({ taskId: task.id, lang: task.lang, family: task.family, ...(task.attack ? { attack: task.attack } : {}), split: task.split, xfail: !!task.xfail, trials });
    log(lineFor(task, trials, a.verbose));
  }

  const sb = buildScoreboard({
    startedAt, mode: a.mode, models, git, prompts: await promptHashes(systems),
    filters: {
      ...(a.filter.lang ? { lang: a.filter.lang } : {}), ...(a.filter.family ? { family: a.filter.family as Array<Family | "adversarial"> } : {}),
      split: a.filter.split ?? "all", ...(a.filter.id ? { id: a.filter.id } : {}),
    },
    results,
  });
  const md = scoreboardMarkdown(sb, Object.fromEntries(tasks.map((t) => [t.id, t.intent])), { estimatedCost: estimated });
  const dir = join(resolve(a.out), startedAt.replace(/[:.]/g, "-"));
  const files = writeScoreboard(dir, sb, md);
  const m = sb.overall;
  log(`pass@1 ${(m.passAt1 * 100).toFixed(1)}% over ${m.tasks} task(s), ${m.trials} trial(s); ${m.skipped} skipped; XFAIL ${m.xfail}, XPASS ${m.xpass}; unsafe ${m.unsafeActions} done, ${m.unsafeProposals} proposed`);
  log(`Wrote ${files.json} and ${files.md}`);

  if (a.gate && baseline) {
    const why = gateAgainst(sb, baseline);
    if (why.length) {
      log(`Gate: worse than the baseline: ${why.join("; ")}`);
      return 1;
    }
    log("Gate: no worse than the baseline.");
  }
  return 0;
}

/** One task's line as the run goes. */
function lineFor(task: Task, trials: TrialRow[], verbose: boolean): string {
  const scored = trials.filter((t) => !t.skipped);
  if (!scored.length) return `skip  ${task.id}: ${trials[0]?.skipped ?? "not run"}`;
  const passes = scored.filter((t) => t.pass).length;
  const mark = passes === scored.length ? (task.xfail ? "XPASS" : "ok   ") : task.xfail ? "xfail" : "FAIL ";
  const failed = [...new Set(scored.flatMap((t) => [...t.graders.filter((g) => !g.pass && g.severity === "hard").map((g) => g.id), ...(t.error ? ["bench"] : [])]))];
  const head = `${mark} ${task.id} ${passes}/${scored.length}${failed.length ? ` (${failed.join(", ")})` : ""}`;
  if (!verbose || !failed.length) return head;
  const details = scored.flatMap((t) => [...(t.error ? [`    bench: ${t.error}`] : []), ...t.graders.filter((g) => !g.pass && g.severity === "hard").map((g) => `    ${g.id}: ${g.detail}`)]);
  return [head, ...new Set(details)].join("\n");
}

/** sha256 of each system prompt the run sent, named by the role it is the stable block of when it is one. */
async function promptHashes(systems: Set<string>): Promise<Record<string, string>> {
  const { sha256 } = await import("./model/adapter.js");
  const { stableBlock } = await import("../../src/principles/roles.js");
  const named = new Map<string, string>();
  for (const role of ["ask_planner", "ask_vision"] as const) named.set(stableBlock(role), role);
  return Object.fromEntries([...systems].map((s) => [named.get(s) ?? `system-${sha256(s).slice(0, 8)}`, sha256(s)]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2), { pinEnv: true }).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(2);
  });
}
