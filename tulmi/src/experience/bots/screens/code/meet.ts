/**
 * The Code bot's meet screen.
 */

import type { ScreenResponse, ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, open, SCREENS, seq, primaryButton, button, secondaryButton, meta, notice, page, row, blip, col, title, body, C, text, grow,
  statusMark, back, icon, sectionLabel, box,
} from "../../kit.js";
import { type MeetData, openUrl, setupBuddy, setupTop, backButton, numberDot, enterTop } from "./parts.js";

/** Enter1 / DEnter1: who Xode is, and Connect GitHub. */
export function meet(ctx: BotsCtx, d: MeetData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const connected = !!d?.gh?.connected;
  const pick = open(SCREENS.codeStart, { step: "pick" });
  const connect: ActionRef | undefined = connected ? pick : d?.installUrl ? seq(openUrl(d.installUrl), pick) : undefined;
  const ways = [
    connect ? primaryButton(connected ? "Pick your projects" : "Connect GitHub", connect, { icon: connected ? undefined : "link", wide: !desk })
      : button("Connect GitHub", undefined, { kind: "disabled", wide: !desk }),
    secondaryButton("Start a new project from scratch", open(SCREENS.newProject), { wide: !desk }),
  ];
  const promise = meta("I only see the projects you pick, and I never change your main branch without you.", { size: 12, lineHeight: 17, align: desk ? undefined : "center" });
  const offLine = !connect ? [notice(d?.off ? "Xode isn't switched on here yet." : "GitHub isn't set up on this server yet.", { mark: "lock" })] : [];
  const how = [
    "I read your project and learn where everything is.",
    "I work on a safe copy and test every change.",
    "Nothing goes live until you say yes.",
  ];
  const stage = setupBuddy(ctx, "wave");
  if (!desk) {
    return page(ctx, {
      title: "Xode", nav: "code",
      body: [
        ...(stage ? [setupTop(backButton(), stage)] : [backButton(), row([blip("think", 210)], { justifyContent: "center" })]),
        col([title("Hi, I'm Xode.", { size: 30, tracking: -0.8, lineHeight: 36 }), body("Tell me what you want built or fixed. I'll do the work and show you the proof.", { color: C.grey70 })], { gap: 8 }),
        col(how.map((h, i) => row([numberDot(i + 1, "plain", 24), body(h, { style: { flexShrink: 1 } })], { gap: 12 })), { gap: 14 }),
        ...offLine,
      ],
      footer: [...ways, promise], gap: 18,
    });
  }
  const pictures: Node[] = [
    col([["app/", "screens"], ["lib/", "logic"], ["tests/", "tests"]].map(([a, b]) => row([text(a!, { size: 11.5, mono: true, lineHeight: 16 }), grow(), text(b!, { size: 11.5, color: C.meta, lineHeight: 16 })], { gap: 10 })),
      { backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 4 }),
    meta("Each change is tested before you see it", { size: 12 }),
    row([statusMark("done"), text("You press Merge. I never merge on my own.", { size: 12.5, weight: 500, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 7, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }),
  ];
  const allow = [["check", "Reading the projects you pick"], ["check", "Making branches and pull requests"], ["lock", "Changing main: never without you"]] as const;
  return page(ctx, {
    title: "Xode", nav: "code", maxWidth: 1100, gap: 18,
    body: [
      enterTop(back(), 1),
      row([
        col([
          stage ?? blip("think", 176),
          col([title("Hi, I'm Xode."), body("Tell me what you want built or fixed. I'll do the work and show you the proof.", { size: 16, color: C.grey70 })], { gap: 10 }),
          row(ways, { gap: 10, flexWrap: "wrap" }),
          row([icon("shield", { size: 18, color: C.meta }), meta("I only see the projects you pick, and I never change your main branch without you.", { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10, maxWidth: 420, alignItems: "flex-start" }),
          ...offLine,
        ], { flexGrow: 0.85, flexBasis: 0, minWidth: 0, gap: 20 }),
        col([
          sectionLabel("How I work"),
          col(how.map((h, i) => row([
            numberDot(i + 1, "done", 28), text(h, { size: 15, lineHeight: 21, style: { flexGrow: 1, flexBasis: 0, minWidth: 0 } }), box([pictures[i]!], { width: 250, flexShrink: 0 }),
          ], { gap: 18, paddingVertical: 18, paddingHorizontal: 20, ...(i < 2 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) })), { borderWidth: 1, borderColor: C.line, borderRadius: 18 }),
          col([
            text("When you connect, GitHub asks you to allow", { size: 13, weight: 600, lineHeight: 17 }),
            row(allow.map(([ic, w]) => row([icon(ic, { size: 16, color: C.grey70 }), text(w, { size: 13, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "flex-start" })), { gap: 14 }),
          ], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, gap: 10 }),
        ], { flexGrow: 1.15, flexBasis: 0, minWidth: 0, gap: 14 }),
      ], { gap: 56, alignItems: "flex-start" }),
    ],
  });
}
