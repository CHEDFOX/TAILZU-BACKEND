/**
 * Training by chat: the person answers, the app learns their voice.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { getMediaRegistryFn } from "../../mediaRegistry.js";
import { applyPresetOverrides } from "../../personalityPresets.js";
import type { ScreenContext } from "../../screens.js";
import { screenHero } from "../hero.js";
import { TRAINING_UI } from "./copy.js";

/**
 * Every string, every gap and every media slot in the Training tab, in one
 * place.
 *
 * The point of this object is that the screens below read from it and hold no
 * literals of their own. Changing where the copy block sits, how far the art
 * bleeds, how strongly the background is veiled, or which of the two doors
 * exists is an edit HERE and a deploy — never a build, never an OTA.
 *
 * Media is separate again: `hero.training` and `hero.training_chat` are
 * registry keys, so the art itself changes by upload with no code change at
 * all. Both slots are optional — screenHero returns nothing for an empty key,
 * and both screens are designed to read correctly with no art behind them.
 */
/**
 * How many rows the chat thread keeps. Old rows drop off the front.
 *
 * A conversation is state on the device, not history on the server — nothing
 * here is stored — so the only thing that grows is what the screen has to
 * draw. Sixty is far more than anyone scrolls back through and well under
 * where a re-render starts to cost anything.
 */
const THREAD_MAX = 60;

