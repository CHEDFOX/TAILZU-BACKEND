/**
 * LOOKING BEFORE ANSWERING: XODE'S CHAT INVESTIGATES THE WAY A JOB DOES, READ-ONLY, IN A FEW ORGANISED STEPS.
 *
 *   investigate(input) -> { text, reads, greps, seen, paise, steps }
 *
 * The one-pass answer (answer.ts) read up to three files and had to answer from them: "I can't see X" was its most common line, and a file it named
 * was a file it had not opened. This is the same answer with the means to go and look, in the order a careful developer works:
 *
 *   1. BRIEF    what is already known, free, in the first message: the question, the project map's components that match it with each function's
 *               exact lines, the index's facts and the first reads (answer.ts), what this chat looked at before, and the job it started.
 *   2. LOOK     the model asks for what it still needs, several calls in one step: project_map (where a thing is, a component's card with every
 *               function's lines), search_code and grep (exact names, every use), read_file (whole functions, by their lines), list_dir, glob,
 *               suggest_files. The agent's own tools (agent/tools.ts), with nothing that writes, runs or goes to the web.
 *   3. LEDGER   after each step it is told what it has read (file and lines) and searched, and how many steps are left: nothing is read twice, and
 *               it knows when to stop.
 *   4. ANSWER   a turn with no tool call is the answer; at the last step it must answer. Every line it was shown is an anchor (cite.ts), so the
 *               answer cites what it read and nothing else.
 *
 * A question the brief already answers costs one turn, as before. The words of the answer are streamed; a turn that goes to a tool after writing a
 * little takes them back (onReset).
 */
import type { ChatMessage, ToolCall, ToolDef } from "../brain/types.js";
import { BudgetExceeded, callModel } from "../brain/gateway.js";
import { compose } from "../../principles/roles.js";
import type { CallFn } from "../work/model.js";
import { cut } from "../work/model.js";
import type { FrontModel } from "../../front/model.js";
import type { ModelTier } from "../brain/tiers.js";
import type { Anchors } from "./cite.js";

/** The tools the chat may use: the agent's, read-only. */
export const LOOK_TOOLS = ["project_map", "search_code", "grep", "read_file", "list_dir", "glob", "suggest_files"] as const;
/** Steps of looking at most, the answer's included; calls one step may make; what all the results together may hold. */
export const LOOK_STEPS_MAX = 5;
export const LOOK_CALLS_PER_STEP = 6;
export const LOOK_RESULT_CHARS = 6_000;
export const LOOK_CHARS_MAX = 36_000;
/** Past this share of the money, the next step is the answer: looking never spends what the answer needs (a large project's brief made the last call unaffordable). */
export const LOOK_SPEND_SHARE = 0.6;

export interface LookTools {
  defs: readonly ToolDef[];
  exec(call: ToolCall): Promise<{ ok: boolean; content: string; data?: string; label?: string }>;
}

export interface LookInput {
  model: FrontModel;
  tier: ModelTier;
  /** The first message: the brief (answer.ts builds it). */
  user: string;
  tools: LookTools;
  anchors: Anchors;
  maxPaise: number;
  maxTokens: number;
  onText?: (piece: string) => void;
  onReset?: () => void;
  onStep?: (stage: string) => void;
}

export interface Looked {
  text: string;
  /** Files read, and patterns searched, through the tools. */
  reads: string[];
  greps: string[];
  /** What was read, as path:from-to: kept on the thread, so the next question knows. */
  seen: string[];
  paise: number;
  steps: number;
}

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === "AbortError";
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const args = (c: ToolCall): Record<string, unknown> => {
  try { const v = JSON.parse(c.arguments || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; }
};

/** What a tool showed, made into anchors: a numbered line read (`12: text`), a grep hit (`path:12:`), a map card's line range. */
export function anchorResult(anchors: Anchors, name: string, a: Record<string, unknown>, data: string): string | null {
  if (name === "read_file") {
    const path = str(a.path)?.trim().replace(/^\.\//, "");
    if (!path) return null;
    const nums = [...data.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]));
    for (const n of nums) anchors.hit(path, n);
    return nums.length ? `${path}:${nums[0]}-${nums.at(-1)}` : null;
  }
  if (name === "grep") {
    for (const m of data.matchAll(/^([^\s:]+):(\d+)[:-]/gm)) anchors.hit(m[1]!, Number(m[2]));
    return null;
  }
  if (name === "project_map") {
    const path = str(a.path)?.trim();
    if (path) for (const m of data.matchAll(/lines (\d+)-(\d+)/g)) { anchors.hit(path, Number(m[1])); anchors.hit(path, Number(m[2])); }
    for (const m of data.matchAll(/^([^\s:]+\.[A-Za-z0-9]+) .*?\[([^\]]*)\]/gm)) for (const r of m[2]!.matchAll(/:(\d+)-(\d+)/g)) { anchors.hit(m[1]!, Number(r[1])); anchors.hit(m[1]!, Number(r[2])); }
    return null;
  }
  if (name === "search_code") {
    for (const m of data.matchAll(/^([^\s:]+\.[A-Za-z0-9]+):(\d+) /gm)) anchors.hit(m[1]!, Number(m[2]));
  }
  return null;
}

/** The ledger: what has been read and searched so far, and the steps left. */
function ledger(seen: readonly string[], greps: readonly string[], step: number): string {
  const left = LOOK_STEPS_MAX - step;
  return [
    `Ledger: ${seen.length ? `read ${seen.slice(-14).join(", ")}` : "nothing read with your tools yet"}${greps.length ? `; searched ${greps.slice(-8).map((g) => JSON.stringify(cut(g, 40))).join(", ")}` : ""}.`,
    left <= 1 ? "This is your last step: answer now, from what you have read, with no tool call." : `${left} steps left. Read only what you have not read; answer as soon as every claim rests on lines you read.`,
  ].join(" ");
}

