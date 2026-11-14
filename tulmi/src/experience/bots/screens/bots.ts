/**
 * THE BOTS THEMSELVES: a bot's page and its chat, Make a bot, Edit, its keys, Find a bot, Plan Ease, the Travel bot, the Oracle, the mail bot, Spaces, sending a
 * shared file or link to a bot, and Blip's five moments (BotPage, Chat, MakeBot, BotEdit, BotKeys, BotStore, PlanBot, TravelBot, Spaces,
 * ShareIn, Avatars; D<Board> in the window).
 *
 * One id serves the phone and the window (ctx.client). Data comes from the app's own routes through deps.api: the bots platform
 * (/v1/bots/..., docs/bots.md), connected apps (/v1/connectors, /v1/tasks), files (/v1/files), and this area's routes
 * (/v1/botsapp/bots/..., routes/bots/botsBots.ts over src/botsBots). A read that fails draws the honest empty state, never a made-up number.
 * Every write is a callEndpoint, then a refresh and a short ink toast; money is always "you press pay".
 */

import type { Node, ActionRef } from "../../../../../shared/types/sdui.js";
import { withoutAmounts } from "../../../shell/parse.js";
import {
  type BotsCtx, page, emptyState, toTab, row, labelled, box, icon, back, botAvatar, col, text, grow, open, SCREENS, listRow, meta, mono,
  headerBuddy, quietButton, body, C, chip, listCard, title, sectionLabel, notice, primaryButton, call, card, grid, divider, seq, button,
  infoChip, when, chips, statusMark, meter, roundButton, needsCard, type LiveBot, secondaryButton, blip, hasSpaces, canPersonBot,
} from "../kit.js";
import { type BotsScreen, screen } from "../registry.js";
import { shareButtonsFor } from "../shareAction.js";
import { usesLine, apiLine, stateLine, starters, liveOf, botDesk } from "./bots/botDesk.js";
import { type EditData, editParts, type App, editDesk } from "./bots/editDesk.js";
import { type KeysData, keysParts, snippets, copyAction, codeBlock, type KeyView, type Usage, keysDesk } from "./bots/keysDesk.js";
import { type DraftView, saidFirst, describeBox, EXAMPLES, drafting, draftCard, trialPart, approveDraft, makeDesk } from "./bots/makeDesk.js";
import {
  type BotPageData, type BotView, enc, type Memory, type Linked, type Turn, A, lookOf, plural, ANSWERING, chatTurns, askBot, chatBar,
  isDesk, setState, write, toast, link, refresh, inputBox, field, clockOf, MIN, WEEKDAYS, MONTHS, ifFilled, shortDate, clearState, dotLine,
} from "./bots/parts.js";
import {
  type PlanRead, planWeek, type PlanDay, fromWords, lengthWords, todoRow, dayLabelOf, keyDate, planGo, PLAN_WEEKDAYS_LONG, planHeadLine,
  keyWords, planShare, suggestionCard, openTodos, planChips, planDesk,
} from "./bots/planDesk.js";
import {
  type MediaFile, kb, type ShareData, sharedOf, sharePick, shareBots, defaultAsk, ASK_ANY, SHARE_LINE, sharedCard, shareSend, shareLineFor,
  sharePeople, type Attachment, sharePhone,
} from "./bots/sharePhone.js";
import * as places from "./botsPlaces.js";
import { itemAction, addAction, planItemScreens } from "./planItem.js";
import { tripSearches } from "./finds.js";
import { loadWork, workCtx, type WorkRead } from "./work/workTab.js";
import { planGoPage, planTodayDesk, planTodayPhone, planWeekPage, type PlanTodayData, type PlanWeekData } from "./bots/planPage.js";
import { planCallPage } from "./bots/planCall.js";
import { CALLS, type CallView } from "../../../botsBots/planCallWords.js";
import { capturePage, planGoLoad, planInScreens, shareCapture, type CaptureView } from "./bots/planIn.js";
import { planPeopleScreens } from "./bots/planSend.js";
import { planFollowScreens } from "./bots/planFollow.js";
import { followPhoneScreens } from "./bots/followPhone.js";
import { homeOn, planOn } from "../../../botsBots/planSwitch.js";
import { planHomeDesk, planHomePhone, planDayQuery, type PlanDayData } from "./bots/planHome.js";
import { planMakeScreens } from "./bots/planMake.js";
import { oraclePage, type OracleSkyView, type OraclePageData } from "./bots/oraclePage.js";
import { mailPage, type MailPageData } from "./bots/mailPage.js";
import { loadMail, mailScreens } from "./bots/mailScreens.js";
import { mailInboxScreens } from "./bots/mailInbox.js";
import { mailAliasScreens } from "./bots/mailAliases.js";
import { mailCallScreens } from "./bots/mailCalls.js";
import type { MailData } from "./bots/mailParts.js";
import { meetPage, type MeetPageData } from "./bots/meetPage.js";
import { loadMeet, meetScreens, type MeetData } from "./bots/meetScreens.js";
import type { About } from "./firstRun/parts.js";
import type { Moves } from "../../../bots/healthDays.js";
import { HEALTH_PAGE_STATE, healthRefresh, movesLine } from "./bots/health.js";

/** Plan Ease's simpler page: on while PLAN_V2_PAGE is, for a build that draws people as their tiny bots; an older one keeps the week. */
const planV2 = (ctx: BotsCtx): boolean => planOn("page") && canPersonBot(ctx);
/** The threaded home (screens/bots/planHome.ts): the same builds, with PLAN_V2_HOME too; off, the simpler page as it was. */
const homeFor = (ctx: BotsCtx): boolean => planV2(ctx) && homeOn();