export function trainingChatScreen(ctx: ScreenContext): ScreenResponse {
  // In-app mic media. Prefer an MP4 upload (mic.animation.mp4) when present —
  // MediaPlayer's video branch freezes it on-frame while paused AND reacts its
  // speed to the mic level (voiceReactive), so the in-app mic feels alive and
  // pauses cleanly. Fall back to the GIF (mic.animation) otherwise; a GIF can't
  // pause on a frame, so freezeOnPause stays false and VoiceToggle swaps to the
  // static mark between takes. The keyboard keeps reading mic.animation (the
  // GIF) — an MP4 can't render in its image-based key button.
  const micReg = getMediaRegistryFn?.() ?? {};
  const micHasMp4 = !!micReg["mic.animation.mp4"]?.url;
  const micIdle = micHasMp4
    ? { source: { key: "mic.animation.mp4" }, autoplay: false, loop: true, muted: true, voiceReactive: true, freezeOnPause: true }
    : { source: { key: "mic.animation" }, autoplay: false, loop: true, voiceReactive: true };

  // Train picker: the user's WHOLE voice library (built-ins + their custom
  // tones), not a hardcoded tone list — tap any voice to train it. "Core
  // style" trains the tone-independent base portrait. Server-authored, so a
  // new custom voice appears here on the next screen fetch with no app update.
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const TONE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
    { id: "none", label: "ZU", hint: "Your own way of talking — detected, cleaned, no vibe added" },
    ...effective.map((p) => ({
      id: p.id,
      label: p.name,
      hint: (p as { tagline?: string }).tagline ?? "Custom voice",
    })),
  ];
  // Seed the pill with the voice the user actually writes with, so "just tap
  // Refine" trains what they use daily.
  const activeVoice = effective.find(
    (e) => e.id === (ctx.personality.activePresetId ?? "signature"),
  );
  // A tappable voice row inside the blurred sheet: pick it → store the id +
  // its pill label, then close the sheet. All state, so the next Refine
  // trains in that voice.
  // The hint is GONE from the row. Thirteen voices each carrying a line of
  // description made the picker a wall of grey text you had to read through to
  // find a name — and the first row wrapped to two lines, so it did not even
  // read as a row. The list is names now; the description moved to the
  // long-press card, where there is room for it and for the prompt too.
  const toneRow = (opt: { id: string; label: string; hint: string }, i: number): Node => ({
    type: "Row",
    props: { label: opt.label, chevron: false, divider: i < TONE_OPTIONS.length - 1 },
    on: {
      onPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "setState", path: "tone", value: opt.id },
        { kind: "setState", path: "toneLabel", value: opt.label },
        { kind: "setState", path: "toneSheetOpen", value: false },
      ] },
      // Hold to look before you leap: what this voice is, and the prompt that
      // makes it that. Everything the card shows is pushed into state HERE, so
      // the card itself is one node bound to those values rather than thirteen
      // cards gated on an id.
      onLongPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "medium" },
        { kind: "setState", path: "cardId", value: opt.id },
        { kind: "setState", path: "cardTitle", value: opt.label },
        { kind: "setState", path: "cardHint", value: opt.hint },
        { kind: "setState", path: "cardPrompt", value: tonePromptOf(opt.id) },
        { kind: "setState", path: "cardEditing", value: false },
        { kind: "setState", path: "toneSheetOpen", value: false },
        { kind: "setState", path: "cardOpen", value: true },
      ] },
    },
  });

  /** The prompt behind a voice — what actually shapes the writing. */
  function tonePromptOf(id: string): string {
    if (id === "none") {
      return "No voice is applied. Your words are cleaned up and left as yours.";
    }
    const p = effective.find((e) => e.id === id) as { promptStyle?: string } | undefined;
    return p?.promptStyle ?? "";
  }

  // The composer. It was a 96pt writing box with the mic parked inside it,
  // which is the right shape for a form and the wrong one for a chat: a field
  // that tall pushes the conversation off the screen before anyone has typed.
  // It grows with what you write instead, and stops before it eats the thread.
  const boxWithVoice = (bindKey: string): Node => ({
    type: "Stack", style: { position: "relative", flex: 1 }, children: [
      { type: "TextField", bind: { value: bindKey },
        props: { placeholder: TRAINING_UI.chat.placeholder, multiline: true },
        style: { paddingRight: 52, minHeight: 44, maxHeight: 120 } },
      { type: "Stack", style: { position: "absolute", right: 12, top: 0, bottom: 0, justify: "center" }, children: [
        {
          type: "VoiceToggle",
          bind: { value: bindKey },
          props: {
            targetApp: "WhatsApp",
            language: "auto",
            size: 38,
            // Pale ink at rest, not amber: the mark's own motion is what says
            // it is listening.
            background: "#F3E2C6",
            iconIdle: micIdle,
          },
          // micError echoes the real failure ($event) — a permission denial or
          // an audio-session error must NOT look like a generic "check your
          // connection" toast, or it's undebuggable in the field.
          // onChange fires once the transcript has been written into the
          // field — that IS the moment to refine. Without it, speaking filled
          // the box and nothing else happened; the user had to know to tap
          // the card as well, and did not.
          on: { onChange: "send", onError: "micError" },
          // Older bundles don't have VoiceToggle in their registry. VoiceButton
          // has shipped since the initial SDUI release, drives the same bind,
          // and reads state → mic → transcript → writes back. Same product
          // outcome, one-tap-record instead of press-and-hold.
          fallback: {
            type: "VoiceButton",
            bind: { value: bindKey },
            props: { targetApp: "WhatsApp", language: "auto" },
            on: { onChange: "send", onError: "micError" },
          },
        },
      ] },
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "training_chat",
    title: TRAINING_UI.chat.title,
    state: {
      input: "", recording: false, refining: false,
      // The conversation itself. Every row was appended by an action below, so
      // what the screen says is server-authored the same way its layout is.
      thread: [{ role: "ask", text: TRAINING_UI.chat.opener }],
      // Training target: which VOICE this session trains (and which the
      // variants speak in). "none" trains the core style. Seeded to the
      // user's active voice so a first send trains what they actually use.
      tone: activeVoice?.id ?? "none",
      toneLabel: activeVoice?.name ?? "ZU",
      toneSheetOpen: false,
      // Voice card (long-press). Seeded so the card's bound Texts render empty
      // rather than undefined before anything has been held.
      cardOpen: false,
      cardEditing: false,
      cardId: "",
      cardTitle: "",
      cardHint: "",
      cardPrompt: "",
      // ChatThread writes the tap into these; the pick action reads them.
      _train: null, _pick: null, _input: "", _chosen: "", _angle: "", _rejA: "", _rejB: "",
    },
    actions: {
      err: { kind: "toast", message: "Something went wrong. Check your connection.", tone: "error" },
      // Shows the words the mic control sends ($event): permission, a busy
      // mic and a failed transcription each have their own sentence. The
      // control never sends a raw error; that goes to the device log.
      micError: { kind: "toast", message: "$event", tone: "error" },

      // Sending. The message lands on the thread and the field empties in the
      // same beat as the tap; the variants arrive when they arrive. Order
      // matters: _input is snapshotted BEFORE the field is cleared, because
      // the pick call sent a minute later still has to say what was asked.
      send: { kind: "sequence", actions: [
        { kind: "haptic", style: "light" },
        { kind: "setState", path: "_input", value: "$state.input" },
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: { role: "mine", text: "$state.input" } },
        { kind: "setState", path: "input", value: "" },
        { kind: "setState", path: "refining", value: true },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/variants",
          body: { text: "$state._input", tone: "$state.tone", language: "auto" },
          assignTo: "_train",
          onSuccess: "gotVariants",
          onError: "variantsErr",
        },
      ] },
      gotVariants: { kind: "sequence", actions: [
        { kind: "setState", path: "refining", value: false },
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: {
            role: "variants",
            label: TRAINING_UI.chat.variantsLabel,
            options: "$state._train.variants",
          } },
        { kind: "haptic", style: "light" },
      ] },
      variantsErr: { kind: "sequence", actions: [
        { kind: "setState", path: "refining", value: false },
        { kind: "toast", message: "Couldn’t refine that. Check your connection and try again.", tone: "error" },
      ] },

      // The tap already happened — ChatThread highlighted the card and wrote
      // the choice into _chosen/_angle/_rejA/_rejB before firing this. All
      // that is left is telling the server, which is why nothing here is
      // optimistic: there is no UI waiting on it.
      picked: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/pick",
          body: {
            input: "$state._input",
            chosen: "$state._chosen",
            rejectedA: "$state._rejA",
            rejectedB: "$state._rejB",
            tone: "$state.tone",
          },
          assignTo: "_pick",
          onSuccess: "learned",
          onError: "err",
        },
      ] },
      // What it took from the pick, then the next thing to answer. The prompt
      // comes back WITH the pick, so the list of them lives in one place on
      // the server and a conversation never runs out of things to ask.
      learned: { kind: "sequence", actions: [
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: { role: "note", text: "$state._pick.learned" } },
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: { role: "ask", text: "$state._pick.next" } },
      ] },

      // Saving from the voice card. The tone upsert makes the saved voice
      // ACTIVE, which is right — you edited it because you want to write with
      // it — so the picker's own state follows rather than silently disagreeing
      // with what the server now thinks the active voice is.
      cardSaved: { kind: "sequence", actions: [
        { kind: "setState", path: "cardEditing", value: false },
        { kind: "setState", path: "tone", value: "$state.cardId" },
        { kind: "setState", path: "toneLabel", value: "$state.cardTitle" },
        { kind: "setState", path: "cardOpen", value: false },
        { kind: "toast", message: "Voice saved.", tone: "success" },
      ] },
      cardSaveErr: { kind: "toast", message: "Couldn't save that voice. Try again.", tone: "error" },
    },
    root: {
      type: "Screen",
      // The THREAD scrolls, not the screen. A scrolling screen under a pinned
      // composer gives you two scrollers fighting over one gesture.
      props: { scroll: false },
      style: {
        paddingHorizontal: TRAINING_UI.chat.paddingHorizontal,
        paddingTop: TRAINING_UI.chat.paddingTop,
        flex: 1,
      },
      children: [
        // Background media slot — `hero.training_chat`. Same node and the same
        // present rules as the entry hero; what differs is that words sit on
        // top of it, so it is dimmed rather than veiled and the opacity is a
        // number in TRAINING_UI. An empty key renders nothing at all.
        ...screenHero("training_chat", {
          behind: true,
          fit: "cover",
          fullBleed: TRAINING_UI.chat.paddingHorizontal,
          fullBleedTop: TRAINING_UI.chat.paddingTop,
        }).map((n) => ({
          ...n,
          style: { ...(n.style ?? {}), opacity: TRAINING_UI.chat.backgroundOpacity },
        })),

        // Which voice this session trains. A chip at the top rather than the
        // old pill under the box: on a chat screen the only thing that belongs
        // at the bottom is the thing you type into.
        {
          type: "Stack",
          style: { direction: "row", alignItems: "center", gap: 10, marginBottom: 10 },
          children: [
            {
              type: "Button",
              bind: { label: "toneLabel" },
              props: { variant: "secondary" },
              style: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18 },
              on: { onPress: { kind: "sequence", actions: [
                { kind: "haptic", style: "light" },
                { kind: "setState", path: "toneSheetOpen", value: true },
              ] } },
            },
            // Thinking. The brand media itself, playing only while the
            // variants generate — the same living mark the mic uses, kept at
            // caption size because on a chat screen the thing you are waiting
            // for is the message, not the spinner.
            {
              type: "Stack",
              visibleIf: { truthy: "refining" },
              style: { direction: "row", alignItems: "center", gap: 8 },
              children: [
                {
                  type: "Stack",
                  style: {
                    width: 22, height: 22, borderRadius: 11, overflow: "hidden",
                    // Pale ink, not amber: generating is waiting, not live.
                    backgroundColor: "#F3E2C6", alignItems: "center", justifyContent: "center",
                  },
                  children: [
                    // Static under-layer: the three-bar wave mark, so an old
                    // bundle with no Video still shows the brand and not a dot.
                    // In the dark ground's ink, to read on the pale circle.
                    { type: "Stack", style: { direction: "row", gap: 1.5, alignItems: "center" }, children: [
                      { type: "Stack", style: { width: 1.5, height: 4, borderRadius: 1, backgroundColor: "#0F0D0B" } },
                      { type: "Stack", style: { width: 1.5, height: 8, borderRadius: 1, backgroundColor: "#0F0D0B" } },
                      { type: "Stack", style: { width: 1.5, height: 4, borderRadius: 1, backgroundColor: "#0F0D0B" } },
                    ] },
                    {
                      type: "Video",
                      bind: { playing: "refining" },
                      props: { source: micIdle, loop: true, muted: true, contentFit: "cover" },
                      style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
                      fallback: { type: "Spacer", style: { height: 0 } },
                    },
                  ],
                },
                { type: "Text", props: { content: TRAINING_UI.chat.refiningLabel },
                  style: { fontSize: 11.5, fontWeight: "600", color: "$color.muted", letterSpacing: 0.5 } },
              ],
            },
          ],
        },

        // The conversation. SDUI has no repeater, so this one node IS the
        // thread: it reads the array above and draws it, and owns the tap so a
        // pick never waits on the network to look chosen.
        {
          type: "ChatThread",
          bind: { thread: "thread" },
          props: {
            pickLabel: TRAINING_UI.chat.variantsLabel,
            chosenPath: "_chosen",
            anglePath: "_angle",
            rejectedAPath: "_rejA",
            rejectedBPath: "_rejB",
            colors: TRAINING_UI.chat.colors,
          },
          on: { onSelect: "picked" },
          style: { flex: 1 },
          // A bundle without ChatThread would render this screen's only content
          // as a hole. The field and the voice picker below still work, so the
          // honest fallback is a line saying where the conversation went.
          fallback: {
            type: "Text",
            props: { content: TRAINING_UI.chat.needsUpdate },
            style: { flex: 1, fontSize: 13.5, color: "$color.muted", textAlign: "center", paddingTop: 40 },
          },
        },

        // The composer, pinned. Type or speak — the mic writes into the same
        // field, so everything after the input is identical either way. Send
        // appears only once there is something to send.
        {
          type: "Stack",
          style: { direction: "row", alignItems: "flex-end", gap: 9, paddingTop: 10, paddingBottom: 6 },
          children: [
            boxWithVoice("input"),
            {
              type: "Button",
              props: { label: TRAINING_UI.chat.send, variant: "primary" },
              visibleIf: { truthy: "input" },
              style: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 22 },
              on: { onPress: "send" },
            },
          ],
        },

        // Blurred tone-picker sheet — pick which voice to train.
        {
          type: "Modal",
          bind: { open: "toneSheetOpen" },
          props: { blur: true, blurIntensity: 55, dismissable: true },
          children: [
            { type: "Text", props: { content: "Pick a voice to train" }, style: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 4 } },
            { type: "Text", props: { content: "Hold a voice to see what it does" },
              style: { fontSize: 12.5, color: "rgba(255,255,255,0.45)", textAlign: "center", marginBottom: 12 } },
            ...TONE_OPTIONS.map(toneRow),
          ],
        },


        // ---- Voice card: hold a voice, see what it is and what drives it ----
        //
        // One card bound to state, not one per voice: the row that opened it
        // pushed the title, description and prompt in, so this is a single node
        // however many voices exist.
        //
        // dismissable gives the tap-outside exit; the cross is here as well,
        // because a card the user cannot see the edge of is a card they cannot
        // tell is dismissable.
        {
          type: "Modal",
          bind: { open: "cardOpen" },
          props: { blur: true, blurIntensity: 70, dismissable: true },
          on: { onDismiss: { kind: "setState", path: "cardOpen", value: false } },
          children: [
            {
              type: "Stack",
              style: { direction: "row", alignItems: "center", gap: 10, marginBottom: 6 },
              children: [
                { type: "Text", bind: { content: "cardTitle" },
                  style: { flex: 1, fontSize: 22, fontWeight: "800", color: "#FFFFFF" } },
                {
                  type: "Button",
                  props: { label: "\u00d7", variant: "ghost" },
                  style: { paddingHorizontal: 10, paddingVertical: 2, fontSize: 26, color: "rgba(255,255,255,0.55)" },
                  on: { onPress: { kind: "setState", path: "cardOpen", value: false } },
                },
              ],
            },
            { type: "Text", bind: { content: "cardHint" },
              style: { fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.62)", marginBottom: 18 } },

            // READING. The prompt as it stands.
            { type: "Overline", props: { content: "Prompt" },
              visibleIf: { falsy: "cardEditing" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            { type: "Text", bind: { content: "cardPrompt" },
              visibleIf: { falsy: "cardEditing" },
              style: { fontSize: 14, lineHeight: 22, color: "rgba(255,255,255,0.82)", marginBottom: 20 } },
            {
              type: "Button",
              props: { label: "Edit", variant: "secondary" },
              visibleIf: { falsy: "cardEditing" },
              style: { width: "100%" },
              on: { onPress: { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "setState", path: "cardEditing", value: true },
              ] } },
            },

            // EDITING. Same card, same place — the prompt becomes writable
            // rather than the user being pushed to another screen and losing
            // the voice they were looking at.
            { type: "Overline", props: { content: "Prompt" },
              visibleIf: { truthy: "cardEditing" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            {
              type: "TextField",
              bind: { value: "cardPrompt" },
              visibleIf: { truthy: "cardEditing" },
              props: { placeholder: "How this voice should write…", multiline: true },
              style: { minHeight: 132, marginBottom: 14 },
            },
            {
              type: "Stack",
              visibleIf: { truthy: "cardEditing" },
              style: { direction: "row", gap: 10 },
              children: [
                {
                  type: "Button",
                  props: { label: "Cancel", variant: "secondary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "setState", path: "cardEditing", value: false } },
                },
                {
                  type: "Button",
                  props: { label: "Save", variant: "primary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "sequence", actions: [
                    { kind: "haptic", style: "selection" },
                    {
                      kind: "callEndpoint",
                      method: "POST",
                      path: "/v1/personality/tone",
                      body: { id: "$state.cardId", name: "$state.cardTitle", promptStyle: "$state.cardPrompt" },
                      onSuccess: "cardSaved",
                      onError: "cardSaveErr",
                    },
                  ] } },
                },
              ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}
