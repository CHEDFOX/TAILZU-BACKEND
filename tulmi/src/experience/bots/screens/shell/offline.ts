/**
 * The Bots app shell's offline screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { clockOf } from "../../../../shell/feed.js";
import {
  shapes, type BotsCtx, botLook, row, C, text, col, botAvatar, meta, box, icon, botRoute, statusMark, when, quietButton, call, seq,
  roundButton, hasOutbox, page, title, grow, sectionLabel, tailzuMark,
} from "../../kit.js";
import { outboxSection } from "../outbox.js";
import { kbd, avatarOf, toast, field, firstName } from "./parts.js";

// ===================================================================== offline

/** No connection: the wifi arcs with a line through them. */
function wifiOff(size: number, color: string): Node {
  return shapes([
    { d: "M2.5 8.8a14 14 0 0 1 6.2-3.1M12.6 5.4a14 14 0 0 1 8.9 3.4M5.6 12.2a9 9 0 0 1 4.3-2.2M15.6 10.6a9 9 0 0 1 2.8 1.6M8.9 15.6a4.5 4.5 0 0 1 6.2 0M12 19.2h.01M3.5 3.5l17 17", stroke: color, strokeWidth: 1.9, linecap: "round" },
  ], { size, label: "Offline" });
}

export function offline(ctx: BotsCtx) {
  const live = ctx.live;
  const code = live.bots.find((b) => b.slug === "code");
  const keybot = live.bots.find((b) => b.slug === "keybot") ?? botLook("keybot");
  const last = clockOf(live.now, ctx.tzOffsetMinutes);
  const desk = ctx.client === "desktop";
  const pill = row([wifiOff(14, C.grey70), text("Offline", { size: 12, weight: 500, color: C.grey70, lineHeight: 16 })], {
    gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: C.surface,
  });
  const keyCard = col([
    row([
      botAvatar(keybot, 38),
      col([text("Keylessbord · basic mode", { size: 15, weight: 600, lineHeight: 20 }), meta(`Speak and it types, right on this ${desk ? "computer" : "phone"}`)], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      box([icon("mic", { size: 18, color: C.paper })], { width: 40, height: 34, borderRadius: 9, backgroundColor: botLook("keybot").color, alignItems: "center", justifyContent: "center" }),
    ], { gap: 12 }),
    col([
      row([text("Works now", { size: 13, color: C.meta, lineHeight: 18, style: { width: 120 } }), text("Dictation · English, Hindi", { size: 13, lineHeight: 18 })], { gap: 12 }),
      row([text("When you're back", { size: 13, color: C.meta, lineHeight: 18, style: { width: 120 } }), text("Clean-up, rewrite, translate", { size: 13, lineHeight: 18 })], { gap: 12 }),
      ...(desk ? [row([kbd("Fn"), meta("Hold Fn to speak in any app")], { gap: 8 })] : []),
    ], { gap: 6 }),
  ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }, botRoute("keybot"));
  const codeLine = code?.working ? [row([
    avatarOf(ctx, "code", 30),
    col([text("Xode keeps working in the cloud", { size: 14, lineHeight: 19 }), meta(`Last heard ${last} · ${code.doing ?? "on it"} · catches you up`)], { gap: 2, flexGrow: 1, flexShrink: 1 }),
    statusMark("working", { color: code.color }),
  ], { gap: 12, paddingHorizontal: 4 })] : [];
  // The asks typed while offline: kept in this page's state (three at most), sent when the person is back.
  const queued = [0, 1, 2].map((i) => when({ truthy: `queued.${i}` }, row([
    avatarOf(ctx, "tailzu", 30),
    col([text("", { size: 14, lineHeight: 19, bind: `queued.${i}` }), meta("Any bot · waiting to send")], { gap: 2, flexGrow: 1, flexShrink: 1 }),
    quietButton("Send", call("POST", "/v1/shell/ask", { message: `$state.queued.${i}`, bot: "any", device: ctx.client, mode: "text" }, {
      ok: seq({ kind: "toggleInArray", path: "queued", value: `$state.queued.${i}` }, toast("Sent. The answer is in Activity.")),
      fail: toast("Still offline. It waits here."),
    }), { size: "md" }),
  ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 })));
  const add = (ph: string) => row([
    field("later", ph, { size: 15, returnKey: "done", onSubmit: seq({ kind: "condition", if: { falsy: "later" }, then: toast("Type the ask first"), else: seq({ kind: "appendState", path: "queued", value: "$state.later", max: 3 }, { kind: "clearState", path: "later" }) }) }),
    roundButton("plus", seq({ kind: "condition", if: { falsy: "later" }, then: toast("Type the ask first"), else: seq({ kind: "appendState", path: "queued", value: "$state.later", max: 3 }, { kind: "clearState", path: "later" }) }), { size: 40, label: "Keep this ask" }),
  ], { gap: 10, borderRadius: 26, borderWidth: 1, borderColor: C.line, paddingVertical: 5, paddingRight: 5, paddingLeft: 18 });
  const kept = hasOutbox(ctx);
  const waiting = kept ? outboxSection(ctx) : col([
    row([icon("send", { size: 16 }), text("Asks wait here until you're back", { size: 15, weight: 600, lineHeight: 20 })], { gap: 8 }),
    when({ truthy: "queued.0" }, col(queued, { borderRadius: 18, borderWidth: 1, borderColor: C.line })),
    add("Ask a bot. It goes out when you are back."),
  ], { gap: 10 });
  const banner = row([
    ...(desk ? [box([wifiOff(18, C.grey70)], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.paper, alignItems: "center", justifyContent: "center" })] : []),
    col([text("No internet right now", { size: 17, weight: 600, lineHeight: 22 }), text(kept ? "Nothing is lost. Your asks wait here and go out on their own when you're back." : "Nothing is lost. Your asks wait here until you're back.", { size: 14, color: C.grey70, lineHeight: 20 })], { gap: 3, flexGrow: 1, flexShrink: 1 }),
    ...(desk ? [meta(`Last online ${last}`)] : []),
  ], { gap: 16, backgroundColor: C.surface, borderRadius: 18, paddingVertical: 16, paddingHorizontal: desk ? 18 : 16, alignItems: desk ? "center" : "flex-start" });
  const stillOpen = `Your chats, notes and files from this ${desk ? "computer" : "phone"} still open.`;

  if (desk) {
    const strip = row(live.bots.slice(0, 5).map((b) => row([
      botAvatar(b, 30),
      col([text(b.name, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(b.slug === "code" && b.working ? "In the cloud · working" : b.slug === "keybot" ? "Basic mode · on here" : "Back when you are", { lines: 1 })], { gap: 2, flexShrink: 1, minWidth: 0 }),
      ...(b.working ? [statusMark("working", { color: b.color })] : []),
    ], { gap: 10, paddingVertical: 12, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0, minWidth: 0 })), { borderRadius: 18, borderWidth: 1, borderColor: C.line });
    return page(ctx, {
      tab: "bots", title: "Offline", gap: 18, maxWidth: 1100, state: kept ? { later: "" } : { queued: [], later: "" },
      body: [
        row([col([text(firstName(ctx) ? `${live.greeting}, ${firstName(ctx)}` : live.greeting, { size: 14, color: C.meta, lineHeight: 18 }), title("Your bots")], { gap: 4 }), grow(), pill], { gap: 16 }),
        banner,
        strip,
        row([
          col([sectionLabel("Still works"), keyCard, meta(stillOpen, { size: 13 })], { gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
          col([waiting, ...codeLine], { gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        ], { gap: 28, alignItems: "flex-start" }),
      ],
    });
  }
  return page(ctx, {
    tab: "bots", title: "Offline", gap: 18, state: kept ? { later: "" } : { queued: [], later: "" },
    body: [
      row([tailzuMark(34), col([text(live.greeting, { size: 13, color: C.meta, lineHeight: 17 }), text("Your bots", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 })], { gap: 2 }), grow(), pill], { gap: 10 }),
      banner,
      col([sectionLabel("Still works"), keyCard, box([meta(stillOpen, { size: 13 })], { paddingHorizontal: 4 })], { gap: 10 }),
      waiting,
      ...codeLine,
    ],
  });
}
