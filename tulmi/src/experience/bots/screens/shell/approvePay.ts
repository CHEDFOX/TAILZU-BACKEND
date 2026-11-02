/**
 * The Bots app shell's approvePay screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { upiOf } from "../../../../shell/parse.js";
import { qrOf, qrPath } from "../../../../shell/qr.js";
import type { Mark } from "../../glyphs.js";
import {
  box, text, C, type BotsCtx, row, labelled, icon, back, statusMark, call, seq, toTab, mono, grow, page, blip, col, title, meta,
  sectionLabel, divider, shapes, secondaryButton, quietButton, primaryButton, when,
} from "../../kit.js";
import { avatarOf, nameOf, toast, firstName } from "./parts.js";

/** A step number in a grey circle (How a bot works, Pay on your phone). */
export function stepDot(n: number): Node {
  return box([text(String(n), { size: 12, weight: 600, lineHeight: 15, align: "center" })], {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

export function approveTop(ctx: BotsCtx, slug: string, mark: Mark | null): Node {
  const desk = ctx.client === "desktop";
  return row([
    labelled(box([icon("back", { size: desk ? 22 : 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
    avatarOf(ctx, slug, desk ? 26 : 30),
    text(nameOf(ctx, slug), desk ? { size: 14, weight: 600, lineHeight: 18 } : { size: 13, color: C.grey70, lineHeight: 17 }),
    ...(mark ? [row([statusMark(mark), ...(desk ? [text(mark === "needs" ? "Needs you" : "Done", { size: 13, color: C.grey70, lineHeight: 17 })] : [])], { gap: 6, marginLeft: desk ? 6 : 0 })] : []),
  ], { gap: 8 });
}

/** "Pay Fresh Basket for this week's groceries?" No amount: the person types it in their UPI app. */
const payQuestion = (u: { name: string; note: string }) =>
  `Pay ${u.name}${u.note ? ` for ${u.note.charAt(0).toLowerCase()}${u.note.slice(1)}` : ""}?`;

export function approvePay(ctx: BotsCtx, link: string) {
  const u = upiOf(link)!;
  const slug = String(ctx.params.bot ?? "tailzu");
  const who = nameOf(ctx, slug);
  const paid = call("POST", "/v1/shell/receipts", { upi: u.link, bot: slug, title: u.note || `Payment to ${u.name}` }, {
    ok: seq(toast("Receipt saved to Activity"), toTab("activity")),
    fail: toast("Couldn't save the receipt. Try again.", "error"),
  });
  const openUpi = seq({ kind: "openUrl", url: u.link, external: true }, { kind: "setState", path: "opened", value: true });
  const lines: Array<[string, Node]> = [
    ["Paying", text(u.name, { size: 14, lineHeight: 19, color: C.meta, align: "right" })],
    ["UPI ID", mono(u.vpa, { size: 12 })],
    ...(u.note ? [["For", text(u.note, { size: 14, lineHeight: 19, color: C.meta, align: "right", lines: 2, style: { flexShrink: 1 } })] as [string, Node]] : []),
  ];
  const lineRow = ([a, b]: [string, Node]) => row([text(a, { size: 14, lineHeight: 19 }), grow(), b], { gap: 12 });
  const total = row([text("Amount", { size: 15, weight: 600, lineHeight: 20 }), grow(), text("You type it in UPI", { size: 14, lineHeight: 19, color: C.meta, align: "right" })]);
  const fine = `You type the amount and press pay in your UPI app. ${who} never pays on its own.`;

  if (ctx.client === "desktop") {
    const qr = qrOf(u.link);
    const d = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000);
    const day = `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
    const name = firstName(ctx);
    return page(ctx, {
      title: "Approve", gap: 18, maxWidth: 1100, state: { opened: false },
      body: [
        approveTop(ctx, slug, "needs"),
        row([blip("needs", 84), col([title(payQuestion(u)), meta(`${u.vpa}${u.note ? ` · ${u.note}` : ""}`, { size: 14, lineHeight: 19 })], { gap: 6, flexShrink: 1 })], { gap: 18 }),
        row([
          col([
            row([sectionLabel("What you're paying for"), grow()], { paddingTop: 12, paddingBottom: 6 }),
            ...lines.map((l) => box([lineRow(l)], { paddingVertical: 10 })),
            divider(), box([total], { paddingTop: 14, paddingBottom: 10 }),
            meta(`${who} filled this in. Check it before you pay.`),
          ], { flexGrow: 1.2, flexBasis: 0, minWidth: 0, paddingTop: 6, paddingHorizontal: 18, paddingBottom: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
          col([
            sectionLabel("Receipt preview"),
            box([col([
              text(u.name, { size: 14, weight: 600, lineHeight: 19 }),
              mono(`${name ? `For ${name} · ` : ""}${day}`, { size: 11.5, boxed: false, color: C.grey70 }),
              ...(u.note ? [mono(u.note, { size: 11.5, boxed: false, color: C.grey70 })] : []),
              mono("Paid by UPI · ref after you pay", { size: 11.5, boxed: false, color: C.meta }),
            ], { gap: 6, backgroundColor: C.paper, borderRadius: 8, padding: 16 })], { backgroundColor: C.surface, borderRadius: 18, padding: 14 }),
            row([icon("check", { size: 14, color: C.meta }), meta("Receipt saves to Activity after you pay")], { gap: 8 }),
          ], { flexGrow: 0.95, flexBasis: 0, minWidth: 0, gap: 10 }),
          col([
            sectionLabel("Pay on your phone"),
            ...(qr ? [box([shapes([{ d: qrPath(qr), fill: C.ink }], { viewBox: `0 0 ${qr.size + 8} ${qr.size + 8}`, size: 150, label: "UPI payment code" })], {
              alignSelf: "center", padding: 6, borderRadius: 14, borderWidth: 1, borderColor: C.divider, backgroundColor: C.paper,
            })] : []),
            col([
              ...[qr ? "Scan with your phone's camera" : "Open X0 Bot on your phone", `UPI opens on ${u.name}`, "You type the amount and press pay"]
                .map((s, i) => row([stepDot(i + 1), text(s, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10 })),
            ], { gap: 9 }),
            row([statusMark("waiting"), meta("Waiting for you · then tell us you paid")], { gap: 8 }),
            row([secondaryButton("Not now", back(), { size: "md" }), quietButton("I've paid", paid, { size: "md" })], { gap: 12, flexWrap: "wrap" }),
          ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 14, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
        ], { gap: 20, alignItems: "flex-start" }),
        row([icon("lock", { size: 16, color: C.grey70 }), text(fine, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8 }),
      ],
    });
  }

  return page(ctx, {
    title: "Approve", gap: 14, state: { opened: false },
    body: [
      approveTop(ctx, slug, "needs"),
      blip("needs", 140),
      col([sectionLabel("Needs you"), text(payQuestion(u), { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { gap: 6 }),
      col([
        col(lines.map(lineRow), { gap: 8, paddingVertical: 14, paddingHorizontal: 16 }),
        divider(),
        box([total], { paddingVertical: 12, paddingHorizontal: 16 }),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line }),
      row([icon("check", { size: 14, color: C.meta }), meta("Receipt saves to Activity after you pay", { size: 13 })], { gap: 8 }),
    ],
    footer: [
      primaryButton("Open UPI to pay", openUpi, { wide: true }),
      when({ truthy: "opened" }, secondaryButton("I've paid", paid, { wide: true })),
      when({ falsy: "opened" }, secondaryButton("Not now", back(), { wide: true })),
      meta(fine, { align: "center" }),
    ],
  });
}
