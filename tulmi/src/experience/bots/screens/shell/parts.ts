/**
 * What several of the Bots app shell's screens share.
 */

import type { Node, ActionRef, ActionSpec } from "../../../../../../shared/types/sdui.js";
import type { FeedRow } from "../../../../shell/feed.js";
import type { Mark } from "../../glyphs.js";
import {
  type LiveBot, type BotsCtx, botAvatar, botLook, statusMark, row, text, C, icon, grow, quietButton, FACE, box, whenEq, open,
  type NeedsItem, SCREENS,
} from "../../kit.js";

// ===================================================================== shared

/** A bot's idle line on its tile. */
export function idleLine(bot: LiveBot, client: "phone" | "desktop"): string {
  switch (bot.slug) {
    case "code": return "Fixes and ships your code";
    case "keybot": return client === "desktop" ? "Hold a key, speak, done" : "Your keyboard, everywhere";
    case "plan": return "Plans your day";
    case "travel": return "Plans your trips";
    // The Oracle and the mail bot, where they are set up (bot.builtin: a person's own bot of that name keeps its own line).
    case "oracle": if (bot.builtin) return "Reads your sky"; break;
    case "mail": if (bot.builtin) return "Answers your business mail"; break;
    default: break;
  }
  return bot.purpose.length > 40 ? bot.purpose.slice(0, 39).trimEnd() + "…" : bot.purpose;
}

/** A bot's name, from the live list (or the built-in words, or "Tailzu"). */
export function nameOf(ctx: BotsCtx, slug: string): string {
  const b = ctx.live.bots.find((x) => x.slug === slug);
  if (b) return b.name;
  return ({ tailzu: "X0", code: "Xode", keybot: "Keylessbord", plan: "Plan Ease", travel: "Travel bot", you: "You" } as Record<string, string>)[slug] ?? slug;
}

/** A bot's head (or its colour and icon), at a size. */
export function avatarOf(ctx: BotsCtx, slug: string, size = 30): Node {
  const b = ctx.live.bots.find((x) => x.slug === slug);
  return botAvatar(b ?? botLook(slug), size);
}

export function colorOf(ctx: BotsCtx, slug: string): string {
  return ctx.live.bots.find((x) => x.slug === slug)?.color ?? botLook(slug).color;
}

export const firstName = (ctx: BotsCtx): string => (ctx.user?.name ?? "").trim().split(/\s+/)[0] ?? "";

/** A row's status mark, a working one in its bot's colour. */
export function markOf(ctx: BotsCtx, mark: Mark, bot: string, size = 8): Node {
  return statusMark(mark, { size, ...(mark === "working" ? { color: colorOf(ctx, bot) } : {}) });
}

/** A key cap ("Fn", "Esc", "↵"), as the window's boards draw one. */
export function kbd(label: string): Node {
  return row([text(label, { size: 12, weight: 500, lineHeight: 16 })], {
    height: 26, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, borderColor: C.outline, backgroundColor: C.paper, justifyContent: "center", flexShrink: 0,
  });
}

/** The page's grey error line, with the way to try again. */
export function couldNot(what: string): Node {
  return row([
    icon("close", { size: 16, color: C.meta }),
    text(`Couldn't load ${what}.`, { size: 13, color: C.grey70, lineHeight: 18, style: { flexShrink: 1 } }),
    grow(),
    quietButton("Try again", { kind: "refresh" }, { size: "md" }),
  ], { gap: 8, paddingVertical: 4, paddingLeft: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line });
}

/** A text field in the kit's way (the ask bar's look, without its sending). */
export function field(path: string, placeholder: string, o: { size?: number; weight?: 400 | 500; onSubmit?: ActionRef; multiline?: boolean; returnKey?: string } = {}): Node {
  const size = o.size ?? 16;
  return {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, returnKeyType: o.returnKey ?? (o.onSubmit ? "search" : "default"), ...(o.multiline ? { multiline: true, minHeightMultiline: 64 } : {}),
    },
    ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: o.weight === 500 ? FACE.medium : FACE.regular,
      fontSize: size, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}

/** A filter chip with a bot's dot, selected by state (the window's Activity). */
export function dotChip(labelText: string, path: string, value: string, dot?: string): Node {
  return row([
    ...(dot ? [box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: dot })] : []),
    text(labelText, { size: 13, lineHeight: 17, style: { color: whenEq(path, value, C.paper, C.ink) } }),
  ], {
    gap: 7, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq(path, value, C.ink, C.line), backgroundColor: whenEq(path, value, C.ink, C.paper),
  }, { kind: "setState", path, value });
}

export const toast = (message: string, tone?: "error"): ActionSpec => ({ kind: "toast", message, ...(tone ? { tone } : {}) });

/** A feed row's place: the screen it opens, as an action. */
export const openRow = (r: FeedRow): ActionSpec | undefined => (r.open ? open(r.open.screenId, r.open.params) : undefined);

/** Where a decision opens: a job's page, or the approval. */
export function openNeed(n: NeedsItem): ActionSpec {
  const [kind, id] = n.id.split(":");
  return kind === "job" ? open(SCREENS.codeJob, { id }) : open(SCREENS.approve, { task: id });
}

/** The progress of a running job: its stages as short bars, done in ink, the current one in its colour. */
export function stageBars(at: number, of: number, color: string, o: { w?: number; h?: number; grow?: boolean } = {}): Node {
  return row(Array.from({ length: of }, (_, i) => box([], {
    ...(o.grow ? { flexGrow: 1, flexBasis: 0 } : { width: o.w ?? 14 }), height: o.h ?? 4, borderRadius: 3,
    backgroundColor: i < at ? C.ink : i === at ? color : C.track,
  })), { gap: o.grow ? 4 : 3, ...(o.grow ? { alignSelf: "stretch" } : {}) });
}
