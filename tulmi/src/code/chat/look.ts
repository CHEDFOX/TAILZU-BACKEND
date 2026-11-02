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
/** Steps the test of an answer may add, to read what it found missing and write the answer again. */
export const CHECK_STEPS = 2;
/** The test runs only while at least this share of the money is left: the answer as it is beats one that cannot be finished. */
export const CHECK_MONEY_SHARE = 0.35;
/** What the test of an answer says when the answer stands. */
export const HOLDS = "HOLDS";

/**
 * THE TEST OF AN ANSWER, BEFORE IT GOES. The App Review replay (2026-11-02): asked why Apple found no tracking prompt, Xode found the gate (a server
 * switch, off by default) and the one call at startup, and said "turn the switch on, no build needed" without walking it: the switch arrives with
 * the server's answer, after that one call, so the prompt would still never show. Found the parts, never ran them in order. This is no rule about
 * that case: any answer from code is walked as if the person did what it says, in the order the code runs, and a link only assumed is read.
 */
export const TEST_DRAFT = [
  "Before this goes to the person, test it. They will not see this test.",
  "WALK: suppose they do exactly what your answer says, in the situation the question describes (who runs it, on what, and whether it is the first run or a later one). Write, as numbered lines, the code running in the order it runs: what starts it, each function called, each value it reads and where and WHEN that value was set or arrives. A link you have not read (who calls it, where a value comes from, when it arrives, what a helper returns) is to be read now, with your tools, before you go on.",
  `Then one line: VERDICT: ${HOLDS} if the problem really goes away (or the question is really answered) as written, or VERDICT: WRONG.`,
  "After WRONG, write the corrected answer in full, exactly as you would have answered the person from the start. They never saw the first answer: do not mention it, a draft, a correction or a mistake.",
].join("\n");

const VERDICT = /^\s*\**\s*VERDICT\s*:?\s*\**\s*(HOLDS|WRONG)\b\**[^\n]*$/im;

/**
 * What the test of an answer decided: "holds" (the answer goes as it was), "wrong" with the corrected answer after the verdict, or null when it said
 * neither (its words are then taken as the answer, if they are one). A bare HOLDS counts as holds.
 */
