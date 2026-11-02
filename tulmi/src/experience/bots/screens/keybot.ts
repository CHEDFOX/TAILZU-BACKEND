/**
 * KEYBOT: the keyboard bot's pages, for the phone and the window (one id each, ctx.client picks the layout).
 *
 *   bots.keybot            Keylessbord / DKeybot         everything the old Stats and You tabs had, in Keylessbord's look
 *                          (docs/bots-keybot-parity.md): the month typed against said, the words left, the week, today,
 *                          where the words went, how you speak, the days, six figures; then the You tab's lines in
 *                          groups (Make it yours, Keyboard and voice, What you said); what the key does. Account and help live in the You tab: Keylessbord is part of the app, not an app of its own
 *   bots.keybot.tone       KeyTone / DKeyTone       a tone for each kind of app (Chats, Mail, Work chat)
 *   bots.keybot.words      KeyWords / DKeyWords     the words it spells your way: added, learned, how often said
 *   bots.keybot.voices     KeyVoices / DKeyVoices   the read-aloud voice, speed, when it reads
 *   bots.keybot.train      KeyTrain / DKeyTrain     ten everyday lines said your way, and what it learned
 *   bots.keybot.history    KeyHistory / DKeyHistory what you said: copy it, forget it, clear it
 *   bots.keybot.settings   KeySettings / DKeySettings  the phone keyboard (look, feel, typing, the key); in the window,
 *                          this computer's keys, the pill and listening (desktop.config), and the languages
 *
 * Each page reads one view from routes/bots/botsKeybot.ts (GET /v1/keybot[/page], shaped in src/keybot/views.ts) and
 * writes through it or the routes that were already there (PUT /v1/personality, POST /v1/words, DELETE /v1/history).
 * A failed read draws the page's honest "couldn't load" state, never a made-up number.
 *
 * The numbers' own pages are screens/keybotStats.ts (month, day, apps, speak, days), the old You tab's that had no
 * Keylessbord page are screens/keybotYou.ts (style, haptics, name); the small parts and the charts, screens/keybotParts.ts.
 *
 * Not here: bots.keybot.on and the keyboard and microphone cards shown on Keylessbord (screens/firstRun.ts). bots.keybot.pill / .reply / .rewrite are the desktop's
 * own windows (TAILZU-DESKTOP pill.html and guide.html, behind the same switch), and the phone keyboard's KeyLive,
 * KeyReply and KeyRewrite are the keyboard extension itself: neither is a server-drawn screen.
 */

import type { Node, ActionSpec, ActionRef } from "../../../../../shared/types/sdui.js";
import type { KeybotStatsView } from "../../../keybot/stats.js";
import { TONE_PRESETS, TONE_GROUP_DEFS, TONE_SAID } from "../../../keybot/tones.js";
import type {
  KeybotHomeView, KeybotToneView, KeybotVoicesView, KeybotTrainView, KeybotSettingsView, KeybotWordsView, KeybotHistoryView,
} from "../../../keybot/views.js";
import {
  type BotsCtx, whenEq, C, row, col, text, meta, icon, seq, when, page, box, divider, sectionLabel, open, SCREENS, button, card, segmented,
  botAvatar, grow, call, blip, statusMark, listCard, listRow, switchRow,
} from "../kit.js";
import type { BotsDeps } from "../live.js";
import { playButton, playingSub, playingLine, canPlay } from "../media.js";
import { type BotsScreen, screen } from "../registry.js";
import { historyPhone, historyDesk } from "./keybot/history.js";
import { type HomeData, phoneKeys, keybotPhone, keybotDesk } from "./keybot/keybot.js";
import { settingsDesk } from "./keybot/settingsDesk.js";
import { wordsPhone, wordsDesk } from "./keybot/words.js";
import {
  load, type Glyph, appSquare, CLAY, save, phoneHead, couldntLoad, glyph, deskHead, DESK_WIDTH, deskCard, toggleRow, twoCols, KEYBOT,
  write, toast, oops, field, both,
} from "./keybotParts.js";
import { keybotStatsScreens } from "./keybotStats.js";
import { keybotYouScreens } from "./keybotYou.js";

