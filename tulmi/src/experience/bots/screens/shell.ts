/**
 * THE SHELL: Home, and what is around it (Activity, Ask, Search, Tasks, Approve, the system states), and the window's own page
 * Today. Notes (the meetings, and one meeting) is its own: screens/notes.ts; Home has its tile.
 *
 * bots.home is the REFERENCE SCREEN (Main.dc.html on the phone, DeskHome.dc.html in the window): copy its shape.
 * Everything it shows is ctx.live (live.ts); its one read is whether the person has done anything yet, so a new person lands
 * on the empty home (EmptyHome) instead of four idle tiles. Its actions are real: a bot's tile opens the bot, the needs-you
 * choices answer the job (POST /v1/code/jobs/:id/answer) or the task, the ask bar sends to the front door (POST /v1/ask).
 *
 * What the other screens read is the shell's own routes (routes/bots/botsShell.ts, src/shell): one feed across Xode jobs, answers
 * bots gave, payments, Keylessbord's words and connected-app tasks (/v1/shell/activity), search across projects, chats, notes, files
 * and bots (/v1/shell/search), who will answer without answering (/v1/shell/route), today's calendar and words (/v1/shell/today),
 * today's tasks (/v1/shell/tasks), and receipts. Money is always "you press pay": bots.approve opens the person's UPI app with the
 * payment the bot filled in (the UPI hand-off), and writes a receipt only when they say they paid.
 */

import type { NotesStats } from "../../../notes/stats.js";
import { clockOf, dayLabel } from "../../../shell/feed.js";
import { upiOf } from "../../../shell/parse.js";
import type { SearchResult, SearchKind } from "../../../shell/search.js";
import { nicknameOf } from "../../assistantName.js";
import {
  duration, type BotsCtx, page, hasOutbox, needsCard, askBar, botLook, open, SCREENS, box, text, C, row, col, card, meta, seq, roundButton,
  sectionLabel, grid, icon, grow, botAvatar, botRoute, labelled, back, emptyState, mono, secondaryButton, title, segmented, when,
  statusMark, button, toTab, call, blip, primaryButton, listCard, listRow, canHomeThought, canSpaces2,
} from "../kit.js";
import { type BotsScreen, screen } from "../registry.js";
import { type DeletionState, DELETION_PATH } from "./accountGrace.js";
import { type AiConsent, AI_CONSENT_PATH } from "./firstRun/aiConsentCard.js";
import { ABOUT_PATH } from "./firstRun/aboutCard.js";
import { arrivalCard, ARRIVAL_PATH } from "./firstRun/arrivalCard.js";
import type { About } from "./firstRun/parts.js";
import { A as SPACES_API, type Space } from "./spaces/parts.js";
import { hasNotes, NOTES_STATS_PATH } from "./notes.js";
import { outboxCard, offlineKept } from "./outbox.js";
import { PUSH_ASK_PATH } from "./pushAsk.js";
import { routinesRow, ROUTINES_PATH, type RoutinesData } from "./routines.js";
import { FINDS_PATH, isFindsId } from "./finds.js";
import type { Card } from "../../../everyday/index.js";
import { type ActivityData, activityDesk, activityPhone } from "./shell/activity.js";
import { stepDot, approveTop, approvePay } from "./shell/approvePay.js";
import { askAnswer } from "./shell/askAnswer.js";
import { type Route, askCompose } from "./shell/askCompose.js";
import { type HomeMore, homeHead, homeNotices, hello, tiles, homePull, homePhone } from "./shell/home.js";
import { HOME_THOUGHT_STATE, homeTalkTo, homeThought } from "./shell/homeThought.js";
import { offline } from "./shell/offline.js";
import { field, toast, kbd, couldNot, avatarOf, nameOf } from "./shell/parts.js";
import { KIND_WORDS, searchField, hitWords, hitIcon, openHit, searchDesk } from "./shell/searchDesk.js";
import { type TasksData, tasksLine, taskChoices, taskRowNode, upcomingNodes, tasksDesk } from "./shell/tasksDesk.js";
import { type TodayData, today } from "./shell/today.js";

/** "4 things done this week · 2 h saved", or the nearest true thing. */
export function weekLine(week: { done: number; minutesSaved: number }): string {
  const done = week.done === 1 ? "1 thing done this week" : `${week.done} things done this week`;
  const saved = week.minutesSaved > 0 ? `${duration(week.minutesSaved)} saved` : "";
  if (week.done > 0) return saved ? `${done} · ${saved}` : done;
  return saved ? `${saved} this week` : "Nothing done yet this week";
}

