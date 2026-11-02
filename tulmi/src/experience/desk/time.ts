/**
 * Dates and times as the desk writes them, in the person's own time zone.
 */

import type { DeskContext } from "./context.js";

// ---- time and numbers ------------------------------------------------------------
const tzMs = (ctx: DeskContext) => Math.max(-840, Math.min(840, Math.round(ctx.tzOffsetMinutes ?? 0))) * 60_000;
export const local = (ctx: DeskContext, ms: number) => new Date(ms + tzMs(ctx));
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const dateLine = (d: Date) => `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
export function clock(d: Date): string {
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const HOUR_TICKS = ["12a", "6a", "12p", "6p", "12a"];
export const hourName = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;

export function dayHeading(ctx: DeskContext, iso: string): string {
  const d = local(ctx, Date.parse(iso)), now = local(ctx, Date.now());
  const k = dayKey(d);
  if (k === dayKey(now)) return "Today";
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return dateLine(d);
}

export const DAYPARTS = ["Morning", "Afternoon", "Evening", "Night"] as const;