const loadHome = async (ctx: BotsCtx, deps: Pick<BotsDeps, "api">): Promise<HomeData> => {
  const [home, stats] = await Promise.all([
    load<KeybotHomeView>("/v1/keybot")(ctx, deps).catch(() => undefined),
    load<KeybotStatsView>("/v1/keybot/stats")(ctx, deps).catch(() => undefined),
  ]);
  return { home, stats };
};

// ===================================================================== bots.keybot.tone
const GROUP_GLYPH: Record<string, Glyph> = { chats: "chats", mail: "mail", work: "work" };
const presetName = (id: string | null) => TONE_PRESETS.find((p) => p.id === id)?.name ?? null;

/** The state a tone page starts from: the kind it opens on, each kind's preset (and its name), the little things. */
function toneState(d: KeybotToneView): Record<string, unknown> {
  const tone: Record<string, string> = {}, toneName: Record<string, string> = {}, little: Record<string, unknown> = {};
  for (const g of d.groups) {
    tone[g.id] = g.preset ?? "";
    toneName[g.id] = presetName(g.preset) ?? "As you say it";
    little[g.id] = { noStop: g.noStop, latin: g.latin, signOff: g.signOff };
  }
  return { group: d.focus, tone, toneName, little };
}

/** A kind of app in the list: picked shows on the surface grey. */
function groupRow(g: KeybotToneView["groups"][number], desk: boolean): Node {
  const def = TONE_GROUP_DEFS.find((x) => x.id === g.id)!;
  const on = whenEq("group", g.id, C.surface, C.paper);
  return row([
    appSquare(GROUP_GLYPH[g.id]!, desk ? 34 : 32, whenEq("group", g.id, C.paper, C.surface)),
    desk
      ? col([text(def.label, { size: 15, weight: 500, lineHeight: 20 }), meta(def.appsLine, { size: 12 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 })
      : text(def.label, { size: 15, weight: 500, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }),
    text(presetName(g.preset) ?? "As you say it", { size: 13, color: C.grey70, lineHeight: 17, bind: `toneName.${g.id}`, align: "right" }),
    ...(desk ? [] : [icon("chevron", { size: 16, color: C.meta })]),
  ], { gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, backgroundColor: on, minHeight: 56 }, { kind: "setState", path: "group", value: g.id });
}

/** The four presets for one kind: the chosen one in clay. A tap chooses and saves it. */
function presetGrid(groupId: string): Node {
  const cardOf = (p: (typeof TONE_PRESETS)[number]) => col([
    text(p.name, { size: 15, weight: 600, lineHeight: 20 }),
    meta(p.blurb, { size: 12 }),
  ], {
    gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, backgroundColor: C.paper,
    borderColor: whenEq(`tone.${groupId}`, p.id, CLAY, C.line), flexGrow: 1, flexBasis: 0, minWidth: 0,
  }, seq(
    { kind: "setState", path: `tone.${groupId}`, value: p.id },
    { kind: "setState", path: `toneName.${groupId}`, value: p.name },
    save("POST", "/v1/keybot/tone", { group: groupId, preset: p.id }, "Couldn't change the tone. Try again."),
  ));
  return col([0, 2].map((i) => row([cardOf(TONE_PRESETS[i]!), cardOf(TONE_PRESETS[i + 1]!)], { gap: 10, alignItems: "stretch" })), { gap: 10 });
}

/** One kind's line in its chosen tone (or as said, when none is chosen), following the state. */
function sampleFor(groupId: string, desk: boolean): Node[] {
  const label = TONE_GROUP_DEFS.find((g) => g.id === groupId)!.label;
  const variant = (preset: string, name: string, line: string): Node => when({ eq: [`tone.${groupId}`, preset] }, col([
    meta(`${label} · ${name}`, { size: 12 }),
    text(line, { size: desk ? 15 : 14, lineHeight: desk ? 21 : 19 }),
  ], { gap: desk ? 6 : 2 }));
  return [...TONE_PRESETS.map((p) => variant(p.id, p.name, p.sample)), variant("", "As you say it", TONE_SAID)];
}

function tonePhone(ctx: BotsCtx, d: KeybotToneView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Tone per app", gap: 14, body: [phoneHead("Tone per app"), couldntLoad("your tones")] });
  return page(ctx, {
    nav: "keybot", title: "Tone per app", gap: 14, state: toneState(d),
    body: [
      phoneHead("Tone per app"),
      text("Keylessbord writes like you, a bit different per app.", { size: 14, color: C.grey70, lineHeight: 19 }),
      box(d.groups.flatMap((g, i) => [...(i ? [divider()] : []), groupRow(g, false)]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ...TONE_GROUP_DEFS.map((g) => when({ eq: ["group", g.id] }, col([sectionLabel(`Presets for ${g.label}`), presetGrid(g.id)], { gap: 10 }))),
      col([sectionLabel("One line, each tone"), box([
        row([glyph("chats", { size: 16, color: C.meta }), meta(`You said: “${TONE_SAID}”`, { size: 13, style: { flexShrink: 1 } })], { gap: 8, paddingVertical: 12, paddingHorizontal: 16 }),
        ...TONE_GROUP_DEFS.flatMap((g) => [divider(), col(sampleFor(g.id, false), { paddingVertical: 10, paddingHorizontal: 16 })]),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 10 }),
    ],
    footer: [row([text(`Teach Keylessbord your style · ${d.train.done} of ${d.train.total} done`, { size: 14, weight: 500, lineHeight: 18 }), icon("chevron", { size: 16 })],
      { gap: 8, justifyContent: "center", minHeight: 44 }, open(SCREENS.keyTrain))],
  });
}

function toneDesk(ctx: BotsCtx, d: KeybotToneView | undefined) {
  const head = deskHead("Tone per app", "Keylessbord writes like you, a bit different per app.", d
    ? [button(`Teach Keylessbord your style · ${d.train.done} of ${d.train.total} done`, open(SCREENS.keyTrain), { kind: "secondary", size: "md" })] : []);
  if (!d) return page(ctx, { nav: "keybot", title: "Tone per app", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your tones")] });
  const little = (g: (typeof TONE_GROUP_DEFS)[number]) => when({ eq: ["group", g.id] }, deskCard(`Little things in ${g.label}`, [
    toggleRow("Skip the full stop at the end", `little.${g.id}.noStop`, save("POST", "/v1/keybot/tone", { group: g.id, noStop: `$state.little.${g.id}.noStop` }), "No full stop to end a message"),
    toggleRow("Write Hindi words in English letters", `little.${g.id}.latin`, save("POST", "/v1/keybot/tone", { group: g.id, latin: `$state.little.${g.id}.latin` }), "“haan”, “kal”, “7 baje”"),
    toggleRow("Add a sign-off", `little.${g.id}.signOff`, save("POST", "/v1/keybot/tone", { group: g.id, signOff: `$state.little.${g.id}.signOff` }), "Your name at the end, where it fits"),
  ], { gap: 0 }));
  return page(ctx, {
    nav: "keybot", title: "Tone per app", gap: 18, maxWidth: DESK_WIDTH, state: toneState(d),
    body: [
      head,
      twoCols([
        col([sectionLabel("Apps"), box(d.groups.flatMap((g, i) => [...(i ? [divider()] : []), groupRow(g, true)]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
        ...TONE_GROUP_DEFS.map(little),
      ], [
        ...TONE_GROUP_DEFS.map((g) => when({ eq: ["group", g.id] }, col([sectionLabel(`Presets for ${g.label}`), presetGrid(g.id)], { gap: 8 }))),
        col([sectionLabel("One line, each tone"), card([
          row([text("You said:", { size: 13, color: C.meta, lineHeight: 17 }), text(`“${TONE_SAID}”`, { size: 13, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8 }),
          row(TONE_GROUP_DEFS.map((g) => col(sampleFor(g.id, true), {
            flexGrow: 1, flexBasis: 0, minWidth: 0, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5,
            borderColor: whenEq("group", g.id, CLAY, C.line),
          })), { gap: 10, alignItems: "stretch" }),
        ], { gap: 12, radius: 18 })], { gap: 8 }),
        meta("Keylessbord picks the tone from the app you’re in. Say “make it formal” any time to change just one message.", { size: 12 }),
      ], { left: 330, gap: 24 }),
    ],
  });
}

// ===================================================================== bots.keybot.voices
const SPEEDS = [{ label: "0.8×", value: "0.8" }, { label: "Normal", value: "1" }, { label: "1.25×", value: "1.25" }, { label: "1.5×", value: "1.5" }];

function voiceCard(v: KeybotVoicesView["voices"][number], desk: boolean, play = false): Node {
  const choose = seq({ kind: "setState", path: "voice", value: v.id }, save("PUT", "/v1/personality", { ttsVoice: v.id }, "Couldn't change the voice. Try again."));
  const frame = {
    borderRadius: 18, borderWidth: 1.5, backgroundColor: C.paper,
    borderColor: whenEq("voice", v.id, CLAY, C.line), ...(desk ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : {}),
  };
  if (!play) {
    return row([
      col([text(v.label, { size: 15, weight: 600, lineHeight: 20 }), meta(v.blurb, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      when({ eq: ["voice", v.id] }, text("In use", { size: 12, weight: 600, lineHeight: 16 })),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 60, ...frame }, choose);
  }
  // With a play button (KeyVoices): hear it without choosing it; the rest of the card chooses it. One plays at a time
  // (the app's own), at the speed picked below, and it stops when they leave the page.
  return col([
    row([
      playButton(v.id, `/v1/keybot/voices/${v.id}/sample?speed=$state.read.speed`, `Hear ${v.label}`),
      row([
        col([text(v.label, { size: 15, weight: 600, lineHeight: 20 }), ...playingSub(v.id, v.blurb)], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        when({ eq: ["voice", v.id] }, text("In use", { size: 12, weight: 600, lineHeight: 16 })),
      ], { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44 }, choose),
    ], { gap: 12 }),
    playingLine(v.id, CLAY),
  ], { gap: 10, paddingVertical: 10, paddingLeft: 10, paddingRight: 14, minHeight: 64, ...frame });
}

const readSave = (key: string) => save("PUT", "/v1/keybot/prefs", { read: { [key]: `$state.read.${key}` } });

function voicesPhone(ctx: BotsCtx, d: KeybotVoicesView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Read aloud", gap: 14, body: [phoneHead("Read aloud"), couldntLoad("the voices")] });
  return page(ctx, {
    nav: "keybot", title: "Read aloud", gap: 14, state: { voice: d.current, read: d.read, playing: null },
    body: [
      phoneHead("Read aloud"),
      text("Pick the voice Keylessbord reads aloud in.", { size: 14, color: C.grey70, lineHeight: 19 }),
      col([sectionLabel("Voices"), ...d.voices.map((v) => voiceCard(v, false, canPlay(ctx)))], { gap: 8 }),
      col([sectionLabel("Speed"), segmented(SPEEDS, "read.speed", { onChange: readSave("speed") })], { gap: 8 }),
      meta("Keylessbord reads Ask’s answers to you in this voice.", { size: 12 }),
    ],
  });
}

function voicesDesk(ctx: BotsCtx, d: KeybotVoicesView | undefined) {
  const head = deskHead("Read aloud", "Pick the voice Keylessbord reads aloud in.");
  if (!d) return page(ctx, { nav: "keybot", title: "Read aloud", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("the voices")] });
  const pairs: Node[] = [];
  for (let i = 0; i < d.voices.length; i += 2) {
    pairs.push(row([voiceCard(d.voices[i]!, true, canPlay(ctx)), d.voices[i + 1] ? voiceCard(d.voices[i + 1]!, true, canPlay(ctx)) : box([], { flexGrow: 1, flexBasis: 0 })], { gap: 10, alignItems: "stretch" }));
  }
  return page(ctx, {
    nav: "keybot", title: "Read aloud", gap: 18, maxWidth: DESK_WIDTH, state: { voice: d.current, read: d.read, playing: null },
    body: [
      head,
      twoCols([
        col([sectionLabel("Voices"), ...pairs], { gap: 10 }),
        col([sectionLabel("Speed"), segmented(SPEEDS, "read.speed", { onChange: readSave("speed") })], { gap: 8 }),
      ], [
        box([text("Keylessbord reads Ask’s answers to you in this voice, here and on your phone.", { size: 13, color: C.grey70, lineHeight: 18 })],
          { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }),
      ], { leftWeight: 1.7, rightWeight: 1, gap: 24 }),
    ],
  });
}

// ===================================================================== bots.keybot.train

/** Keylessbord's turn: its face, what it says, and the line to say (in clay when it is the one now). */
function botTurn(says: string, line: string, now: boolean): Node {
  return row([
    botAvatar(KEYBOT, 30),
    col([
      text(says, { size: 14, color: C.grey70, lineHeight: 19 }),
      box([text(`“${line}”`, { size: 15, lineHeight: 21 })], {
        alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 14, borderWidth: now ? 1.5 : 1, borderColor: now ? CLAY : C.line,
        borderTopLeftRadius: 6, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
      }),
    ], { gap: 6, flexShrink: 1, minWidth: 0 }),
  ], { gap: 10, alignItems: "flex-start" });
}

function youTurn(said: string): Node {
  return col([
    box([text(said, { size: 15, color: C.paper, lineHeight: 21 })], {
      backgroundColor: C.ink, paddingVertical: 10, paddingHorizontal: 14,
      borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 6, maxWidth: "85%",
    }),
    meta("You said", { size: 12 }),
  ], { gap: 4, alignItems: "flex-end" });
}

const kindFor = (k: string) => (k === "Work" ? "for work" : k === "Mail" ? "for mail" : "for a chat");

function conversation(d: KeybotTrainView): Node[] {
  const cur = d.lines[d.current];
  if (!cur) return [];
  if (d.previous < 0) return [botTurn("Say this your way:", cur.text, true)];
  const prev = d.lines[d.previous]!;
  return [botTurn("Say this your way:", prev.text, false), youTurn(prev.said ?? ""), botTurn(`Got it. Next one, ${kindFor(cur.kind)}:`, cur.text, true)];
}

function progress(d: KeybotTrainView): Node {
  const left = d.lines.filter((l) => !l.said && !l.skipped).length;
  return col([
    row([text(`${d.done} of ${d.lines.length}`, { size: 14, weight: 600, lineHeight: 18 }), grow(),
      meta(left ? `about ${Math.max(1, Math.round(left * 0.3))} min left` : "all done", { size: 12 })]),
    row(d.lines.map((l, i) => box([], { flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3, backgroundColor: l.said ? C.ink : i === d.current ? CLAY : C.track })), { gap: 4 }),
  ], { gap: 8 });
}

function learnedCard(d: KeybotTrainView, desk: boolean): Node {
  if (!d.learned.length) return col([sectionLabel("What I learned"), meta("Nothing yet. Say a line your way, and what it hears shows up here.", { size: 13 })], { gap: 8 });
  return col([sectionLabel("What I learned"), box(d.learned.flatMap((l, i) => [
    ...(i ? [divider()] : []),
    row([
      col([text(l.title, { size: 14, lineHeight: 19 }), ...(l.sub ? [meta(l.sub, { size: 12, lines: 2 })] : [])], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 10 }),
      desk
        ? row([text("Not me", { size: 12, color: C.grey70, lineHeight: 16 })], { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line },
          write("POST", "/v1/keybot/learned/forget", { kind: l.kind, key: l.key }, "Forgotten", "Couldn't forget that. Try again."))
        : box([text("Not me", { size: 12, color: C.meta, lineHeight: 16 })], { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
          write("POST", "/v1/keybot/learned/forget", { kind: l.kind, key: l.key }, "Forgotten", "Couldn't forget that. Try again.")),
    ], { gap: 10, paddingLeft: 16, paddingRight: 6, minHeight: 52 }),
  ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 });
}

function trainActions(d: KeybotTrainView, client: "phone" | "desktop"): Node[] {
  if (d.current < 0) return [];
  const next: ActionSpec = {
    kind: "condition", if: { falsy: "said" }, then: toast("Say it your way first"),
    else: call("POST", "/v1/keybot/train", { line: d.current, said: "$state.said" }, {
      ok: seq({ kind: "clearState", path: "said" }, { kind: "refresh" }), fail: oops("Couldn't learn from that. Try again."),
    }),
  };
  const skip = write("POST", "/v1/keybot/train/skip", { line: d.current }, undefined, "Couldn't skip it. Try again.");
  return [
    field("said", client === "desktop" ? "Type it, or hold your Keylessbord key and say it" : "Type it, or tap the X0 key and say it", { onSubmit: next, label: "Your way", returnKey: "send" }),
    row([
      box([button("Skip", skip, { kind: "secondary", wide: true, size: client === "desktop" ? "md" : "lg" })], { flexGrow: 1, flexBasis: 0 }),
      box([button("That's how I say it", next, { wide: true, icon: "check", size: client === "desktop" ? "md" : "lg" })], { flexGrow: 2.4, flexBasis: 0 }),
    ], { gap: 8 }),
  ];
}

function trainDone(): Node {
  return col([
    blip("done", 140),
    text("All ten done", { size: 18, weight: 600, lineHeight: 24, align: "center" }),
    meta("Keylessbord writes more like you now. It keeps learning from what you say.", { size: 13, align: "center" }),
    button("Start again", write("POST", "/v1/keybot/train/restart", undefined, undefined, "Couldn't start again. Try again."), { kind: "secondary", size: "md" }),
  ], { gap: 10, alignItems: "center", paddingVertical: 8 });
}

function trainPhone(ctx: BotsCtx, d: KeybotTrainView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Teach your style", gap: 14, body: [phoneHead("Teach your style"), couldntLoad("your lines")] });
  return page(ctx, {
    nav: "keybot", title: "Teach your style", gap: 14, state: { said: "" },
    body: [
      phoneHead("Teach your style"),
      progress(d),
      ...(d.current < 0 ? [trainDone()] : [col(conversation(d), { gap: 10 })]),
      learnedCard(d, false),
    ],
    footer: trainActions(d, "phone"),
  });
}

function trainDesk(ctx: BotsCtx, d: KeybotTrainView | undefined) {
  const head = deskHead("Teach your style", "Say 10 everyday lines your way. Keylessbord picks up how you really talk.");
  if (!d) return page(ctx, { nav: "keybot", title: "Teach your style", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your lines")] });
  const lastDone = d.lines.reduce((m, l, i) => (l.said || l.skipped ? i + 1 : m), 0);
  const lineRow = (l: KeybotTrainView["lines"][number], i: number): Node => row([
    box([l.said ? statusMark("done") : i === d.current ? statusMark("working", { color: CLAY }) : l.skipped ? statusMark("waiting") : box([], { width: 8, height: 8 })], { width: 12, alignItems: "center" }),
    text(String(i + 1), { size: 12, color: C.meta, lineHeight: 16, style: { width: 20 } }),
    text(`“${l.text}”`, { size: 13, weight: i === d.current ? 600 : 400, color: l.said || l.skipped ? C.idle : C.ink, lineHeight: 18, style: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 4 } }),
    meta(l.kind, { size: 12 }),
  ], { gap: 8, minHeight: 30 });
  return page(ctx, {
    nav: "keybot", title: "Teach your style", gap: 18, maxWidth: DESK_WIDTH, state: { said: "" },
    body: [
      head,
      twoCols([
        card([
          progress(d),
          ...(lastDone ? [row([text(lastDone === 1 ? "Line 1 done" : `Lines 1 to ${lastDone} done`, { size: 11, color: C.meta, lineHeight: 14 })],
            { alignSelf: "center", backgroundColor: C.surface, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 10 })] : []),
          ...(d.current < 0 ? [trainDone()] : conversation(d)),
          ...trainActions(d, "desktop"),
        ], { gap: 14, radius: 18, style: { paddingHorizontal: 18 } }),
      ], [
        learnedCard(d, true),
        col([sectionLabel(`All ${d.lines.length} lines`), card(d.lines.map(lineRow), { gap: 0, radius: 18, style: { paddingVertical: 6 } })], { gap: 6 }),
      ], { leftWeight: 1.15, rightWeight: 1, gap: 20 }),
    ],
  });
}

// ===================================================================== bots.keybot.settings
const kbSave = (key: string) => save("PUT", "/v1/keybot/prefs", { keyboard: { [key]: `$state.kb.${key}` } });

/** A small keyboard in the light or dark look. */
function lookPreview(dark: boolean): Node {
  const key = dark ? C.grey70 : C.paper, side = dark ? C.meta : C.track;
  const k = (f: number, bg: string, h = 14) => box([], { flexGrow: f, flexBasis: 0, height: h, borderRadius: 3, backgroundColor: bg });
  return col([
    row(Array.from({ length: 7 }, () => k(1, key)), { gap: 3 }),
    row(Array.from({ length: 7 }, () => k(1, key)), { gap: 3 }),
    row([k(1.2, side, 15), k(1, CLAY, 15), k(4, key, 15), k(1.4, side, 15)], { gap: 3 }),
  ], { gap: 4, backgroundColor: dark ? C.ink : C.surface, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 6 });
}

function lookCard(value: "light" | "dark", label: string, note: string): Node {
  return col([
    lookPreview(value === "dark"),
    row([text(label, { size: 14, weight: 600, lineHeight: 18 }), grow(), when({ eq: ["kb.look", value] }, meta("In use", { size: 12 })), when({ neq: ["kb.look", value] }, meta(note, { size: 12 }))], { paddingHorizontal: 2 }),
  ], {
    gap: 8, padding: 10, borderRadius: 18, borderWidth: 1.5, borderColor: whenEq("kb.look", value, CLAY, C.line), flexGrow: 1, flexBasis: 0, minWidth: 0,
  }, seq({ kind: "setState", path: "kb.look", value }, kbSave("look")));
}

/** A segmented control whose words need the room: less side padding in each segment. */
function tight(seg: Node): Node {
  return { ...seg, children: (seg.children ?? []).map((c) => ({ ...c, style: { ...(c.style ?? {}), paddingHorizontal: 4 } })) };
}

/** A label with a small segmented control on its right. */
function segRow(label: string, options: Array<{ label: string; value: string }>, path: string, onChange: ActionRef, width = 200): Node {
  return row([text(label, { size: 15, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }), box([segmented(options, path, { onChange })], { width, flexShrink: 0 })],
    { gap: 10, paddingVertical: 10, paddingLeft: 16, paddingRight: 12, minHeight: 52 });
}

function settingsPhone(ctx: BotsCtx, d: KeybotSettingsView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Keyboard", gap: 14, body: [phoneHead("Keyboard"), couldntLoad("your keyboard")] });
  const langs = d.languages.map((l) => l.label).join(", ") || "Not set";
  return page(ctx, {
    nav: "keybot", title: "Keyboard", gap: 14, state: { kb: d.keyboard },
    body: [
      phoneHead("Keyboard"),
      col([sectionLabel("Look"), row([lookCard("light", "Light", "Bright keys"), lookCard("dark", "Dark", "Easy at night")], { gap: 10, alignItems: "stretch" }),
        when({ eq: ["kb.look", "phone"] }, meta("Follows your phone until you pick one.", { size: 12 }))], { gap: 8 }),
      col([sectionLabel("Feel"), box([
        segRow("Haptics", [{ label: "Off", value: "off" }, { label: "Light", value: "light" }, { label: "Strong", value: "strong" }], "kb.haptics", kbSave("haptics")),
        divider(),
        segRow("Key height", [{ label: "Short", value: "short" }, { label: "Normal", value: "normal" }, { label: "Tall", value: "tall" }], "kb.height", kbSave("height"), 210),
        divider(),
        segRow("Key sounds", [{ label: "On", value: "on" }, { label: "Off", value: "off" }], "kb.sounds", kbSave("sounds"), 140),
        when({ eq: ["kb.sounds", "phone"] }, row([meta("Follows your phone until you pick one.", { size: 12 })], { paddingLeft: 16, paddingRight: 12, paddingBottom: 10 })),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
      listCard([
        listRow({ label: "Languages", value: langs, onPress: open(SCREENS.language) }),
        switchRow("Hold space to speak", "kb.holdSpace", { sub: "Hold still to speak, like a tap on the X0 key. Slide to move the cursor.", onChange: kbSave("holdSpace") }),
      ], { title: "Typing" }),
      col([sectionLabel("Keylessbord key"), card([
        tight(segmented([{ label: "Left of space", value: "left" }, { label: "Right of space", value: "right" }, { label: "Top row", value: "top" }], "kb.keyAt", { onChange: kbSave("keyAt") })),
        ...(["left", "right", "top"] as const).map((at) => when({ eq: ["kb.keyAt", at] }, phoneKeys(at, 0.9))),
      ], { gap: 10, padding: 12, radius: 18 })], { gap: 8 }),
    ],
  });
}

// ===================================================================== the list
const withQ = (base: string) => (ctx: BotsCtx) => (ctx.params.q ? `${base}?q=${encodeURIComponent(String(ctx.params.q))}` : base);

export const keybotScreens: BotsScreen[] = [
  screen<HomeData>({ id: SCREENS.keybot, load: loadHome, build: both(keybotPhone, keybotDesk) }),
  screen<KeybotToneView>({ id: SCREENS.keyTone, load: load<KeybotToneView>("/v1/keybot/tone"), build: both(tonePhone, toneDesk) }),
  screen<KeybotWordsView>({ id: SCREENS.keyWords, load: (ctx, deps) => load<KeybotWordsView>(withQ("/v1/keybot/words")(ctx))(ctx, deps), build: both(wordsPhone, wordsDesk) }),
  screen<KeybotVoicesView>({ id: SCREENS.keyVoices, load: load<KeybotVoicesView>("/v1/keybot/voices"), build: both(voicesPhone, voicesDesk) }),
  screen<KeybotTrainView>({ id: SCREENS.keyTrain, load: load<KeybotTrainView>("/v1/keybot/train"), build: both(trainPhone, trainDesk) }),
  screen<KeybotHistoryView>({ id: SCREENS.keyHistory, load: (ctx, deps) => load<KeybotHistoryView>(withQ("/v1/keybot/history")(ctx))(ctx, deps), build: both(historyPhone, historyDesk) }),
  screen<KeybotSettingsView>({ id: SCREENS.keySettings, load: load<KeybotSettingsView>("/v1/keybot/settings"), build: both(settingsPhone, settingsDesk) }),
  // The old Stats and You tabs' pages (docs/bots-keybot-parity.md).
  ...keybotStatsScreens,
  ...keybotYouScreens,
];
