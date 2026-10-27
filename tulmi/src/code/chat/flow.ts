/**
 * A FLOW, DRAWN FROM THE IMPORT GRAPH: MERMAID BUILT BY CODE, FOR NOTHING.
 *
 * "How does login work" is answered in words, and the picture that goes beside it (the front door's visual plan says a diagram explains it faster) does
 * not need a model: the project brain already knows which file imports which. From the files the question is about, this follows the graph a hop or
 * two each way (who calls the entry, what it calls), keeps the files that matter (not tests, not secrets), and draws them as a `flowchart TD`
 * whose arrows read "uses". Each box is a file and the most telling thing it exports.
 *
 * At most 10 boxes (the diagram role's own limit is 12). Fewer than two boxes is no flow, and nothing is drawn. Pure over the brain's reads.
 */
import type { BrainHandle } from "../project/index.js";
import { isSecretPath, isTestPath } from "../project/lang.js";

export type FlowBrain = Pick<BrainHandle, "file" | "neighbors">;

const NODES_MAX = 10;
const UP_MAX = 2;
const DOWN_PER_NODE = 3;

/** A label as Mermaid takes it inside quotes: no quotes, brackets or breaks; short. */
export function boxLabel(s: string, max = 40): string {
  const t = s.replace(/["\n\r[\]{}()<>|`#;]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t || "file";
}

/** The most telling thing a file exports: a route, then a component, a class, a function. */
function headline(f: { symbols: Array<{ name: string; kind: string; exported?: boolean; method?: string; path?: string }> }): string {
  const order = ["route", "component", "class", "function", "method", "const", "type", "interface", "enum"];
  const syms = f.symbols.filter((s) => s.kind !== "env" && s.kind !== "entry" && (s.exported !== false || s.kind === "route"));
  for (const kind of order) {
    const s = syms.find((x) => x.kind === kind);
    if (s) return kind === "route" ? `${s.method ?? "ANY"} ${s.path ?? s.name}` : s.name;
  }
  return "";
}

const usable = (p: string): boolean => !isTestPath(p) && !isSecretPath(p);

/**
 * Mermaid text for the flow around `seeds` (best first), or null when the graph shows fewer than two files. `weights` can say which files matter
 * more (a locate score); the rest are ranked by how central the brain says they are.
 */
export async function flowDiagram(brain: FlowBrain, seeds: readonly string[], o: { max?: number } = {}): Promise<string | null> {
  const max = Math.min(NODES_MAX, o.max ?? NODES_MAX);
  const order: string[] = [];
  const edges: Array<[string, string]> = [];
  const add = (p: string): boolean => {
    if (order.includes(p)) return true;
    if (order.length >= max || !usable(p)) return false;
    order.push(p);
    return true;
  };
  const seeded = seeds.filter(usable).slice(0, 3);
  for (const s of seeded) add(s);
  if (!order.length) return null;

  // Who calls the first file: one hop up, so the flow starts where a request comes in.
  const first = seeded[0]!;
  const near = await brain.neighbors(first).catch(() => ({ imports: [] as string[], importedBy: [] as string[] }));
  const ranked = async (paths: readonly string[]): Promise<string[]> => {
    const rows = await Promise.all(paths.filter(usable).map(async (p) => ({ p, rank: (await brain.file(p).catch(() => null))?.rank ?? 0 })));
    return rows.sort((a, b) => b.rank - a.rank || (a.p < b.p ? -1 : 1)).map((r) => r.p);
  };
  for (const up of (await ranked(near.importedBy)).slice(0, UP_MAX)) if (add(up)) edges.push([up, first]);

  // What the files call, a hop or two down, best connected first.
  let layer = [...order];
  for (let depth = 0; depth < 2 && order.length < max; depth += 1) {
    const next: string[] = [];
    for (const from of layer) {
      const row = await brain.file(from).catch(() => null);
      for (const to of (await ranked(row?.imports ?? [])).slice(0, DOWN_PER_NODE)) {
        if (!order.includes(to) && !add(to)) continue;
        if (!edges.some(([a, b]) => a === from && b === to)) edges.push([from, to]);
        if (!next.includes(to)) next.push(to);
      }
    }
    layer = next;
  }
  // The seeds that are linked to each other, whichever way, are shown linked.
  for (const a of order) {
    const row = await brain.file(a).catch(() => null);
    for (const b of row?.imports ?? []) if (order.includes(b) && !edges.some(([x, y]) => x === a && y === b)) edges.push([a, b]);
  }
  if (order.length < 2 || !edges.length) return null;

  const ids = new Map(order.map((p, i) => [p, `N${i + 1}`]));
  const boxes: string[] = [];
  for (const p of order) {
    const row = await brain.file(p).catch(() => null);
    const what = row ? headline(row) : "";
    boxes.push(`  ${ids.get(p)}["${boxLabel(p.split("/").slice(-2).join("/"))}${what ? `<br/>${boxLabel(what, 30)}` : ""}"]`);
  }
  return ["flowchart TD", ...boxes, ...edges.map(([a, b]) => `  ${ids.get(a)} --> ${ids.get(b)}`)].join("\n");
}
