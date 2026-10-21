/**
 * WHICH APPS, AND WHICH OF THEIR TOOLS, THE PLANNER GETS TO SEE.
 *
 * With many apps connected, showing the planner every tool of every one would
 * cost money on every step and make it worse at choosing. So it sees a few:
 *
 *   1. score the person's connected apps against what they said. An alias or
 *      the app's name in their words is the strongest signal; the app in front
 *      of them, a word shared with the app's one-line description, and use in
 *      the last week add to it. An app with no signal from the words or the
 *      front app is not a candidate, however recently it was used.
 *   2. keep the top three.
 *   3. rank THEIR tools by words shared with what was said (a name hit counts
 *      more than a description hit) and keep twelve across all three.
 *   4. hand the planner compact cards: connector.tool, the description's
 *      first sentence, and the arguments as a short schema.
 *
 * Plain lexical overlap, no model call and no embeddings: this runs on every
 * step of every run and must be free. Ties fall back to the app's own order.
 */
import type { ConnectorDef } from "./catalog.js";
import type { ToolInfo } from "./client.js";

export const MAX_CONNECTORS = 3;
export const MAX_TOOLS = 12;
const WEEK_MS = 7 * 24 * 60 * 60_000;

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "their", "them", "then", "than", "have", "has",
  "are", "was", "were", "will", "can", "all", "any", "not", "but", "you", "its", "per", "via", "etc", "use", "uses",
  "using", "new", "one", "out", "get", "set", "app", "apps", "please", "just", "want", "need", "like", "make", "tell",
]);

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const wordsOf = (s: string): string[] =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
const keywords = (s: string) => wordsOf(s).filter((w) => w.length >= 3 && !STOP.has(w));

export interface Candidate { def: ConnectorDef; lastUsedAt: number | null }

export interface ConnectorScore { id: string; score: number }

/** The top apps for these words, best first. Empty when no app has any signal. */
export function pickConnectors(utterance: string, frontApp: string, have: Candidate[], now = Date.now()): ConnectorScore[] {
  const said = ` ${wordsOf(utterance).join(" ")} `;
  const front = ` ${wordsOf(frontApp).join(" ")} `;
  const saidWords = new Set(keywords(utterance));
  const scored: ConnectorScore[] = [];
  for (const { def, lastUsedAt } of have) {
    const names = [def.name, def.id, ...def.aliases].map((a) => ` ${wordsOf(a).join(" ")} `).filter((a) => a.trim());
    let signal = 0;
    for (const a of def.aliases) if (said.includes(` ${wordsOf(a).join(" ")} `)) signal += 10;
    if (names.some((n) => said.includes(n)) && signal === 0) signal += 10;
    if (names.some((n) => front.includes(n))) signal += 4;
    const desc = new Set(keywords(def.oneLine));
    for (const w of saidWords) if (desc.has(w)) signal += 2;
    if (signal <= 0) continue;
    const recent = lastUsedAt && now - lastUsedAt < WEEK_MS ? 3 * (1 - (now - lastUsedAt) / WEEK_MS) : 0;
    scored.push({ id: def.id, score: signal + recent });
  }
  // Stable: equal scores keep the order the person's connections came in.
  return scored.map((s, i) => ({ s, i })).sort((a, b) => b.s.score - a.s.score || a.i - b.i).map((x) => x.s).slice(0, MAX_CONNECTORS);
}

export interface Card {
  connector: string;
  name: string;
  /** The description's first sentence. */
  description: string;
  /** Arguments as a short schema: {"query":"string","limit?":"number"}. */
  args: string;
}

const firstSentence = (s: string | undefined, max = 160) => {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  const cut = /^(.+?[.!?])(\s|$)/.exec(one)?.[1] ?? one;
  return cut.length > max ? cut.slice(0, max - 1).trimEnd() + "…" : cut;
};

function argsOf(schema: ToolInfo["inputSchema"]): string {
  const props = (schema?.properties ?? {}) as Record<string, { type?: unknown; enum?: unknown[] }>;
  const required = new Set(schema?.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props).slice(0, 8)) {
    const type = Array.isArray(v?.enum) && v.enum.length <= 8 ? v.enum.map(String).join("|") : Array.isArray(v?.type) ? v.type.join("|") : String(v?.type ?? "any");
    out[required.has(k) ? k : `${k}?`] = type;
  }
  const s = JSON.stringify(out);
  return s.length > 400 ? s.slice(0, 399) + "…" : s;
}

/** The cards for the planner: these apps' tools, best twelve for these words. */
export function pickTools(utterance: string, byConnector: Array<{ def: ConnectorDef; tools: ToolInfo[] }>): Card[] {
  const said = new Set(keywords(utterance));
  const all: Array<{ card: Card; score: number; order: number }> = [];
  let order = 0;
  for (const { def, tools } of byConnector) {
    for (const t of tools) {
      let score = 0;
      for (const w of keywords(t.name)) if (said.has(w)) score += 3;
      for (const w of new Set(keywords(t.description ?? ""))) if (said.has(w)) score += 1;
      all.push({
        score, order: order++,
        card: { connector: def.id, name: t.name, description: firstSentence(t.description), args: argsOf(t.inputSchema) },
      });
    }
  }
  return all.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_TOOLS).map((x) => x.card);
}
