/**
 * APPLYING A PASS TO THE BRIEF (docs/brief.md): the pure half, with no model, no store and no clock of its own.
 *
 * Everything a model says about the document comes through here, so one place decides what a document may hold: which parts
 * are real, what a part may be called, how many there are, what order they are drawn in, and which blocks survive — the last
 * by the same checker that guards what a bot draws under its words (`show/check.ts`), so a brief can hold nothing a chat
 * could not.
 *
 * It is a replace, never a merge: a part the pass names is written whole, a part it did not name is left exactly as it was,
 * and `remove` takes one away. That is what keeps a document people are reading from shuffling under them.
 */

import { checkShown } from "../show/check.js";
import type { Block } from "../show/types.js";
import { BRIEF_LIMITS as L, PART_KINDS, PART_ORDER, type Brief, type BriefEdit, type BriefPart, type PartKind } from "./types.js";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const kindOf = (v: unknown): PartKind => (PART_KINDS as readonly string[]).includes(String(v)) ? (v as PartKind) : "other";

/**
 * An id of this document's own: lowercase letters, digits and a dash. The model names its parts ("flow", "q3-numbers"), and
 * the name is only ever compared with another of its own, so anything else is made into one rather than refused.
 */
export function partId(v: unknown, fallback: string): string {
  const raw = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  const id = str(raw, L.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}

/** The blocks of one part, through the drawing checker. Nothing in a brief is a link the meeting did not carry, as nothing in a chat is. */
function blocksOf(raw: unknown): Block[] {
  const shown = checkShown({ blocks: Array.isArray(raw) ? raw : [] }, { seen: { has: () => false } });
  return shown ? shown.blocks : [];
}

/**
 * The document after one pass. `now` is the clock's, `v` the pass's number (the brief's own, up one when anything changed).
 * Nothing is thrown: a pass that says nothing usable leaves the brief it was given, and `changed` says so.
 */
export function applyEdit(brief: Brief, edit: BriefEdit | null | undefined, now: number): { brief: Brief; changed: boolean; say: string } {
  const parts = brief.parts.map((p) => ({ ...p }));
  const v = brief.v + 1;
  let changed = false;

  // Taken away first, so a pass can replace one part with another under a new name without passing the cap on the way.
  const remove = Array.isArray(edit?.remove) ? edit.remove.map((x) => partId(x, "")) : [];
  for (const id of remove) {
    const at = parts.findIndex((p) => p.id === id);
    if (at >= 0) { parts.splice(at, 1); changed = true; }
  }

  const written = Array.isArray(edit?.parts) ? edit.parts.slice(0, L.perPass) : [];
  for (const [i, raw] of written.entries()) {
    const kind = kindOf(raw?.kind);
    const id = partId(raw?.id, `${kind}-${i + 1}`);
    const blocks = blocksOf(raw?.blocks);
    const at = parts.findIndex((p) => p.id === id);
    // A part with nothing left to draw is a part gone, not an empty heading.
    if (!blocks.length) {
      if (at >= 0) { parts.splice(at, 1); changed = true; }
      continue;
    }
    const part: BriefPart = { id, kind, title: str(raw?.title, L.title), blocks, at: now, v };
    if (at >= 0) {
      // The same blocks again is not a change: a pass that re-states what it already wrote must not make the document look new.
      if (JSON.stringify(parts[at]!.blocks) === JSON.stringify(blocks) && parts[at]!.title === part.title && parts[at]!.kind === part.kind) continue;
      parts[at] = part;
    } else {
      parts.push(part);
    }
    changed = true;
  }

  if (!changed) return { brief, changed: false, say: "" };

  // Full: the oldest of the parts that are nobody's point ("other") goes, then the oldest picture, then simply the oldest —
  // but never the one just written.
  while (parts.length > L.parts) {
    const fresh = new Set(written.map((raw, i) => partId(raw?.id, `${kindOf(raw?.kind)}-${i + 1}`)));
    const droppable = parts.filter((p) => !fresh.has(p.id));
    if (!droppable.length) break;
    const pick = droppable.find((p) => p.kind === "other") ?? droppable.find((p) => p.kind === "picture") ?? droppable[0]!;
    parts.splice(parts.indexOf(pick), 1);
  }

  parts.sort((a, b) => (PART_ORDER[a.kind] - PART_ORDER[b.kind]) || (a.at - b.at));
  return { brief: { v, parts, at: now }, changed: true, say: str(edit?.say, L.say) };
}

/** The brief as it is read back from a row: a kept document is data too, so every block is checked again. */
export function keptBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { v?: unknown; parts?: unknown; at?: unknown };
  if (!Array.isArray(o.parts)) return null;
  const parts: BriefPart[] = [];
  for (const [i, p] of o.parts.slice(0, L.parts).entries()) {
    if (!p || typeof p !== "object") continue;
    const q = p as { id?: unknown; kind?: unknown; title?: unknown; blocks?: unknown; at?: unknown; v?: unknown };
    const blocks = blocksOf(q.blocks);
    if (!blocks.length) continue;
    parts.push({
      id: partId(q.id, `part-${i + 1}`), kind: kindOf(q.kind), title: str(q.title, L.title), blocks,
      at: typeof q.at === "number" ? q.at : 0, v: typeof q.v === "number" ? q.v : 0,
    });
  }
  if (!parts.length) return null;
  return { v: typeof o.v === "number" ? o.v : 0, parts, at: typeof o.at === "number" ? o.at : 0 };
}
