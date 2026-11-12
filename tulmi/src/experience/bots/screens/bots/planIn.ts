/**
 * PLAN EASE: WHAT COMES IN (docs/plan-ease.md "The work calendar", "Getting things in", "Bills due"; design A3, A5, A8, A9).
 *
 *   bots.plan.link          "Link your calendar": three rows (Google, Outlook, iPhone), three short steps each, one field, one button.
 *                           On the phone, Google and Outlook end with x0bot.com/cal (their settings need a computer): its 6-digit code
 *                           goes in the same field. The linked ones are listed with "Take it out". (params: again)
 *   bots.plan.capture       one capture card: "4 things from the school circular", ticks, "Date?" on an unsure one, one button
 *                           ("Add all", "Add 3"), then "Added 3 things · Undo" for 10 seconds (params: id). The share-in screen draws the
 *                           same card when what was shared is Plan Ease's.
 *   bots.plan.capture.item  a row's small sheet: title, day, time, who (the family's tiny bots) (params: id, item)
 *
 * And for the item details (screens/planItem.ts): a work meeting ("From your work calendar", no buttons, "Change it in your work
 * calendar."), a bill (Pay when the link is safe, Paid, Take it out), and "Take out all from the circular" at the foot of anything a
 * capture added. Every row and line comes worked out from the server (botsBots/planCapture.ts, planLinks.ts): this only draws them.
 */