export function verdictOf(text: string): { holds: true } | { holds: false; answer: string } | null {
  const t = text.trim();
  if (holds(t)) return { holds: true };
  const m = VERDICT.exec(t);
  if (!m) return null;
  if (m[1]!.toUpperCase() === HOLDS) return { holds: true };
  // What follows the verdict, without the rule or heading lines a model puts before an answer ("---", "Answer:").
  const after = t.slice(m.index + m[0].length).replace(/^(?:\s*(?:[-*_=]{3,}|#*\s*(?:corrected\s+)?answer\s*:?)\s*\n)+/i, "");
  return { holds: false, answer: after.trim() };
}

/** The test's reply is the word alone (a full stop, quotes or bold around it at most). */
export const holds = (text: string): boolean => new RegExp(`^[\\s"'*_.]*${HOLDS}[\\s"'*_.!]*$`, "i").test(text);
/** Room for the walk the test writes before its verdict. */
export const CHECK_TOKENS = 600;

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
  /** The role the loop speaks as: code_ask (a question, read-only) unless told; code_chat for the one loop of a project's chat (converse.ts). */
  role?: "code_ask" | "code_chat";
  /** What it may do besides reading (converse.ts: a book chapter, start a job, ask the person). A call that returns `end` ends the loop with those words. */
  acts?: Acts;
  /**
   * What the turn owes besides words (converse.ts: a change asked for owes the job). Said once when the model ends with words and no act; the words it
   * ended with are kept as the answer unless what follows ends with an act or says more.
   */
  owed?: string;
  /**
   * Test the answer before it goes (TEST_DRAFT): an answer drawn from reading code is walked again, as if the person did what it says, in the order
   * the code runs; a link only assumed is read. One round a turn, only after looking. converse.ts asks it of every question, not of talk or a change.
   */
  check?: boolean;
  /** The most steps (LOOK_STEPS_MAX unless fewer): a change asked for looks only to place the work, as the job reads it in full. */
  steps?: number;
}

export interface Acts {
  defs: readonly ToolDef[];
  exec(name: string, args: Record<string, unknown>): Promise<{ content: string; end?: string }>;
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
  /** The action that ended the loop (start_job, ask_person), when one did. */
  ended?: string;
  /** A first look did not settle it and a tier that reasons looked again (converse.ts). */
  escalated?: boolean;
  /** The answer came because the steps or the money ran out, not because it was done looking (converse.ts looks again on a tier that reasons). */
  ranOut?: boolean;
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

/** A turn that is only a promise to look further: short, no answer in it, and saying it will read, check or look next. */
export function promisesMore(text: string): boolean {
  const t = text.trim();
  return !!t && t.length <= 400 && !t.includes("```") && /\b(?:let me|i'll|i will|i need to|i'm going to|next,? i)\b[^.]*\b(?:read|check|look|open|search|find|see|get)\b/i.test(t);
}

/**
 * A tool call a model wrote into its words instead of making it: the markup of one (`<invoke`, `<tool_call>`, `<function_calls>`, a model's own
 * tokens such as `<｜DSML｜invoke` or `<｜tool▁call▁begin｜>`) or a JSON call.
 */
const LEAK = /(?<!`)<\s*\/?\s*(?:invoke|tool_call|tool_use|function_calls?)\b|(?<!`)<\s*[｜|]\s*(?:DSML|tool)|```(?:json)?\s*\{\s*"(?:name|tool|function)"\s*:/;
export const leakedCall = (text: string): boolean => LEAK.test(text);
/** The words before a leaked call: what the person may read of such a turn. */
export function stripLeak(text: string): string {
  const m = LEAK.exec(text);
  return m ? text.slice(0, m.index).trim() : text;
}

/** The ledger: what has been read and searched so far, and the steps left. */
function ledger(seen: readonly string[], greps: readonly string[], step: number, max: number, lastNext: boolean, owed?: string): string {
  const left = max - step;
  return [
    `Ledger: ${seen.length ? `read ${seen.slice(-14).join(", ")}` : "nothing read with your tools yet"}${greps.length ? `; searched ${greps.slice(-8).map((g) => JSON.stringify(cut(g, 40))).join(", ")}` : ""}.`,
    lastNext ? (owed ? `This is your last step: no more reading. ${owed}` : "This is your last step: answer now, from what you have read, with no tool call.") : `${left} steps left. Read only what you have not read; answer as soon as every claim rests on lines you read.`,
  ].join(" ");
}

export async function investigate(i: LookInput): Promise<Looked> {
  const call: CallFn = i.model.call ?? (callModel as CallFn);
  const messages: ChatMessage[] = compose(i.role ?? "code_ask", [{ role: "user" as const, content: i.user }]);
  const acts = new Set((i.acts?.defs ?? []).map((d) => d.name));
  const defs = [...i.tools.defs.filter((d) => (LOOK_TOOLS as readonly string[]).includes(d.name)), ...(i.acts?.defs ?? [])];
  const reads = new Set<string>();
  const greps: string[] = [];
  const seen: string[] = [];
  let paise = 0;
  let chars = 0;
  let said = false;
  let owed = i.owed;
  /** The words a turn ended with before it was told what it owes: the answer, unless what follows does better. */
  let held: string | null = null;
  const words = i.onText
    ? { onText: (piece: string) => { said = true; i.onText!(piece); }, onReset: () => { if (said) { said = false; i.onReset?.(); } } }
    : null;
  let max = Math.max(1, Math.min(LOOK_STEPS_MAX, i.steps ?? LOOK_STEPS_MAX));
  /** The answer under test (TEST_DRAFT), once it has been written; the test runs once a turn. */
  let draft: string | null = null;
  let draftForced = false;
  let tested = false;
  const lastAt = (step: number): boolean => step === max || chars >= LOOK_CHARS_MAX || (step > 1 && paise >= i.maxPaise * LOOK_SPEND_SHARE);
  let steps = 0;
  for (let step = 1; step <= max; step += 1) {
    steps = step;
    const last = lastAt(step);
    // The last step of a turn that owes an act (a job for a change) may still act, and only act: no more reading. Told so by the ledger before it.
    const acting = last && !!owed && acts.size > 0;
    if (acting && step === 1) messages.push({ role: "user", content: owed! });
    if (acting) owed = undefined;
    const left = Math.max(1, i.maxPaise - paise);
    i.onStep?.(step === 1 ? "code:write" : "code:look");
    let res;
    try {
      res = await call({
        tier: i.tier, messages, maxTokens: draft !== null ? i.maxTokens + CHECK_TOKENS : i.maxTokens, purpose: "front.code_answer", userId: i.model.userId, budget: { maxPaise: left },
        tools: acting ? [...(i.acts?.defs ?? [])] : [...defs], toolChoice: last && !acting ? ("none" as const) : ("auto" as const), ...(i.model.signal ? { signal: i.model.signal } : {}),
        // The test's own reply is not streamed: "HOLDS" is no answer, and a corrected one is shown whole once it is in.
        ...(held === null && draft === null ? words ?? {} : {}),
      }, i.model.gateway);
    } catch (err) {
      if (draft !== null) return { text: draft, reads: [...reads], greps, seen, paise, steps: step, ranOut: draftForced };
      if (isAbort(err) || step === 1) throw err;
      // Out of money or the model gone after some looking: one answer from what was read, with no tools, if it can be had.
      break;
    }
    paise += res.paise;
    const asked = res.toolCalls ?? [];
    // The test of the answer came back: it stands (shown already), or it is written again (shown whole now), or more is read first, and the
    // test goes on after the reading (the draft stays on screen until the verdict says otherwise).
    if (draft !== null && !asked.length) {
      const reply = stripLeak(res.text).trim();
      const v = verdictOf(reply);
      // A walk with no verdict, or a WRONG with nothing after it: the answer as it was beats a half-written one. Words with no walk and no
      // verdict, after reading more, are the answer written again.
      const again = v ? (v.holds ? "" : v.answer) : /^\s*\**\s*WALK\b/i.test(reply) ? "" : reply;
      if (!again) return { text: draft, reads: [...reads], greps, seen, paise, steps: step, ranOut: draftForced };
      words?.onReset();
      words?.onText(again);
      return { text: again, reads: [...reads], greps, seen, paise, steps: step };
    }
    // Words that only say it will look further ("Let me read the rest of DEPLOY.md."), with no call: not an answer. Told to do it or answer, once a step.
    // A tool call written out as words (`<invoke>…`, `<tool_call>{…}`) is not a call: told to make it, or to answer, and never shown as the answer.
    if (draft === null && !asked.length && !last && (promisesMore(res.text) || leakedCall(res.text))) {
      words?.onReset();
      messages.push({ role: "assistant", content: stripLeak(res.text) || "(a tool call written as words)" }, {
        role: "user", content: leakedCall(res.text) ? "That was a tool call written as words: make it as a real tool call, or answer now." : "Do that now with your tools, or answer now: words that only say what you will do are not an answer.",
      });
      continue;
    }
    // On the last step a promise or a written call is still no answer: one more call, with no tools, for the answer from what was read.
    if (!asked.length && last && held === null && (promisesMore(res.text) || leakedCall(res.text))) break;
    // Words where an act was owed (a change asked for, and no job): told once; the words stay the answer if words come back.
    if (!asked.length && !last && owed) {
      held = stripLeak(res.text).trim();
      messages.push({ role: "assistant", content: held || "(no words)" }, { role: "user", content: owed });
      owed = undefined;
      continue;
    }
    if (!asked.length || (last && !acting)) {
      const text = stripLeak(res.text).trim();
      const answer: string = held !== null && held.length >= text.length ? held : text;
      // An answer drawn from reading code is tested once before it goes (TEST_DRAFT), while the money allows: walked as if done, every link read.
      if (i.check && !tested && answer && (reads.size > 0 || greps.length > 0) && i.maxPaise - paise >= i.maxPaise * CHECK_MONEY_SHARE) {
        tested = true;
        draft = answer;
        draftForced = last && !acting;
        max = Math.min(LOOK_STEPS_MAX + CHECK_STEPS, Math.max(max, step) + CHECK_STEPS);
        messages.push({ role: "assistant", content: answer }, { role: "user", content: TEST_DRAFT });
        continue;
      }
      return { text: answer, reads: [...reads], greps, seen, paise, steps: step, ranOut: last && !acting };
    }
    if (held === null && draft === null) words?.onReset();
    messages.push({ role: "assistant", content: res.text || null, tool_calls: asked });
    const calls = asked.slice(0, LOOK_CALLS_PER_STEP);
    for (const c of calls) {
      const a = args(c);
      let content: string;
      if (acts.has(c.name)) {
        const r = await i.acts!.exec(c.name, a);
        if (r.end !== undefined) return { text: r.end, reads: [...reads], greps, seen, paise, steps: step, ended: c.name };
        content = r.content;
      } else if (!(LOOK_TOOLS as readonly string[]).includes(c.name)) {
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
    messages.push({ role: "user", content: ledger(seen, greps, step, max, lastAt(step + 1), acts.size > 0 ? owed : undefined) });
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
    return { text: stripLeak(res?.text ?? "").trim(), reads: [...reads], greps, seen, paise: paise + (res?.paise ?? 0), steps, ranOut: true };
  }
  return { text: "", reads: [...reads], greps, seen, paise, steps, ranOut: true };
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
