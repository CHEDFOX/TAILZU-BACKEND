/**
 * Print the size of every role's system prompt, before the principles and after.
 *
 *   npm run prompt-sizes            a table for the terminal
 *   npm run prompt-sizes -- --md    the same as markdown (docs/principles.md carries it)
 *
 * "After" is read from the library as it is now: the stable block compose() puts in front of every call of
 * the role (principles/roles.ts). "Before" is what the same call site sent at b046a4b, the commit before the
 * principles landed, measured by running the sites from that commit with a stand-in model and keeping the
 * system message. It cannot be recomputed from the code now (the text is gone), so it is recorded here:
 *
 *   - characters of the system message as the gateway received it, plus the 60 it added for a JSON answer
 *     ("\n\n" and "Answer with one JSON value only: no prose, no code fences.") on the calls that asked for
 *     one, so both columns are what the model was sent;
 *   - agent_work is the fixed part: with no project rules, no memory, no install command and no kind of
 *     request. Those are dynamic now (they open the first user message) and were then too.
 *
 * Tokens are estimated the way the gateway estimates them before a call (code/brain/money.ts, 3.5 characters
 * to a token), so the table is in the same unit as a job's budget check.
 */
import { tokensOfChars } from "../src/code/brain/money.js";
import { ROLE_IDS, stableBlock, type RoleId } from "../src/principles/index.js";

export const BEFORE: Readonly<Record<RoleId, number>> = {
  classify: 1645,
  locate_terms: 538,
  locate_pick: 740,
  plan_change: 1003,
  agent_work: 3288,
  agent_fold: 608,
  index_files: 615,
  index_dirs: 496,
  index_repo: 405,
  index_features: 553,
  welcome: 592,
  spec: 1474,
  brief: 1169,
  research_answer: 930,
  research_gaps: 418,
  search_plan: 929,
  artifact_element: 925,
  artifact_edit: 1051,
  artifact_fix: 907,
  artifact_make: 766,
  artifact_ask: 534,
  artifact_vision: 482,
  artifact_compare: 1449,
};

export interface Row {
  role: RoleId;
  beforeChars: number;
  beforeTokens: number;
  afterChars: number;
  afterTokens: number;
  /** Percent fewer characters; negative when the role grew. */
  saved: number;
}

export function rows(): Row[] {
  return ROLE_IDS.map((role) => {
    const beforeChars = BEFORE[role];
    const afterChars = stableBlock(role).length;
    return {
      role, beforeChars, beforeTokens: tokensOfChars(beforeChars), afterChars, afterTokens: tokensOfChars(afterChars),
      saved: Math.round((1 - afterChars / beforeChars) * 100),
    };
  });
}

export function totals(list: readonly Row[]): Row {
  const beforeChars = list.reduce((n, r) => n + r.beforeChars, 0);
  const afterChars = list.reduce((n, r) => n + r.afterChars, 0);
  return {
    role: "total" as RoleId, beforeChars, beforeTokens: tokensOfChars(beforeChars), afterChars, afterTokens: tokensOfChars(afterChars),
    saved: Math.round((1 - afterChars / beforeChars) * 100),
  };
}

function render(list: readonly Row[], md: boolean): string {
  const total = totals(list);
  const head = ["role", "before chars", "before tokens", "after chars", "after tokens", "saved"];
  const body = [...list, total].map((r) => [r.role, String(r.beforeChars), String(r.beforeTokens), String(r.afterChars), String(r.afterTokens), `${r.saved}%`]);
  if (md) {
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return [line(head), line(head.map((_, i) => (i === 0 ? "---" : "---:"))), ...body.map((r, i) => line(i === body.length - 1 ? r.map((c) => `**${c}**`) : r))].join("\n");
  }
  const width = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(width[i]!) : c.padStart(width[i]!))).join("  ");
  return [line(head), line(width.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

// Run as a script, not when a test imports rows().
if (process.argv[1] && /prompt-sizes\.[tj]s$/.test(process.argv[1])) {
  const list = rows();
  console.log(render(list, process.argv.includes("--md")));
  const biggest = [...list].sort((a, b) => (b.beforeChars - b.afterChars) - (a.beforeChars - a.afterChars)).slice(0, 3);
  console.log(`\nbiggest savings: ${biggest.map((r) => `${r.role} (${r.beforeTokens} -> ${r.afterTokens} tokens)`).join(", ")}`);
}