function homeDesk(ctx: BotsCtx, arrival = false, more: HomeMore = {}) {
  const first = ctx.live.needs[0];
  const { head, pinned } = homeHead(ctx);
  const n = homeNotices(ctx, arrival, more);
  const thought = canHomeThought(ctx);
  return page(ctx, {
    tab: "bots", title: "Your bots", state: { ...n.state, ...(thought ? HOME_THOUGHT_STATE : {}) }, pinned, ...(hasNotes(ctx) ? { live: ["notes"] } : {}),
    body: [
      head,
      ...n.leaving,
      ...n.about,
        ...(hasOutbox(ctx) ? outboxCard(ctx) : []),
      // The first time here: one card for this computer's microphone and Accessibility, over Home, and the bot saying hello.
      ...(n.arrival ? [...arrivalCard(ctx), hello(ctx, more)] : []),
      ...(first ? [needsCard(first, { layout: "row" })] : []),
      tiles(ctx, 4, 150, 18, more.notes, more.groups),
      ...routinesRow(ctx, more.routines),
    ],
    // Ask any bot: his thought at the foot of the window where the build draws it, else the ask bar.
    ...(thought ? { dock: [homeThought(ctx)], talkTo: homeTalkTo(ctx) } : { footer: [askBar("desktop", { ctx })] }),
  });
}

// ===================================================================== the empty home
const IDEAS = [
  { label: "Plan my week", body: "Every Sunday at 8 pm it lays out your week from your calendar. You say yes to each block.", uses: "Uses Calendar", icon: "calendar" as const },
  { label: "Track my gym days", body: "Counts your sessions, keeps your streak, and goes easy when you say you're sore.", uses: "Uses Reminders", icon: "dumbbell" as const },
  { label: "Rent yaad dilana, 1st ko", body: "On the 1st it reminds you and opens UPI with the rent filled in. You press pay.", uses: "Uses Reminders, UPI", icon: "rupee" as const },
];

/**
 * The first day (EmptyHome, DEmptyHome): Home's own living header on top (homeHead: the greeting and the bold time-aware line, the
 * living mark, the compact bar once scrolled), then Blip saying hello, Keylessbord already on, and making the first bot.
 */
