/**
 * WHAT THE ONE BOX UNDERSTANDS OF WHAT COMES IN (planBox.ts BOX_SLOTS; docs/plan-ease.md "The one box"). Rules only:
 *
 *   capture  pasted words that are a notice, not a line: a circular or a bill SMS (several lines, or a date with an amount and enough
 *            words around them). It becomes the capture card (planCapture.ts), which the screen opens
 *   link     "link my work calendar": the link page opens (the offer card is asked only once, so this is how it is found again)
 *   seen     a desktop's "add this" (its addThis.js): the words came with what was on the screen (`seen`: the selection, the page in
 *            front, or the window's text). One clear line is added as the box adds any line; a notice with several things in it
 *            goes to capture, with its consent gate and Plan Ease's budget, as a shared circular does. Its slot is planBox.ts's SEEN,
 *            first of all when `seen` is there; these are its parts
 *
 * The bill in a line ("Electricity 2140 due 14th") is planDue.ts's slot; a plain line is the item slot's.
 */
import type { BoxReply, BoxSlot } from "./planBox.js";
import { amountOf } from "./planDue.js";
import { planCapture } from "./planCapture.js";
import { CAPTURE_SCREEN, LINK_SCREEN } from "./planInCards.js";
import { planOn } from "./planSwitch.js";

const DATE_WORD = /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|due date|last date|(?:mon|tue|wed|thu|fri|sat|sun)\w*day)\b/i;

/** Several lines, or a long line with a date and an amount (a bill SMS): a notice, not a line to add. */
export function looksPasted(words: string): boolean {
  const s = words.trim();
  const lines = s.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3 && s.length >= 60) return true;
  return s.length >= 90 && amountOf(s) !== null && DATE_WORD.test(s);
}

export const CAPTURE_SLOT: BoxSlot<{ words: string }> = {
  slot: "capture", step: 3,
  read(words) {
    if (!planOn("capture") || !planCapture() || !looksPasted(words)) return null;
    return { words };
  },
  async run(r, _w, ctx) {
    const v = await planCapture()!.fromWords(ctx.userId, r.words, ctx.tz);
    return { slot: "capture", kind: "capture", line: v.title, capture: v.id, open: { screen: CAPTURE_SCREEN, params: { id: v.id } } };
  },
};

export const LINK_SLOT: BoxSlot<true> = {
  slot: "link", step: 2,
  read(words) {
    if (!planOn("links")) return null;
    const s = words.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    return /^(?:please )?(?:link|connect|add|show)(?: my)?(?: work| office| google| outlook| icloud| iphone)? calendar(?: here)?$/.test(s) ? true : null;
  },
  async run() {
    return { slot: "link", kind: "said", line: "Paste your calendar's link to see your meetings here.", open: { screen: LINK_SCREEN } };
  },
};

// ------------------------------------------------------------------ "add this" from a desktop

/** What a desktop's "add this" carried with the words (its addThis.js seenOf): never kept, never in memory, read only here. */
export interface Seen { from: "selection" | "page" | "screen"; text: string; app?: string; title?: string; where?: string }

export const SEEN_TEXT_MAX = 12_000;
const SEEN_FROM = new Set(["selection", "page", "screen"]);
const shortLine = (v: unknown, max: number): string | undefined => {
  const t = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  return t || undefined;
};

/** The body's `seen`, checked, or null. Its lines are kept: a circular's lines are its items. */
export function seenOf(v: unknown): Seen | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.from !== "string" || !SEEN_FROM.has(o.from) || typeof o.text !== "string") return null;
  const text = o.text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim().slice(0, SEEN_TEXT_MAX);
  if (!text) return null;
  const app = shortLine(o.app, 80), title = shortLine(o.title, 200), where = shortLine(o.where, 200);
  return { from: o.from as Seen["from"], text, ...(app ? { app } : {}), ...(title ? { title } : {}), ...(where ? { where } : {}) };
}

/** When the spoken words say it is: "on Friday at 5 pm" of "remind me about this on Friday at 5 pm". */
const WHEN = /\b(?:(?:on|at|by|this|next|every)\s+)?(?:today|tonight|tomorrow|tmrw|kal|parso|(?:mon|tues?|wed(?:nes)?|thu(?:r|rs)?|fri|sat(?:ur)?|sun)(?:day)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|morning|afternoon|evening|night|every\s+(?:day|week|month))\b/gi;

/**
 * The one clear thing that was seen, as a line the box reads ("Team offsite 14 Nov 10 am" plus "on Friday" from the words), or null
 * when it is a notice with several things in it (several lines, or long): capture reads that.
 */
export function seenLine(seen: Seen, words: string): string | null {
  const lines = seen.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 1 || lines[0]!.length > 300 || looksPasted(seen.text)) return null;
  const when = (words.match(WHEN) ?? []).join(" ");
  const remind = /^\s*(?:please\s+)?remind me\b/i.test(words) ? "remind me " : "";
  return `${remind}${lines[0]}${when ? ` ${when}` : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * A notice that was seen: the capture card, read with the person's yes to AI and on Plan Ease's budget; without that yes, by the rules
 * at once. What was seen is never stored either way (planCapture.ts look's `seen`). Null with capture off, or nothing found.
 */
export async function seenCapture(userId: string, seen: Seen, tz: number): Promise<BoxReply | null> {
  const c = planCapture();
  if (!planOn("capture") || !c) return null;
  const r = await c.look(userId, { text: seen.text, from: "plan", tz, seen: true });
  if (!("capture" in r)) return null;
  return { slot: "seen", kind: "capture", line: r.capture.title, capture: r.capture.id, open: { screen: CAPTURE_SCREEN, params: { id: r.capture.id } } };
}
