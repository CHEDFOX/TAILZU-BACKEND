/**
 * Run the prompt evals: every fixture in evals/<role>.jsonl against a real model, scored by its own assertions.
 *
 *   npm run eval:prompts                          every role
 *   npm run eval:prompts -- classify plan_change  only these roles
 *   npm run eval:prompts -- --list                what is there (needs no key, calls nothing)
 *   EVAL_RUNS=3 npm run eval:prompts              repeat each fixture; models are not deterministic
 *   EVAL_MAX_PAISE=300 npm run eval:prompts       stop asking once this much has been spent (default 500, five rupees)
 *
 * It exists because the prompts have no examples any more: an example used to be the test of a prompt (the model
 * copied it or it did not), and now the fixtures are. Each line of a fixture file is { input, expect }: `input` is
 * the dynamic user message exactly as the product sends it, the role's stable block goes in front of it with
 * compose(), and `expect` holds checkable assertions (JSON fields, must-include, must-not-include; see
 * principles/evalcheck.ts). Run it before merging a change to a principle or a role, or when the models behind a
 * tier change.
 *
 * It costs money and needs OPENROUTER_API_KEY, so:
 *   - without the key it prints what it would have run and exits 0, having called nothing;
 *   - with CI set it refuses to run at all. It is never part of CI, and no workflow runs it;
 *   - calls go through callModel (code/brain/gateway.ts) like the product's, so what each one cost, in paise, is
 *     what the product would have been charged, and a call that would pass the cap is not made.
 *
 * The report is per role: the pass rate, the tokens (in and out) and the paise. Exit code 1 if any fixture failed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { AGENT_TOOLS } from "../src/code/agent/tools.js";
import { DEFAULT_USD_INR } from "../src/code/brain/money.js";
import { callModel, type CallInput, type CallResult, type GatewayDeps } from "../src/code/brain/gateway.js";
import { buildTierTable, type ModelTier } from "../src/code/brain/tiers.js";
import { ROLE_IDS, check, compose, fixtureProblem, isRoleId, type Fixture, type RoleId } from "../src/principles/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVALS_DIR = path.join(HERE, "..", "evals");

/** The tier each role is asked at, as its call sites ask it (the cheapest tier that does the job). */
export const ROLE_TIER: Readonly<Record<RoleId, ModelTier>> = {
  classify: "tiny", locate_terms: "cheap", locate_pick: "cheap", plan_change: "code",
  agent_work: "code", agent_fold: "cheap",
  index_files: "cheap", index_dirs: "cheap", index_repo: "cheap", index_features: "cheap", welcome: "cheap",
  spec: "strong", brief: "code", research_answer: "code", research_gaps: "cheap", search_plan: "tiny",
  artifact_element: "cheap", artifact_edit: "cheap", artifact_fix: "cheap", artifact_make: "code", artifact_ask: "cheap",
  artifact_vision: "vision", artifact_compare: "vision",
  front_decide: "tiny", front_reply: "cheap", front_code_answer: "cheap", front_diagram: "cheap", front_plan: "cheap", front_look: "vision",
  care_review: "cheap", care_conflict: "cheap",
  ask_planner: "cheap", ask_vision: "vision", writer: "cheap", edit_selection: "cheap", answer_about: "cheap", converse: "cheap",
  portrait_update: "code", portrait_transcript: "code", portrait_usage: "code",
};

/** The most each role may write, so a call's worst case stays small. */
const MAX_TOKENS: Partial<Record<RoleId, number>> = { agent_work: 800, spec: 3500, artifact_make: 6000, artifact_edit: 3000, artifact_element: 1500, plan_change: 2500 };
const DEFAULT_MAX_TOKENS = 1500;
/** The most one call may cost in the worst case, in paise. */
const CALL_CAP_PAISE = 150;

// ---------------------------------------------------------------- fixtures

