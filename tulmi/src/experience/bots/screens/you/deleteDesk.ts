/**
 * The You area's deleteDesk screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, listRow, row, botAvatar, botLook, card, text, C, open, SCREENS, sectionLabel, grow, col, listCard, page, meta,
  primaryButton, icon, button, divider, when, secondaryButton, back,
} from "../../kit.js";
import { type DeletionState, dayMonthOf, goneAt, GRACE_DAYS, daysStrip, keepAccount, scheduleDeletion } from "../accountGrace.js";
import { plural, glyph, G, dayMonth, couldNot, heading, columns, exportAction } from "./parts.js";

export interface AccountData {
  bots: Array<{ slug: string; name: string; colour: string; builtin: boolean }>;
  projects: string[];
  notes: number;
  keys: number;
  plan: { active: boolean; store: string | null; renews: boolean; until: number | null };
  exportUrl: string | null;
}

// ===================================================================== bots.delete-account

// Asking sets a date seven days out and signs the person out; signing in before it shows the date and Keep my account (accountGrace.ts).

/** What the page reads: what the account holds (GET /v1/you/account), and whether a date is set (GET /v1/account/deletion). */
export interface DeleteData { account: AccountData | undefined; deletion: DeletionState | undefined }

export function goesAway(ctx: BotsCtx, d: AccountData): Node[] {
  const own = d.bots.filter((b) => !b.builtin);
  return [
    listRow({
      label: plural(d.bots.length, "bot"), chevron: false,
      right: row(d.bots.slice(0, 5).map((b) => botAvatar(botLook(b.slug, b.colour), 20)), { gap: 3 }),
      ...(ctx.client === "desktop" ? { sub: d.bots.map((b) => b.name).join(", ") } : own.length ? { sub: `${plural(own.length, "of your own")}` } : {}),
    }),
    listRow({ label: plural(d.projects.length, "project"), value: d.projects.length ? (d.projects.length > 1 ? `${d.projects[0]} and ${d.projects.length - 1} more` : d.projects[0]!) : "None" }),
    listRow({ label: plural(d.notes, "note"), value: "and every chat" }),
    // The bots stop the day they ask, keys too (you/deletion.ts isLeaving); Keep my account starts them again.
    listRow({ label: plural(d.keys, "key"), value: d.keys ? "stop working right away" : "None" }),
  ];
}
export const planWarning = (ctx: BotsCtx, d: AccountData): Node[] =>
  d.plan.active && d.plan.renews ? [card([
    row([glyph(G.never, 16), text(`Cancel Pro first. You're on Pro, and it would still renew${d.plan.until ? ` on ${dayMonth(ctx, d.plan.until)}` : ""}.`, { size: 13, weight: 500, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
    text("Plan and billing", { size: 13, weight: 500, style: { textDecorationLine: "underline" } }),
  ], { gap: 8, padding: 14, style: { backgroundColor: C.surface, borderWidth: 0 }, onPress: open(SCREENS.billing) })] : [];

export function deleteDesk(ctx: BotsCtx, data: DeleteData | undefined) {
  const d = data?.account, del = data?.deletion, s = del?.scheduled;
  const gone = dayMonthOf(ctx, goneAt(ctx, del));
  const days = card([
    row([sectionLabel(s ? "Until then, nothing is lost" : `${GRACE_DAYS} days to change your mind`), grow(), text(`Gone for good, ${gone}`, { size: 13, weight: 600, lineHeight: 18 })], { gap: 10 }),
    daysStrip(ctx, s?.requestedAt ?? ctx.live.now, { labels: true }),
    text(s ? "Everything is kept, and your bots are stopped. Keep your account and they start again."
      : `You have ${GRACE_DAYS} days to change your mind. Sign in before ${gone} and everything comes back as it was.`, { size: 14, lineHeight: 20 }),
  ], { padding: 20, gap: 12 });
  const left = [
    ...(d ? [col([sectionLabel(s ? "What goes then" : "What goes away"), listCard(goesAway(ctx, d))], { gap: 8 })] : [couldNot("what your account holds")]),
    days,
  ];
  if (s) {
    return page(ctx, {
      back: true, backTitle: "You", nav: "you", title: "Delete account", maxWidth: 1040, gap: 20,
      body: [
        heading(ctx, "Delete account", `Your account will be deleted on ${gone}.`),
        columns(left, [card([
          sectionLabel("Changed your mind?"),
          meta("Keep your account and your bots and keys work again. Nothing is lost.", { size: 13, lineHeight: 18 }),
          primaryButton("Keep my account", keepAccount, { wide: true, size: "md" }),
        ], { padding: 20, gap: 12 })]),
      ],
    });
  }
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Delete account", maxWidth: 1040, gap: 20, state: { sure: false },
    body: [
      heading(ctx, "Delete account", "Here is exactly what happens, so there are no surprises."),
      columns(left, [
        card([
          sectionLabel("Before you go"),
          ...(d ? planWarning(ctx, d) : []),
          row([icon("check", { size: 14 }), meta("Want a copy first? Chats, notes, files and job steps, in one file.", { size: 13, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" }),
          button("Download my data", exportAction(d?.exportUrl ?? null), { kind: "secondary", size: "md" }),
          divider(),
          when({ falsy: "sure" }, primaryButton("Delete account", { kind: "setState", path: "sure", value: true }, { wide: true, size: "md" })),
          when({ truthy: "sure" }, col([
            text(`Delete your account on ${gone}?`, { size: 14, weight: 600, align: "center" }),
            primaryButton("Yes, delete my account", scheduleDeletion(gone), { wide: true, size: "md" }),
          ], { gap: 8 })),
          secondaryButton("Keep my account", back(), { wide: true, size: "md" }),
        ], { padding: 20, gap: 12 }),
      ]),
    ],
  });
}