export async function investigate(i: LookInput): Promise<Looked> {
  const call: CallFn = i.model.call ?? (callModel as CallFn);
  const messages: ChatMessage[] = compose("code_ask", [{ role: "user" as const, content: i.user }]);
  const defs = i.tools.defs.filter((d) => (LOOK_TOOLS as readonly string[]).includes(d.name));
  const reads = new Set<string>();
  const greps: string[] = [];
  const seen: string[] = [];
  let paise = 0;
  let chars = 0;
  let said = false;
  const words = i.onText
    ? { onText: (piece: string) => { said = true; i.onText!(piece); }, onReset: () => { if (said) { said = false; i.onReset?.(); } } }
    : null;
  for (let step = 1; step <= LOOK_STEPS_MAX; step += 1) {
    const last = step === LOOK_STEPS_MAX || chars >= LOOK_CHARS_MAX || (step > 1 && paise >= i.maxPaise * LOOK_SPEND_SHARE);
    const left = Math.max(1, i.maxPaise - paise);
    i.onStep?.(step === 1 ? "code:write" : "code:look");
    let res;
    try {
      res = await call({
        tier: i.tier, messages, maxTokens: i.maxTokens, purpose: "front.code_answer", userId: i.model.userId, budget: { maxPaise: left },
        tools: [...defs], toolChoice: last ? ("none" as const) : ("auto" as const), ...(i.model.signal ? { signal: i.model.signal } : {}), ...(words ?? {}),
      }, i.model.gateway);
    } catch (err) {
      if (isAbort(err) || step === 1) throw err;
      // Out of money or the model gone after some looking: one answer from what was read, with no tools, if it can be had.
      break;
    }
    paise += res.paise;
    const asked = res.toolCalls ?? [];
    if (!asked.length || last) return { text: res.text.trim(), reads: [...reads], greps, seen, paise, steps: step };
    words?.onReset();
    messages.push({ role: "assistant", content: res.text || null, tool_calls: asked });
    const calls = asked.slice(0, LOOK_CALLS_PER_STEP);
    for (const c of calls) {
      const a = args(c);
      let content: string;
      if (!(LOOK_TOOLS as readonly string[]).includes(c.name)) {
        content = `There is no ${cut(c.name, 40)} here: this chat only reads (${LOOK_TOOLS.join(", ")}).`;
      } else {
        if (c.name === "read_file") { const p = str(a.path)?.trim(); if (p) { reads.add(p); i.onStep?.(`code:read:${p}`); } }
        if (c.name === "grep") { const g = str(a.pattern); if (g) { greps.push(g); i.onStep?.("code:grep"); } }
        const out: { ok: boolean; content: string; data?: string } = await i.tools.exec(c).catch((err: unknown) => {
          if (isAbort(err)) throw err;
          return { ok: false, content: `That did not work: ${cut(String((err as Error)?.message ?? err), 200)}` };
        });
        const data = out.data ? cut(out.data, LOOK_RESULT_CHARS) : "";
        const range = data ? anchorResult(i.anchors, c.name, a, data) : null;
        if (range) seen.push(range);
        content = out.ok ? [out.content, data ? `<data from="${c.name}">\n${data}\n</data>` : ""].filter(Boolean).join("\n") : `That did not work. ${out.content}`;
      }
      chars += content.length;
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
    for (const c of asked.slice(LOOK_CALLS_PER_STEP)) messages.push({ role: "tool", tool_call_id: c.id, content: `Skipped: at most ${LOOK_CALLS_PER_STEP} calls a step.` });
    messages.push({ role: "user", content: ledger(seen, greps, step) });
  }
  // The money or the model ran out while looking: the last answer it can give, from what it has, with no tool call. The money's guard prices a call
  // at its worst case, so what the tools returned is cut down until the answer fits (a refused call costs nothing); the lines read stay anchors.
  for (const keep of FIT_KEEP) {
    const res = await call({
      tier: i.tier, messages: [...shrunk(messages, keep), { role: "user", content: "Answer now from what you have read, with no tool call." }], maxTokens: i.maxTokens,
      purpose: "front.code_answer", userId: i.model.userId, budget: { maxPaise: Math.max(1, i.maxPaise - paise) }, tools: [...defs], toolChoice: "none" as const,
      ...(i.model.signal ? { signal: i.model.signal } : {}), ...(words ?? {}),
    }, i.model.gateway).catch((err: unknown) => { if (isAbort(err)) throw err; return err instanceof BudgetExceeded ? ("budget" as const) : null; });
    if (res === "budget") continue;
    return { text: res?.text.trim() ?? "", reads: [...reads], greps, seen, paise: paise + (res?.paise ?? 0), steps: LOOK_STEPS_MAX };
  }
  return { text: "", reads: [...reads], greps, seen, paise, steps: LOOK_STEPS_MAX };
}

/** How much of each tool result the last answer keeps, tried in turn until its worst case fits the money left (null: all of it). */
const FIT_KEEP: ReadonlyArray<number | null> = [null, 2_000, 500, 0];

/** The messages with every tool result cut to `keep` characters (null: as they are). */
export function shrunk(messages: readonly ChatMessage[], keep: number | null): ChatMessage[] {
  if (keep === null) return [...messages];
  return messages.map((m) => {
    if (m.role !== "tool" || typeof m.content !== "string" || m.content.length <= keep) return m;
    return { ...m, content: keep ? `${m.content.slice(0, keep)}\n…(cut short: the answer has to fit the money left)` : "(left out: the answer has to fit the money left)" };
  });
}
