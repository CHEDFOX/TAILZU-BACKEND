/**
 * Training live: a spoken conversation the app learns from.
 */

import { type ScreenResponse, type ActionSpec, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import type { ScreenContext } from "../../screens.js";
import { onDesk, FILL_STYLE } from "../layout.js";
import { fieldGrowth, neuralField, NEURAL_FIELD } from "../neuralField.js";
import { TRAINING_UI, REARM_FLOW_AFTER_TRAINING } from "./copy.js";

/**
 * The realtime door: a spoken conversation, and a portrait read from it.
 *
 * Three nodes do the work and none of them is native. VoiceSession owns the
 * audio loop and writes `sessionState`, `level`, `line` and `turns` into this
 * screen's state; VoiceBubble draws from the first two; the End button posts
 * the fourth. Everything else here is ordinary layout, so where the bubble
 * sits, what the states are called and how long a pause ends a turn are all
 * edits to TRAINING_UI.
 *
 * It is turn-based, not full duplex — you cannot interrupt it. That needs a
 * bidirectional audio session and a native module the app does not carry, so
 * it is honestly absent rather than half-built. The pieces this DOES use
 * (the streaming mic, speech synthesis, Skia) all shipped long ago, which is
 * why the whole screen arrives without a build.
 */
/**
 * THE FIRST THING THE SESSION SAYS, decided here and sent with the screen.
 *
 * No model is asked, because nothing it would say needs one: the facts are the
 * person's name and what has actually been learned of them, and both are in
 * hand at the moment the screen is built. Asking would cost a round trip, and
 * the round trip IS the bug — the screen opened listening, so the first app
 * voice arrived only after someone had talked into silence and waited.
 *
 * It picks the most specific thing that is TRUE. A real learned word is the
 * strongest, because it is the one line that could not have been written for
 * anybody else. Below that, how far along the portrait is. A line naming
 * something it does not have is never reachable.
 *
 * Varied by the day so a daily user is not greeted identically every time —
 * deterministic rather than random, so the same open twice in a row says the
 * same thing and does not look like a reroll.
 */
/**
 * THE VOICE SPEAKS THEIR LANGUAGE. The session's language is the one the user
 * set for dictation; the phone's synthesiser needs it as a locale, and "auto"
 * or English means the phone's own voice. Hinglish is read by an Indian
 * English voice, which handles Latin-letter Hindi where a Hindi voice does
 * not. Anything else is its own locale.
 */
export function speechLocale(hint?: string): string | undefined {
  const h = String(hint ?? "").trim().toLowerCase();
  if (!h || h === "auto" || h === "en") return undefined;
  const table: Record<string, string> = {
    hinglish: "en-IN", hi: "hi-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", mr: "mr-IN", gu: "gu-IN",
    kn: "kn-IN", ml: "ml-IN", pa: "pa-IN", ur: "ur-PK", es: "es-ES", fr: "fr-FR", de: "de-DE",
    it: "it-IT", pt: "pt-BR", ar: "ar-SA", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN", ru: "ru-RU",
    tr: "tr-TR", nl: "nl-NL", id: "id-ID", vi: "vi-VN", th: "th-TH", pl: "pl-PL", sv: "sv-SE",
    uk: "uk-UA", fa: "fa-IR",
  };
  return table[h] ?? h;
}

/** The greeting in the flagship languages. Elsewhere the session opens by
 *  listening, as it did before there was a greeting: an English line in a
 *  Hindi voice is worse than a moment of quiet. */
const LIVE_GREETING_BY_LANGUAGE: Record<string, string> = {
  hinglish: "Bas aise hi baat karte hain. Aaj kya chal raha hai?",
  hi: "बस ऐसे ही बात करते हैं। आज क्या चल रहा है?",
};

function liveGreeting(ctx: ScreenContext): string {
  const lang = String(ctx.language ?? "").trim().toLowerCase();
  if (lang && lang !== "auto" && lang !== "en") return Object.hasOwn(LIVE_GREETING_BY_LANGUAGE, lang) ? LIVE_GREETING_BY_LANGUAGE[lang]! : "";
  const g = TRAINING_UI.chat.live.greeting;
  const sp = ctx.personality?.stylePortrait;
  const sessions = sp?.sessions ?? 0;
  // Their own slang, each stored with what it means to them. Only the term is
  // spoken: the meaning is what makes the word usable in a refine, and reading
  // a definition back at someone is not a greeting.
  const words = (sp?.words ?? [])
    .map((w) => String(w?.term ?? "").trim())
    .filter((t) => t.length > 1);
  // Rotates daily, and is the same for every choice in one render.
  const pick = (xs: readonly string[]): string =>
    xs[Math.floor(Date.now() / 86_400_000) % xs.length] ?? xs[0] ?? "";

  let line: string;
  if (words.length && sessions > 0) {
    line = pick(g.withWord).replace("{word}", pick(words));
  } else if (sessions === 0) {
    line = pick(g.first);
  } else if (sessions < 3) {
    line = pick(g.early);
  } else {
    line = pick(g.known);
  }

  // A first name only. The greeting is spoken aloud, and a full legal name
  // read out by a machine is the opposite of the thing this is for.
  const name = String(ctx.name ?? "").trim().split(/\s+/)[0];
  return name ? g.withName.replace("{name}", name) + line : line;
}

export function trainingLiveScreen(ctx: ScreenContext): ScreenResponse {
  const ui = TRAINING_UI.chat.live;
  // The field on the live screen is THIS person's, at the density they have
  // earned — and it sprouts new fibres while the session runs, so the growth
  // it opens at is the floor for the conversation, not a decoration.
  const growth = fieldGrowth(ctx.personality);
  // NO SPOKEN OPENER ON A PHONE. It was said while the microphone was still
  // opening, and the audio session switching over to listen cut it off
  // mid-sentence — "I don't know how you sound yet. Just talk, and I'll…". The
  // phone opens by listening, with the field already moving.
  //
  // THE DESK SAYS IT. A window has no audio session to switch: it opens the
  // microphone underneath the sentence and hands over when it ends (sdui.js
  // startSession), so the line is said whole. Without it the desk's Train
  // screen opened on silence, which read as a session with no voice at all.
  const greeting = onDesk(ctx) ? liveGreeting(ctx) : "";
  // Back where it was opened: the You tab on a phone, the Train page on the
  // desk. switchTab, not navigate, so the page is drawn fresh with the new
  // round counted and the desk's stack starts clean.
  const exit: ActionSpec = onDesk(ctx)
    ? { kind: "switchTab", tabId: "desk_train" }
    : { kind: "navigate", screenId: "personality" };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "training_live",
    title: ui.title,
    state: {
      // "speaking", not "idle". The session opens by SAYING something — see
      // liveGreeting — so the orb is already moving when the screen lands
      // rather than sitting still through a warm-up.
      sessionState: greeting ? "speaking" : "listening",
      level: 0.5,
      // The greeting, on screen at the same moment it is spoken. Seeded into
      // the transcript too, so the model's first reply answers something and
      // the conversation does not start mid-air.
      line: greeting,
      // NOT seeded. The line below carries the hint as its literal content and
      // binds `line` over it, so leaving this unset is what makes the hint the
      // opening state — seeded as "", the bind won with an empty string and the
      // hint never appeared at all.
      turns: greeting ? [{ role: "assistant", text: greeting }] : [],
      saving: false,
      saved: false,
      /** Set by the back arrow, so onDisappear does not post a second time. */
      leaving: false,
    },
    actions: {
      sessionErr: { kind: "toast", message: "$event", tone: "error" },
      // The conversation is read ONCE, here, on the way out. Per-turn updates
      // would let a single throwaway line move the portrait as far as the
      // pattern does.
      /**
       * LEAVING IS SAVING. There is no End button any more — the screen is the
       * orb and nothing else — so the way out has to carry the save.
       *
       * `leaving` is the guard. The back arrow runs this, which marks the flag
       * before it posts; the root's onDisappear runs the same post ONLY if the
       * flag is unset, which is the case when someone swipes back or is taken
       * off the screen some other way. So the conversation is read exactly
       * once however it ends, and never twice.
       */
      finish: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "setState", path: "leaving", value: true },
        { kind: "setState", path: "saving", value: true },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/portrait",
          body: { turns: "$state.turns" },
          onSuccess: "saved",
          onError: "saveErr",
        },
      ] },
      // The flip is the confirmation. A toast on top of it is the same fact
      // said twice, in two voices, one of them grey.
      saved: { kind: "sequence", actions: [
        { kind: "setState", path: "saved", value: true },
        { kind: "delay", ms: ui.farewell.holdMs },
        { kind: "setState", path: "saving", value: false },
        exit,
      ] },
      // A failed save must not trap someone on this screen. They leave either
      // way; what they lose is the portrait update, and the toast says so.
      saveErr: { kind: "sequence", actions: [
        { kind: "setState", path: "saving", value: false },
        { kind: "toast", message: "Couldn't save that conversation.", tone: "error" },
        exit,
      ] },
    },
    // The header carried the screen's name, and the name was a second copy of
    // the words on the button that opened it. Gone, so the way out is drawn
    // here instead — see the arrow below.
    hideHeader: true,
    root: {
      type: "Stack",
      // The save happens here for anyone who leaves without using the arrow.
      // And Flow, stood down on the way in, is armed again on the way out.
      on: { onDisappear: { kind: "sequence", actions: [
        {
          kind: "condition",
          if: { falsy: "leaving" },
          then: {
            kind: "callEndpoint",
            method: "POST",
            path: "/v1/train/portrait",
            body: { turns: "$state.turns" },
          },
        },
        REARM_FLOW_AFTER_TRAINING,
      ] } },
      style: { flex: 1, backgroundColor: "#000000", justifyContent: "flex-end", alignItems: "center" },
      children: [
        // Draws nothing. Mounting it starts the conversation; leaving the
        // screen unmounts it, which is what stops the mic.
        {
          type: "VoiceSession",
          props: {
            path: "/v1/train/converse",
            // THEIR LANGUAGE, both ways: the hint the recogniser and the
            // partner get, and the locale the phone speaks the replies in.
            language: ctx.language || "auto",
            ...(speechLocale(ctx.language) ? { speakLanguage: speechLocale(ctx.language) } : {}),
            silenceMs: ui.silenceMs,
            statePath: "sessionState",
            levelPath: "level",
            linePath: "line",
            turnsPath: "turns",
            /**
             * SPOKEN FIRST, AND WHILE THE MICROPHONE IS STILL OPENING.
             *
             * The session used to begin by listening, so the warm-up — asking
             * for the mic, opening the socket, waiting for it — happened in
             * silence, and the first thing the app ever said came after the
             * user had spoken into that silence and waited out a round trip.
             *
             * This is already written (liveGreeting builds it from the name
             * and what has actually been learned), so it can be said at once.
             * Saying it is what the warm-up hides behind: by the time the
             * sentence ends the socket is open, and the handover to listening
             * is instant instead of being where the wait moved to.
             *
             * An older bundle ignores an unknown prop and starts as it always
             * did, which is the behaviour this replaces rather than breaks.
             */
            ...(greeting ? { greeting } : {}),
          },
          on: { onError: "sessionErr" },
        },

        // EVERYTHING THAT IS NOT THE ORB IS THE WAY OUT.
        //
        // The arrow is a 38pt target in the corner and a thumb is wider than
        // that, so leaving was the one thing on this screen that took aim. It
        // does not have to: the screen holds a single object and the rest is
        // ground, and ground that dismisses is a gesture people already have
        // from every sheet they have ever closed.
        //
        // Placed BEFORE the orb and after everything else, which is what makes
        // it "outside the orb" rather than "anywhere": the topmost view under
        // a finger is the one that answers, so the orb keeps its own area and
        // the arrow, drawn last, keeps its own. This layer gets the rest.
        //
        // It fires `finish`, not a bare navigate — leaving by tapping the black
        // is still leaving, and the conversation is saved exactly as the arrow
        // saves it.
        {
          type: "Stack",
          on: { onPress: "finish" },
          visibleIf: { falsy: "saving" },
          props: { pressOpacity: 1 },
          style: { ...FILL_STYLE },
        },

        // THE ONLY THING ON THE SCREEN.
        //
        // No status word, no transcript line, no button. A conversation is
        // something you have, not something you read, and every one of those
        // was the screen explaining itself while the user was mid-sentence.
        // What the orb is doing says which state it is in, which is the whole
        // reason it moves.
        // THE FIELD, AND IT IS THE WHOLE SCREEN.
        //
        // The orb was one object pulsing in the middle of a black screen: a
        // good abstraction for a voice and a poor one for a thing that
        // LEARNS. This is the same network the entry shows, at full strength,
        // and it is bound to the session — the cascades run inward while it
        // listens, spill while it thinks, run outward while it answers, and
        // new fibres grow the whole time. What the state is, is what the
        // picture is doing, so the status word underneath is a caption on
        // something already legible.
        {
          ...neuralField(1, growth, { state: "sessionState", level: "level" }),
          props: { ...NEURAL_FIELD, growth, training: true },
        },

        // ENDING, IN THE MIDDLE OF THE FIELD.
        //
        // Over the network and under nothing, because for these three seconds
        // it is the only thing on the screen — the field goes on running
        // behind it, which is the point: the conversation is being folded into
        // the thing you were just talking to.
        {
          type: "Stack",
          visibleIf: { truthy: "saving" },
          style: { ...FILL_STYLE, alignItems: "center", justifyContent: "center" },
          children: [
            {
              type: "FlipText",
              props: {
                words: ui.farewell.words,
                intervalMs: ui.farewell.intervalMs,
                flipMs: ui.farewell.flipMs,
                flip: "turn",
              },
              style: {
                fontSize: ui.farewell.size,
                fontWeight: ui.farewell.weight,
                letterSpacing: ui.farewell.tracking,
                color: ui.farewell.color,
                textAlign: "center",
              },
            },
          ],
        },

        // THE WAY OUT, and the only control left. Last in the list so it paints
        // over everything, and absolute so the orb's own placement ignores it.
        {
          type: "Stack",
          on: { onPress: "finish" },
          visibleIf: { falsy: "saving" },
          // The disc is 38pt and a thumb is about 44. The slop is the
          // difference, taken outward, so the target is a thumb's width while
          // the thing drawn stays the size it should be.
          props: { pressOpacity: 0.6, hitSlop: ui.backSlop },
          style: {
            position: "absolute", top: ui.backTop, left: ui.backInset,
            width: ui.backSize, height: ui.backSize, borderRadius: ui.backSize / 2,
            alignItems: "center", justifyContent: "center",
            backgroundColor: ui.backBackground,
          },
          children: [{
            type: "SVG",
            props: {
              viewBox: "0 0 24 24", d: "M14.5 5 L8 12 L14.5 19",
              fill: "none", stroke: ui.backColor, strokeWidth: 2.2,
              strokeLinecap: "round", strokeLinejoin: "round",
            },
            style: { width: 16, height: 16 },
          }],
        },
      ],
    },
    // Never cached: this screen's whole content is the conversation it is
    // having, and a cached copy of that is a copy of someone else's.
    cacheTtlSeconds: 0,
  };
}
