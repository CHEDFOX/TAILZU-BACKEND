/**
 * The You tab itself: the person's voice, languages and cards.
 */

import { type ScreenResponse, type Node, type ActionRef, type ActionSpec, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { youCard } from "../../assistant.js";
import { DESK_ROOMS } from "../../deskSamples.js";
import { applyPresetOverrides } from "../../personalityPresets.js";
import { PHONE_LOOK, t, PHONE_ROOMS, label, caption, proofMark } from "../../phoneLook.js";
import type { ScreenContext } from "../../screens.js";
import { sw } from "../../settingsWords.js";
import { waveform } from "../../statsCharts.js";
import { dayPart, blipBox } from "../../touches.js";
import { FILL_STYLE, readable } from "../layout.js";
import { neuralField, fieldGrowth, FIELD_SIGNAL_AT_REST } from "../neuralField.js";
import { settingsGear } from "../parts.js";
import { LANGUAGE_NAMES } from "../pie.js";
import { QUIET_FLOW_FOR_TRAINING } from "../training/copy.js";
import { YOU_UI } from "./copy.js";

/** The You tab's three small cards (see settingCard). */
const YOU_CARD_FILL = { dictionary: "#16463D", languages: "#4B2240", haptics: "#253A5C", stats: "#3A2B1C" } as const;
/** Between the You tab's cards, top to bottom: three times the 14 it was, so
 *  each card is a place of its own rather than a row in a list. */
const YOU_CARD_GAP = 42;

/**
 * "Hello", around the world — the one cycle, the same for everyone.
 *
 * THE ORDER IS THE DESIGN, which is why this is a list and not a map. The
 * greeting turns over in place, so two words in the same script one after the
 * other read as a typo rather than a change of language. Every step here moves
 * to a different writing system where it can — Latin, then Devanagari, then
 * Latin, then Han — so each turn is visibly a turn.
 *
 * English is first because it is the word on screen when the tab opens.
 * Nothing after it depends on the account: one person's phone shows the same
 * sequence as the next one's.
 *
 * The code beside each word is documentation, not a lookup. It says which
 * language the word belongs to so the next person to edit this list can check
 * one without guessing from the script.
 */
const HELLOS: Array<[code: string, hello: string]> = [
  ["en", "Hello"],
  ["hi", "\u0928\u092e\u0938\u094d\u0924\u0947"],
  ["es", "Hola"],
  ["zh", "\u4f60\u597d"],
  ["fr", "Bonjour"],
  ["ar", "\u0645\u0631\u062d\u0628\u0627"],
  ["ja", "\u3053\u3093\u306b\u3061\u306f"],
  ["pt", "Ol\u00e1"],
  ["ru", "\u041f\u0440\u0438\u0432\u0435\u0442"],
  ["ta", "\u0bb5\u0ba3\u0b95\u0bcd\u0b95\u0bae\u0bcd"],
  ["it", "Ciao"],
  ["ko", "\uc548\ub155\ud558\uc138\uc694"],
  ["de", "Hallo"],
  ["bn", "\u09a8\u09ae\u09b8\u09cd\u0995\u09be\u09b0"],
  ["tr", "Merhaba"],
  ["he", "\u05e9\u05dc\u05d5\u05dd"],
  ["te", "\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02"],
  ["pl", "Cze\u015b\u0107"],
  ["th", "\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35"],
  ["gu", "\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7"],
  ["el", "\u0393\u03b5\u03b9\u03b1 \u03c3\u03b1\u03c2"],
  ["vi", "Xin ch\u00e0o"],
  ["kn", "\u0ca8\u0cae\u0cb8\u0ccd\u0c95\u0cbe\u0cb0"],
  ["fa", "\u0633\u0644\u0627\u0645"],
  ["sv", "Hej"],
  ["ml", "\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02"],
  ["uk", "\u041f\u0440\u0438\u0432\u0456\u0442"],
  ["pa", "\u0a38\u0a24 \u0a38\u0a4d\u0a30\u0a40 \u0a05\u0a15\u0a3e\u0a32"],
  ["id", "Halo"],
  ["or", "\u0b28\u0b2e\u0b38\u0b4d\u0b15\u0b3e\u0b30"],
  ["tl", "Kumusta"],
  ["ur", "\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u06cc\u06a9\u0645"],
  ["cs", "Ahoj"],
  ["my", "\u1019\u1004\u103a\u1039\u1002\u101c\u102c\u1015\u102b"],
  ["sw", "Habari"],
  ["mr", "\u0928\u092e\u0938\u094d\u0915\u093e\u0930"],
  ["hu", "Szia"],
  ["ka", "\u10d2\u10d0\u10db\u10d0\u10e0\u10ef\u10dd\u10d1\u10d0"],
  ["zu", "Sawubona"],
  ["si", "\u0d86\u0dba\u0dd4\u0db6\u0ddd\u0dc0\u0db1\u0dca"],
  ["ro", "Salut"],
  ["am", "\u1230\u120b\u121d"],
  ["no", "Hei"],
  ["km", "\u179f\u17bd\u179f\u17d2\u178f\u17b8"],
  ["hy", "\u0532\u0561\u0580\u0587"],
  ["fi", "Moi"],
  ["yo", "Bawo"],
  ["nl", "Hoi"],
  ["ha", "Sannu"],
];

/**
 * The cycle, built once.
 *
 * The dedup is a guard on the list above, not a feature: two languages can
 * genuinely share a word, and the same word twice running reads as a skipped
 * turn rather than a greeting in another language.
 */
function helloCycle(): string[] {
  const seen = new Set<string>();
  return HELLOS
    .map(([, hello]) => hello)
    .filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
}

export function personalityScreen(ctx: ScreenContext): ScreenResponse {
  const u = YOU_UI;
  const g = u.greet;

  /**
   * The greeting, top left.
   *
   * Two nodes, not one: the app is handed a word list and a name, and given
   * no say in either. FlipText knows how to turn one word into the next and
   * nothing else — which words, how long they hold, how they are set and
   * where they sit are all decided here.
   *
   * A person with no name saved gets the hello alone rather than a greeting
   * addressed to nobody.
   */
  const name = (ctx.name ?? "").trim();
  const greeting: Node = {
    type: "Stack",
    style: { position: "absolute", top: g.top, left: g.left },
    children: [
      {
        type: "FlipText",
        props: {
          words: helloCycle(),
          intervalMs: g.intervalMs,
          flipMs: g.flipMs,
          flip: g.flip,
          variant: "greetHello",
        },
        // The height again, on the node. A lineHeight makes the text sit the
        // same inside its box; a height makes the box the same. Both, or a
        // script whose glyphs overrun the line still grows the row.
        style: { height: g.hello.lineHeight },
      },
      ...(name
        ? [{
            type: "Text",
            // Trimmed, not wrapped. A second line would push the greeting
            // down into the deck, and the deck is what this screen is for.
            props: { content: name, variant: "greetName", numberOfLines: g.nameLines },
            style: { marginTop: g.gap, maxWidth: g.nameMaxWidth },
          } as Node]
        : []),
    ],
  };

  /**
   * THE VOICE CARD — in the voice's own colour, writing a real sentence.
   *
   * What was said, in the hand, above what this voice makes of it: the one
   * thing anybody opening this tab wants to know about a voice is what it
   * does to their words. The dot beside WRITING AS is in the card's own ink:
   * a chosen voice is a setting, not something live, so no amber here.
   */
  /**
   * EVERY CARD: ITS NAME IN BOLD AT THE TOP, A LINE IN THE HAND AT THE FOOT.
   * The name is the thing (ZU, BIRZU, BOOK, BUZZ); the line is what it says
   * to you. Between them, whatever the card shows.
   */
  const cardTitle = (text: string, color: string = PHONE_LOOK.ink): Node =>
    t(text, "uiBold", 22, { letterSpacing: 1.4, textTransform: "uppercase", color });
  const cardSub = (text: string, color = "rgba(243,226,198,0.8)"): Node =>
    t(text, "said", 19, { color, marginTop: 16 });
  /** Tallest first: the voice, then training, then the rest. */
  const CARD_MIN = { voice: 260, train: 210, small: 170, pair: 190 };

  const voiceCard = (name: string, _tagline: string, voiceId: string): Node => {
    const room = PHONE_ROOMS[DESK_ROOMS[voiceId] ?? "d-w-zu"] ?? PHONE_ROOMS["d-w-zu"]!;
    return {
      type: "Stack",
      on: { onPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "navigate", screenId: "voices" },
      ] } },
      props: { pressOpacity: 0.85 },
      style: {
        borderRadius: 20, padding: 22, marginBottom: YOU_CARD_GAP, backgroundColor: room.bg,
        minHeight: CARD_MIN.voice, justifyContent: "space-between",
        ...(room.edge ? { borderWidth: 1, borderColor: room.edge } : {}),
      },
      children: [
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
          children: [
            // The voice's own name: ZU, unless another voice is writing.
            { ...cardTitle(name, room.ink), props: { content: name, variant: "voiceName" } } as Node,
            label("Change", { color: room.dim, marginTop: 6 }),
          ],
        },
        cardSub("Write Thoughts Your Way", room.dim),
      ],
    };
  };

  /**
   * Dictionary, Languages and Haptics: outlined, not filled — the two cards
   * above have colour; these are settings, and say so quietly.
   */
  /**
   * THE THREE SMALL CARDS, EACH IN ITS OWN COLOUR. Outlines made them read as
   * settings rows; a deep fill of their own makes each a place, beside the
   * voice card and the training card's indigo. Deep so the pale ink carries,
   * and none of them amber or saffron: nothing on them is live.
   *   Dictionary  evergreen — a page the proof marks sit on
   *   Languages   plum
   *   Haptics     lapis
   */
  const settingCard = (
    title: string | Node, body: Node[], sub: string, screen: string, fill: string,
    style: Record<string, unknown> = {}, aside?: Node,
  ): Node => ({
    type: "Stack",
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "navigate", screenId: screen },
    ] } },
    props: { pressOpacity: 0.7 },
    style: { borderRadius: 20, padding: 20, backgroundColor: fill, justifyContent: "space-between", ...style },
    children: [
      {
        type: "Stack",
        children: [
          {
            type: "Stack",
            style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
            children: [typeof title === "string" ? cardTitle(title) : title, ...(aside ? [aside] : [])],
          },
          ...body,
        ],
      },
      cardSub(sub),
    ],
  });

  /**
   * "LANGUAGE", IN LANGUAGE AFTER LANGUAGE, each written in its own script:
   * English first, then the ones this person chose, then a turn round the
   * world. It turns over in 3D, where the greeting above crossfades, so the
   * two never move alike. The system's bold, because a word in Devanagari or
   * Tamil has no glyphs in the app's own faces.
   */
  const LANGUAGE_WORD: Record<string, string> = {
    en: "LANGUAGE", hi: "भाषा", bn: "ভাষা", ta: "மொழி", te: "భాష", gu: "ભાષા", kn: "ಭಾಷೆ",
    ml: "ഭാഷ", pa: "ਭਾਸ਼ਾ", mr: "भाषा", ur: "زبان", or: "ଭାଷା", as: "ভাষা", es: "IDIOMA",
    fr: "LANGUE", de: "SPRACHE", it: "LINGUA", pt: "IDIOMA", ru: "ЯЗЫК", ar: "لغة",
    ja: "言語", zh: "语言", ko: "언어", tr: "DİL", id: "BAHASA", sw: "LUGHA", nl: "TAAL",
  };
  const languageTitle = (codes: string[]): Node => {
    const order = ["en", ...codes, "hi", "es", "ta", "fr", "ja", "bn", "de", "ar", "ko", "te", "ru"];
    const words = [...new Set(order.map((c) => LANGUAGE_WORD[c]).filter((w): w is string => !!w))].slice(0, 12);
    return {
      type: "FlipText",
      props: { words, intervalMs: 2300, flipMs: 760, flip: "turn", perspective: 320, turnDegrees: 90 },
      style: { fontSize: 22, lineHeight: 30, height: 30, fontWeight: "800", letterSpacing: 1.2, color: PHONE_LOOK.ink },
      fallback: cardTitle("Language"),
    };
  };

  /**
   * THE LAST CARD: what all of this has added up to. Opens the Stats tab. The
   * month as a voice — a bar for each day, as tall as what was said that
   * day, mirrored about a line the way a recording looks — a glimpse, not
   * the numbers, which are the other tab's to tell.
   */
  const statsCard = (): Node => {
    const perDay = ctx.stats?.wordsPerDay ?? [];
    const go: ActionRef = { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "switchTab", tabId: "stats" },
    ] };
    return {
      type: "Stack",
      on: { onPress: go },
      props: { pressOpacity: 0.7 },
      style: { borderRadius: 20, padding: 20, backgroundColor: YOU_CARD_FILL.stats, marginTop: YOU_CARD_GAP },
      children: [
        // No amber on You: today is drawn like any other day here.
        waveform(perDay.length ? perDay : new Array(30).fill(0), { height: 72, markToday: false }),
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginTop: 4 },
          children: [
            { type: "Stack", style: { flex: 1 }, children: [cardSub("See What You Have Experienced So Far")] },
            {
              type: "Button",
              props: {
                label: "Stats", variant: "primary",
                labelColor: YOU_CARD_FILL.stats, fontSize: 13, fontWeight: "600", tracking: 0.4,
                paddingVertical: 0, paddingHorizontal: 22, radius: 12,
              },
              on: { onPress: go },
              style: { height: 44, backgroundColor: PHONE_LOOK.ink },
            },
          ],
        },
      ],
    };
  };

  /**
   * THE TRAINING CARD. What the Train tab was, at card size: the network it
   * grows, the two lines, what it has learned, and the same drag in. A tap
   * where the drag cannot be held (a bundle whose scroll steals it) falls
   * back to a button, the same way the tab did.
   */
  const trainCard = (): Node => {
    const T = u.trainCard;
    const sp = ctx.personality?.stylePortrait ?? {};
    const known = (sp.words?.length ?? 0) + (sp.styles?.length ?? 0)
      + (sp.rhythms?.length ?? 0) + Object.keys(sp.tones ?? {}).length;
    const sittings = sp.sessions ?? 0;
    const learned = known + sittings > 0
      ? T.learned.replace("{n}", known.toLocaleString("en-US")).replace("{s}", sittings.toLocaleString("en-US"))
      : T.learnedNone;
    // Always a tap now (see the tests): the card scrolls with the tab.
    const button: Node = {
      type: "Button",
      props: {
        label: T.tapLabel, variant: "primary",
        labelColor: "#1C1640", fontSize: 13, fontWeight: "600", tracking: 0.4,
        paddingVertical: 0, paddingHorizontal: 18, radius: 12,
      },
      on: { onPress: "enterTraining" },
      style: { backgroundColor: PHONE_LOOK.ink, height: 44 },
    };
    return {
      type: "Stack",
      on: { onPress: "enterTraining" },
      props: { pressOpacity: 0.85 },
      style: {
        borderRadius: 20, overflow: "hidden", marginBottom: YOU_CARD_GAP,
        padding: 20, backgroundColor: "#1E1946",
        minHeight: CARD_MIN.train, justifyContent: "space-between",
      },
      children: [
        // The network it grows, faint: a texture under the words, not a picture.
        { type: "Stack", style: { ...FILL_STYLE, opacity: 0.32 },
          // Always the live field, never an upload. The art uploaded at
          // you.train was rendered with words of its own ("I don't know how
          // you sound yet…"), and at this opacity they showed through behind
          // the card's real text. The field has no words, and it is theirs:
          // it grows with what has been learned.
          children: [neuralField(T.fieldDim, fieldGrowth(ctx.personality), undefined, FIELD_SIGNAL_AT_REST)] },
        cardTitle(T.title),
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16 },
          children: [
            {
              type: "Stack",
              style: { flex: 1 },
              children: [
                ...(learned ? [caption(learned, { marginBottom: 4, color: "rgba(243,226,198,0.72)" })] : []),
                cardSub(T.subtitle),
              ],
            },
            button,
          ],
        },
      ],
    };
  };

  // ---------------------------------------------------------- the values
  //
  // Every line says what it is SET TO, which means reading the same places
  // the sub-screens write to. A value that cannot be read says so plainly
  // rather than showing a zero, because "0 words" and "never opened" are
  // different facts and only one of them is true.
  const presets = applyPresetOverrides(ctx.personality.presetOverrides);
  const activeId = ctx.personality.activePresetId ?? "signature";
  const active = presets.find((e) => e.id === activeId);
  const voiceName = active?.name ?? "Zu";
  // What that voice actually DOES. The name says which one is on; this says
  // what it means, which is the thing anybody opening this tab wanted to know.
  const voiceLine = (active as { tagline?: string } | undefined)?.tagline ?? "";
  const wordCount = ctx.dictionary?.length ?? 0;
  const langCodes = (ctx.personality.languages ?? []).map(String);
  const langNames = langCodes.map((c) => LANGUAGE_NAMES[c] ?? c.toUpperCase());
  // EVERY ONE CHOSEN, and nothing when none is. "Auto" said nothing a blank
  // card does not, and "Hindi +3" hid the three; the card grows instead.
  const langLabel = langNames.join(", ");
  const fixes = [
    ...(ctx.personality.dictionary ?? [])
      .filter((d) => d && d.word && d.replacement)
      .map((d) => ({ was: String(d.word), word: String(d.replacement) })),
    ...(ctx.dictionary ?? []).map((d) => ({ was: "", word: String((d as { replacement?: string; word?: string }).replacement ?? (d as { word?: string }).word ?? "") })),
  ].filter((f) => f.word).slice(0, 3);
  const hapticsOn = ctx.personality?.hapticsAll === true
    || (ctx.personality?.hapticKeys ?? []).length > 0;

  /**
   * BLIP'S GREETING, under the name: a small Blip waving, and one line that
   * follows the person's time of day (morning, afternoon, evening, night, in
   * their time zone). It sits in the room the old spacer left, so the first
   * card clears it; it is the only Blip on this tab. The line is a sentence
   * as written (keepCase), not a label.
   */
  const dayLine = sw(`g.${dayPart(ctx.tzOffsetMinutes)}`);

  /**
   * HAND IT TO ME, only while connected apps are on (CONNECTORS): the task
   * card on the onboarding's paper (his line, the field, the mic and Do it),
   * then a card of the next three tasks and the apps (assistant.ts youCard).
   * It sits right under the greeting. From a bundle that has BlipRoam, Blip
   * leaves the greeting and walks the card's top edge instead: still the
   * tab's one Blip.
   */
  const handIt = youCard({
    assistant: ctx.assistant, can: ctx.can, connectorsOn: ctx.connectorsOn,
    language: ctx.language, platform: ctx.platform, tzOffsetMinutes: ctx.tzOffsetMinutes,
  }, u, { marginBottom: YOU_CARD_GAP });
  const underGreeting: Node = {
    type: "Stack",
    style: { marginTop: u.portrait.marginTop - 66, marginBottom: 24, flexDirection: "row", alignItems: "center", gap: 14 },
    children: [
      ...(handIt?.roams ? [] : [blipBox("wave-l", 0.4)]),
      { ...t(dayLine, "ui", 15, { lineHeight: 22, color: PHONE_LOOK.ink2, flex: 1 }), props: { content: dayLine, keepCase: true } },
    ],
  };

  /**
   * HAPTICS, ON THE CARD ITSELF. The switch turns every key on. Keys picked
   * one by one on the Haptics screen count as on too, and switching those
   * off loses the picking — so that, and only that, asks first.
   */
  const manualKeys = (ctx.personality?.hapticKeys ?? []).length;
  const hapticsSave = (body: Record<string, unknown>): ActionRef => ({
    kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics", body, onError: "hapticsErr",
  });
  /** Keys picked by hand: the switch goes back on and asks first. */
  const askFirst: ActionSpec = { kind: "sequence", actions: [
    { kind: "setState", path: "hapticsOn", value: true },
    { kind: "setState", path: "askHapticsOff", value: true },
  ] };
  const hapticsSwitch: Node = {
    // Its own touch: a tap on the switch flips it, and never also opens the
    // Haptics screen the rest of the card leads to.
    type: "Stack",
    on: { onPress: { kind: "haptic", style: "selection" } },
    children: [{
      type: "Switch",
      bind: { value: "hapticsOn" },
      props: { onColor: PHONE_LOOK.ink, offColor: "rgba(243,226,198,0.22)", thumbColor: "#FFFFFF" },
      on: { onChange: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        {
          kind: "condition",
          if: { truthy: "hapticsOn" },
          then: hapticsSave({ all: true }),
          // OFF. Asked EVERY time there are keys picked by hand — read from
          // the server at the moment of turning off, not from when this tab
          // was drawn: keys picked on the Haptics screen a minute ago, with
          // this tab still on the stack underneath, used to slip past it.
          else: {
            kind: "callEndpoint", method: "GET", path: "/v1/personality", assignTo: "_hapticsNow",
            onSuccess: {
              kind: "condition",
              if: { truthy: "_hapticsNow.personality.hapticKeys.0" },
              then: askFirst,
              else: hapticsSave({ all: false }),
            },
            // Unreadable: decide on what this tab knew when it was drawn.
            onError: manualKeys > 0 ? askFirst : hapticsSave({ all: false }),
          },
        },
      ] } },
      fallback: t(hapticsOn ? "On" : "Off", "writtenLight", 17, { lineHeight: 24 }),
    }],
  };
  /** The one question the switch asks, and only with keys picked by hand. */
  const smallButton = (labelText: string, action: ActionRef, primary: boolean): Node => ({
    type: "Button",
    props: {
      label: labelText, variant: primary ? "primary" : "secondary",
      labelColor: primary ? "#1C1640" : PHONE_LOOK.ink, fontSize: 12, fontWeight: "600", tracking: 0.3,
      paddingVertical: 0, paddingHorizontal: 18, radius: 12,
    },
    on: { onPress: action },
    style: { flex: 1, height: 44, ...(primary ? { backgroundColor: PHONE_LOOK.ink }
      : { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(243,226,198,0.28)" }) },
  });
  const hapticsAsk: Node = {
    type: "Modal",
    bind: { open: "askHapticsOff" },
    props: { blur: true, blurIntensity: 30, blurTint: "dark" },
    on: { onDismiss: { kind: "setState", path: "askHapticsOff", value: false } },
    style: { backgroundColor: YOU_CARD_FILL.haptics, borderRadius: 22, padding: 22, width: "88%" },
    children: [
      label("Haptics", { color: "rgba(243,226,198,0.62)" }),
      t("Turn every key off?", "writtenLight", 22, { marginTop: 12, letterSpacing: -0.3 }),
      caption("The keys you picked by hand go quiet too. You can pick them again any time.",
        { marginTop: 10, color: "rgba(243,226,198,0.72)" }),
      {
        type: "Stack",
        style: { flexDirection: "row", gap: 10, marginTop: 22 },
        children: [
          smallButton("I Know", { kind: "sequence", actions: [
            { kind: "setState", path: "askHapticsOff", value: false },
            { kind: "setState", path: "hapticsOn", value: false },
            hapticsSave({ all: false, clear: true }),
          ] }, false),
          smallButton("Leave It", { kind: "setState", path: "askHapticsOff", value: false }, true),
        ],
      },
    ],
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality",
    title: "",
    // The backdrop runs to the top of the window. The tabs stay — this is a
    // tab root, and taking them away here strands the user.
    hideHeader: true,
    /**
     * Which card's art is the backdrop. It followed the coverflow; with the
     * deck gone it is fixed on the Voice card, which is the right answer and
     * not a leftover — the voice is what this tab is about, so the voice's
     * art is the mood behind it. Kept as state rather than inlined because
     * the Image nodes below still read it, and because the day a screen
     * wants to change the mood it writes one path.
     */
    state: { deck: 0, hapticsOn, askHapticsOff: false, ...(handIt?.state ?? {}) },
    actions: {
      // The button that fired this is gone from the tab by owner decision.
      // The ACTION stays defined on purpose.
      //
      // App Review 2.5.4 wants a background capture to be stoppable without
      // force-quitting. Three things still satisfy that without a button: iOS
      // paints its own recording indicator the whole time, the keyboard's mic
      // stops the session, and FlowSessionManager ends it after five idle
      // minutes on its own. If a reviewer disagrees, putting the control back
      // is re-adding one node here — no build.
      endFlow: {
        kind: "sequence",
        actions: [
          { kind: "endFlowSession" },
          { kind: "toast", message: "Background microphone turned off.", tone: "success" },
        ],
      },
      // The Train tab's way in, unchanged: the spoken door when the flag says
      // the realtime voice is ready, the refine loop until then.
      hapticsErr: { kind: "sequence", actions: [
        { kind: "toast", message: "Couldn't save that.", tone: "error" },
        { kind: "refresh" },
      ] },
      enterTraining: { kind: "sequence", actions: [
        { kind: "haptic", style: "light" },
        {
          kind: "condition",
          if: { flag: "train.realtime" },
          then: { kind: "sequence", actions: [QUIET_FLOW_FOR_TRAINING, { kind: "navigate", screenId: "training_live" }] },
          else: { kind: "navigate", screenId: "training_chat" },
        },
      ] },
    },
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: u.ground },
      children: [
        // A GROUND, NOT A PHOTOGRAPH.
        //
        // The tab used to stand on the voice's own art, blurred past reading
        // and washed back — a mood behind the words. Blurred art is not a
        // colour: it is a smear whose hue is whatever was uploaded, it changes
        // under every card and every row on the tab, and nothing on top of it
        // sits on the same value twice. The content is a name, a line and
        // three settings; all of them read better on one flat, chosen dark.
        //
        // It also takes five blurred views off the screen, which is what made
        // the greeting's turn flicker the whole tab on Android.
        // THE PORTRAIT AND THE FOUR LINES.
        //
        // The deck showed one card and hid three, and what each card was
        // ABOUT — which voice, how many words, which languages — was behind a
        // tap. This tab is about a person, and a person is read at a glance.
        // So: a sentence that says the whole setup, then four lines that each
        // carry their own current value on the surface.
        {
          type: "Screen",
          // Held only when the training card is a drag (trainCard.swipe):
          // holding touches stops a drag that starts on a card or a row
          // from scrolling the tab at all.
          props: { holdTouches: u.trainCard.swipe === true },
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: PHONE_LOOK.side, paddingTop: 0, paddingBottom: 40,
          },
          children: [
            // ONE COLUMN, CENTRED, WHATEVER THE WINDOW IS.
            //
            // This tab is a name, a line about the voice, and three settings.
            // None of that is wider on a desktop than it is on a phone — a
            // setting row stretched across a 1400px window puts its label and
            // its value at opposite ends of the desk, and the eye has to
            // travel the whole way to read one fact. So the column keeps the
            // width it was designed at and takes the air instead.
            {
              type: "Stack",
              style: { ...readable(ctx) },
              children: [
                underGreeting,
                ...(handIt ? [handIt.node] : []),
                voiceCard(voiceName, voiceLine, activeId),
                trainCard(),
                settingCard("Book", [
                  {
                    type: "Stack",
                    style: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 22, marginTop: 14 },
                    // Nothing in place of an empty list: the card's name
                    // says what it is, and "None yet" said nothing more.
                    children: fixes.map((f) => proofMark(f.was, f.word)),
                  },
                ], "Create Your Signs And Give A Meaning", "dictionary", YOU_CARD_FILL.dictionary,
                  { marginBottom: YOU_CARD_GAP, minHeight: CARD_MIN.small },
                  wordCount > 0 ? label(`${wordCount} words`, { color: "rgba(243,226,198,0.62)" }) : undefined),
                {
                  type: "Stack",
                  style: { flexDirection: "row", gap: 14 },
                  children: [
                    settingCard(languageTitle(langCodes), langLabel ? [
                      t(langLabel, "writtenLight", 15, { lineHeight: 22, marginTop: 12 }),
                    ] : [], "Do You Speak More Than One Tongue?", "languages", YOU_CARD_FILL.languages,
                      { flex: 1, minHeight: CARD_MIN.pair }),
                    settingCard("Buzz", [], "Your Touch Makes Them Shiver", "haptics", YOU_CARD_FILL.haptics,
                      { flex: 1, minHeight: CARD_MIN.pair }, hapticsSwitch),
                  ],
                },
                statsCard(),
              ],
            },
          ],
        },

        greeting,
        settingsGear("dark"),
        hapticsAsk,
      ],
    },
    // SHORTER NOW THAT THE CARDS CARRY NUMBERS.
    //
    // The four cards' CONTENTS change only when the user changes them, and
    // every one of those writes drops the cache — 120s was right for that.
    // The rings do not work that way: they move every time the person
    // dictates anything, from the keyboard, in another app, without ever
    // opening this tab. A two-minute window meant coming back to a chart that
    // did not include what you just wrote.
    //
    // 45s matches the Stats tab, which charts the same rows. Fresh on any
    // return that was not a bounce, and still cached across the bounce.
    //
    // With the Hand it to me card on, shorter: its Coming up is tasks that
    // move while the person is elsewhere (an OK given from a push, a run that
    // finished), and a row that says "Needs your OK" for a minute after it
    // was given reads as broken.
    cacheTtlSeconds: handIt ? 15 : 45,
  };
}
