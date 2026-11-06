/**
 * PLAN EASE, THE SIMPLER PAGE (docs/plan-ease.md; design A1, A2, A3, A12). The person sees three things: the one thing that matters
 * next, at most one question for them, and a calm list of today and tomorrow; then "See the week" and one box.
 *
 *   bots.plan           (PLAN_V2_PAGE, a build that draws PersonBot) the page, phone and window: GET .../plan/today
 *   bots.plan.week      "See the week": a plain list by day (GET .../plan/week); with `day`, that day's rows
 *   bots.plan.go        a notification's hand-off (a leave-by's Open map): Maps opens at once, then the Plan
 *
 * Every row, card and reply comes worked out from the server (botsBots/planDay.ts, planNeeds.ts, planRows.ts, planBox.ts): this file
 * only draws them, the same way for every kind, so a later step's row or card needs nothing here. A button goes through the one act
 * door (POST /v1/widgets/act), as the widget's and a notification's do: answered here, it's gone there too. The page listens to
 * "bot:plan", which every change publishes, and its live reload keeps what is on it (an answer's grey line, the box's reply).
 *
 * Look: white paper and ink; Plan Ease's ochre only on its own bot, the Needs-you dot and the leave-by time in the big line. People are
 * their tiny bots, never initials. Words a person wrote or will send are in Bricolage (messageText).
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, back, botAvatar, box, C, call, col, grow, icon, labelled, meta, open, page, personBot, primaryButton, row,
  secondaryButton, sectionLabel, seq, text, when, emptyState, messageText,
} from "../../kit.js";
import { canUpload, uploadPick } from "../../media.js";
import { itemAction, tickBox } from "../planItem.js";
import { A, clearState, field, handoffOf, isDesk, lookOf, refresh, setState, toast } from "./parts.js";
import { said } from "../../said.js";
import type { PersonLook } from "../../../../botsBots/personLook.js";

// ------------------------------------------------------------------ what the server sends (botsBots/planDay.ts PlanPage)

interface RowView {
  id: string; kind: string; time: string; title: string; line: string; done: boolean; at: number;
  tick?: { item: string; action: string; label: string };
  person?: { look: PersonLook; name: string };
  action?: { label: string; url: string };
  /** The grey line is a person's word on it: their tiny bot and their words. */
  note?: { look: PersonLook; name: string; text: string };
  open: { kind: "event" | "task"; id: string };
}
interface NeedsCard {
  type: string; key: string; question: string; reason: string; message?: string; item: string;
  person?: { look: PersonLook; name: string };
  buttons: Array<{ id: string; label: string; primary?: boolean; done?: string; undo?: string; open?: { screen: string; params?: Record<string, string> } }>;
  field?: { placeholder: string; path: string; save: string };
}
export interface PlanTodayData {
  v: 2; today: string; tomorrow: string;
  next: { big: string; accent?: string; grey: string; button?: { label: string; url: string }; rung: number };
  needs: NeedsCard | null;
  days: Array<{ key: string; label: "Today" | "Tomorrow"; rows: RowView[]; more: number }>;
  week: Array<{ key: string; date: string; line: string }>;
}
export interface PlanWeekData { today: string; days: Array<{ key: string; date: string; rows: RowView[] }> }

const ACT = "/v1/widgets/act";
const OCHRE = lookOf("plan").color;

/** A press of one of Plan Ease's buttons, through the act door; its own key, so pressing it again later is a new answer. */
const act = (ctx: BotsCtx, item: string, action: string, then?: { ok?: ActionRef; fail?: ActionRef }): ActionSpec =>
  call("POST", ACT, { item, action, key: `${item}:${action}:${ctx.live.now}`.slice(0, 120) }, {
    ok: then?.ok ?? seq(), fail: then?.fail ?? toast("Couldn't do that. Try again.", true), stay: true,
  }) as ActionSpec;

// ------------------------------------------------------------------ the parts

