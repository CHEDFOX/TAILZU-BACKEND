/**
 * Eval runner — measure the writing pipeline instead of guessing at it.
 *
 *   npm run eval                  # every case
 *   npm run eval -- instr script  # only cases whose id contains a filter
 *   EVAL_RUNS=3 npm run eval      # repeat each case; LLMs aren't deterministic
 *   CLEANUP_MODEL=... npm run eval # compare models on identical inputs
 *
 * This calls the REAL assist() path, so it costs tokens and needs
 * OPENROUTER_API_KEY — which is exactly why it's a script rather than a CI
 * test. Run it before merging a prompt change, swapping CLEANUP_MODEL, or
 * flipping an STT provider.
 *
 * Exit code is 1 on any failure, so it can gate a release when you want it to.
 */
import { assist } from "../src/pipeline/cleanup.js";
import { detectScript } from "../src/pipeline/stt.js";
import { CASES, type EvalCase } from "./cases.js";

interface CaseResult {
  id: string;
  runs: number;
  passes: number;
  failures: string[];
  outputs: string[];
  ms: number;
}

/** Every assertion a case can make. Deterministic on purpose — see cases.ts.
 *  Exported so the SCORER itself is unit-tested: a scorer with a bug would
 *  pass every case silently, which is worse than having no evals at all. */
export function scoreOutput(c: EvalCase, out: string): string[] {
  const problems: string[] = [];
  const lower = out.toLowerCase();
  const wantNonEmpty = c.mustBeNonEmpty !== false;

  if (wantNonEmpty && !out.trim()) {
    problems.push("output was empty");
    return problems; // every other assertion is meaningless on an empty string
  }
  if (!wantNonEmpty && out.trim()) {
    problems.push(`expected NO output, got: ${JSON.stringify(out.slice(0, 80))}`);
    return problems;
  }
  if (!wantNonEmpty) return problems;

  for (const s of c.mustContain ?? []) {
    if (!lower.includes(s.toLowerCase())) problems.push(`missing required text: ${JSON.stringify(s)}`);
  }
  for (const s of c.mustNotContain ?? []) {
    if (lower.includes(s.toLowerCase())) problems.push(`leaked forbidden text: ${JSON.stringify(s)}`);
  }
  // Verbatim, case-sensitive: a phone number or email that got "helpfully"
  // reformatted is still a broken fact.
  for (const s of c.mustPreserve ?? []) {
    if (!out.includes(s)) problems.push(`did not preserve: ${JSON.stringify(s)}`);
  }
  if (c.mustBeScript) {
    const got = detectScript(out);
    if (got !== c.mustBeScript) problems.push(`script was ${got}, expected ${c.mustBeScript}`);
  }
  if (c.maxChars && out.length > c.maxChars) {
    problems.push(`too long: ${out.length} chars > ${c.maxChars}`);
  }
  return problems;
}

async function runCase(c: EvalCase, runs: number): Promise<CaseResult> {
  const res: CaseResult = { id: c.id, runs, passes: 0, failures: [], outputs: [], ms: 0 };
  const started = Date.now();
  for (let i = 0; i < runs; i++) {
    let out = "";
    try {
      out = await assist(c.input, {
        tone: c.tone,
        personality: c.personality,
        script: c.script,
        alternative: c.alternative,
        targetApp: "Generic",
      });
    } catch (err) {
      res.failures.push(`run ${i + 1}: threw ${(err as Error).message}`);
      continue;
    }
    res.outputs.push(out);
    const problems = scoreOutput(c, out);
    if (problems.length === 0) res.passes++;
    else res.failures.push(`run ${i + 1}: ${problems.join("; ")}`);
  }
  res.ms = Date.now() - started;
  return res;
}

async function main(): Promise<void> {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
  const cases = filters.length
    ? CASES.filter((c) => filters.some((f) => c.id.includes(f)))
    : CASES;

  if (!cases.length) {
    console.error(`No cases match ${filters.join(", ")}. Available ids:`);
    for (const c of CASES) console.error(`  ${c.id}`);
    process.exit(1);
  }

  console.log(`\nEval — ${cases.length} case(s) × ${runs} run(s)`);
  console.log(`model: ${process.env.CLEANUP_MODEL ?? "(config default)"}\n`);

  // Sequential on purpose: parallel calls hit provider rate limits and make
  // the timings meaningless.
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await runCase(c, runs);
    results.push(r);
    const ok = r.passes === r.runs;
    const rate = `${r.passes}/${r.runs}`;
    console.log(`${ok ? "PASS" : "FAIL"}  ${rate.padEnd(6)} ${r.id}  (${r.ms}ms)`);
    if (!ok) {
      console.log(`      why it matters: ${cases.find((x) => x.id === r.id)!.intent}`);
      for (const f of r.failures) console.log(`      ✗ ${f}`);
      // The actual output is the thing you need to see to fix a prompt.
      for (const o of r.outputs) console.log(`      → ${JSON.stringify(o.slice(0, 160))}`);
    }
  }

  const fullPass = results.filter((r) => r.passes === r.runs).length;
  const anyPass = results.reduce((s, r) => s + r.passes, 0);
  const total = results.reduce((s, r) => s + r.runs, 0);
  console.log(`\n${fullPass}/${results.length} cases fully passed  ·  ${anyPass}/${total} runs passed`);

  // Flaky cases (some runs pass, some don't) are worth calling out separately:
  // they're usually a prompt that's ALMOST right, which is different from one
  // that's simply wrong.
  const flaky = results.filter((r) => r.passes > 0 && r.passes < r.runs);
  if (flaky.length) {
    console.log(`\nFlaky (inconsistent across runs): ${flaky.map((r) => r.id).join(", ")}`);
  }

  process.exit(fullPass === results.length ? 0 : 1);
}

// Only run when invoked directly (npm run eval) — importing this module for
// the scorer tests must not fire a paid eval sweep.
const invokedDirectly = process.argv[1]?.includes("evals/run");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("eval runner crashed:", err);
    process.exit(1);
  });
}