const slugParam = (ctx: BotsCtx): string => String(ctx.params.slug ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

async function loadBot(ctx: BotsCtx, deps: Parameters<NonNullable<BotsScreen["load"]>>[1], turnsLimit: number, o: { mail?: boolean; meet?: boolean } = {}): Promise<OraclePageData & MailPageData & MeetPageData> {
  const slug = slugParam(ctx);
  if (!slug) return {};
  const [one, memory, linked, chat, sky, about, mail, meet] = await Promise.all([
    deps.api<{ bot?: BotView }>("GET", `/v1/bots/${enc(slug)}`).catch(() => undefined),
    deps.api<Memory>("GET", `/v1/bots/${enc(slug)}/memory`).catch(() => undefined),
    deps.api<{ connectors: Linked[] }>("GET", `/v1/bots/${enc(slug)}/connectors`).then((r) => r.connectors).catch(() => undefined),
    deps.api<{ turns: Turn[] }>("GET", `${A}/chat/${enc(slug)}?limit=${turnsLimit}`).then((r) => r.turns).catch(() => undefined),
    // The Oracle's own card: when and where they were born (routes/bots/oracle.ts).
    slug === "oracle" ? deps.api<OracleSkyView>("GET", "/v1/oracle/sky").catch(() => undefined) : Promise.resolve(undefined),
    // And whether its last card is owed: the person's name and gender, as the About you card reads them.
    slug === "oracle" ? deps.api<About>("GET", "/v1/bots/first-run/about").catch(() => undefined) : Promise.resolve(undefined),
    // The mail bot's page: its businesses' mail (routes/bots/mail.ts), on bots.bot only (its chat is the usual one).
    slug === "mail" && o.mail ? loadMail(ctx, deps).catch((): MailData => ({ down: true })) : Promise.resolve(undefined),
    // The meeting bot's page: its meetings (routes/bots/meet.ts), on bots.bot only (its chat is the usual one).
    slug === "meet" && o.meet ? loadMeet(ctx, deps).catch((): MeetData => ({ down: true })) : Promise.resolve(undefined),
  ]);
  // THE MOVES COUNTS, on their own route and only for a bot that is counting (docs: perms §4.6). They are asked for after
  // the bot is known, and only then, so a page that can never show them never reads a health row, and nothing on the bot's
  // own route carries one.
  const moves = one?.bot?.skills.health
    ? await deps.api<{ moves: Moves | null }>("GET", `/v1/bots/${enc(slug)}/health/moves`).then((r) => r.moves).catch(() => undefined)
    : undefined;
  return {
    bot: one?.bot, memory, linked, turns: chat, ...(moves ? { moves } : {}),
    ...(sky ? { sky } : {}), ...(about ? { about } : {}), ...(mail ? { mail } : {}), ...(meet ? { meet } : {}),
  };
}

/** The Oracle is the chat and nothing in its way: its bot page and its chat are one page (screens/bots/oraclePage.ts). */
const isOracle = (d: BotPageData): boolean => d.bot?.slug === "oracle" && d.bot.builtin;
/** The mail bot's page is its mail (screens/bots/mailPage.ts); its chat is the usual chat. */
const isMail = (d: BotPageData): boolean => d.bot?.slug === "mail" && d.bot.builtin;
/** The meeting bot's page is its meetings (screens/bots/meetPage.ts); its chat is the usual chat. */
const isMeet = (d: BotPageData): boolean => d.bot?.slug === "meet" && d.bot.builtin;

function noBot(ctx: BotsCtx): ReturnType<typeof page> {
  return page(ctx, {
    back: true, title: "Bot", nav: "bots",
    body: [emptyState({ pose: "think", title: "Couldn't open this bot", body: "It may have been deleted, or the connection dropped.", action: { label: "Back to your bots", onPress: toTab("bots") } })],
  });
}

/**
 * The phone's head of a bot's own page: back, the bot, its line in its colour (BotPage, PlanBot, TravelBot), and at
 * its right end the bot's own tiny bot where the build draws it (`buddy`, kit headerBuddy).
 */
function phoneHead(look: ReturnType<typeof lookOf>, name: string, line: string, lineColor?: string, buddy: Node[] = []): Node {
  return row([
    labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
    botAvatar(look, 40),
    col([text(name, { size: 19, weight: 600, lineHeight: 24 }), text(line, { size: 12, weight: 500, color: lineColor ?? look.color, lineHeight: 16, lines: 1 })], { gap: 2, flexShrink: 1 }),
    ...(buddy.length ? [grow(), ...buddy] : []),
  ], { gap: 10 });
}

function botPhone(ctx: BotsCtx, d: BotPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const turns = (d.turns ?? []).slice(-2);
  const facts = d.memory?.facts ?? [];
  const edit = open(SCREENS.edit, { slug: bot.slug });
  const info: Node[] = [
    listRow({ label: `Rules · ${bot.principles.length}`, value: bot.builtin ? "See" : "Edit", chevron: false, onPress: edit }),
    listRow({ label: `Uses · ${usesLine(bot, d.linked)}`, value: bot.builtin ? "See" : "Edit", chevron: false, onPress: edit }),
    listRow({ label: d.memory ? `Remembers · ${plural(facts.length, "thing")}` : "Remembers", value: "See", chevron: false, onPress: edit }),
    ...(bot.builtin ? [] : [col([
      row([text("Use from your own app", { size: 15, lineHeight: 20 }), grow(), meta("Keys", { size: 14 })]),
      mono(apiLine(bot.slug)),
    ], { gap: 8, paddingVertical: 14, paddingHorizontal: 16 }, open(SCREENS.keys, { slug: bot.slug }))]),
  ];
  return page(ctx, {
    title: bot.name, nav: bot.slug,
    // A page that draws a health number is never kept on the device (kit page keep), so none of it reaches the phone's
    // AsyncStorage cache and from there the device backup and iCloud (docs: perms §4.6).
    ...(bot.skills.health ? { keep: false as const, state: { ...HEALTH_PAGE_STATE } } : {}),
    body: [
      phoneHead(look, bot.name, stateLine(ctx, bot), undefined, headerBuddy(ctx, bot.slug, { color: look.color, lookTo: "down", thinkWhen: ANSWERING })),
      ...(turns.length
        ? [col(chatTurns(ctx, bot, turns), { gap: 14 }), ...(d.turns && d.turns.length > 2 ? [quietButton("See the whole chat", open(SCREENS.chat, { slug: bot.slug }), { size: "md" })] : [])]
        : [col([body(bot.purpose, { color: C.grey70 }), row(starters(bot.slug, bot.purpose).map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" })], { gap: 12 })]),
      listCard([...movesLine(ctx, bot, d.moves), ...info]),
      // The numbers come in while the page is open, and only then: ask: false never prompts (docs: perms §4.3).
      ...healthRefresh(ctx, bot),
    ],
    footer: [chatBar(ctx, bot.slug, bot.name)],
  });
}

function chatPage(ctx: BotsCtx, d: BotPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  if (bot.slug === "code") {
    return page(ctx, { back: true, title: "Xode", nav: "code", body: [emptyState({ pose: "think", title: "Xode talks on its own page", body: "It reads your projects and answers there.", action: { label: "Open Xode", onPress: open(SCREENS.code) } })] });
  }
  const turns = d.turns ?? [];
  // The bot's own tiny bot at the head's right end: it thinks while an answer comes, and glances down at the field.
  const buddy = headerBuddy(ctx, bot.slug, { color: look.color, lookTo: "down", thinkWhen: ANSWERING });
  const head = row([
    botAvatar(look, 30),
    col([text(bot.name, { size: 17, weight: 600, lineHeight: 22 }), meta(stateLine(ctx, bot), { size: 12, lines: 1 })], { gap: 1, flexShrink: 1 }),
    ...(buddy.length ? [grow(), ...buddy] : []),
  ], { gap: 10 });
  const phoneTop = row([
    labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
    col([text(bot.name, { size: 17, weight: 600, lineHeight: 22 }), meta(stateLine(ctx, bot), { size: 12, lines: 1 })], { gap: 1, flexShrink: 1 }),
    ...(buddy.length ? [grow(), ...buddy] : []),
  ], { gap: 6 });
  return page(ctx, {
    back: isDesk(ctx), title: bot.name, nav: bot.slug, ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    // Pull-a-bot at both ends: what is new is a turn, and new turns land at the bottom.
    pullBot: { top: true, bottom: true, newAt: "bottom", ...(d.turns ? { items: d.turns.map((t) => t.id) } : {}) },
    body: [
      ...(isDesk(ctx) ? [head] : [phoneTop]),
      ...(turns.length
        ? chatTurns(ctx, bot, turns, { big: !isDesk(ctx), days: isDesk(ctx) || turns.length > 6 })
        : [emptyState({ pose: "listen", title: `Ask ${bot.name} anything`, body: bot.purpose })]),
    ],
    footer: [chatBar(ctx, bot.slug, bot.name)],
    gap: 18,
  });
}

function makePhone(ctx: BotsCtx, v: DraftView | null | undefined) {
  if (!v) {
    return page(ctx, {
      back: true, title: "Make a bot", nav: "make", state: { sentence: saidFirst(ctx) },
      body: [
        title("Make a bot"),
        meta("Say what it should do. It shows you the plan before it acts.", { size: 14 }),
        describeBox(ctx),
        col([sectionLabel("Or start from"), ...EXAMPLES.slice(1).map((e) => chip(e, { onPress: setState("sentence", e) }))], { gap: 8 }),
        ...(v === undefined ? [notice("Couldn't load your draft. What you type now starts a new one.")] : []),
      ],
      footer: [primaryButton("Draft it", drafting(), { wide: true })],
    });
  }
  const d = v.draft.definition;
  return page(ctx, {
    back: true, title: "Make a bot", nav: "make", state: { sentence: v.sentence, d_web: d.skills.web, d_files: d.skills.files },
    body: [
      row([title("Make a bot"), grow(), quietButton("Start over", write("DELETE", `${A}/draft`, undefined, { ok: "Draft cleared" }), { size: "md" })]),
      box([text(v.sentence, { size: 15, lineHeight: 21 })], { borderWidth: 1, borderColor: C.ink, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16 }),
      draftCard(ctx, v),
      col([sectionLabel("Try it first"), ...trialPart(ctx, v)], { gap: 10 }),
    ],
    footer: [primaryButton(`Make ${d.name}`, approveDraft(d.name), { wide: true })],
  });
}

function editPhone(ctx: BotsCtx, d: EditData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const p = editParts(ctx, d);
  const done = bot.builtin ? back() : call("PUT", `/v1/bots/${enc(bot.slug)}`, { name: "$state.name" }, { ok: back(), fail: toast("Couldn't save the name. Try again.", true) });
  return page(ctx, {
    title: `Edit ${bot.name}`, nav: bot.slug, state: p.state,
    // The health row is on this page, so it is never kept on the device (docs: perms §4.6).
    ...(bot.skills.health ? { keep: false as const } : {}),
    body: [
      row([
        box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()),
        botAvatar(look, 36), text(bot.builtin ? bot.name : `Edit ${bot.name}`, { size: 19, weight: 600, lineHeight: 24, lines: 1, style: { flexShrink: 1 } }), grow(),
        row([text("Done", { size: 15, weight: 600, lineHeight: 20 })], { minHeight: 44, paddingHorizontal: 4 }, done),
      ], { gap: 10 }),
      ...(bot.builtin ? [notice("One of X0 Bot's own bots: its rules are fixed. What it remembers is yours to forget.")] : [
        col([sectionLabel("Name"), p.nameField], { gap: 8 }),
        col([sectionLabel("Colour"), p.colours, meta(p.takenLine, { size: 12 })], { gap: 8 }),
      ]),
      col([sectionLabel(`Rules · ${bot.principles.length}`), p.rules], { gap: 8 }),
      ...(bot.builtin ? [] : [col([sectionLabel("Tools and apps"), listCard(p.toolRows)], { gap: 8 })]),
      ...(p.listing ? [listCard([p.listing])] : []),
      col([sectionLabel(d.memory ? `It remembers · ${p.facts.length}` : "It remembers"), p.memory], { gap: 8 }),
      ...(bot.builtin ? [] : [p.del]),
    ],
  });
}

function keysPhone(ctx: BotsCtx, d: KeysData) {
  const k = keysParts(ctx, d);
  const look = lookOf(k.bot.slug, k.bot.colour);
  const snip = snippets(k.endpoint, "Plan my next week");
  return page(ctx, {
    title: "Use it from your app", nav: k.bot.slug, state: { label: "" },
    body: [
      row([labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"), botAvatar(look, 30), text(k.bot.name, { size: 14, color: C.grey70, lineHeight: 18 })], { gap: 8 }),
      col([title("Use it from your app"), meta(`Your site or app asks ${k.bot.name}. Same rules as here.`, { size: 13 })], { gap: 4 }),
      card([
        grid([
          col([text(k.u ? k.u.requests.toLocaleString("en-IN") : "—", { size: 34, weight: 700, lineHeight: 38, tracking: -0.5 }), meta(k.u ? `requests in ${k.u.month}` : "couldn't read usage", { size: 12 })], { gap: 2 }),
          col([text(d.usage ? String(d.usage.ratePerMin) : "—", { size: 34, weight: 700, lineHeight: 38, tracking: -0.5 }), meta("a minute, for each key", { size: 12 })], { gap: 2 }),
        ], 2, 12),
        divider(),
        row([text("What it uses", { size: 14, lineHeight: 19 }), grow(), meta("Counts toward your plan", { size: 14 })]),
      ], { gap: 14 }),
      k.made,
      col([sectionLabel(`Keys · ${k.keys.length}`), k.keys.length
        ? listCard(k.keys.map((key) => row([
          col([row([text(key.label || "Key", { size: 14, weight: 600, lineHeight: 19 }), mono(key.masked, { size: 11.5 })], { gap: 8, flexWrap: "wrap" }), meta(k.keyMeta(key), { size: 12 })], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          row([text("Revoke", { size: 13, color: C.grey70, lineHeight: 18 })], { minHeight: 44, paddingHorizontal: 4 }, k.revoke(key)),
        ], { gap: 10, paddingVertical: 12, paddingHorizontal: 16 })))
        : card([meta("No keys yet. Make one to call this bot from your own site or app.", { size: 13 })], { dashed: true })], { gap: 8 }),
      col([sectionLabel("Endpoint"), mono(`POST ${k.endpoint}`, { size: 11.5 })], { gap: 8 }),
      col([row([sectionLabel("Try it"), grow(), link("Copy", copyAction(ctx, snip.curl))]), codeBlock(snip.curl)], { gap: 8 }),
      k.labelField,
    ],
    footer: [primaryButton("Create key", k.create, { wide: true }), meta("You see a new key once. Each key has a daily limit.", { size: 12, align: "center" })],
  });
}

// ===================================================================== bots.store
interface ShopEntry { id: string; kind: "ready" | "people"; slug?: string; name: string; colour: string; purpose: string; by: string; adds: number; status: "yours" | "added" | null; does: string[]; will: string; wont: string; apps: string[] }
interface Shop { readyMade: ShopEntry[]; people: ShopEntry[] }

const count = (n: number) => (n >= 20_000 ? `${Math.round(n / 1000)}k` : n >= 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-IN"));
const usedBy = (e: ShopEntry) => `${e.by === "you" ? "By you" : e.kind === "ready" ? "X0 Bot" : `By ${e.by}`} · ${e.adds ? `${count(e.adds)} use it` : "new"}`;
const addEntry = (e: ShopEntry): ActionRef => call("POST", `${A}/store/${enc(e.id)}/add`, {}, { assignTo: "added", ok: seq(toast(`${e.name} added to your bots`), refresh), fail: toast("Couldn't add it. Try again.", true) });
const shopLook = (e: ShopEntry) => lookOf(e.slug ?? e.name.toLowerCase().replace(/\s+/g, "-"), e.colour);
function entryAction(e: ShopEntry, wide = false): Node {
  if (e.status === "yours") return text("Yours", { size: 13, color: C.meta, lineHeight: 18 });
  if (e.status === "added") return text("In Home", { size: 13, color: C.meta, lineHeight: 18 });
  return button("Add", addEntry(e), { kind: "secondary", size: "md", wide });
}

function storeRow(e: ShopEntry, last: boolean): Node {
  return row([
    row([botAvatar(shopLook(e), 40), col([text(e.name, { size: 15, weight: 600, lineHeight: 20 }), text(e.purpose, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 }), meta(usedBy(e), { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })],
      { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0 }, open(SCREENS.store, { id: e.id })),
    entryAction(e),
  ], { gap: 10, paddingVertical: 12, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: C.divider }) });
}

function entryDetail(e: ShopEntry, o: { wide?: boolean } = {}): Node[] {
  return [
    row([botAvatar(shopLook(e), 52), col([text(e.name, { size: 20, weight: 700, lineHeight: 25 }), meta(usedBy(e), { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
    text(e.purpose, { size: 14, color: C.grey70, lineHeight: 20 }),
    e.status ? infoChip(e.status === "yours" ? "You listed this one" : "Already in your bots") : primaryButton(`Add ${e.name}`, addEntry(e), { wide: true, size: o.wide ? "lg" : "md" }),
    ...(e.does.length ? [col([sectionLabel("What it does"), ...e.does.map((x) => row([box([], { width: 4, height: 4, borderRadius: 2, backgroundColor: C.ink, marginTop: 8 }), text(x.replace(/\.$/, ""), { size: 14, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }))], { gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.divider })] : []),
    col([sectionLabel("Before it acts"),
      row([text("Will", { size: 13, weight: 600, lineHeight: 19, style: { width: 52 } }), text(e.will, { size: 13, color: C.grey70, lineHeight: 19, style: { flexShrink: 1 } })], { alignItems: "flex-start" }),
      row([text("Won't", { size: 13, weight: 600, lineHeight: 19, style: { width: 52 } }), text(e.wont, { size: 13, color: C.grey70, lineHeight: 19, style: { flexShrink: 1 } })], { alignItems: "flex-start" }),
    ], { gap: 6 }),
    ...(e.apps.length ? [col([sectionLabel("Apps it asks for"), row(e.apps.map((a) => box([text(a, { size: 11.5, color: C.grey70, lineHeight: 15 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 })), { gap: 6, flexWrap: "wrap" })], { gap: 8 })] : []),
  ];
}

const plusDot = (): Node => box([icon("plus", { size: 20, color: C.paper })], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" });
const makeOwn = (dash: boolean): Node => dash
  ? row([plusDot(), col([text("Make your own", { size: 16, weight: 600, lineHeight: 21 }), meta("Say what it should do. Ready in a minute.", { size: 13 })], { gap: 2, flexShrink: 1, flexGrow: 1 }), icon("chevron", { size: 16, color: C.meta })],
    { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: C.idle, borderStyle: "dashed" }, open(SCREENS.make))
  : col([plusDot(), col([text("Make your own", { size: 15, weight: 600, lineHeight: 20 }), text("Say what it should do. Ready in a minute.", { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 2 })],
    { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, minHeight: 210, minWidth: 0 }, open(SCREENS.make));

const FILTERS = [{ label: "All", value: "all" }, { label: "Ready-made", value: "ready" }, { label: "Made by people", value: "people" }];

function storePhone(ctx: BotsCtx, d: Shop | undefined) {
  const id = String(ctx.params.id ?? "");
  const one = id && d ? [...d.readyMade, ...d.people].find((e) => e.id === id) : undefined;
  if (one) {
    return page(ctx, { back: true, title: one.name, nav: "bots", body: entryDetail(one, { wide: true }), footer: [meta("Every bot asks before it uses an app or spends money.", { size: 12, align: "center" })] });
  }
  const section = (label: string, list: ShopEntry[], show: string[]) => when({ in: ["filter", show] }, col([
    sectionLabel(label),
    ...(list.length ? list.map((e, i) => storeRow(e, i === list.length - 1)) : [meta(label === "Made by people" ? "Nobody has listed a bot yet. List yours from its settings." : "Nothing matches.", { size: 13 })]),
  ], { gap: 4 }));
  return page(ctx, {
    back: true, title: "Find a bot", nav: "bots", state: { filter: "all" },
    body: [
      title("Find a bot"),
      makeOwn(true),
      chips(FILTERS, "filter"),
      ...(d ? [section("Ready-made", d.readyMade, ["all", "ready"]), section("Made by people", d.people, ["all", "people"])]
        : [emptyState({ pose: "think", title: "Couldn't load the store", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]),
    ],
    footer: [meta("Every bot asks before it uses an app or spends money.", { size: 12, align: "center" })],
  });
}

function storeCard(e: ShopEntry, selected: boolean): Node {
  const look = shopLook(e);
  return col([
    col([
      botAvatar(look, 40),
      col([text(e.name, { size: 15, weight: 600, lineHeight: 20 }), text(e.purpose, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })], { gap: 2 }),
      meta(usedBy(e), { size: 12 }),
    ], { gap: 10 }, open(SCREENS.store, { id: e.id })),
    grow(),
    box([entryAction(e, true)], { minHeight: 36, justifyContent: "center" }),
  ], { padding: 16, gap: 12, borderRadius: 18, borderWidth: selected ? 1.5 : 1, borderColor: selected ? look.color : C.line, minWidth: 0, minHeight: 210 });
}

function storeDesk(ctx: BotsCtx, d: Shop | undefined) {
  const all = d ? [...d.readyMade, ...d.people] : [];
  const sel = all.find((e) => e.id === String(ctx.params.id ?? "")) ?? all[0];
  const q = String(ctx.params.q ?? "");
  const search = inputBox([icon("search", { size: 18, color: C.meta }), field("q", "q", "Try 'school', 'UPI' or 'groceries'", { onSubmit: { kind: "navigate", screenId: SCREENS.store, params: { q: "$state.q" }, replace: true } })], { radius: 22 });
  const section = (label: string, list: ShopEntry[], show: string[], extra: Node[] = []) => when({ in: ["filter", show] }, col([
    sectionLabel(`${label} · ${list.length}`),
    grid([...list.map((e) => storeCard(e, e.id === sel?.id)), ...extra], 3, 14),
  ], { gap: 10 }));
  return page(ctx, {
    title: "Find a bot", nav: "bots", maxWidth: 1120, state: { filter: "all", q },
    body: [
      row([col([row([text("Your bots", { size: 13, color: C.grey70, lineHeight: 18 })], { minHeight: 32 }, toTab("bots")), title("Find a bot", { size: 26 })], { gap: 4 }), grow(), box([search], { width: 340 })], { alignItems: "flex-end", gap: 16 }),
      row([chips(FILTERS, "filter"), grow(), meta("Every bot asks before it uses an app or spends money.", { size: 12 })], { gap: 12 }),
      ...(d ? [row([
        col([
          section("Ready-made", d.readyMade, ["all", "ready"]),
          section("Made by people", d.people, ["all", "people"], [makeOwn(false)]),
        ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 28 }),
        ...(sel ? [card(entryDetail(sel), { gap: 14, style: { width: 320, flexShrink: 0 } })] : []),
      ], { gap: 24, alignItems: "flex-start" })] : [emptyState({ pose: "think", title: "Couldn't load the store", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]),
    ],
  });
}

const hourWords = (ctx: BotsCtx, ms: number) => clockOf(ctx, ms).replace(":00", "");

/** The day the phone shows: `day` when it was read, else tomorrow on this week, else the week's Monday. */
function planDay(ctx: BotsCtx, d: PlanRead): string {
  const p = String(ctx.params.day ?? "");
  if (d.days.some((x) => x.key === p)) return p;
  return planWeek(ctx) === 0 ? d.tomorrow : d.week[0] ?? d.tomorrow;
}

function dayTimeline(ctx: BotsCtx, d: PlanRead, day: PlanDay): Node {
  const timed = day.events.filter((e) => !e.allDay);
  const rows: Node[] = [];
  const line = (h?: number) => box([], { width: 1.5, alignSelf: "stretch", backgroundColor: C.track, ...(h ? { height: h } : {}) });
  for (const e of day.events.filter((x) => x.allDay)) {
    rows.push(row([text("All day", { size: 12, weight: 600, lineHeight: 16, style: { width: 54 } }), line(), col([
      text(e.title, { size: 14, weight: 500, lineHeight: 19 }), ...(e.where || e.from ? [meta([e.where, fromWords(e)].filter(Boolean).join(" · "), { size: 12, lines: 1 })] : []),
    ], { flexGrow: 1, flexShrink: 1, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, gap: 2 }, itemAction("event", e.id))], { gap: 10, alignItems: "stretch" }));
  }
  timed.forEach((e, i) => {
    const target = d.suggestion?.eventId === e.id;
    rows.push(...places.legRowsTo(ctx, d.travel, e.id));
    rows.push(row([
      text(clockOf(ctx, e.start), { size: 12, weight: 600, lineHeight: 16, style: { width: 54, paddingTop: 12 } }),
      line(),
      row([
        col([text(e.title, { size: 14, weight: 500, lineHeight: 19, lines: 1 }), meta([lengthWords(e.end - e.start), ...(e.where ? [e.where] : []), ...(e.people ? [plural(e.people, "other")] : []), fromWords(e)].filter(Boolean).join(" · "), { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...(target ? [row([text("Move?", { size: 12, weight: 600, lineHeight: 16 }), statusMark("needs", { size: 8 })], { gap: 6 })] : []),
      ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 8, padding: 12, borderRadius: 14, borderWidth: target ? 1.5 : 1, borderColor: target ? C.ink : C.line, ...(target ? { borderStyle: "dashed" } : {}), backgroundColor: C.paper }, itemAction("event", e.id)),
    ], { gap: 10, alignItems: "stretch" }));
    rows.push(...places.headsUpRows(ctx, d.travel, e.id));
    const next = timed[i + 1];
    if (next && next.start - e.end >= 90 * MIN) {
      rows.push(row([box([], { width: 54 }), line(26), meta(`Free · ${hourWords(ctx, e.end)} to ${hourWords(ctx, next.start)}, ${lengthWords(next.start - e.end)}`, { size: 12 })], { gap: 10, minHeight: 26 }));
    }
  });
  for (const t of day.tasks) rows.push(row([text("To do", { size: 12, weight: 600, lineHeight: 16, style: { width: 54, paddingTop: 12 } }), line(), box([todoRow(ctx, t, { when: true })], { flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 10, alignItems: "stretch" }));
  if (!rows.length) {
    return card([
      text(`Nothing on ${day.key === d.today ? "today" : day.key === d.tomorrow ? "tomorrow" : dayLabelOf(d, day.key)}`, { size: 15, weight: 500, lineHeight: 20 }),
      meta("A free day. Add something, or ask Plan Ease to fill it.", { size: 13 }),
    ], { dashed: true });
  }
  return col(rows, { gap: 8 });
}

/** The week as seven days (the phone): each opens its day; the arrows go a week back or on. */
function dayStrip(d: PlanRead, sel: string, week: number): Node {
  const look = lookOf("plan");
  const cell = (k: string): Node => {
    const dt = keyDate(k);
    const on = k === sel;
    const day = d.days.find((x) => x.key === k);
    const busy = !!day && day.events.length + day.tasks.filter((t) => !t.done).length > 0;
    return labelled(col([
      text(WEEKDAYS[dt.getUTCDay()]!, { size: 11, weight: 500, color: on ? C.paper : C.meta, lineHeight: 14 }),
      text(String(dt.getUTCDate()), { size: 15, weight: on || k === d.today ? 600 : 400, color: on ? C.paper : C.ink, lineHeight: 20 }),
      box([], { width: 4, height: 4, borderRadius: 2, backgroundColor: busy ? (on ? C.paper : look.color) : "transparent" }),
    ], {
      flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "center", gap: 2, paddingVertical: 7, borderRadius: 14, backgroundColor: on ? C.ink : C.paper,
      ...(k === d.today && !on ? { borderWidth: 1, borderColor: C.line } : {}),
    }, planGo(week, k)), `${PLAN_WEEKDAYS_LONG[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`);
  };
  const arrow = (dir: -1 | 1) => labelled(box([icon(dir < 0 ? "back" : "chevron", { size: 16, color: C.grey70 })], { width: 26, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }, planGo(week + dir)), dir < 0 ? "The week before" : "The week after");
  return row([arrow(-1), ...d.week.map(cell), arrow(1)], { gap: 2, alignItems: "stretch" });
}

function planPhone(ctx: BotsCtx, d: PlanRead | undefined) {
  const look = lookOf("plan");
  const week = planWeek(ctx);
  const sel = d ? planDay(ctx, d) : "";
  const day = d ? d.days.find((x) => x.key === sel) ?? { key: sel, events: [], tasks: [] } : undefined;
  return page(ctx, {
    title: "Plan Ease", nav: "plan", live: ["bot:plan", "calendar", "tasks"], state: { ...places.PLAN_STATE },
    body: [
      phoneHead(look, "Plan Ease", planHeadLine(d), undefined, headerBuddy(ctx, "plan", { lookTo: "down", thinkWhen: ANSWERING })),
      ...(!d || !day ? [emptyState({ pose: "think", title: "Couldn't read your days", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [
          dayStrip(d, sel, week),
          col([
            row([sectionLabel(`${dayLabelOf(d, sel)} · ${keyWords(sel)}`), grow(), link("Add", addAction(sel))], { gap: 8 }),
            ...(d.trouble ? [notice(d.trouble)] : []),
            dayTimeline(ctx, d, day),
            ...(sel === d.tomorrow ? places.planFoot(ctx, d.travel) : []),
            ...planShare(ctx, d, day),
          ], { gap: 12 }),
          ...(d.suggestion ? [suggestionCard(ctx, d.suggestion)] : []),
          ...openTodos(ctx, d),
          ...places.homePart(ctx, d.travel),
        ]),
    ],
    footer: [
      ...(d ? [row(planChips(d).map((c) => chip(c, { onPress: askBot("plan", c) })), { gap: 8, flexWrap: "wrap" })] : []),
      chatBar(ctx, "plan", "Plan Ease", "Add dentist Fri 5 pm, or plan my week…", open(SCREENS.chat, { slug: "plan" })),
    ],
  });
}

// ===================================================================== bots.travel
interface TripData { trip: { id: string; place: string; when: string; who: string; packing: Array<{ text: string; done: boolean }>; spots?: string[]; stays?: Array<{ picked: boolean }> } | null; facts: Array<{ id: string; text: string }>; bookings: Array<{ label: string; url: string; at: number; said: string }> }

/** `x`: the trip's weather, places and stays compared (GET .../trip/:id/extras, botsPlaces.ts); `work`: Work in space (work/workTab.ts). */
interface TravelData { t?: TripData; files?: MediaFile[]; x?: places.TripExtrasView; work?: WorkRead }

const TRAVELLY = /ticket|pnr|boarding|itinerary|hotel|booking|flight|train|irctc|visa|passport|e-?ticket|bus|stay|trip/i;
const GETTING = /train|flight|bus|cab|ticket|irctc|rail|air|uber|ola|route|maps|direction/i;
const STAYING = /hotel|stay|room|booking\.com|airbnb|hostel|resort|homestay/i;

function tripSteps(ctx: BotsCtx, d: TravelData) {
  const t = d.t?.trip;
  const opens = d.t?.bookings ?? [];
  const files = (d.files ?? []).filter((f) => TRAVELLY.test(f.name));
  const travelNeeds = ctx.live.needs.filter((n) => n.bot === "travel");
  const steps = [
    { name: "Dates", ok: !!t?.when },
    { name: "Getting there", ok: opens.some((o) => GETTING.test(`${o.label} ${o.url} ${o.said}`)) || files.some((f) => GETTING.test(f.name)) },
    { name: "Stay", ok: opens.some((o) => STAYING.test(`${o.label} ${o.url} ${o.said}`)) || files.some((f) => STAYING.test(f.name)) || !!t?.stays?.some((x) => x.picked) },
    { name: "Packed", ok: !!t && t.packing.length > 0 && t.packing.every((p) => p.done) },
    { name: "Nothing waiting", ok: !!t && travelNeeds.length === 0 },
  ];
  return { steps, ready: steps.filter((s) => s.ok).length, files, opens, travelNeeds };
}

function tripForm(_ctx: BotsCtx): Node {
  const start = ifFilled("t_place", write("POST", `${A}/trip`, { place: "$state.t_place", when: "$state.t_when", who: "$state.t_who" }, { ok: "Trip started" }), "Where are you going?");
  return card([
    text("Where to next?", { size: 17, weight: 600, lineHeight: 22 }),
    meta("Travel bot keeps the trip in one place: the bookings it finds for you, your tickets, what to pack.", { size: 13 }),
    inputBox([field("t_place", "t_place", "Where: Pune, Goa, Jaipur…")], { radius: 14 }),
    row([box([inputBox([field("t_when", "t_when", "When: 14–16 Nov")], { radius: 14 })], { flexGrow: 1, flexBasis: 0 }), box([inputBox([field("t_who", "t_who", "Who: you + Rohan")], { radius: 14 })], { flexGrow: 1, flexBasis: 0 })], { gap: 10 }),
    button("Start the trip", start, { size: "md" }),
  ], { gap: 12 });
}

function bookingCards(ctx: BotsCtx, d: TravelData, place: string): Node[] {
  const opens = d.t?.bookings ?? [];
  if (!opens.length) {
    return [card([
      row([box([icon("pin", { size: 18, color: lookOf("travel").color })], { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
        col([text("Nothing to book yet", { size: 15, weight: 600, lineHeight: 20 }), meta("Ask Travel bot for trains, flights or stays. It opens the app for you to book; you press pay.", { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" }),
      row([chip(`Trains to ${place}`, { onPress: askBot("travel", `Find trains to ${place}${d.t?.trip?.when ? ` for ${d.t.trip.when}` : ""}`) }), chip(`Stays in ${place}`, { onPress: askBot("travel", `Find two or three stays in ${place}${d.t?.trip?.when ? ` for ${d.t.trip.when}` : ""}`) })], { gap: 8, flexWrap: "wrap" }),
    ], { gap: 12 })];
  }
  return opens.slice(0, 3).map((o) => card([
    row([box([icon(STAYING.test(`${o.label} ${o.url}`) ? "today" : "pin", { size: 18 })], { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      col([text(withoutAmounts(o.label), { size: 15, weight: 600, lineHeight: 20, lines: 2 }), meta(o.said ? `You asked: ${o.said}` : `From your chat · ${shortDate(ctx, o.at)}`, { size: 12, lines: 2 })], { gap: 2, flexShrink: 1, flexGrow: 1 }),
      statusMark("needs", { size: 8 })], { gap: 12, alignItems: "flex-start" }),
    row([button("Open to book", { kind: "openUrl", url: o.url, handoff: true }, { size: "md", icon: "link" }), meta("Ready to book · you press pay", { size: 12 })], { gap: 12, flexWrap: "wrap" }),
  ], { gap: 12 }));
}

function packingPart(_ctx: BotsCtx, trip: NonNullable<TripData["trip"]>, columns: number): Node {
  const done = trip.packing.filter((p) => p.done).length;
  const add = ifFilled("pack", seq(call("POST", `${A}/trip/${enc(trip.id)}/packing`, { text: "$state.pack" }, { ok: seq(clearState("pack"), refresh), fail: toast("Couldn't add that. Try again.", true) })), "Write what to pack");
  const item = (p: { text: string; done: boolean }, i: number): Node => row([
    box(p.done ? [icon("check", { size: 13, color: C.paper, weight: 2.4 })] : [], { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center", flexShrink: 0, ...(p.done ? { backgroundColor: C.ink } : { borderWidth: 1.5, borderColor: C.ink }) }),
    text(p.text, { size: 13, lineHeight: 18, color: p.done ? C.meta : C.ink, lines: 2, style: { flexShrink: 1 } }),
  ], { gap: 10, minHeight: 36 }, write("PUT", `${A}/trip/${enc(trip.id)}/packing/${i}`));
  return col([
    row([sectionLabel("Packing"), grow(), meta(trip.packing.length ? `${done} of ${trip.packing.length} packed` : "Nothing on the list yet", { size: 12 })]),
    ...(trip.packing.length ? [meter(done, trip.packing.length, { color: lookOf("travel").color }), grid(trip.packing.map(item), columns, 4)]
      : [button("Start a list for me", write("POST", `${A}/trip/${enc(trip.id)}/packing/starter`, {}, { ok: "List started" }), { kind: "secondary", size: "md" })]),
    inputBox([field("pack", "pack", "Add something to pack…", { onSubmit: add }), roundButton("plus", add, { size: 36, label: "Add", light: true })], { radius: 14 }),
  ], { gap: 10 });
}

function travelParts(ctx: BotsCtx, d: TravelData) {
  const look = lookOf("travel");
  const s = tripSteps(ctx, d);
  const trip = d.t?.trip ?? null;
  const live = liveOf(ctx, "travel");
  const headLine = live?.working ? `Working · ${live.doing ?? "on it"}` : trip ? `${s.ready} of ${s.steps.length} ready` : "Plans your trips";
  const segments = row(s.steps.map((st, i) => box([], {
    flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3,
    backgroundColor: st.ok ? C.ink : i === s.steps.findIndex((x) => !x.ok) ? look.color : C.track,
  })), { gap: 4 });
  const files = s.files.length ? col([sectionLabel("Your tickets and bookings"), listCard(s.files.slice(0, 4).map((f) => listRow({
    label: f.name, sub: `${kb(f.bytes)} · ${shortDate(ctx, f.createdAt)}`, left: icon("clip", { size: 18, color: C.meta }), onPress: open(SCREENS.shareIn, { file: f.id }),
  })))], { gap: 8 }) : null;
  const facts = d.t?.facts ?? [];
  const remembers = facts.length ? col([sectionLabel("Travel bot remembers"), ...facts.slice(0, 5).map((f) => dotLine(f.text))], { gap: 6 }) : null;
  const needs = s.travelNeeds.slice(0, 2).map((n) => needsCard(n));
  // Share the trip with a space or a person (a copy, with its packing list: screens/spaces.ts bots.share).
  const over = trip ? row([...shareButtonsFor(ctx, { kind: "trip", ref: trip.id, title: `Trip to ${trip.place}` }), quietButton("Trip over", write("DELETE", `${A}/trip/${enc(trip.id)}`, undefined, { ok: "Trip cleared" }), { size: "md" })], { gap: 4 }) : null;
  return { look, s, trip, headLine, segments, files, remembers, needs, over };
}

function travelPhone(ctx: BotsCtx, d: TravelData) {
  const p = travelParts(ctx, d);
  return page(ctx, {
    title: "Travel bot", nav: "travel", state: { t_place: "", t_when: "", t_who: "", pack: "", ...places.TRIP_STATE }, live: ["bot:travel"],
    body: [
      phoneHead(p.look, "Travel bot", p.headLine, undefined, headerBuddy(ctx, "travel", { lookTo: "down", thinkWhen: ANSWERING })),
      ...(!d.t ? [emptyState({ pose: "think", title: "Couldn't load your trip", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : !p.trip ? [tripForm(ctx), ...(p.remembers ? [p.remembers] : [])]
          : [
            col([
              row([text(p.trip.when ? `${p.trip.place} · ${p.trip.when}` : p.trip.place, { size: 24, weight: 700, lineHeight: 30, tracking: -0.5, style: { flexShrink: 1 } }), grow(), ...(p.over ? [p.over] : [])], { alignItems: "flex-start" }),
              ...(p.trip.who ? [meta(p.trip.who, { size: 12 })] : []),
              p.segments,
            ], { gap: 8 }),
            ...p.needs,
            ...places.datesHint(p.trip, d.x),
            tripSearches(ctx, p.trip),
            ...bookingCards(ctx, d, p.trip.place),
            places.staysPart(ctx, p.trip, d.x, d.t?.bookings ?? []),
            ...places.weatherPart(ctx, p.trip, d.x),
            places.spotsPart(ctx, p.trip, d.x),
            ...(p.files ? [p.files] : []),
            packingPart(ctx, p.trip, 2),
            ...(p.remembers ? [p.remembers] : []),
            ...places.tripFoot(d.x),
          ]),
    ],
    footer: [chatBar(ctx, "travel", "Travel bot", "Ask about this trip…", open(SCREENS.chat, { slug: "travel" }))],
  });
}

function travelDesk(ctx: BotsCtx, d: TravelData) {
  const p = travelParts(ctx, d);
  const left: Node[] = !d.t ? [emptyState({ pose: "think", title: "Couldn't load your trip", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
    : !p.trip ? [tripForm(ctx)]
      : [
        col([
          row([text(p.trip.when ? `${p.trip.place} · ${p.trip.when}` : p.trip.place, { size: 28, weight: 700, lineHeight: 34, tracking: -0.6, style: { flexShrink: 1 } }), grow(), ...(p.over ? [p.over] : [])], { alignItems: "flex-start" }),
          ...(p.trip.who ? [meta(p.trip.who, { size: 13 })] : []),
          p.segments,
          row(p.s.steps.map((st) => text(st.name, { size: 11, weight: st.ok ? 500 : 400, color: st.ok ? C.ink : C.meta, lineHeight: 14, style: { flexGrow: 1, flexBasis: 0 } })), { gap: 4 }),
        ], { gap: 8 }),
        ...p.needs,
        ...places.datesHint(p.trip, d.x),
        tripSearches(ctx, p.trip),
        grid(bookingCards(ctx, d, p.trip.place), 2, 14),
        ...(d.x ? [places.tripPlanPart(ctx, p.trip, d.x)!] : []),
        places.staysPart(ctx, p.trip, d.x, d.t?.bookings ?? [], { desk: true }),
        places.spotsPart(ctx, p.trip, d.x),
        packingPart(ctx, p.trip, 3),
      ];
  const right: Node[] = [
    ...(p.files ? [p.files] : []),
    ...(p.remembers ? [p.remembers] : []),
    col([sectionLabel("Ask Travel bot"), chatBar(ctx, "travel", "Travel bot", "Ask about this trip…", open(SCREENS.chat, { slug: "travel" }))], { gap: 8 }),
  ];
  return page(ctx, {
    title: "Travel bot", nav: "travel", maxWidth: 1100, state: { t_place: "", t_when: "", t_who: "", pack: "", ...places.TRIP_STATE }, live: ["bot:travel"],
    body: [
      row([botAvatar(p.look, 44), col([title("Travel bot", { size: 26 }), text(p.headLine, { size: 13, weight: 500, color: p.look.color, lineHeight: 18 })], { gap: 2 }),
        ...headerBuddy(ctx, "travel", { lookTo: "right", thinkWhen: ANSWERING })], { gap: 14 }),
      row([col(left, { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 22 }), col(right, { width: 300, flexShrink: 0, gap: 22 })], { gap: 28, alignItems: "flex-start" }),
    ],
  });
}

/**
 * What came in from another app's Share menu (the phone's share extension and share intent) or was dropped on the window: `text`, `url`,
 * and files already sent to POST /v1/files, as `file` (one id) and `files` (ids, comma separated: a share of several). At most five.
 */
const SHARE_FILES = 5;
function shareFileIds(params: Record<string, unknown>): string[] {
  const ids = [String(params.file ?? ""), ...String(params.files ?? "").split(",")].map((s) => s.trim()).filter((s) => /^[A-Za-z0-9-]{1,64}$/.test(s));
  return [...new Set(ids)].slice(0, SHARE_FILES);
}

function shareDesk(ctx: BotsCtx, d: ShareData) {
  const s = sharedOf(ctx, d);
  const pick = sharePick(ctx, d);
  const bots = shareBots(ctx, pick);
  if (!s.kind) {
    return page(ctx, { title: "Send to a bot", nav: "bots", body: [title("Send to a bot"), emptyState({ pose: "hello", title: "Nothing to send yet", body: "Drop a file, a link or some text on this window, or pick X0 Bot in another app's Share menu. It lands here with the bot that fits best." })] });
  }
  const asks: Record<string, string> = {};
  for (const b of bots) asks[b.slug] = b.slug === pick && d.ask ? d.ask : defaultAsk(b.slug, s.kind);
  const big = (b: LiveBot) => when({ eq: ["bot", b.slug] }, col([
    botAvatar(b, 56),
    text(b.slug === ASK_ANY ? b.name : `Send to ${b.name}`, { size: 24, weight: 700, lineHeight: 30, align: "center" }),
    text(SHARE_LINE[b.slug] ?? b.purpose, { size: 14, color: C.grey70, lineHeight: 20, align: "center" }),
    ...(b.slug === d.pick ? [row([infoChip("Suggested")], { justifyContent: "center" })] : []),
    box([sharedCard(ctx, s)], { width: 360, maxWidth: "100%" }),
  ], { alignItems: "center", gap: 10, paddingVertical: 32, paddingHorizontal: 24, borderRadius: 22, borderWidth: 2, borderColor: b.color, borderStyle: "dashed" }));
  const others = (b: LiveBot) => when({ neq: ["bot", b.slug] }, row([
    botAvatar(b, 30), col([text(b.name, { size: 13, weight: 600, lineHeight: 18 }), text(SHARE_LINE[b.slug] ?? b.purpose, { size: 11.5, color: C.meta, lineHeight: 15, lines: 1 })], { gap: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 10, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: C.outline, borderStyle: "dashed", minWidth: 0 }, seq(setState("bot", b.slug), setState("what", "$state.asks." + b.slug))));
  return page(ctx, {
    title: "Send to a bot", nav: "bots", maxWidth: 760, state: { bot: pick, what: asks[pick] ?? "", asks },
    body: [
      ...bots.map(big),
      col([sectionLabel("Or send to another bot"), grid(bots.map(others), 3, 10)], { gap: 10 }),
      col([
        row([sectionLabel("What it should do"), grow()]),
        inputBox([field("what", "what", "Say what it should do", { onSubmit: shareSend(ctx, s, d) })], { radius: 14 }),
        ...bots.map((b) => when({ eq: ["bot", b.slug] }, meta(shareLineFor(b.slug, b.name), { size: 12.5, lineHeight: 18 }))),
        when({ truthy: "sendingShare" }, row([statusMark("working", { color: C.ink }), meta("Sending…", { size: 13 })], { gap: 8 })),
      ], { gap: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.divider }),
      // To a space or a person only while Spaces is on (kit hasSpaces): with it off, every person to share with is out of sight too.
      row([quietButton("Cancel", back(), { size: "md" }), grow(), ...(hasSpaces(ctx) ? [secondaryButton("Share with a space or person", sharePeople(s), { size: "md", icon: "share" })] : []), primaryButton("Send", shareSend(ctx, s, d), { size: "md" })], { gap: 12 }),
    ],
  });
}

// ===================================================================== bots.avatars

const MOMENTS: Array<{ pose: "hello" | "listen" | "think" | "needs" | "done"; who: string; slug: string; line: string }> = [
  { pose: "hello", who: "X0 Bot · Hello", slug: "tailzu", line: "Ink · no light · home, welcome" },
  { pose: "listen", who: "Keylessbord · Listening", slug: "keybot", line: "Clay" },
  { pose: "think", who: "Xode · On it", slug: "code", line: "Moss" },
  { pose: "needs", who: "Plan Ease · Needs you", slug: "plan", line: "Ochre" },
  { pose: "done", who: "Travel bot · All set", slug: "travel", line: "Sea" },
];

function avatarsPage(ctx: BotsCtx) {
  const desk = isDesk(ctx);
  const tiles = MOMENTS.map((m) => col([
    blip(m.pose, desk ? 150 : 120),
    col([text(m.who, { size: 13, weight: 600, lineHeight: 18, align: "center" }), row([statusMark("working", { color: lookOf(m.slug).color, still: true }), meta(m.line, { size: 12 })], { gap: 6, justifyContent: "center" })], { gap: 3, alignItems: "center" }),
  ], { alignItems: "center", gap: 10, minWidth: 0 }));
  return page(ctx, {
    back: true, title: "Blip, as every bot", nav: "you",
    body: [
      col([title("Blip, as every bot"), meta("The app stays black and white; the only colour is each bot's own, in its light. His pose says what's happening.", { size: 13, lineHeight: 19 })], { gap: 6 }),
      grid(tiles, desk ? 5 : 2, 16),
      col([sectionLabel("Small, inside the app"), row(["code", "keybot", "plan", "travel"].map((s) => botAvatar(lookOf(s), 40)), { gap: 12 })], { gap: 10 }),
    ],
  });
}

// ===================================================================== the screens

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

export const botsScreens: BotsScreen[] = [
  screen<OraclePageData & MailPageData & MeetPageData>({
    id: SCREENS.bot,
    load: (ctx, deps) => loadBot(ctx, deps, slugParam(ctx) === "oracle" || isDesk(ctx) ? 30 : slugParam(ctx) === "mail" || slugParam(ctx) === "meet" ? 1 : 6, { mail: true, meet: true }),
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : isOracle(d) ? oraclePage(ctx, d) : isMail(d) ? mailPage(ctx, d) : isMeet(d) ? meetPage(ctx, d) : isDesk(ctx) ? botDesk(ctx, d) : botPhone(ctx, d)),
  }),
  screen<OraclePageData>({
    id: SCREENS.chat,
    load: (ctx, deps) => loadBot(ctx, deps, 30),
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : isOracle(d) ? oraclePage(ctx, d) : chatPage(ctx, d)),
  }),
  screen<{ draft: DraftView | null }>({
    id: SCREENS.make,
    load: (_ctx, deps) => deps.api<{ draft: DraftView | null }>("GET", `${A}/draft`),
    build: (ctx, d) => (isDesk(ctx) ? makeDesk(ctx, d ? d.draft : undefined) : makePhone(ctx, d ? d.draft : undefined)),
  }),
  screen<EditData>({
    id: SCREENS.edit,
    load: async (ctx, deps: Deps) => {
      const base = await loadBot(ctx, deps, 2);
      const slug = slugParam(ctx);
      if (!base.bot) return base;
      const [apps, mine, listed] = await Promise.all([
        deps.api<{ connectors: App[] }>("GET", "/v1/connectors").then((r) => r.connectors).catch(() => undefined),
        deps.api<{ bots: Array<{ slug: string; colour: string; name: string; builtin: boolean }> }>("GET", "/v1/bots").then((r) => r.bots).catch(() => undefined),
        base.bot.builtin ? Promise.resolve(false) : deps.api<{ listed: boolean }>("GET", `${A}/listing/${enc(slug)}`).then((r) => r.listed).catch(() => false),
      ]);
      return { ...base, apps, mine, listed };
    },
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : isDesk(ctx) ? editDesk(ctx, d) : editPhone(ctx, d)),
  }),
  screen<KeysData>({
    id: SCREENS.keys,
    load: async (ctx, deps) => {
      const slug = slugParam(ctx);
      const [bot, keys, usage] = await Promise.all([
        deps.api<{ bot?: BotView }>("GET", `/v1/bots/${enc(slug)}`).then((r) => r.bot).catch(() => undefined),
        deps.api<{ keys: KeyView[] }>("GET", `/v1/bots/${enc(slug)}/keys`).then((r) => r.keys).catch(() => undefined),
        deps.api<Usage>("GET", `${A}/keys/${enc(slug)}/usage?tz=${ctx.tzOffsetMinutes}`).catch(() => undefined),
      ]);
      return { bot, keys, usage };
    },
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : d.bot.builtin ? page(ctx, { back: true, title: "Keys", nav: d.bot.slug, body: [emptyState({ pose: "think", title: `${d.bot.name} is X0 Bot's own`, body: "Keys are for bots you make. Make one, and your own site or app can ask it.", action: { label: "Make a bot", onPress: open(SCREENS.make) } })] })
      : isDesk(ctx) ? keysDesk(ctx, d) : keysPhone(ctx, d)),
  }),
  screen<Shop>({
    id: SCREENS.store,
    load: (ctx, deps) => deps.api<Shop>("GET", `${A}/store${ctx.params.q ? `?q=${enc(String(ctx.params.q))}` : ""}`),
    build: (ctx, d) => (isDesk(ctx) ? storeDesk(ctx, d) : storePhone(ctx, d)),
  }),
  screen<(PlanRead & { work?: WorkRead }) | (PlanTodayData & { work?: WorkRead }) | (PlanDayData & { work?: WorkRead })>({
    id: SCREENS.plan,
    // The threaded home (screens/bots/planHome.ts) where it's on, with Work in space's tabs as the week page had them; else the simpler
    // page (screens/bots/planPage.ts); else the week, with Work in space's people too (screens/work/workTab.ts), never failing the page.
    // The simpler page has no Work in space tab: what others set is on the list already, with their tiny bot.
    load: async (ctx, deps) => {
      if (homeFor(ctx)) {
        const [day, work] = await Promise.all([deps.api<PlanDayData>("GET", `${A}/plan/day?${planDayQuery(ctx)}`), loadWork(ctx, deps, "plan")]);
        return { ...day, work };
      }
      if (planV2(ctx)) return deps.api<PlanTodayData>("GET", `${A}/plan/today?tz=${ctx.tzOffsetMinutes}`);
      const [plan, work] = await Promise.all([deps.api<PlanRead>("GET", `${A}/plan?tz=${ctx.tzOffsetMinutes}&week=${planWeek(ctx)}`), loadWork(ctx, deps, "plan")]);
      return { ...plan, work };
    },
    build: (ctx, d) => {
      if (homeFor(ctx)) {
        const v = d && "v" in d && d.v === 3 ? d : undefined;
        const c = workCtx(ctx, d?.work);
        return isDesk(c) ? planHomeDesk(c, v) : planHomePhone(c, v);
      }
      if (planV2(ctx)) { const v = d && "v" in d && d.v === 2 ? d : undefined; return isDesk(ctx) ? planTodayDesk(ctx, v) : planTodayPhone(ctx, v); }
      const old = d && !("v" in d) ? d : undefined;
      const c = workCtx(ctx, old?.work);
      return isDesk(c) ? planDesk(c, old) : planPhone(c, old);
    },
  }),
  screen<PlanWeekData>({
    id: SCREENS.planWeek,
    load: (ctx, deps) => deps.api("GET", `${A}/plan/week?tz=${ctx.tzOffsetMinutes}`),
    build: (ctx, d) => planWeekPage(ctx, d),
  }),
  screen<{ url?: string }>({ id: SCREENS.planGo, load: (ctx, deps) => planGoLoad(ctx, deps), build: (ctx, d) => planGoPage(ctx, d) }),
  // "X0 is calling" (botsBots/planCall.ts): the call, ringing to talking, missed, or ended; a record on the window (screens/bots/planCall.ts).
  screen<CallView>({
    id: SCREENS.planCall,
    load: (ctx, deps) => deps.api<CallView>("GET", `${CALLS}/${enc(String(ctx.params.call ?? ""))}`),
    build: (ctx, d) => planCallPage(ctx, d),
  }),
  screen<TravelData>({
    id: SCREENS.travel,
    load: async (ctx, deps) => {
      const [t, files] = await Promise.all([
        deps.api<TripData>("GET", `${A}/trip`).catch(() => undefined),
        deps.api<{ files: MediaFile[] }>("GET", "/v1/files").then((r) => r.files).catch(() => undefined),
      ]);
      const [x, work] = await Promise.all([
        t?.trip
          ? deps.api<{ extras: places.TripExtrasView }>("GET", `${A}/trip/${enc(t.trip.id)}/extras?tz=${ctx.tzOffsetMinutes}`).then((r) => r.extras).catch(() => undefined)
          : Promise.resolve(undefined),
        loadWork(ctx, deps, "travel"),
      ]);
      return { t, files, x, work };
    },
    build: (ctx, d) => { const c = workCtx(ctx, d?.work); return isDesk(c) ? travelDesk(c, d ?? {}) : travelPhone(c, d ?? {}); },
  }),
  screen<ShareData & { capture?: CaptureView }>({
    id: SCREENS.shareIn,
    load: async (ctx, deps) => {
      type Got = { file: MediaFile; attachment: Attachment };
      const got = (await Promise.all(shareFileIds(ctx.params).map((id) => deps.api<Got>("GET", `/v1/files/${enc(id)}`).catch(() => undefined))))
        .filter((g): g is Got => !!g?.file && !!g.attachment);
      const text0 = String(ctx.params.text ?? ""), url = String(ctx.params.url ?? "");
      if (!got.length && !text0 && !url) return {};
      // What is Plan Ease's (a circular, a bill, a ticket) becomes its card here, with no bot picker (screens/bots/planIn.ts).
      const capture = await shareCapture(ctx, deps, got.map((g) => g.file.id), text0);
      if (capture) return { capture };
      const name = got.map((g) => g.file.name).join(", ").slice(0, 200);
      const sug = await deps.api<{ pick: string | null; ask: string; line: string }>("POST", `${A}/share/suggest`, { ...(name ? { name } : {}), ...(text0 ? { text: text0 } : {}), ...(url ? { url } : {}) }).catch(() => undefined);
      const files = got.length ? { file: got[0]!.file, attachment: got[0]!.attachment, files: got.map((g) => g.file), attachments: got.map((g) => g.attachment) } : {};
      return { ...files, pick: sug?.pick ?? null, ...(sug ? { ask: sug.ask, line: sug.line } : {}) };
    },
    build: (ctx, d) => (d?.capture ? capturePage(ctx, d.capture, { share: true }) : isDesk(ctx) ? shareDesk(ctx, d ?? {}) : sharePhone(ctx, d ?? {})),
  }),
  screen({ id: SCREENS.avatars, build: (ctx) => avatarsPage(ctx) }),
  // Plan's own calendar, one event or to-do at a time (screens/planItem.ts).
  ...planItemScreens,
  // "Plan something": the card, Check, Done, and the box that fills it (screens/bots/planMake.ts).
  ...planMakeScreens,
  // Plan Ease's link page and capture card (screens/bots/planIn.ts).
  ...planInScreens,
  ...mailScreens,
  ...mailInboxScreens,
  ...mailAliasScreens,
  ...mailCallScreens,
  ...meetScreens,
  // A wait's hand-off: WhatsApp with the follow-up (screens/bots/planSend.ts).
  ...planPeopleScreens,
  // Follow-through (botsBots/planFollow.ts): one followed item, and who does an item.
  ...planFollowScreens,
  // Follow-through's real phone call (botsBots/followPhone.ts): the person's own number.
  ...followPhoneScreens,
];
