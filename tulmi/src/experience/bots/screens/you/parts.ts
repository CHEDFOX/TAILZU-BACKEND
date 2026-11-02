/**
 * What several of the You area's screens share.
 */

import type { Node, ActionSpec, ActionRef } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botLook, C, shapes, row, col, title, meta, card, body, seq } from "../../kit.js";

// ===================================================================== what the routes answer (routes/bots/botsYou.ts)
export interface Settings {
  monthLimitPaise: number;
  stopAtLimit: boolean;
  notify: { done: "quiet" | "ping"; summary: boolean; summaryAt: number; quiet: boolean; quietFrom: number; quietTo: number; botsOff: string[] };
  privacy: { screenPictures: "ask" | "allow"; personalise?: boolean };
}

// ===================================================================== small things
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DAY_MS = 86_400_000;

export const local = (ctx: BotsCtx, t: number) => new Date(t + ctx.tzOffsetMinutes * 60_000);
/** "14 Oct" */
export const dayMonth = (ctx: BotsCtx, t: number) => { const d = local(ctx, t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** "9:00 pm", "11 pm" */
export function clock(minute: number, short = false): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60, h12 = h % 12 === 0 ? 12 : h % 12, ap = h < 12 ? "am" : "pm";
  return short && m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** A bot by slug: the live one (name, colour, head), or Tailzu itself. */
export function botOf(ctx: BotsCtx, slug: string) {
  const b = ctx.live.bots.find((x) => x.slug === slug);
  if (b) return { slug, name: b.name, short: b.name.replace(/ bot$/i, ""), look: b };
  const look = botLook(slug);
  const name = slug === "tailzu" ? "X0" : slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { slug, name, short: name.replace(/ bot$/i, ""), look };
}

/** A line icon from a path of our own (24 grid), for the few the kit's set has not got. */
export const glyph = (d: string, size = 20, color: string = C.ink): Node =>
  shapes([{ d, stroke: color, strokeWidth: 1.9, linecap: "round", linejoin: "round" }], { size });
export const G = {
  download: "M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13",
  bell: "M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14zM10 20.5a2 2 0 0 0 4 0",
  moon: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z",
  globe: "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM3.5 12h17M12 3.5c2.4 2.4 3.5 5.4 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.4-3.5-8.5s1.1-6.1 3.5-8.5z",
  mail: "M3.5 6.5h17v11h-17zM3.5 7.5l8.5 6 8.5-6",
  never: "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM6 6l12 12",
  card: "M3 6.5h18v11H3zM3 10h18M7 14.5h3",
  receipt: "M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8h6M9 11.5h6",
  sliders: "M5 7h14M5 17h14M9 4.5v5M15 14.5v5",
  rules: "M5 6.5h14M5 12h14M5 17.5h9",
  box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  battery: "M3.5 8h15v8h-15zM18.5 10.5h2v3h-2M6 10.5v3",
};

export const toast = (message: string): ActionSpec => ({ kind: "toast", message });
export const refresh: ActionSpec = { kind: "refresh" };
export const oops = (what = "save that"): ActionSpec => ({ kind: "toast", message: `Couldn't ${what}. Try again.`, tone: "error" });

export const openUrl = (url: string): ActionSpec => ({ kind: "openUrl", url });

/** The window's two columns: the main one, and a narrower one beside it. */
export const columns = (left: Node[], right: Node[], o: { gap?: number; rightWidth?: number } = {}): Node =>
  row([
    col(left, { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 18 }),
    col(right, { width: o.rightWidth ?? 340, flexShrink: 0, gap: 18 }),
  ], { alignItems: "flex-start", gap: o.gap ?? 20 });

/** A page's heading: the title, and a line under it. */
export const heading = (ctx: BotsCtx, t: string, sub?: string): Node =>
  col([title(t, ctx.client === "desktop" ? { size: 28, lineHeight: 34 } : {}), ...(sub ? [meta(sub, { size: 14, lineHeight: 19, color: C.grey70 })] : [])], { gap: 4 });

/** Something the screen could not read: says so, plainly. */
export const couldNot = (what: string): Node => card([body(`Couldn't load ${what}.`, { size: 14 }), meta("Pull down to try again, or come back in a moment.", { size: 13 })], { gap: 4 });

export const exportAction = (url: string | null): ActionRef => (url ? seq(openUrl(url), toast("Your data is downloading")) : toast("Download isn't available right now. Try again later."));
