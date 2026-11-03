/**
 * LOOKING BEFORE ANSWERING, READ-ONLY AND CAPPED (code/chat/look.ts's way, one step).
 *
 *   lookFirst({ user, ports, … }) -> { text, tools, links, paise }
 *
 * An answer that needs fresh facts (the one key's brain said `web`) is looked up before a word is said: one call on the cheap tier
 * (LOOK_TIER: picking what to look up needs no reasoning, and the strong tier's first model refuses a tools call with reasoning on,
 * 2.5 s lost before the next) with the role talk_reply and the tools, where the model must pick what to look up, at most LOOK_CALLS calls, run together. Each result is cut to
 * LOOK_RESULT_CHARS and all of them to LOOK_CHARS_MAX; they go to the answer in <found_now>. The tools are the bots' own:
 * web_search (code/webTools.ts) and the everyday tools' weather and currency_convert (src/everyday), which only read.
 *
 * Never in the way: a model that is down, over its cap, a tool that fails, or one slower than LOOK_TOOL_MS leaves the answer to go on
 * without it. Only the person's
 * stop goes through (an AbortError).
 */
import { callModel, type GatewayDeps } from "../code/brain/gateway.js";
import type { ModelTier } from "../code/brain/tiers.js";
import type { ToolCall, ToolDef } from "../code/brain/types.js";
import { makeWebTools } from "../code/webTools.js";
import type { CallFn } from "../code/work/model.js";
import { everyday as everydayService, type Everyday } from "../everyday/index.js";
import { EVERYDAY_TOOLS, runEveryday } from "../everyday/tools.js";
import { compose } from "../principles/index.js";

export const LOOK_CALLS = 3;
export const LOOK_RESULT_CHARS = 2_000;
export const LOOK_CHARS_MAX = 4_500;
/** A spoken answer waits this long for a lookup at most: one that takes longer is answered without (a search that hangs, a
 *  geocoder that is slow), and the answer says it could not look. */
export const LOOK_TOOL_MS = 4_000;
const LOOK_TOKENS = 300;
/** The tier that picks the lookups, whatever tier then answers. */
export const LOOK_TIER: ModelTier = "cheap";
/** The most the call that picks the lookups may cost, in paise. */
export const LOOK_PAISE = 100;
/** The model's line before the turn: what this call is for. */
export const LOOK_NOTE = "Before you answer, look up what the answer needs with the tools: call them now, nothing else.";

/** The tools a lookup may use, and how each runs. */
export interface LookPorts {
  defs: ToolDef[];
  run(call: ToolCall): Promise<{ content: string; ok: boolean }>;
}

export interface Looked {
  /** For <found_now>; empty when nothing was found. */
  text: string;
  tools: string[];
  links: string[];
  paise: number;
}

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === "AbortError";
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const LINK = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

export async function lookFirst(o: {
  user: string; ports: LookPorts; userId: string;
  /** Instead of LOOK_TOOL_MS (tests). */
  toolMs?: number;
  call?: CallFn; gateway?: GatewayDeps; signal?: AbortSignal;
}): Promise<Looked> {
  const none: Looked = { text: "", tools: [], links: [], paise: 0 };
  if (!o.ports.defs.length) return none;
  const call: CallFn = o.call ?? (callModel as CallFn);
  let calls: ToolCall[];
  let paise = 0;
  try {
    const r = await call({
      tier: LOOK_TIER, messages: compose("talk_reply", [{ role: "user" as const, content: `${LOOK_NOTE}\n${o.user}` }]),
      tools: o.ports.defs, toolChoice: "required", maxTokens: LOOK_TOKENS, purpose: "talk.look", userId: o.userId,
      budget: { maxPaise: LOOK_PAISE }, ...(o.signal ? { signal: o.signal } : {}),
    }, o.gateway);
    paise = r.paise;
    calls = r.toolCalls.slice(0, LOOK_CALLS);
  } catch (err) {
    if (isAbort(err)) throw err;
    return none;
  }
  if (!calls.length) return { ...none, paise };
  const results = await Promise.all(calls.map(async (c) => {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), o.toolMs ?? LOOK_TOOL_MS); });
      const r = await Promise.race([o.ports.run(c), late]).finally(() => clearTimeout(timer));
      if (!r) return { name: c.name, content: `${c.name} took too long just now.`, ok: false };
      return { name: c.name, content: cut(r.content, LOOK_RESULT_CHARS), ok: r.ok };
    } catch (err) {
      if (isAbort(err)) throw err;
      return { name: c.name, content: `${c.name} did not work just now.`, ok: false };
    }
  }));
  const parts: string[] = [];
  let n = 0;
  for (const r of results) {
    const piece = `${r.name}:\n${r.content}`;
    if (n + piece.length > LOOK_CHARS_MAX) { parts.push(cut(piece, Math.max(0, LOOK_CHARS_MAX - n))); break; }
    parts.push(piece);
    n += piece.length + 1;
  }
  const links = [...new Set(results.filter((r) => r.ok).flatMap((r) => r.content.match(LINK) ?? []))].slice(0, 3);
  return { text: parts.join("\n").trim(), tools: results.map((r) => r.name), links, paise };
}

/** The production tools: the web search, and the everyday tools that only read (weather, currency). Null when there are none. */
export function lookPorts(userId: string, o: { signal?: AbortSignal; maxPaise: number; everyday?: Everyday | null }): LookPorts | null {
  const defs: ToolDef[] = [];
  const runs = new Map<string, (c: ToolCall) => Promise<{ content: string; ok: boolean }>>();
  const web = makeWebTools({ userId, budget: { maxPaise: o.maxPaise }, ...(o.signal ? { signal: o.signal } : {}) });
  const search = web.tools.find((t) => t.name === "web_search");
  if (search) {
    defs.push(search);
    runs.set(search.name, async (c) => { const r = await web.run(c); return { content: r.message.content, ok: r.ok }; });
  }
  const e = o.everyday === undefined ? everydayService() : o.everyday;
  if (e) {
    for (const kind of ["weather", "money"] as const) {
      if (!e.on(kind)) continue;
      const def = EVERYDAY_TOOLS[kind];
      defs.push(def);
      runs.set(def.name, (c) => {
        let args: Record<string, unknown> = {};
        try { const v = JSON.parse(c.arguments || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>; } catch { /* empty */ }
        return runEveryday(e, userId, kind, args, () => undefined);
      });
    }
  }
  if (!defs.length) return null;
  return {
    defs,
    run: (c) => runs.get(c.name)?.(c) ?? Promise.resolve({ content: `There is no tool called ${c.name}.`, ok: false }),
  };
}
