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
import { AGENT_TOOLS } from "../src/code/agent/tools.js";
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
  // The front door's roles (src/front) were written after the principles: they replace no older prompt, so "before" is their first size.
  front_decide: 1460,
  front_reply: 1066,
  // Rewritten when the code answer became real (src/code/chat): it is told about <facts> and <thread> too. Re-measured, 789 before.
  front_code_answer: 1067,
  front_diagram: 556,
  front_plan: 668,
  front_look: 587,
  // PR care (src/code/prcare, src/code/agent/merge.ts): written after the principles too, so their first size is their "before".
  care_review: 1422,
  care_conflict: 697,
};

/** The roles that replaced a prompt the code used to carry: only these have a real "before", and only these are held to the saving. */
export const NEW_ROLES: readonly RoleId[] = ["front_decide", "front_reply", "front_code_answer", "front_diagram", "front_plan", "front_look", "care_review", "care_conflict"];

/**
 * The agent's tool definitions are sent with every turn of a job, so they are prompt too. What they were before they were tightened in the
 * principles' style (short, the schema does the work, no examples), as JSON.stringify(AGENT_TOOLS) measured them: the whole list, the
 * descriptions alone, and the parameter schemas alone (which hold the web tools' per-parameter descriptions that were dropped).
 */
export const TOOLS_BEFORE = { total: 8258, descriptions: 4023, schema: 3355 } as const;

export interface ToolSizes { total: number; descriptions: number; schema: number; tools: number; longest: { name: string; chars: number } }

/** The size of the agent's tool definitions as they are now. */
export function toolSizes(tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }> = AGENT_TOOLS): ToolSizes {
  const descriptions = tools.reduce((n, t) => n + t.description.length, 0);
  const schema = tools.reduce((n, t) => n + JSON.stringify(t.parameters).length, 0);
  const longest = tools.reduce((a, t) => (t.description.length > a.chars ? { name: t.name, chars: t.description.length } : a), { name: "", chars: 0 });
  return { total: JSON.stringify(tools).length, descriptions, schema, tools: tools.length, longest };
}

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
  // The saving is for the roles that replaced a prompt. The front door's roles replace none, so they are a total of their own.
  const isNew = (r: Row) => (NEW_ROLES as readonly string[]).includes(r.role);
  const replaced = totals(list.filter((r) => !isNew(r)));
  const fresh = totals(list.filter(isNew));
  const head = ["role", "before chars", "before tokens", "after chars", "after tokens", "saved"];
  const label = (r: Row, name: string): Row => ({ ...r, role: name as RoleId });
  const body = [...list, label(replaced, `total (${list.filter((r) => !isNew(r)).length} replaced)`), label(fresh, `total (${NEW_ROLES.length} new)`)]
    .map((r) => [r.role, String(r.beforeChars), String(r.beforeTokens), String(r.afterChars), String(r.afterTokens), isNew(r) || String(r.role).includes("new)") ? "n/a" : `${r.saved}%`]);
  if (md) {
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return [line(head), line(head.map((_, i) => (i === 0 ? "---" : "---:"))), ...body.map((r, i) => line(i >= body.length - 2 ? r.map((c) => `**${c}**`) : r))].join("\n");
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
  const t = toolSizes();
  const pct = (a: number, b: number) => `${Math.round((1 - a / b) * 100)}%`;
  console.log(
    `\nthe agent's ${t.tools} tool definitions, as JSON: ${TOOLS_BEFORE.total} -> ${t.total} chars (${pct(t.total, TOOLS_BEFORE.total)} fewer, ${tokensOfChars(TOOLS_BEFORE.total)} -> ${tokensOfChars(t.total)} tokens a turn); `
    + `descriptions ${TOOLS_BEFORE.descriptions} -> ${t.descriptions} (${pct(t.descriptions, TOOLS_BEFORE.descriptions)}), schemas ${TOOLS_BEFORE.schema} -> ${t.schema} (${pct(t.schema, TOOLS_BEFORE.schema)})`,
  );
}
