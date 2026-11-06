/**
 * ONE ASK FROM ACTIVITY (bots.activity.item): what was asked, of which bot and when, a few numbers about it, and what to do next.
 *
 * An ask in Activity used to open Ask itself, its box filled in again, with the bots to hand it to, the live tools, the tries and
 * Photo, File, Screen and Paste: a whole new ask, when the person only tapped to look back at one. This page shows the ask and
 * three plain ways on: ask it again (the answer opens as Ask's does), the bot's own page, or take it off Activity.
 *
 * The numbers (how often this bot was asked, how often this very ask was) come from the same feed Activity draws (GET
 * /v1/shell/activity, the last seven days), so nothing new is kept for it.
 * The row's own words, bot and time ride along in its params, so the page still reads when the feed could not be read or the ask
 * is older than the feed. What a bot's work cost is never shown, as on every Activity row.
 */

import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { type FeedRow, clockOf, dayLabel } from "../../../../shell/feed.js";
import {
  type BotsCtx, ASK_PATH, C, SCREENS, answerParams, back, button, call, col, keptOffline, meta, open, page, primaryButton, quietButton, row,
  secondaryButton, seq, text, when,
} from "../../kit.js";
import { botRoute } from "../../ids.js";
import type { ActivityData } from "./activity.js";
import { avatarOf, nameOf, toast } from "./parts.js";

/** Bots with a page of their own to go on to (Tailzu, the front door, has none: Ask is its page). */
const hasPage = (slug: string): boolean => slug !== "tailzu" && slug !== "any";

/** The same ask, however it was spaced or cased. */
const same = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The row's own words: its title is the ask in curly quotes, cut; the params carry it whole (200 characters at most). */
const askedOf = (r: FeedRow | undefined, fallback: string): string => fallback || (r ? r.title.replace(/^“|”$/g, "") : "");

/** A number and what it counts, small. */
function tile(value: string, label: string): Node {
  return col([
    text(value, { size: 22, weight: 600, lineHeight: 28, lines: 1 }),
    meta(label, { size: 12, lines: 2 }),
  ], { gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.surface });
}

/** Ask it again, of the same bot: the answer opens on Ask as any ask's does; offline (a build with an outbox) it is kept to go later. */
function askAgain(ctx: BotsCtx, asked: string, slug: string, who: string): ActionSpec {
  return keptOffline(ctx.client, { message: "$state.again", bot: slug, who }, seq(
    { kind: "setState", path: "asking", value: true },
    call("POST", ASK_PATH, { message: "$state.again", bot: slug, device: ctx.client, mode: "text", tz: ctx.tzOffsetMinutes }, {
      assignTo: "asked",
      ok: seq({ kind: "setState", path: "asking", value: false }, { kind: "navigate", screenId: SCREENS.ask, params: answerParams(asked) }),
      fail: seq({ kind: "setState", path: "asking", value: false }, toast("Couldn't reach your bots. Try again.", "error")),
    }),
  ));
}

export function activityItem(ctx: BotsCtx, data: ActivityData | undefined): ReturnType<typeof page> {
  const desk = ctx.client === "desktop";
  const id = String(ctx.params.id ?? "");
  const rowId = id.startsWith("ask:") ? id : `ask:${id}`;
  const r = data?.rows.find((x) => x.id === rowId);
  const slug = String(ctx.params.bot ?? "") || r?.bot || "tailzu";
  const asked = askedOf(r, String(ctx.params.message ?? ""));
  const at = r?.at ?? (Number(ctx.params.at) || 0);
  const name = nameOf(ctx, slug);
  const now = data?.now ?? ctx.live.now;
  const tz = ctx.tzOffsetMinutes;

  // The numbers: how often this bot was asked, how often this very ask was (the feed's seven days, this one counted).
  const asks = (data?.rows ?? []).filter((x) => x.type === "ask");
  const ofBot = asks.filter((x) => x.bot === slug).length;
  const again = asks.filter((x) => x.bot === slug && same(askedOf(x, ""), asked)).length;
  // When is said under the bot's name: a time in a third of a phone's width is cut ("7:30 p…").
  const tiles: Node[] = [
    ...(data ? [
      tile(String(Math.max(ofBot, 1)), `${Math.max(ofBot, 1) === 1 ? "ask" : "asks"} to ${name} in 7 days`),
      again > 1 ? tile(`${again}×`, "you asked this in 7 days") : tile("First", "time you asked this"),
    ] : []),
  ];

  // Clearing is the list forgetting it (POST /v1/shell/activity/clear, as a row's ✕ does): the ask itself stays.
  const clear = call("POST", "/v1/shell/activity/clear", { id: rowId }, { ok: seq(toast("Cleared from Activity"), back()), fail: toast("Couldn't clear that. Try again.", "error") });
  const size = desk ? "md" as const : "lg" as const;
  const next: Node[] = [
    ...(asked ? [
      when({ falsy: "asking" }, primaryButton("Ask again", askAgain(ctx, asked, slug, name), { wide: !desk, size })),
      when({ truthy: "asking" }, button("Asking…", undefined, { kind: "disabled", wide: !desk, size })),
    ] : []),
    hasPage(slug)
      ? secondaryButton(`Open ${name}`, botRoute(slug), { wide: !desk, size })
      : secondaryButton("Ask something new", open(SCREENS.ask), { wide: !desk, size }),
    quietButton("Clear from Activity", clear, { wide: !desk, size: "md" }),
  ];

  return page(ctx, {
    back: true, backTitle: "Activity", nav: "activity", title: "Your ask", gap: desk ? 22 : 20, maxWidth: 640,
    state: { again: asked, asking: false },
    body: [
      row([
        avatarOf(ctx, slug, 44),
        col([
          text(name, { size: 16, weight: 600, lineHeight: 21, lines: 1 }),
          meta(at ? `You asked · ${dayLabel(at, now, tz)}, ${clockOf(at, tz)}` : "You asked", { lines: 1 }),
        ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12 }),
      text(asked ? `“${asked}”` : "This ask", { size: desk ? 24 : 22, weight: 600, lineHeight: desk ? 31 : 29, lines: 6 }),
      ...(tiles.length ? [row(tiles, { gap: 8, alignItems: "stretch" })] : []),
      desk ? row(next, { gap: 10, flexWrap: "wrap" }) : col(next, { gap: 10 }),
    ],
  });
}