import { KIT_EXTRAS_CAPABILITY, type ActionRef, type ActionSpec, type Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, back, box, C, call, chips, col, emptyState, icon, labelled, meta, open, page, personBot, primaryButton, quietButton, row,
  secondaryButton, sectionLabel, seq, text, when, notice,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { aiConsentCard } from "../firstRun/aiConsentCard.js";
import { A, clearState, field, inputBox, isDesk, lookOf, refresh, setState, toast } from "./parts.js";
import { lookOf as personLookOf, type PersonLook } from "../../../../botsBots/personLook.js";
import type { ItemFollow } from "../../../../botsBots/planFollow.js";
import { followSection, followState } from "./planFollow.js";

const ACT = "/v1/widgets/act";
const OCHRE = lookOf("plan").color;
const enc = encodeURIComponent;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN = 60_000, DAY = 86_400_000;

// ------------------------------------------------------------------ what the server sends

export interface CaptureView {
  id: string; state: string; label: string; title: string;
  rows: Array<{ id: string; tick: boolean; title: string; line: string; dateAsk: boolean; person?: { id: string; name: string } }>;
  already: string; button: string; added?: { n: number; line: string }; consent?: true; fallback?: string;
}
interface LinkView { id: string; provider: string; name: string; hint: string; stopped: boolean }
interface Meeting { title: string; day: string; start: number | null; end: number | null; allDay: boolean; where?: string; place?: string; people: number; provider: string }
interface Person { id: string; name: string; spaceId: string; look: PersonLook }

const keyWords = (k: string) => { const d = new Date(`${k}T00:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const clockOf = (ctx: BotsCtx, ms: number) => {
  const d = new Date(ms + ctx.tzOffsetMinutes * MIN), h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};
const keyOf = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN).toISOString().slice(0, 10);

/** One of Plan Ease's buttons through the act door, with its own key (pressing it again later is a new answer). */
const act = (ctx: BotsCtx, item: string, action: string, then?: { ok?: ActionRef; fail?: ActionRef }): ActionSpec =>
  call("POST", ACT, { item, action, key: `${item}:${action}:${ctx.live.now}`.slice(0, 120) }, {
    ok: then?.ok ?? seq(), fail: then?.fail ?? toast("Couldn't do that. Try again.", true), ...keep(ctx),
  }) as ActionSpec;

const toPlan: ActionSpec = { kind: "navigate", screenId: SCREENS.plan, replace: true } as ActionSpec;

/** A write that keeps the window as it is (KitExtras); an older build fetches the screen again, as it always did. */
const keep = (ctx: BotsCtx): { stay?: true } => (ctx.can.has(KIT_EXTRAS_CAPABILITY) ? { stay: true } : {});

// ===================================================================== the capture card

/** The round tick of a row: filled when ticked. */
function tick(on: boolean, onPress: ActionRef, label: string): Node {
  const ring = row([on ? icon("check", { size: 13, color: C.paper, weight: 2.4 }) : row([], {})], {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
    ...(on ? { backgroundColor: C.ink } : { borderWidth: 1.5, borderColor: C.outline }),
  });
  return labelled(row([ring], { width: 40, height: 40, marginLeft: -9, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), label);
}

function captureRow(ctx: BotsCtx, v: CaptureView, r: CaptureView["rows"][number]): Node {
  const edit = open(SCREENS.planCaptureItem, { id: v.id, item: r.id });
  const toggle = r.dateAsk && !r.tick ? edit : call("POST", `${A}/plan/capture/${enc(v.id)}/toggle`, { item: r.id }, { ok: refresh, fail: toast("Couldn't change that.", true), ...keep(ctx) });
  const right = r.dateAsk
    ? [row([text("Date?", { size: 14, weight: 600, color: OCHRE, lineHeight: 19 })], { minHeight: 36, paddingHorizontal: 4, alignItems: "center" }, edit)]
    : r.person ? [personBot(ctx, personLookOf(r.person.id), { size: 24, label: `For ${r.person.name}` })] : [];
  return row([
    tick(r.tick, toggle, r.tick ? `${r.title}. Ticked: it will be added.` : `${r.title}. Not ticked.`),
    col([
      text(r.title, { size: 16, lineHeight: 22, lines: 2 }),
      ...(r.line ? [text(r.line, { size: 14, color: C.meta, lineHeight: 19, lines: 1 })] : []),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }, edit),
    ...right,
  ], { gap: 12, alignItems: "center", paddingVertical: 6 });
}

/** The card itself: one title, up to 5 rows then "2 more" (opened in place), one button that says what it does. */
function captureCard(ctx: BotsCtx, v: CaptureView, o: { share: boolean }): Node[] {
  const desk = isDesk(ctx);
  const head = text(v.title, { size: desk ? 19 : 17, weight: 500, lineHeight: 24 });
  if (v.state === "reading" || v.state === "waiting") {
    return [col([head, meta(v.state === "waiting" ? "I'll have it ready in the morning." : "This takes a few seconds.", { size: 14 })], { gap: 6 })];
  }
  if (v.state === "failed") {
    return [col([head, meta(v.fallback ?? "", { size: 14 })], { gap: 6 }), secondaryButton("Open Plan", toPlan, { size: "md" })];
  }
  if (v.consent) {
    const read = call("POST", `${A}/plan/capture/${enc(v.id)}/consent`, {}, { ok: refresh, fail: toast("Couldn't read it. Try again.", true), ...keep(ctx) });
    const plain = call("POST", `${A}/plan/capture/${enc(v.id)}/plain`, {}, { assignTo: "capPlain", ok: seq(toast("$state.capPlain.line"), o.share ? toPlan : back()), fail: toast("Couldn't add it. Try again.", true), ...keep(ctx) });
    // Two choices, not three: the AI card's Agree reads it; its Not now adds it as one to-do (said here, so it is no surprise).
    return [
      col([head, meta("Plan Ease reads it to find the dates and what to do. That needs your OK first. Not now adds it as one to-do.", { size: 14, lines: 3 })], { gap: 6 }),
      ...aiConsentCard(ctx, { agreed: false }, { then: read, later: plain }),
    ];
  }
  // Added: where the card was, a grey line and Undo for 10 seconds (kept through the screen's live reload); then the things live on
  // the person's days.
  const did = row([
    text("", { size: 15, color: C.meta, lineHeight: 20, bind: "capAdded.message", style: { flexShrink: 1 } }),
    row([text("Undo", { size: 15, weight: 500, lineHeight: 20 })], { minHeight: 36, paddingHorizontal: 6 },
      call("POST", ACT, { item: `pc:${v.id}`, action: "undo", key: `capundo:${v.id}:${ctx.live.now}`.slice(0, 120) }, { ok: seq(clearState("capDid"), refresh), fail: toast("Couldn't undo that.", true), ...keep(ctx) })),
  ], { gap: 8, alignItems: "center", minHeight: 44 });
  if (v.state === "added" && v.added) {
    return [
      when({ truthy: "capDid" }, did),
      when({ falsy: "capDid" }, col([text(v.added.line, { size: 16, lineHeight: 22 }), meta("They're on your days now.", { size: 14 }), secondaryButton("Open Plan", toPlan, { size: "md" })], { gap: 8 })),
    ];
  }
  if (!v.rows.length) {
    return [col([head, ...(v.already ? [meta(v.already, { size: 14 })] : [])], { gap: 6 }), secondaryButton(o.share ? "Open Plan" : "Done", o.share ? toPlan : back(), { size: "md" })];
  }
  const first = v.rows.slice(0, 5), rest = v.rows.slice(5);
  const added: ActionRef = seq(
    setState("capDid", true),
    { kind: "delay", ms: 10_000 } as ActionSpec,
    clearState("capDid"),
    o.share ? toPlan : refresh,
  );
  const add = call("POST", ACT, { item: `pc:${v.id}`, action: "addall", key: `pc:${v.id}:addall:${ctx.live.now}`.slice(0, 120) }, {
    assignTo: "capAdded", ok: added, fail: toast("Couldn't add them. Try again.", true), ...keep(ctx),
  });
  const card = col([
    head,
    col([
      ...first.map((r) => captureRow(ctx, v, r)),
      ...(rest.length ? [
        when({ falsy: "capAll" }, row([meta(`${rest.length} more`, { size: 14 })], { minHeight: 36, paddingLeft: 40 }, setState("capAll", true))),
        when({ truthy: "capAll" }, col(rest.map((r) => captureRow(ctx, v, r)), { gap: 0 })),
      ] : []),
    ], { gap: 0 }),
    ...(v.already ? [meta(v.already, { size: 14, lines: 2 })] : []),
    ...(v.button ? [primaryButton(v.button, add, { wide: !desk })] : []),
  ], { gap: 14 });
  return [when({ falsy: "capDid" }, card), when({ truthy: "capDid" }, did)];
}

/** The capture card as a page: its own screen, or the share-in screen when what was shared is Plan Ease's (no bot picker). */
export function capturePage(ctx: BotsCtx, v: CaptureView | undefined, o: { share?: boolean } = {}) {
  const share = !!o.share;
  return page(ctx, {
    back: share ? back() : true, ...(isDesk(ctx) ? { backTitle: "Plan Ease" } : {}), title: "Plan Ease", nav: "plan", maxWidth: 680,
    live: ["bot:plan"], state: { capAll: false },
    body: !v ? [emptyState({ pose: "think", title: "It isn't there any more", body: "It may have been added or taken out already.", action: { label: "Open Plan", onPress: toPlan } })]
      : captureCard(ctx, v, { share }),
  });
}

/** A row's sheet: what it is, its day, its time, and who it is for (the person, or someone in their family space). */
export function captureItemPage(ctx: BotsCtx, d: { capture?: CaptureView; people?: Person[] } | undefined) {
  const itemId = String(ctx.params.item ?? "");
  const r = d?.capture?.rows.find((x) => x.id === itemId);
  if (!d?.capture || !r) return capturePage(ctx, undefined);
  const days = Array.from({ length: 10 }, (_, i) => keyOf(ctx, ctx.live.now + i * DAY));
  const save = call("PUT", `${A}/plan/capture/${enc(d.capture.id)}/items/${enc(r.id)}`, { title: "$state.capTitle", day: "$state.capDay", time: "$state.capTime", who: "$state.capWho" }, {
    ok: seq(toast("Saved"), back()), fail: toast("Couldn't save that. Try again.", true),
  });
  const people = d.people ?? [];
  return page(ctx, {
    back: true, title: "Plan Ease", nav: "plan", maxWidth: 560,
    state: { capTitle: r.title.replace(/ · ₹[\d,.]+$/, ""), capDay: "", capTime: "", capWho: r.person ? { id: r.person.id, name: r.person.name } : null },
    body: [
      col([sectionLabel("What"), inputBox([field("capTitle", "capTitle", "What it is")])], { gap: 8 }),
      col([sectionLabel("Day"), chips(days.map((k) => ({ label: keyWords(k), value: k })), "capDay"),
        inputBox([field("capDayWords", "capDay", "Or type a day, like 20 Nov")])], { gap: 8 }),
      col([sectionLabel("Time"), chips([{ label: "Any time", value: "" }, { label: "9 am", value: "09:00" }, { label: "1 pm", value: "13:00" }, { label: "4 pm", value: "16:00" }, { label: "6 pm", value: "18:00" }], "capTime")], { gap: 8 }),
      ...(people.length ? [col([
        sectionLabel("Who"),
        row([
          row([text("Me", { size: 14, lineHeight: 18 })], { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line }, setState("capWho", null)),
          ...people.map((p) => row([personBot(ctx, p.look, { size: 22, label: p.name }), text(p.name, { size: 14, lineHeight: 18 })],
            { gap: 6, alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line }, setState("capWho", { id: p.id, name: p.name, spaceId: p.spaceId }))),
        ], { gap: 8, flexWrap: "wrap" }),
        row([meta("For: ", { size: 13 }), text("", { size: 13, color: C.meta, bind: "capWho.name" })], { gap: 2 }),
      ], { gap: 8 })] : []),
    ],
    footer: [primaryButton("Save", save, { wide: !isDesk(ctx) })],
  });
}

// ===================================================================== the link page

const STEPS: Record<string, { name: string; steps: string[]; computer: boolean; settings?: string }> = {
  google: {
    name: "Google Calendar", computer: true, settings: "https://calendar.google.com/calendar/r/settings",
    steps: ["Open Google Calendar on a computer.", "Settings › your calendar › Secret address in iCal format › Copy.", "Paste it here."],
  },
  outlook: {
    name: "Outlook", computer: true, settings: "https://outlook.office.com/calendar/options/calendar/SharedCalendars",
    steps: ["Open Outlook on the web.", "Settings › Calendar › Shared calendars › Publish a calendar › Can view all details › Publish.", "Copy the ICS link and paste it here."],
  },
  icloud: {
    name: "iPhone (iCloud)", computer: false,
    steps: ["On iPhone, open Calendar › Calendars › ⓘ next to the calendar.", "Turn on Public Calendar › Share Link › Copy.", "Paste it here."],
  },
};

export function linkPage(ctx: BotsCtx, d: { links: LinkView[] } | undefined) {
  const desk = isDesk(ctx);
  const links = d?.links ?? [];
  const send = {
    kind: "condition", if: { falsy: "calLink" }, then: toast("Paste the link first"),
    else: call("POST", `${A}/plan/links`, { url: "$state.calLink", tz: ctx.tzOffsetMinutes }, {
      assignTo: "linked", ok: seq(clearState("calLink"), toast("Linked. Your meetings show here now."), toPlan),
      fail: { kind: "condition", if: { truthy: "lastError.message" }, then: toast("$state.lastError.message", true), else: toast("Couldn't link it. Try again.", true) } as ActionSpec, ...keep(ctx),
    }),
  } as ActionSpec;
  const steps = (key: string): Node => {
    const s = STEPS[key]!;
    const lines = s.steps.map((l, i) => row([text(`${i + 1}.`, { size: 14, color: C.meta, lineHeight: 20, style: { width: 18 } }), text(l, { size: 14, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 6, alignItems: "flex-start" }));
    return col([
      ...lines,
      ...(s.computer && !desk ? [text("On your computer, go to x0bot.com/cal. Then type its 6-number code here.", { size: 14, lineHeight: 20, color: C.meta })] : []),
      ...(desk && s.settings ? [row([text("Open its settings", { size: 14, weight: 500, lineHeight: 20 })], { minHeight: 32 }, { kind: "openUrl", url: s.settings, external: true } as ActionSpec)] : []),
      meta("Can't find it? Your work may have turned this off.", { size: 13 }),
    ], { gap: 8, paddingLeft: 4, paddingTop: 4 });
  };
  const choice = (key: string, i: number): Node => col([
    row([text(STEPS[key]!.name, { size: 16, lineHeight: 22 }), box([], { flexGrow: 1 }), icon("chevron", { size: 16, color: C.meta })], { minHeight: 48, alignItems: "center" }, setState("calOpen", key)),
    when({ eq: ["calOpen", key] }, steps(key)),
  ], { gap: 4, paddingHorizontal: 16, paddingVertical: 6, ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) });
  return page(ctx, {
    back: true, ...(desk ? { backTitle: "Plan Ease" } : {}), title: "Link your calendar", nav: "plan", maxWidth: 640, state: { calLink: "", calOpen: "" },
    body: [
      col([text("Link your calendar", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta("Where are your meetings?", { size: 15 })], { gap: 4 }),
      col(["google", "outlook", "icloud"].map(choice), { borderWidth: 1, borderColor: C.line, borderRadius: 20, overflow: "hidden" }),
      col([
        inputBox([field("calLink", "calLink", desk ? "Paste the link here" : "Paste the link, or the 6-number code", { onSubmit: send })]),
        primaryButton("Link", send, { wide: !desk }),
        meta("Keep this link private. I keep it locked and only read from it.", { size: 13, lines: 2 }),
      ], { gap: 10 }),
      ...(links.length ? [col([
        sectionLabel("Linked"),
        ...links.map((l) => row([
          col([text(l.name, { size: 15, lineHeight: 20 }), meta(l.stopped ? "Stopped updating. Paste its link again." : l.hint, { size: 13, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          quietButton("Take it out", call("DELETE", `${A}/plan/links/${enc(l.id)}`, undefined, { ok: seq(toast("Taken out"), refresh), fail: toast("Couldn't take it out. Try again.", true), ...keep(ctx) }), { size: "md" }),
        ], { gap: 12, alignItems: "center", paddingVertical: 6 })),
      ], { gap: 6 })] : []),
    ],
  });
}

// ===================================================================== a work meeting's details

export function linkedPage(ctx: BotsCtx, m: Meeting) {
  const when1 = m.allDay || m.start === null ? `${keyWords(m.day)}, all day` : `${keyWords(m.day)} · ${clockOf(ctx, m.start)}${m.end ? ` to ${clockOf(ctx, m.end)}` : ""}`;
  return page(ctx, {
    back: true, title: m.title, nav: "plan", maxWidth: 560,
    body: [
      text(m.title, { size: 20, weight: 600, lineHeight: 26 }),
      col([
        text(when1, { size: 15, lineHeight: 21 }),
        ...(m.place ? [text(m.place, { size: 15, lineHeight: 21 })] : []),
        ...(m.people > 1 ? [text(`${m.people} people`, { size: 15, lineHeight: 21 })] : []),
        text("From your work calendar", { size: 15, lineHeight: 21, color: C.meta }),
      ], { gap: 6, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
      meta("Change it in your work calendar.", { size: 14 }),
    ],
  });
}

// ===================================================================== a bill's details, and what a capture added

interface DueView { id: string; title: string; due: string | null; done: boolean; amountPaise?: number; payee?: string; payLink?: string; repeat?: string; from: string | null; captureId?: string }

const rupeesOf = (paise: number): string => {
  const r = Math.floor(paise / 100), s = String(r);
  const g = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}`;
  return `₹${g}${paise % 100 ? `.${String(paise % 100).padStart(2, "0")}` : ""}`;
};

/** A bill: its amount and payee (inside the app), when it's due, and Pay (only with a safe link), Paid, Take it out. */
export function duePage(ctx: BotsCtx, t: DueView, follow?: ItemFollow) {
  const doneBack = (m: string): ActionRef => seq(toast(m), back());
  const title = t.amountPaise ? `${t.title} ${rupeesOf(t.amountPaise)}` : t.title;
  return page(ctx, {
    back: true, title: t.title, nav: "plan", maxWidth: 560, ...(t.done ? {} : { state: followState(follow) }),
    body: [
      text(t.done ? `${title} · paid` : title, { size: 20, weight: 600, lineHeight: 26 }),
      col([
        ...(t.due ? [text(`Due ${keyWords(t.due)}${t.repeat === "monthly" ? " · every month" : ""}`, { size: 15, lineHeight: 21 })] : []),
        ...(t.payee ? [text(t.payee, { size: 15, lineHeight: 21 })] : []),
        ...(t.from ? [text(`From the ${t.from}`, { size: 15, lineHeight: 21, color: C.meta })] : [text("Added by you", { size: 15, lineHeight: 21, color: C.meta })]),
      ], { gap: 6, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
      ...(!t.payLink && !t.done ? [notice("Pay it from your bank or UPI app.")] : []),
      // Follow-through: Must not miss, who pays it (anyone on it who says paid stops it for everyone), its open follow.
      ...(t.done ? [] : followSection("task", t.id, follow)),
      ...captureFoot(ctx, t.captureId, t.from),
    ],
    footer: [row([
      ...(t.payLink && !t.done ? [primaryButton("Pay", { kind: "openUrl", url: t.payLink } as ActionSpec, { size: "md" })] : []),
      (t.payLink && !t.done ? secondaryButton : primaryButton)(t.done ? "Not paid yet" : "Paid", act(ctx, `pt:${t.id}`, t.done ? "unpaid" : "paid", { ok: doneBack(t.done ? "Back on your list" : "Paid") }), { size: "md" }),
      quietButton("Take it out", call("DELETE", `/v1/botsapp/calendar/tasks/${enc(t.id)}`, undefined, { ok: doneBack("Taken out"), fail: toast("Couldn't take it out. Try again.", true) }), { size: "md" }),
    ], { gap: 10, flexWrap: "wrap" })],
  });
}

/** "Take out all from the circular", in grey at the foot of anything a capture added. */
export function captureFoot(ctx: BotsCtx, captureId: string | undefined, label: string | null): Node[] {
  if (!captureId) return [];
  return [row([text(`Take out all from the ${label ?? "share"}`, { size: 14, color: C.meta, lineHeight: 19 })], { minHeight: 40 },
    act(ctx, `pc:${captureId}`, "takeout", { ok: seq(toast("Taken out"), toPlan) }))];
}

// ===================================================================== a notification's Pay

/** bots.plan.go with go=pay: the bill's safe pay link, read from the server (a push never carries it). */
export async function planGoLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }): Promise<{ url?: string }> {
  const item = String(ctx.params.item ?? "");
  if (ctx.params.go !== "pay" || !/^pt:[0-9a-f-]{36}$/i.test(item)) return {};
  return deps.api<{ url: string }>("GET", `${A}/plan/pay/${enc(item.slice(3))}`).catch(() => ({}));
}

// ===================================================================== the share-in screen

/**
 * The share-in screen asks the server first: is this Plan Ease's? (rules for words and PDFs, one tiny look at a photo; with
 * PLAN_V2_CAPTURE off, never). Yes: the card is what the screen shows, and it reloads as the card is read.
 */
export async function shareCapture(ctx: BotsCtx, deps: { api<T>(m: "POST", p: string, b?: unknown): Promise<T> }, files: string[], words: string): Promise<CaptureView | undefined> {
  if (!files.length && !words) return undefined;
  const r = await deps.api<{ capture?: CaptureView; plan?: false }>("POST", `${A}/plan/capture/look`, {
    files, ...(words ? { text: words.slice(0, 6000) } : {}), ...(ctx.params.from === "plan" ? { from: "plan" } : {}), tz: ctx.tzOffsetMinutes,
  }).catch(() => undefined);
  return r?.capture;
}

// ===================================================================== the screens

export const planInScreens: BotsScreen[] = [
  screen<{ links: LinkView[] }>({
    id: SCREENS.planLink,
    load: (_ctx, deps) => deps.api("GET", `${A}/plan/links`),
    build: (ctx, d) => linkPage(ctx, d),
  }),
  screen<{ capture: CaptureView }>({
    id: SCREENS.planCapture,
    load: (ctx, deps) => deps.api("GET", `${A}/plan/capture/${enc(String(ctx.params.id ?? ""))}`),
    build: (ctx, d) => capturePage(ctx, d?.capture),
  }),
  screen<{ capture?: CaptureView; people?: Person[] }>({
    id: SCREENS.planCaptureItem,
    load: async (ctx, deps) => {
      const id = enc(String(ctx.params.id ?? ""));
      const [c, w] = await Promise.all([
        deps.api<{ capture: CaptureView }>("GET", `${A}/plan/capture/${id}`),
        deps.api<{ people: Person[] }>("GET", `${A}/plan/capture/${id}/who`).catch(() => ({ people: [] as Person[] })),
      ]);
      return { capture: c.capture, people: w.people };
    },
    build: (ctx, d) => captureItemPage(ctx, d),
  }),
];
