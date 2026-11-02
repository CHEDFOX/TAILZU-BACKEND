/**
 * Voices: the tones the person can write in.
 */

import { type ScreenResponse, type ActionRef, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { DESK_SAMPLES, DESK_CONTEXTS, DESK_ROOMS } from "../../deskSamples.js";
import { HOUSE_TONE } from "../../keyboard/houseTone.js";
import { applyPresetOverrides } from "../../personalityPresets.js";
import { PHONE_FONT, t, PHONE_ROOMS, PHONE_LOOK, label, caption } from "../../phoneLook.js";
import type { ScreenContext } from "../../screens.js";
import { readable } from "../layout.js";
import { youLabel, YOU_UI, youHead, youHeadIcon } from "./copy.js";

/**
 * The Voice list — every tone (built-in + the user's custom ones), opened from
 * the Voice card on the You tab. The active tone is tinted; tapping a tone opens
 * the two-field editor (name + prompt). The "＋ Add a tone" button opens the
 * same editor with empty fields to create a new one.
 */
export function voicesScreen(ctx: ScreenContext): ScreenResponse {
  const p = ctx.personality;
  const effective = applyPresetOverrides(p.presetOverrides);
  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  // ZU IS NOT IN EITHER LIST. It is the person's own voice, always on the
  // keyboard and never edited, so it has no Add to offer and no prompt to
  // change. It sits above the styles as itself — see YOU_UI.selfVoice.
  const self = effective.find((e) => e.id === HOUSE_TONE.id);
  const styles = effective.filter((e) => e.id !== HOUSE_TONE.id);
  // The keyboard set, in pin order; ids whose preset was deleted are dropped.
  const kbVoices = pinned
    .map((id) => styles.find((e) => e.id === id))
    .filter((e): e is (typeof effective)[number] => !!e);

  /** Open the editor on a voice — what a row now does when it is tapped. */
  const openEditor = (preset: (typeof effective)[number]): ActionRef => ({
    kind: "sequence",
    actions: [
      { kind: "haptic", style: "selection" },
      { kind: "setState", path: "vcId", value: preset.id },
      { kind: "setState", path: "vcName", value: preset.name },
      // The toast's whole sentence, made here where the name is known. A
      // phone fills in a message that IS "$state.x", not one that holds it:
      // "Writing as $state.vcName." reached the screen as written.
      { kind: "setState", path: "vcToast", value: `Writing as ${preset.name}.` },
      { kind: "setState", path: "vcTone", value: preset.defaultTone ?? "" },
      { kind: "setState", path: "vcPrompt",
        value: (preset as { promptStyle?: string }).promptStyle ?? "" },
      { kind: "setState", path: "vcOpen", value: true },
    ],
  });
  const pinAction = (presetId: string, pinnedFlag: boolean): ActionRef => ({
    kind: "sequence",
    actions: [
      { kind: "haptic", style: "selection" },
      {
        kind: "callEndpoint",
        method: "POST",
        path: "/v1/personality/pin",
        body: { presetId, pinned: pinnedFlag },
        onSuccess: "pinChanged",
        onError: "pinErr",
      },
    ],
  });

  /** Make this the voice refine writes with. The one action every voice has. */
  const activate = (preset: (typeof effective)[number]): ActionRef => ({
    kind: "sequence",
    actions: [
      { kind: "haptic", style: "selection" },
      {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/personality",
        // Carry the voice's tone along so the keyboard's tone pill follows
        // the voice instead of keeping a stale tone.
        body: {
          activePresetId: preset.id,
          ...(preset.defaultTone ? { activeTone: preset.defaultTone } : {}),
        },
        onSuccess: "activated",
        onError: "activateErr",
      },
    ],
  });

  // ------------------------------------------------------------------
  // EACH VOICE IN ITS OWN COLOUR, writing the same said line — per kind of
  // writing (Chats, Work, Email, Other; `vctx`), because a voice that suits a
  // chat can be wrong for an email and that is the reason to see them side
  // by side. A voice made by the user has no colour or sample: it shows what
  // it was told to do, outlined.
  // ------------------------------------------------------------------
  const faceFor = (roomId: string | undefined): { face: keyof typeof PHONE_FONT; size: number; style?: Record<string, unknown> } => {
    switch (roomId) {
      case "d-w-saffron": return { face: "uiMedium", size: 16 };
      case "d-w-teal": return { face: "said", size: 20 };
      case "d-w-noir": return { face: "writtenItalic", size: 16.5 };
      case "d-w-night": return { face: "writtenLight", size: 13.5, style: { letterSpacing: 1.6, textTransform: "uppercase" } };
      default: return { face: "written", size: 16.5 };
    }
  };
  /** The + or − on a card, in the card's own ink. Hit area reaches 46 pt. */
  const cardSign = (sign: string, onPress: ActionRef, ink: string): Node => ({
    type: "Stack",
    on: { onPress },
    props: { pressOpacity: 0.6, hitSlop: 8 },
    style: {
      width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: ink,
      alignItems: "center", justifyContent: "center", opacity: 0.8,
    },
    children: [t(sign, "ui", 17, { lineHeight: 20, color: ink })],
  });
  const samples = (id: string, ink: string, roomId: string | undefined): Node[] => {
    const set = DESK_SAMPLES[id];
    if (!set) return [];
    const f = faceFor(roomId);
    // keepCase: a sample shows writing exactly as the voice writes it.
    return DESK_CONTEXTS.map((c) => {
      const n = t(set[c.id], f.face, f.size, { lineHeight: Math.round(f.size * 1.45), color: ink, marginTop: 12, ...(f.style ?? {}) });
      return { ...n, props: { ...n.props, keepCase: true }, visibleIf: { eq: ["vctx", c.id] } } as Node;
    });
  };
  const voiceCardOf = (preset: (typeof effective)[number], opts: {
    onPress: ActionRef; kicker?: Node; sign?: (ink: string) => Node; live?: boolean;
  }): Node => {
    const roomId = DESK_ROOMS[preset.id];
    const room = roomId ? PHONE_ROOMS[roomId] : undefined;
    const ink = room?.ink ?? PHONE_LOOK.ink;
    const dim = room?.dim ?? PHONE_LOOK.ink3;
    const tagline = (preset as { tagline?: string }).tagline ?? "";
    const own = (preset as { promptStyle?: string }).promptStyle ?? "";
    const shown = samples(preset.id, ink, roomId);
    return {
      type: "Stack",
      on: { onPress: opts.onPress },
      props: { pressOpacity: 0.8 },
      style: {
        borderRadius: 16, padding: 18, marginBottom: 12,
        backgroundColor: room?.bg ?? "transparent",
        ...(room?.edge || !room ? { borderWidth: 1, borderColor: room?.edge ?? "rgba(243,226,198,0.12)" } : {}),
        ...(opts.live ? { borderWidth: 1.5, borderColor: PHONE_LOOK.ink } : {}),
      },
      children: [
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
          children: [
            opts.kicker ?? label(preset.name, { color: dim }),
            ...(opts.sign ? [opts.sign(ink)] : []),
          ],
        },
        ...(opts.kicker ? [t(preset.name, "writtenLight", 20, { color: ink, marginTop: 10 })] : []),
        ...(shown.length ? shown
          // A custom voice's own instructions, as its owner wrote them.
          : own ? [{ ...t(own.length > 140 ? `${own.slice(0, 137)}…` : own, "written", 15, { lineHeight: 22, color: ink, marginTop: 10 }),
                     props: { content: own.length > 140 ? `${own.slice(0, 137)}…` : own, keepCase: true } } as Node]
          : []),
        ...(tagline ? [label(tagline, { color: dim, marginTop: 12, letterSpacing: 1.2 })] : []),
      ],
    };
  };

  /** Zu, as itself: its own voice, one tap to write as it. */
  const selfBlock = (preset: (typeof effective)[number]): Node => {
    const live = (p.activePresetId ?? HOUSE_TONE.id) === preset.id;
    const room = PHONE_ROOMS[DESK_ROOMS[preset.id] ?? "d-w-zu"] ?? PHONE_ROOMS["d-w-zu"]!;
    return voiceCardOf(preset, {
      onPress: activate(preset),
      live,
      kicker: {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "center", gap: 7 },
        children: [
          // In the card's own ink, not amber: the voice that writes is a
          // setting, not something live.
          ...(live ? [{ type: "Stack", style: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: room.ink } } as Node] : []),
          label(live ? "WRITING AS YOU" : "YOUR OWN VOICE", { color: room.dim }),
        ],
      },
    });
  };

  const voiceRow = (preset: (typeof effective)[number], where: "kb" | "all"): Node => {
    const isPinned = pinned.includes(preset.id);
    return voiceCardOf(preset, {
      onPress: openEditor(preset),
      sign: (ink) => where === "kb" || isPinned
        ? cardSign("\u2212", pinAction(preset.id, false), ink)
        : cardSign("+", pinAction(preset.id, true), ink),
    });
  };

  const keyboardSet: Node[] = [
    youLabel("On the keyboard"),
    ...(kbVoices.length ? [] : [caption("Zu is always on it. Add a style from below.", { marginBottom: 12 })]),
    ...kbVoices.map((e) => voiceRow(e, "kb")),
  ];

  const allSet: Node[] = [
    youLabel("Styles"),
    ...styles.map((e) => voiceRow(e, "all")),
  ];

  /** Which kind of writing the samples are shown for. */
  const contextSwitch: Node = {
    type: "SegmentedControl",
    bind: { value: "vctx" },
    props: {
      options: DESK_CONTEXTS.map((c) => ({ label: c.label.toUpperCase(), value: c.id })),
      background: "transparent", activeBackground: PHONE_LOOK.ink, activeColor: PHONE_LOOK.ground,
      color: PHONE_LOOK.ink2, fontSize: 10, fontWeight: "600", radius: 12, itemRadius: 9,
      padding: 3, paddingVertical: 12,
    },
    style: { borderWidth: 1, borderColor: "rgba(243,226,198,0.12)", marginTop: 4 },
  };
  const saidLine: Node[] = DESK_CONTEXTS.map((c) => ({
    type: "Stack",
    visibleIf: { eq: ["vctx", c.id] },
    style: { marginTop: 28, marginBottom: 16 },
    children: [label("You said"), {
      type: "Stack", props: { keepCase: true },
      children: [t(c.said, "said", 19, { lineHeight: 24, color: PHONE_LOOK.ink2, marginTop: 8 })],
    }],
  }) as Node);

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "voices",
    title: "Voice",
    // Seeded so the card's bound fields render empty rather than undefined
    // before anything has been opened.
    state: { vcOpen: false, vcId: "", vcName: "", vcToast: "", vcTone: "", vcPrompt: "", vctx: "chats" },
    actions: {
      // A NEW VOICE IS A CARD TOO, not a screen.
      //
      // Editing one happens here, over the list, because the list is what you
      // were comparing against when you decided to change something. Making
      // one is the same act with empty fields — sending it to a full screen
      // made the two feel like different features and threw away the list on
      // the way. Empty vcId is what marks it as new: the same POST upserts.
      addTone: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "setState", path: "vcId", value: "" },
        { kind: "setState", path: "vcName", value: "" },
        { kind: "setState", path: "vcTone", value: "" },
        { kind: "setState", path: "vcPrompt", value: "" },
        { kind: "setState", path: "vcOpen", value: true },
      ] },
      // addKbTone — "create it AND pin it" — went with the button that fired
      // it. The tone_edit screen still honours params.pin, so restoring the
      // shortcut is one node here and nothing on the client.
      // A voice was made active: confirm + re-render so the "Active" badge
      // moves. The keyboard picks it up on its next config fetch.
      activated: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "setState", path: "vcOpen", value: false },
        { kind: "toast", message: "$state.vcToast", tone: "success" },
        { kind: "refresh" },
      ] },
      activateErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't switch voices — check your connection and try again.",
      },
      // Keyboard set changed (Add/Remove): re-render both cards.
      pinChanged: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "refresh" },
      ] },
      pinErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't update the keyboard voices — check your connection and try again.",
      },
      vcSaved: { kind: "sequence", actions: [
        { kind: "setState", path: "vcOpen", value: false },
        { kind: "toast", message: "Voice saved.", tone: "success" },
        { kind: "refresh" },
      ] },
      vcSaveErr: { kind: "toast", tone: "error", message: "Couldn't save that voice. Try again." },
    },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // The ＋ sits ON the amber, at the top right — the one place on the
        // screen that is not a list, which is what makes it findable in a
        // screen that is otherwise entirely list.
        youHead("Voices", "Same words. The voice you choose.",
          youHeadIcon("M12 5 L12 19 M5 12 L19 12", "addTone")),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: PHONE_LOOK.side, paddingTop: 8, paddingBottom: 40,
            // A list of rows is a column at any width — see readable().
            ...readable(ctx),
          },
          children: [
            contextSwitch,
            ...saidLine,
            ...(self ? [selfBlock(self)] : []),
            ...keyboardSet,
            ...allSet,
            // NO SECOND ADD BUTTON. The ＋ on the header already makes a voice,
            // and any row's Add puts one on the keyboard — so a full-width pill
            // for "make one AND pin it" was a shortcut through two steps the
            // user can already see, sitting at the bottom of a list it had
            // nothing to do with.
          ],
        },

        // ---- Edit a voice, without leaving the list ----
        // Same shape as the training card: blurred behind, cross and
        // tap-outside both exit, Save writes and closes.
        {
          type: "Modal",
          bind: { open: "vcOpen" },
          props: { blur: true, blurIntensity: 70, dismissable: true },
          on: { onDismiss: { kind: "setState", path: "vcOpen", value: false } },
          children: [
            {
              type: "Stack",
              style: { direction: "row", alignItems: "center", gap: 10, marginBottom: 14 },
              children: [
                { type: "Text", bind: { content: "vcName" },
                  // The name IS the title. Before one is typed the card says
                  // what it is instead of showing an empty line where a
                  // heading should be.
                  props: { content: "New voice" },
                  style: { flex: 1, fontSize: 22, fontWeight: "800", color: "#FFFFFF" } },
                {
                  type: "Button",
                  props: { label: "\u00d7", variant: "ghost" },
                  style: { paddingHorizontal: 10, paddingVertical: 2, fontSize: 26, color: "rgba(255,255,255,0.55)" },
                  on: { onPress: { kind: "setState", path: "vcOpen", value: false } },
                },
              ],
            },
            { type: "Overline", props: { content: "Name" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            { type: "TextField", bind: { value: "vcName" },
              props: { placeholder: "Voice name" }, style: { marginBottom: 16 } },
            { type: "Overline", props: { content: "How it writes" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            { type: "TextField", bind: { value: "vcPrompt" },
              props: { placeholder: "Short, warm, no filler\u2026", multiline: true },
              style: { minHeight: 132, marginBottom: 16 } },
            // WHERE A VOICE IS CHOSEN, now that the row opens this instead of
            // switching under the finger. Tapping a name used to change what
            // the app writes as — a consequence you could not see from a list
            // of names, fired by the most casual gesture there is. Here the
            // name, the line and the prompt are in front of you when you
            // decide.
            { type: "Button", props: { label: "Write as this voice", variant: "primary" },
              // Nothing to write as until it exists. A new voice is saved
              // first, and the row it becomes is one tap from this card again.
              visibleIf: { truthy: "vcId" },
              style: { marginBottom: 10 },
              on: { onPress: { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "callEndpoint", method: "PUT", path: "/v1/personality",
                  body: { activePresetId: "$state.vcId", activeTone: "$state.vcTone" },
                  onSuccess: "activated", onError: "activateErr" },
              ] } } },
            {
              type: "Stack",
              style: { direction: "row", gap: 10 },
              children: [
                { type: "Button", props: { label: "Cancel", variant: "secondary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "setState", path: "vcOpen", value: false } } },
                { type: "Button", props: { label: "Save", variant: "secondary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "sequence", actions: [
                    { kind: "haptic", style: "selection" },
                    { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone",
                      body: { id: "$state.vcId", name: "$state.vcName", promptStyle: "$state.vcPrompt" },
                      onSuccess: "vcSaved", onError: "vcSaveErr" },
                  ] } } },
              ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}