/** The fixtures of a role, and what is wrong with the lines that are not usable. A missing file is no fixtures. */
export function loadFixtures(role: RoleId, dir: string = EVALS_DIR): { fixtures: Fixture[]; problems: string[] } {
  const file = path.join(dir, `${role}.jsonl`);
  if (!fs.existsSync(file)) return { fixtures: [], problems: [`${role}.jsonl does not exist`] };
  const fixtures: Fixture[] = [];
  const problems: string[] = [];
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { problems.push(`${role}.jsonl:${i + 1} is not JSON`); return; }
    const why = fixtureProblem(raw);
    if (why) problems.push(`${role}.jsonl:${i + 1} ${why}`);
    else fixtures.push(raw as Fixture);
  });
  return { fixtures, problems };
}

// ---------------------------------------------------------------- running

export type CallFn = (input: CallInput<unknown>) => Promise<CallResult<unknown>>;

export interface Failure {
  input: string;
  why: string[];
  answer: string;
}

export interface Report {
  role: RoleId;
  fixtures: number;
  /** Fixtures times runs. */
  runs: number;
  passed: number;
  promptTokens: number;
  completionTokens: number;
  paise: number;
  failures: Failure[];
  /** The run stopped before every fixture was asked: the money ran out. */
  stoppedEarly?: boolean;
}

export interface RunOptions {
  call: CallFn;
  runs?: number;
  /** Where evals/images/ is. */
  images?: string;
  /** What has been spent over all roles so far, in paise; the run stops asking once it passes `maxPaise`. */
  spent?: { paise: number };
  maxPaise?: number;
}