function emptyHome(ctx: BotsCtx, arrival = false, more: HomeMore = {}) {
  const { head, pinned } = homeHead(ctx);
  const n = homeNotices(ctx, arrival, more);
  const keybot = ctx.live.bots.find((b) => b.slug === "keybot") ?? botLook("keybot");
  const make = (idea?: string) => open(SCREENS.make, idea ? { idea } : undefined);
  const fnKey = (w: number, h: number, size: number) => box([text("Fn", { size, weight: 500, color: botLook("keybot").color, lineHeight: size + 4, align: "center" })], {
    width: w, height: h, borderRadius: 10, borderWidth: 1.5, borderColor: botLook("keybot").color, backgroundColor: C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });

  if (ctx.client === "desktop") {
    return page(ctx, {
      tab: "bots", title: "Your bots", gap: 20, maxWidth: 1100, pinned,
      state: { draft: "", ...n.state },
      body: [
        head,
        ...n.leaving,
        ...n.about,
        ...(n.arrival ? arrivalCard(ctx) : []),
        row([
          col([
            hello(ctx, more),
            card([
              col([text("Make your first bot", { size: 18, weight: 600, lineHeight: 23 }), meta("Say what it should do. It shows you the plan before it acts.", { size: 14, lineHeight: 19 })], { gap: 3 }),
              row([
                field("draft", "A bot that…", { size: 16, onSubmit: seq({ kind: "condition", if: { falsy: "draft" }, then: toast("Say what it should do first"), else: open(SCREENS.make, { say: "$state.draft" }) }) }),
                roundButton("mic", { kind: "dictate" }, { size: 48, label: "Speak instead" }),
              ], { gap: 14, borderWidth: 1.5, borderColor: C.ink, borderRadius: 18, paddingVertical: 10, paddingRight: 12, paddingLeft: 18 }),
              row([meta("Hindi, English or both · hold", { size: 12 }), kbd("Fn"), meta("anywhere to speak", { size: 12 })], { gap: 6 }),
            ], { padding: 20, gap: 14, radius: 18 }),
            col([
              sectionLabel("Or start from an idea"),
              grid(IDEAS.map((i) => col([
                row([box([icon(i.icon, { size: 18, color: C.ink })], { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }), grow(), icon("chevron", { size: 16, color: C.meta })]),
                text(i.label, { size: 15, weight: 600, lineHeight: 20 }),
                text(i.body, { size: 13, color: C.grey70, lineHeight: 18 }),
                meta(i.uses, { size: 12 }),
              ], { gap: 8, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, make(i.label))), 3, 14),
            ], { gap: 10 }),
          ], { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 20 }),
          col([
            card([
              row([botAvatar(keybot, 36), col([text("Keylessbord is on", { size: 15, weight: 600, lineHeight: 20 }), meta("Your first bot · free")], { gap: 2 })], { gap: 12 }),
              col([fnKey(64, 56, 17), text("Hold Fn to speak, in any app", { size: 14, weight: 500, lineHeight: 19, align: "center" })], {
                gap: 10, padding: 18, borderRadius: 14, backgroundColor: C.surface, alignItems: "center",
              }),
              text("Try it in Gmail or WhatsApp: hold Fn, say “Kal 10 baje call karte hain”, let go.", { size: 13, color: C.grey70, lineHeight: 18 }),
            ], { padding: 18, gap: 14, radius: 18, onPress: botRoute("keybot") }),
            card([
              sectionLabel("How a bot works"),
              ...[["You say what it should do", "Type it, or hold Fn and speak"], ["It shows you the plan first", "Nothing happens before you see it"], ["You say go", "Money is always: you press pay"]]
                .map(([a, b], i) => row([stepDot(i + 1), col([text(a!, { size: 14, weight: 500, lineHeight: 19 }), meta(b!)], { gap: 1, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" })),
            ], { padding: 18, gap: 14, radius: 18 }),
          ], { width: 292, flexShrink: 0, gap: 18 }),
        ], { gap: 28, alignItems: "flex-start" }),
      ],
    });
  }

  return page(ctx, {
    tab: "bots", title: "Your bots", gap: 16, state: n.state, pinned, pullBot: homePull(ctx),
    body: [
      head,
      ...n.leaving,
      ...n.about,
      ...(n.arrival ? arrivalCard(ctx) : []),
      hello(ctx, more),
      // The bots they already have (Keylessbord, Code, Plan, Travel), as Home shows them once they've started.
      tiles(ctx, 2, 132, 16, more.notes, more.groups),
      ...routinesRow(ctx, more.routines),
      col([
        row([
          col([text("Make your first bot", { size: 20, weight: 700, tracking: -0.3, lineHeight: 25 }), text("Say what it should do. It shows you the plan before it acts.", { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 4, flexGrow: 1, flexShrink: 1 }),
          box([icon("plus", { size: 24, color: C.paper })], { width: 52, height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }),
        ], { gap: 14 }, make()),
        col([
          sectionLabel("Or start from an idea"),
          row(IDEAS.map((i) => row([text(i.label, { size: 13, lineHeight: 17 })], {
            paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline,
          }, make(i.label))), { gap: 8, flexWrap: "wrap" }),
        ], { gap: 8 }),
      ], { padding: 18, gap: 14, borderRadius: 22, borderWidth: 1, borderColor: C.line }),
    ],
  });
}

function activityLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }) {
  return deps.api<ActivityData>("GET", `/v1/shell/activity?tz=${ctx.tzOffsetMinutes}`);
}

// ===================================================================== search
function searchLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }) {
  const q = String(ctx.params.q ?? "").trim();
  return q ? deps.api<SearchResult>("GET", `/v1/shell/search?q=${encodeURIComponent(q)}&tz=${ctx.tzOffsetMinutes}`) : Promise.resolve(undefined as unknown as SearchResult);
}

function searchPhone(ctx: BotsCtx, data: SearchResult | undefined) {
  const q = String(ctx.params.q ?? "").trim();
  const groups = data ? (Object.keys(KIND_WORDS) as SearchKind[]).filter((k) => data.groups[k].length) : [];
  return page(ctx, {
    title: "Search", gap: 16, state: { q },
    body: [
      row([labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"), searchField(false)], { gap: 4 }),
      ...(!q ? [emptyState({ pose: "listen", title: "Search everything", body: "Your projects, chats, notes, files and bots, in one place." })]
        : !data ? [couldNot("results")]
          : !data.total ? [emptyState({ pose: "think", title: `Nothing for “${q}”`, body: "Try fewer words, or ask your bots.", action: { label: `Ask your bots about “${q}”`, onPress: open(SCREENS.ask, { message: q }) } })]
            : [
              meta(`${data.total} ${data.total === 1 ? "result" : "results"} in projects, chats, notes, files and bots`, { size: 13 }),
              ...groups.map((k) => col([
                sectionLabel(KIND_WORDS[k]),
                ...data.groups[k].map((h) => {
                  const w = hitWords(h);
                  return row([
                    hitIcon(ctx, h, 36),
                    col([
                      h.kind === "files" ? mono(w.line, { size: 12 }) : text(w.line, { size: 15, weight: h.kind === "bots" ? 600 : 400, lineHeight: 20, lines: 2, ...(h.kind === "chats" ? { color: C.grey70 } : {}) }),
                      meta(w.sub, { lines: 1 }),
                    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
                    ...(h.bot && h.kind !== "bots" ? [avatarOf(ctx, h.bot, 26)] : []),
                  ], { gap: 12, paddingVertical: 9 }, openHit(h));
                }),
              ], { gap: 4 })),
            ]),
    ],
    ...(q ? { footer: [secondaryButton(`Ask your bots about “${q}”`, open(SCREENS.ask, { message: q }), { wide: true })] } : {}),
  });
}

function tasksPhone(ctx: BotsCtx, d: TasksData | undefined) {
  const needs = ctx.live.needs;
  const rest = (d?.rows ?? []).filter((r) => r.mark !== "needs");
  const upCount = d?.upcoming.todos?.length ?? 0;
  return page(ctx, {
    tab: "bots", title: "Tasks", gap: 16, state: { tview: "today" },
    body: [
      row([
        col([title("Tasks"), meta(tasksLine(d), { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
        roundButton("plus", open(SCREENS.ask), { size: 44, light: true, label: "Add a task" }),
      ], { gap: 10 }),
      segmented([{ label: `Today · ${needs.length + rest.length}`, value: "today" }, { label: `Upcoming · ${upCount}`, value: "upcoming" }], "tview"),
      ...(d ? [] : [couldNot("your tasks")]),
      when({ eq: ["tview", "today"] }, col([
        ...(needs.length ? [col([
          sectionLabel(`Needs you · ${needs.length}`),
          ...needs.map((n) => col([
            row([
              avatarOf(ctx, n.bot, 30),
              col([text(n.question, { size: 15, weight: 600, lineHeight: 20, lines: 2 }), meta([n.botName, n.detail].filter(Boolean).join(" · "), { lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
              statusMark("needs"),
            ], { gap: 12, alignItems: "flex-start" }),
            row(taskChoices(n).map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8, flexWrap: "wrap" }),
          ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line })),
        ], { gap: 10 })] : []),
        ...(rest.length ? [col([sectionLabel(`Rest of today · ${rest.length}`), ...rest.map((r) => taskRowNode(ctx, r, 30))], { gap: 14 })] : []),
        ...(d && !needs.length && !rest.length ? [emptyState({ pose: "hello", title: "Nothing on today", body: "Ask a bot for something and it shows up here.", action: { label: "Add a task", onPress: open(SCREENS.ask) } })] : []),
      ], { gap: 16 })),
      when({ eq: ["tview", "upcoming"] }, col(upcomingNodes(ctx, d), { gap: 12 })),
    ],
  });
}

// ===================================================================== approve
interface Receipt { id: string; bot: string; title: string; amountPaise: number; payee: string; at: number }
interface ApproveData { task?: { id: string; state: string; title: string; approval: { id: string; connector: string; tool: string; preview: string } | null; updatedAt: number } | null; receipt?: Receipt | null }

async function approveLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }): Promise<ApproveData> {
  if (ctx.params.task) {
    const r = await deps.api<{ tasks: NonNullable<ApproveData["task"]>[] }>("GET", "/v1/tasks");
    return { task: (r.tasks ?? []).find((t) => t.id === String(ctx.params.task)) ?? null };
  }
  if (ctx.params.receipt) {
    const r = await deps.api<{ receipt: Receipt }>("GET", `/v1/shell/receipts/${encodeURIComponent(String(ctx.params.receipt))}`);
    return { receipt: r.receipt };
  }
  return {};
}

function approveTask(ctx: BotsCtx, d: ApproveData | undefined) {
  const t = d?.task;
  const waiting = t && t.state === "waiting" && t.approval;
  const slug = t?.approval ? ({ "google-calendar": "plan", "google-tasks": "plan", maps: "travel", booking: "travel" } as Record<string, string>)[t.approval.connector] ?? "tailzu" : "tailzu";
  if (!waiting) {
    return page(ctx, {
      back: true, title: "Approve", nav: "activity",
      body: [d ? emptyState({ pose: "done", title: "Nothing waiting here", body: t ? "This one was already answered." : "It may have expired. Anything that needs you is in Activity.", action: { label: "Open Activity", onPress: toTab("activity") } }) : couldNot("this request")],
    });
  }
  const app = t.approval!.connector.replace(/^google-/, "Google ").replace(/(^|\s)\w/g, (m) => m.toUpperCase());
  const yes = call("POST", `/v1/tasks/${t.id}/approve`, { approvalId: t.approval!.id }, { ok: seq(toast("Done"), back()), fail: toast("Couldn't do that. Try again.", "error") });
  const no = call("POST", `/v1/tasks/${t.id}/deny`, undefined, { ok: seq(toast("Left it"), back()), fail: toast("Couldn't do that. Try again.", "error") });
  const fine = `${nameOf(ctx, slug)} does only this, once. The yes holds for an hour.`;
  const words = col([
    sectionLabel(`The exact change · ${app}`),
    text(t.approval!.preview, { size: 15, lineHeight: 21 }),
  ], { gap: 8, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line });
  const question = ctx.client === "desktop"
    ? row([blip("needs", 84), col([title(t.title), meta(`${app} · waiting since ${clockOf(t.updatedAt, ctx.tzOffsetMinutes)}`, { size: 14, lineHeight: 19 })], { gap: 6, flexShrink: 1 })], { gap: 18 })
    : col([blip("needs", 140), sectionLabel("Needs you"), text(t.title, { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { gap: 6 });
  return page(ctx, {
    title: "Approve", gap: ctx.client === "desktop" ? 18 : 14,
    body: [approveTop(ctx, slug, "needs"), question, words, ...(ctx.client === "desktop" ? [row([primaryButton("Yes, do it", yes, { size: "md" }), secondaryButton("No", no, { size: "md" })], { gap: 10 }), meta(fine, { size: 13 })] : [])],
    ...(ctx.client === "desktop" ? {} : { footer: [primaryButton("Yes, do it", yes, { wide: true }), secondaryButton("No", no, { wide: true }), meta(fine, { align: "center" })] }),
  });
}

function approveReceipt(ctx: BotsCtx, d: ApproveData | undefined) {
  const r = d?.receipt;
  if (!r) return page(ctx, { back: true, title: "Receipt", nav: "activity", body: [d ? emptyState({ pose: "think", title: "No such receipt", action: { label: "Open Activity", onPress: toTab("activity") } }) : couldNot("this receipt")] });
  const at = `${dayLabel(r.at, ctx.live.now, ctx.tzOffsetMinutes)}, ${clockOf(r.at, ctx.tzOffsetMinutes)}`;
  return page(ctx, {
    back: true, backTitle: "Receipt", title: "Receipt", nav: "activity", gap: 18,
    body: [
      row([statusMark("done", { size: 10 }), sectionLabel("Paid")], { gap: 8 }),
      title(`Paid ${r.payee || "the payee"}`),
      listCard([
        listRow({ label: "For", value: r.title }), listRow({ label: "Paid to", value: r.payee || "—" }),
        listRow({ label: "Filled in by", value: nameOf(ctx, r.bot) }), listRow({ label: "When", value: at }),
      ]),
      meta("You pressed pay by UPI. Your UPI app has the bank's reference.", { size: 13 }),
    ],
  });
}

// ===================================================================== the list
export const shellScreens: BotsScreen[] = [
  screen<{ arrival?: boolean } & HomeMore>({
    id: SCREENS.home,
    // Whether the first-arrival card (and the bot's hello) is due (once, after onboarding), the name they gave their bot, whether the
    // account has a deletion date, (a phone) whether the notifications ask was ever answered, and Notes' week for its tile.
    load: async (ctx, deps) => {
      const [arrival, leaving, push, notes, persona, routines, about, groups, ai] = await Promise.all([
        deps.api<{ due: boolean; kind?: "first" | "back" }>("GET", ARRIVAL_PATH).catch(() => undefined),
        deps.api<DeletionState>("GET", DELETION_PATH).catch(() => undefined),
        ctx.client === "phone" ? deps.api<{ due: boolean }>("GET", PUSH_ASK_PATH).catch(() => undefined) : Promise.resolve(undefined),
        hasNotes(ctx) ? deps.api<NotesStats>("GET", NOTES_STATS_PATH).catch(() => undefined) : Promise.resolve(undefined),
        // The name they gave their bot, for the first day's hello.
        deps.api<{ personality?: { assistantName?: string } }>("GET", "/v1/personality").catch(() => undefined),
        // Routines, for Home's row once there is one (screens/routines.ts).
        deps.api<RoutinesData>("GET", ROUTINES_PATH).catch(() => undefined),
        // The About you card (firstRun/aboutCard.ts): due after a few visits, while the name and gender are owed.
        deps.api<About>("GET", ABOUT_PATH).catch(() => undefined),
        // The groups (family, friends): each a bot of its own on Home, or (the new Spaces) one Space card with their newest line.
        deps.api<{ spaces?: Space[] }>("GET", `${SPACES_API}/spaces${canSpaces2(ctx) ? "?last=1" : ""}`).catch(() => undefined),
        // The AI permission (firstRun/aiConsentCard.ts): asked before anything else, until they agree.
        deps.api<AiConsent>("GET", AI_CONSENT_PATH).catch(() => undefined),
      ]);
      return {
        arrival: arrival?.due === true, back: arrival?.kind === "back", leaving, push: push?.due === true, notes, botName: nicknameOf(persona?.personality), routines, about,
        groups: groups?.spaces, ai,
      };
    },
    build: (ctx, data) => {
      const arrival = !!data?.arrival, more: HomeMore = {
        leaving: data?.leaving, push: data?.push === true, notes: data?.notes, botName: data?.botName, back: data?.back === true, routines: data?.routines, about: data?.about, groups: data?.groups,
        ai: data?.ai,
      };
      // One Home for everyone, new or not; the bot's hello on top only the first time.
      return ctx.client === "desktop" ? homeDesk(ctx, arrival, more) : homePhone(ctx, arrival, more);
    },
  }),
  screen({ id: SCREENS.empty, build: (ctx) => emptyHome(ctx) }),
  screen<ActivityData>({ id: SCREENS.activity, load: activityLoad, build: (ctx, d) => (ctx.client === "desktop" ? activityDesk(ctx, d) : activityPhone(ctx, d)) }),
  screen<Route & { cards?: Card[] }>({
    id: SCREENS.ask,
    // Composing: who would answer what they typed. An answer: the cards its everyday tools found (screens/finds.ts), when it has any.
    load: (ctx, deps) => (ctx.params.answer !== undefined && isFindsId(ctx.params.finds)
      ? deps.api<{ cards: Card[] }>("GET", `${FINDS_PATH}/${ctx.params.finds}`) as Promise<Route & { cards?: Card[] }>
      : ctx.params.message && ctx.params.answer === undefined && ctx.params.id === undefined && !ctx.params.bot
        ? deps.api<Route>("POST", "/v1/shell/route", { message: String(ctx.params.message) })
        : Promise.resolve(undefined as unknown as Route)),
    build: (ctx, pre) => (ctx.params.answer !== undefined || ctx.params.id !== undefined ? askAnswer(ctx, pre?.cards) : askCompose(ctx, pre)),
  }),
  screen<SearchResult>({ id: SCREENS.search, load: searchLoad, build: (ctx, d) => (ctx.client === "desktop" ? searchDesk(ctx, d) : searchPhone(ctx, d)) }),
  screen<TasksData>({ id: SCREENS.tasks, load: (ctx, deps) => deps.api<TasksData>("GET", `/v1/shell/tasks?tz=${ctx.tzOffsetMinutes}`), build: (ctx, d) => (ctx.client === "desktop" ? tasksDesk(ctx, d) : tasksPhone(ctx, d)) }),
  screen<ApproveData>({
    id: SCREENS.approve, load: approveLoad,
    build: (ctx, d) => (upiOf(ctx.params.upi) ? approvePay(ctx, String(ctx.params.upi)) : ctx.params.receipt ? approveReceipt(ctx, d) : approveTask(ctx, d)),
  }),
  screen({ id: SCREENS.offline, build: (ctx) => offlineKept(ctx, offline(ctx)) }),
  screen<TodayData>({ id: SCREENS.today, load: (ctx, deps) => deps.api<TodayData>("GET", `/v1/shell/today?tz=${ctx.tzOffsetMinutes}`), build: today }),
];
