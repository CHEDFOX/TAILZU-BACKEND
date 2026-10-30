/**
 * WHAT A QUICK ACTION IS ABOUT: one id per thing a widget row, a notification's button or a Home Screen tap can act on, and the
 * one place that reads them back. Opaque to the apps (they only hand it back), checked here before anything is done with it.
 *
 *   job:<jobId>:<q>               a Xode job's question; <q> is the question's fingerprint, so an answer meant for one question
 *                                 never answers the next one the job asks
 *   task:<taskId>[:<approvalId>]  a connected app's call waiting for a yes; with the approval's id, only that approval
 *   stask:<spaceId>:<taskId>      a task or plan someone in a space gave this person
 *   thread:<threadId>             a chat (a reply goes there)
 *   item:<itemId>                 a thing shared in a space (opened, never acted on)
 *   msg:<threadId>:<messageId>    one message (opened at its chat)
 *
 * Pure: no imports but node's hash.
 */
import { createHash } from "node:crypto";

export type QuickItem =
  | { kind: "job"; jobId: string; q: string }
  | { kind: "task"; taskId: string; approvalId: string | null }
  | { kind: "stask"; spaceId: string; taskId: string }
  | { kind: "thread"; threadId: string }
  | { kind: "item"; itemId: string }
  | { kind: "msg"; threadId: string; messageId: string };

/** An id part: what the stores make (UUIDs, slugs, short codes). Nothing with a separator of ours, nothing long. */
const PART = /^[A-Za-z0-9_.-]{1,80}$/;

/** A question's fingerprint: eight hex characters of its words. */
export function questionMark(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 8);
}

export function itemId(i: QuickItem): string {
  switch (i.kind) {
    case "job": return `job:${i.jobId}:${i.q}`;
    case "task": return i.approvalId ? `task:${i.taskId}:${i.approvalId}` : `task:${i.taskId}`;
    case "stask": return `stask:${i.spaceId}:${i.taskId}`;
    case "thread": return `thread:${i.threadId}`;
    case "item": return `item:${i.itemId}`;
    case "msg": return `msg:${i.threadId}:${i.messageId}`;
  }
}

/** The id read back, or null for anything that is not exactly one of ours. */
export function parseItem(raw: unknown): QuickItem | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const [kind, a, b, ...rest] = raw.split(":");
  if (rest.length || !a || !PART.test(a) || (b !== undefined && !PART.test(b))) return null;
  switch (kind) {
    case "job": return b && /^[0-9a-f]{8}$/.test(b) ? { kind, jobId: a, q: b } : null;
    case "task": return { kind, taskId: a, approvalId: b ?? null };
    case "stask": return b ? { kind, spaceId: a, taskId: b } : null;
    case "thread": return b === undefined ? { kind, threadId: a } : null;
    case "item": return b === undefined ? { kind, itemId: a } : null;
    case "msg": return b ? { kind, threadId: a, messageId: b } : null;
    default: return null;
  }
}

/**
 * The item a push is about, from the data its sender gave it (push/engine.ts adds it as data.item, so a notification's button
 * knows what it answers). Null for a push no button acts on.
 */
export function pushItemOf(kind: string, data: Record<string, string> | undefined): string | null {
  const d = data ?? {};
  const ok = (v: string | undefined): v is string => typeof v === "string" && PART.test(v);
  if ((kind === "space_task" || kind === "space_plan") && ok(d.spaceId) && ok(d.taskId)) return itemId({ kind: "stask", spaceId: d.spaceId, taskId: d.taskId });
  if (kind === "space_message" && ok(d.threadId)) return itemId({ kind: "thread", threadId: d.threadId });
  if (kind === "approval" && ok(d.taskId)) return itemId({ kind: "task", taskId: d.taskId, approvalId: ok(d.approvalId) ? d.approvalId : null });
  return null;
}