/** Back, Plan Ease's bot and its name: the header is just the name. */
function head(ctx: BotsCtx): Node {
  const look = lookOf("plan");
  return row([
    ...(isDesk(ctx) ? [] : [labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back")]),
    botAvatar(look, isDesk(ctx) ? 40 : 36),
    text("Plan Ease", { size: isDesk(ctx) ? 22 : 19, weight: 600, lineHeight: 26 }),
  ], { gap: 10 });
}

/** The one thing: 26/32 ink, its leave-by time in ochre, one grey line, and Open map when it is time. */
function nextPart(ctx: BotsCtx, n: PlanTodayData["next"]): Node {
  const size = isDesk(ctx) ? 30 : 26, lh = isDesk(ctx) ? 36 : 32;
  const words = n.big.split(" ");
  const accent = n.accent ? n.accent.split(" ") : [];
  const at = accent.length ? words.findIndex((_w, i) => accent.every((a, j) => words[i + j] === a)) : -1;
  const big = row(words.map((w, i) => text(w, {
    size, weight: 600, lineHeight: lh, tracking: -0.6, color: at >= 0 && i >= at && i < at + accent.length ? OCHRE : C.ink, style: { marginRight: size * 0.26 },
  })), { flexWrap: "wrap", alignItems: "flex-end" });
  return col([
    labelled(big, n.big),
    ...(n.grey ? [text(n.grey, { size: 16, color: C.meta, lineHeight: 22 })] : []),
    // Open map is a hand-off the phone checks against its own list (Maps); Pay is a plain link (a UPI app or a biller's page), as on
    // the row: the hand-off list has no biller pages and wants a UPI link with an amount.
    ...(n.button ? [secondaryButton(n.button.label, { kind: "openUrl", url: n.button.url, ...(n.rung === 1 ? { handoff: true } : {}) } as ActionSpec, { size: "md" })] : []),
  ], { gap: 6 });
}

/** The one Needs-you card: the ochre dot, the question, one grey reason, one or two buttons. Answered: a grey line with Undo. */
function needsPart(ctx: BotsCtx, c: NeedsCard): Node {
  const desk = isDesk(ctx);
  const label = row([box([], { width: 9, height: 9, borderRadius: 5, backgroundColor: OCHRE }), text("Needs you", { size: 12, weight: 600, tracking: 0.4, upper: true, lineHeight: 16 })], { gap: 8 });
  const buttons = c.buttons.slice(0, 2).map((b) => {
    const done: ActionRef = seq(
      setState("planDid", { line: b.done ?? "Done", item: c.item, undo: b.undo ?? "" }),
      { kind: "delay", ms: 10_000 } as ActionSpec,
      clearState("planDid"),
    );
    // A button that opens a page (the work calendar's Link it, a capture's Look) goes there; the rest answer through the act door.
    return (b.primary ? primaryButton : secondaryButton)(b.label, b.open ? open(b.open.screen, b.open.params) : act(ctx, c.item, b.id, { ok: done }), { size: "md" });
  });
  // Saved: the card's question is answered, so the page is read again and the next card (or none) takes its place.
  const save = c.field ? call("PUT", c.field.path, { home: "$state.planHome" }, { ok: seq(clearState("planHome"), toast("Saved"), refresh), fail: toast("Couldn't save that. Try again.", true), stay: true }) : null;
  const answer = c.field && save ? row([
    box([field("planHome", "planHome", c.field.placeholder, { onSubmit: save })],
      { flexGrow: 1, flexShrink: 1, minWidth: 0, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 14 }),
    primaryButton(c.field.save, save, { size: "md" }),
  ], { gap: 8, alignItems: "center" }) : row(buttons, { gap: 8, flexWrap: "wrap" });
  const words = col([
    label,
    text(c.question, { size: desk ? 18 : 17, weight: 500, lineHeight: 24, lines: 2 }),
    // No reason line when the card has none (a waiting-on's draft says it all).
    ...(c.person ? [row([personBot(ctx, c.person.look, { size: 22, label: c.person.name }), meta(c.reason, { size: 14, lines: 1 })], { gap: 8 })] : c.reason ? [meta(c.reason, { size: 14, lines: 2 })] : []),
    ...(c.message ? [box([messageText(ctx, c.message, { lines: 4 })], { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12 })] : []),
  ], { gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 });
  const cardNode = desk && !c.field
    ? row([words, answer], { gap: 20, alignItems: "center", flexWrap: "wrap", padding: 20, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper })
    : col([words, answer], { gap: 14, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
  // Answered: where the card was, a grey line and Undo for 10 seconds.
  const did = row([
    text("", { size: 14, color: C.meta, lineHeight: 19, bind: "planDid.line", style: { flexShrink: 1 } }),
    when({ truthy: "planDid.undo" }, row([text("Undo", { size: 14, weight: 500, lineHeight: 19 })], { minHeight: 32, paddingHorizontal: 6 },
      call("POST", ACT, { item: "$state.planDid.item", action: "$state.planDid.undo", key: `undo:${c.key.replace(/[^A-Za-z0-9_.:-]/g, "")}:${ctx.live.now}`.slice(0, 120) }, { ok: clearState("planDid"), fail: toast("Couldn't undo that.", true), stay: true }))),
  ], { gap: 8, alignItems: "center", minHeight: 40 });
  return col([when({ falsy: "planDid" }, cardNode), when({ truthy: "planDid" }, did)], { gap: 0 });
}

/** One row: a time (or its tick) on the left, the title and one grey line, and on the right Pay or the tiny bot of who set it. */
export function planRow(ctx: BotsCtx, r: RowView): Node {
  const left = r.tick
    ? box([tickBox(r.done, act(ctx, r.tick.item, r.tick.action), r.tick.label)], { width: isDesk(ctx) ? 64 : 56, alignItems: "flex-start", paddingTop: 2 })
    : text(r.time, { size: 13, color: C.meta, lineHeight: 22, style: { width: isDesk(ctx) ? 64 : 56, flexShrink: 0 } });
  // A person's word on it is theirs: their tiny bot and their words in Bricolage, grey, one line.
  const grey = r.note
    ? row([personBot(ctx, r.note.look, { size: 18, label: r.note.name }), messageText(ctx, r.line, { lines: 1, color: C.meta, size: 14 })], { gap: 6, alignItems: "center" })
    : r.line ? text(r.line, { size: 14, color: C.meta, lineHeight: 19, lines: 1 }) : null;
  const words = col([
    text(r.title, { size: 16, lineHeight: 22, lines: 2, color: r.done ? C.meta : C.ink }),
    ...(grey ? [grey] : []),
  ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }, itemAction(r.open.kind, r.open.id));
  const right = r.action
    ? [secondaryButton(r.action.label, { kind: "openUrl", url: r.action.url } as ActionSpec, { size: "md" })]
    : r.person ? [personBot(ctx, r.person.look, { size: 26, label: `From ${r.person.name}` })] : [];
  return row([left, words, ...right], { gap: 12, alignItems: "flex-start", paddingVertical: 8, ...(r.done ? { opacity: 0.55 } : {}) });
}

function dayPart(ctx: BotsCtx, d: PlanTodayData["days"][number]): Node[] {
  if (!d.rows.length && !d.more) return [];
  return [col([
    sectionLabel(d.label),
    ...d.rows.map((r) => planRow(ctx, r)),
    ...(d.more ? [row([meta(`${d.more} more`, { size: 14 })], { minHeight: 32, paddingLeft: isDesk(ctx) ? 76 : 68 }, open(SCREENS.planWeek, { day: d.key }))] : []),
  ], { gap: 2 })];
}

/**
 * The one box: "Tell me anything, or add a photo". The server says what it was (POST .../plan/box): added (a grey line with Undo), a
 * day's answer, or the chat's (sent to the Plan Ease chat as before). The + picks a photo, a camera shot or a file, and the share-in
 * screen reads it.
 */
function planBox(ctx: BotsCtx): Node {
  const desk = isDesk(ctx);
  // A reply that opens a page: pasted words read into a capture card, "link my work calendar" (botsBots/planInBox.ts).
  const boxOpens: ActionRef = {
    kind: "condition", if: { eq: ["boxed.open.screen", SCREENS.planCapture] }, then: open(SCREENS.planCapture, { id: "$state.boxed.capture" }),
    else: { kind: "condition", if: { eq: ["boxed.open.screen", SCREENS.planLink] }, then: open(SCREENS.planLink), else: seq() } as ActionSpec,
  } as ActionSpec;
  // Anything else is the Plan Ease chat's (its own route, its consent gate and its budget, as before). The question and its answer
  // stay here under the box, the answer in a faint message container, with the chat a tap away: the person never has to go looking.
  const askChat: ActionRef = seq(
    setState("askQ", "$state.say"), clearState("say"), clearState("asked"), setState("askBusy", true),
    call("POST", `${A}/chat/plan`, { message: "$state.askQ" }, {
      assignTo: "asked", stay: true, ok: setState("askBusy", false),
      fail: seq(setState("askBusy", false), clearState("askQ"), said("Couldn't ask that. Try again.")),
    }),
  );
  const send: ActionRef = {
    kind: "condition", if: { falsy: "say" }, then: toast("Type something first"),
    else: call("POST", `${A}/plan/box`, { words: "$state.say", tz: ctx.tzOffsetMinutes }, {
      assignTo: "boxed", stay: true,
      ok: { kind: "condition", if: { eq: ["boxed.kind", "chat"] }, then: askChat, else: seq(clearState("say"), clearState("askQ"), boxOpens) } as ActionSpec,
      fail: toast("Couldn't add that. Try again.", true),
    }),
  } as ActionSpec;
  // From the Plan's own +, what is shared is always Plan Ease's: the capture card, never the bot picker.
  const shareIn = (pick: "photo" | "camera" | "file") => uploadPick(pick, "boxFiles", open(SCREENS.shareIn, { file: "$state.sent.file.id", from: "plan" }));
  const plus = canUpload(ctx)
    ? [labelled(box([icon("plus", { size: 22 })], { width: 40, height: 40, alignItems: "center", justifyContent: "center", flexShrink: 0 },
      desk ? shareIn("file") : { kind: "condition", if: { truthy: "boxPick" }, then: setState("boxPick", false), else: setState("boxPick", true) } as ActionSpec), desk ? "Add a file" : "Add a photo or a file")]
    : [];
  const input = row([
    ...plus,
    field("say", "say", desk ? "Tell me anything, or drop a file here" : "Tell me anything, or add a photo", { onSubmit: send }),
    labelled(box([icon("send", { size: 18, color: C.paper })], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 }, send), "Send"),
  ], { gap: 8, alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 28, paddingLeft: plus.length ? 8 : 18, paddingRight: 6, paddingVertical: 4, minHeight: 52, backgroundColor: C.paper });
  const picks = !desk && canUpload(ctx) ? [when({ truthy: "boxPick" }, row([
    secondaryButton("Photo", seq(clearState("boxPick"), shareIn("photo")), { size: "md" }),
    secondaryButton("Camera", seq(clearState("boxPick"), shareIn("camera")), { size: "md" }),
    secondaryButton("File", seq(clearState("boxPick"), shareIn("file")), { size: "md" }),
  ], { gap: 8, flexWrap: "wrap" }))] : [];
  // The reply, one grey line under the box, with Undo for what was added; a day's answer is its rows' line with the chat a tap away.
  const reply = when({ truthy: "boxed.line" }, row([
    // A family ask's preview: tapping its words puts them back in the box, to change the day, the time or the space.
    row([text("", { size: 14, color: C.meta, lineHeight: 19, bind: "boxed.line", style: { flexShrink: 1 } })], { flexShrink: 1 },
      { kind: "condition", if: { truthy: "boxed.edit" }, then: setState("say", "$state.boxed.edit"), else: seq() } as ActionSpec),
    // Its one button ([Ask]), through the act door: its answer is the reply that takes the preview's place. Keyed by its item.
    when({ truthy: "boxed.act.item" }, row([text("", { size: 14, weight: 600, color: C.paper, lineHeight: 19, bind: "boxed.act.label" })],
      { minHeight: 36, paddingHorizontal: 18, borderRadius: 18, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" },
      call("POST", ACT, { item: "$state.boxed.act.item", action: "$state.boxed.act.action" }, { assignTo: "boxed", ok: seq(), fail: toast("Couldn't do that. Try again.", true), stay: true }))),
    when({ truthy: "boxed.undo.item" }, row([text("Undo", { size: 14, weight: 500, lineHeight: 19 })], { minHeight: 32, paddingHorizontal: 6 },
      call("POST", ACT, { item: "$state.boxed.undo.item", action: "$state.boxed.undo.action", key: `boxundo:${ctx.live.now}` }, { ok: clearState("boxed"), fail: toast("Couldn't undo that.", true), stay: true }))),
    when({ eq: ["boxed.kind", "day"] }, row([text("Open chat", { size: 14, color: C.meta, lineHeight: 19 })], { minHeight: 32, paddingHorizontal: 6 }, open(SCREENS.chat, { slug: "plan" }))),
  ], { gap: 6, alignItems: "center", flexWrap: "wrap" }));
  // A question for the chat: what was asked, then "Thinking…" or the answer in a faint message container, and "Open chat".
  const asked = when({ truthy: "askQ" }, col([
    text("", { size: 14, color: C.meta, lineHeight: 19, bind: "askQ", lines: 2 }),
    when({ truthy: "askBusy" }, meta("Thinking…", { size: 14 })),
    when({ truthy: "asked.text" }, box([messageText(ctx, "", { lines: 12, bind: "asked.text" })], { borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 })),
    row([text("Open chat", { size: 14, color: C.meta, lineHeight: 19 })], { minHeight: 32, alignSelf: "flex-start" }, open(SCREENS.chat, { slug: "plan" })),
  ], { gap: 6 }));
  return col([...picks, input, reply, asked], { gap: 8 });
}

const noRead = () => emptyState({ pose: "think", title: "Couldn't read your days", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } });

/** The page's state: what an answer or the box leaves on it (kept through the live reloads). */
const STATE = { say: "", boxPick: false, planHome: "", askQ: "", askBusy: false };

// ------------------------------------------------------------------ the page, phone and window

export function planTodayPhone(ctx: BotsCtx, d: PlanTodayData | undefined) {
  return page(ctx, {
    title: "Plan Ease", nav: "plan", live: ["bot:plan", "calendar", "tasks"], state: { ...STATE }, gap: 26,
    body: [
      head(ctx),
      ...(!d ? [noRead()] : [
        nextPart(ctx, d.next),
        ...(d.needs ? [needsPart(ctx, d.needs)] : []),
        ...d.days.flatMap((x) => dayPart(ctx, x)),
        row([text("See the week", { size: 16, weight: 500, lineHeight: 22 })], { minHeight: 40, alignSelf: "flex-start" }, open(SCREENS.planWeek)),
      ]),
    ],
    footer: [planBox(ctx)],
  });
}

export function planTodayDesk(ctx: BotsCtx, d: PlanTodayData | undefined) {
  const rail = d ? col([
    sectionLabel("Later this week"),
    col(d.week.map((w, i) => row([
      text(w.date, { size: 14, color: C.meta, lineHeight: 20, style: { width: 64, flexShrink: 0 } }),
      text(w.line, { size: 15, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 18, ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) }, open(SCREENS.planWeek, { day: w.key }))),
    { borderWidth: 1, borderColor: C.line, borderRadius: 20, overflow: "hidden" }),
  ], { gap: 10, width: 320, flexShrink: 0 }) : box([], { width: 320 });
  return page(ctx, {
    title: "Plan Ease", nav: "plan", maxWidth: 1080, live: ["bot:plan", "calendar", "tasks"], state: { ...STATE },
    body: [row([
      col([
        head(ctx),
        ...(!d ? [noRead()] : [nextPart(ctx, d.next), ...(d.needs ? [needsPart(ctx, d.needs)] : []), ...d.days.flatMap((x) => dayPart(ctx, x))]),
        planBox(ctx),
      ], { gap: 28, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, maxWidth: 680 }),
      rail,
    ], { gap: 48, alignItems: "flex-start" })],
  });
}

// ------------------------------------------------------------------ See the week

/** A day's one line for the week's list: its first thing (with its time), then "2 more". Nothing on it: just its date. */
function dayLine(d: PlanWeekData["days"][number]): string {
  const open = d.rows.filter((r) => !r.done);
  const first = open[0];
  if (!first) return "";
  const what = `${first.title}${first.time && first.time !== "All day" ? ` ${first.time}` : ""}`;
  return open.length > 1 ? `${what} · ${open.length - 1} more` : what;
}

export function planWeekPage(ctx: BotsCtx, d: PlanWeekData | undefined) {
  const day = String(ctx.params.day ?? "");
  const one = d?.days.find((x) => x.key === day);
  // One day (a day's "2 more", a day tapped on the list): its rows. The week: a plain list, one line a day; a tap opens that day.
  return page(ctx, {
    back: true, ...(isDesk(ctx) ? { backTitle: "Plan Ease" } : {}), title: one ? one.date : "This week", nav: "plan", maxWidth: 680, live: ["bot:plan", "calendar", "tasks"],
    body: !d ? [noRead()] : one ? [
      text(one.date, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
      col(one.rows.map((r) => planRow(ctx, r)), { gap: 2 }),
    ] : [
      text("This week", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
      col(d.days.map((x, i) => {
        const l = dayLine(x);
        return row([
          text(x.date, { size: 15, weight: 500, lineHeight: 21, style: { width: isDesk(ctx) ? 110 : 96, flexShrink: 0 } }),
          ...(l ? [text(l, { size: 15, lineHeight: 21, lines: 1, style: { flexShrink: 1 } })] : []),
        ], { gap: 12, paddingVertical: 12, minHeight: 44, alignItems: "center", ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) }, l ? open(SCREENS.planWeek, { day: x.key }) : undefined);
      }), { gap: 0 }),
    ],
  });
}

// ------------------------------------------------------------------ a notification's hand-off

/**
 * A notification button can't open another app by itself, so Open map opens this: Maps at once (a hand-off link the phone checks
 * against its own list), then the Plan underneath. Nothing to read on it.
 */
export function planGoPage(ctx: BotsCtx, d?: { url?: string }) {
  // A bill's Pay (step 3): its safe pay link, read from the server for this person's own bill (planIn.ts planGoLoad), opened as it is.
  const pay = ctx.params.go === "pay" && typeof d?.url === "string" && d.url ? d.url : "";
  const to = String(ctx.params.to ?? "").slice(0, 160);
  const mode = ctx.params.mode === "walking" ? "walking" : "driving";
  const url = pay ? "" : to ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(to)}&travelmode=${mode}` : "";
  const home = { kind: "navigate", screenId: SCREENS.plan, replace: true } as ActionSpec;
  const go: ActionRef = pay
    ? seq({ kind: "openUrl", url: pay } as ActionSpec, home)
    : url ? seq({ kind: "openUrl", url, handoff: true } as ActionSpec, home) : home;
  // Only Pay or Open map opens UPI or Maps; tapping "Electricity due today" just to look opens the Plan (parts.ts handoffOf).
  const how = handoffOf(ctx, ["p_pay", "p_map"]);
  if (how === "ask" && (pay || url)) {
    return page(ctx, {
      title: "Plan Ease", nav: "plan",
      body: [row([primaryButton(pay ? "Pay" : "Open map", go, { size: "md" }), secondaryButton("Open Plan", home, { size: "md" })], { gap: 10, flexWrap: "wrap", paddingTop: 24 })],
    });
  }
  return page(ctx, {
    title: "Plan Ease", nav: "plan",
    body: [{ ...col([meta(how === "go" ? (pay ? "Opening…" : url ? "Opening Maps…" : "") : "", { size: 14 }), grow()], { flexGrow: 1, alignItems: "center", justifyContent: "center", minHeight: 200 }), on: { onAppear: how === "go" ? go : home } }],
  });
}