function userMessage(f: Fixture, images: string): { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> } {
  if (!f.images?.length) return { role: "user", content: f.input };
  return {
    role: "user",
    content: [
      { type: "text", text: f.input },
      ...f.images.map((name) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${fs.readFileSync(path.join(images, name)).toString("base64")}` } })),
    ],
  };
}

/** Every fixture of a role, `runs` times each, asked one after another (parallel calls make provider limits and timings meaningless). */
export async function runRole(role: RoleId, fixtures: readonly Fixture[], o: RunOptions): Promise<Report> {
  const report: Report = { role, fixtures: fixtures.length, runs: 0, passed: 0, promptTokens: 0, completionTokens: 0, paise: 0, failures: [] };
  const spent = o.spent ?? { paise: 0 };
  const images = o.images ?? path.join(EVALS_DIR, "images");
  for (const f of fixtures) {
    for (let n = 0; n < (o.runs ?? 1); n += 1) {
      if (o.maxPaise !== undefined && spent.paise >= o.maxPaise) { report.stoppedEarly = true; return report; }
      report.runs += 1;
      try {
        const r = await o.call({
          tier: ROLE_TIER[role], messages: compose(role, [userMessage(f, images)]), maxTokens: MAX_TOKENS[role] ?? DEFAULT_MAX_TOKENS,
          purpose: `eval.${role}`, userId: "eval", budget: { maxPaise: CALL_CAP_PAISE },
          ...(role === "agent_work" ? { tools: [...AGENT_TOOLS], toolChoice: "auto" as const } : {}),
        });
        report.promptTokens += r.promptTokens;
        report.completionTokens += r.completionTokens;
        report.paise += r.paise;
        spent.paise += r.paise;
        const first = r.toolCalls[0]?.name;
        const verdict = check(f.expect, { text: r.text, ...(first ? { tool: first } : {}) });
        if (verdict.ok) report.passed += 1;
        else report.failures.push({ input: f.input, why: verdict.failures, answer: r.text || (first ? `(tool call ${first})` : "") });
      } catch (err) {
        report.failures.push({ input: f.input, why: [`the call failed: ${(err as Error).message}`], answer: "" });
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------- the report

const pct = (n: number, of: number): string => (of ? `${Math.round((n / of) * 100)}%` : "-");

export function formatReport(reports: readonly Report[]): string {
  const head = ["role", "pass", "rate", "tokens in", "tokens out", "paise"];
  const total = reports.reduce((t, r) => ({ runs: t.runs + r.runs, passed: t.passed + r.passed, i: t.i + r.promptTokens, o: t.o + r.completionTokens, p: t.p + r.paise }), { runs: 0, passed: 0, i: 0, o: 0, p: 0 });
  const rows = [
    ...reports.map((r) => [r.role, `${r.passed}/${r.runs}${r.stoppedEarly ? " (stopped: money)" : ""}`, pct(r.passed, r.runs), String(r.promptTokens), String(r.completionTokens), String(r.paise)]),
    ["total", `${total.passed}/${total.runs}`, pct(total.passed, total.runs), String(total.i), String(total.o), String(total.p)],
  ];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(width[i]!) : c.padStart(width[i]!))).join("  ");
  return [line(head), line(width.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

// ---------------------------------------------------------------- the script

/** callModel with its own client, tiers and rate, so the script needs OPENROUTER_API_KEY and nothing else of the server's config. */
export function realCall(apiKey: string, client?: GatewayDeps["client"]): CallFn {
  const deps: GatewayDeps = {
    client: client ?? new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1", timeout: 60_000, maxRetries: 1 }) as unknown as GatewayDeps["client"],
    fx: Number(process.env.CODE_USD_INR) || DEFAULT_USD_INR,
    tiers: buildTierTable({ tiers: process.env.CODE_MODEL_TIERS, indic: process.env.CODE_INDIC_MODEL }),
    ledger: null,
    log: { info: () => undefined, warn: () => undefined },
  };
  return (input) => callModel(input, deps);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const asked = argv.filter((a) => !a.startsWith("-"));
  const unknown = asked.filter((a) => !isRoleId(a));
  if (unknown.length) {
    console.error(`No such role: ${unknown.join(", ")}. Roles: ${ROLE_IDS.join(", ")}`);
    return 1;
  }
  const roles = asked.length ? (asked as RoleId[]) : ROLE_IDS;
  const loaded = roles.map((role) => ({ role, ...loadFixtures(role) }));
  const problems = loaded.flatMap((l) => l.problems);
  if (problems.length) console.error(`Fixtures that cannot be used:\n  ${problems.join("\n  ")}`);

  if (argv.includes("--list")) {
    for (const l of loaded) console.log(`${l.role.padEnd(18)} ${l.fixtures.length} fixtures`);
    return problems.length ? 1 : 0;
  }
  if (process.env.CI) {
    console.log("CI is set: the prompt evals call real models, cost money and are never part of CI. Nothing was run.");
    return 0;
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    const n = loaded.reduce((t, l) => t + l.fixtures.length, 0);
    console.log(`OPENROUTER_API_KEY is not set, so nothing was run (${n} fixtures in ${loaded.length} roles; --list shows them).`);
    return 0;
  }

  const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
  const maxPaise = Number(process.env.EVAL_MAX_PAISE ?? 500);
  const call = realCall(key);
  const spent = { paise: 0 };
  console.log(`\nPrompt evals: ${loaded.length} role(s), ${runs} run(s) each, stopping at ${maxPaise} paise\n`);
  const reports: Report[] = [];
  for (const l of loaded) reports.push(await runRole(l.role, l.fixtures, { call, runs, spent, maxPaise }));
  console.log(formatReport(reports));
  for (const r of reports) {
    for (const f of r.failures) {
      console.log(`\n${r.role}: ${f.why.join("; ")}\n  input:  ${JSON.stringify(f.input.slice(0, 120))}\n  answer: ${JSON.stringify(f.answer.slice(0, 200))}`);
    }
  }
  return reports.some((r) => r.failures.length) || problems.length ? 1 : 0;
}

// Only run when invoked directly (npm run eval:prompts): the tests import runRole and loadFixtures, and must not fire a paid sweep.
if (process.argv[1] && /eval-prompts\.[tj]s$/.test(process.argv[1])) {
  main().then((code) => process.exit(code), (err) => { console.error("the prompt evals crashed:", err); process.exit(1); });
}
