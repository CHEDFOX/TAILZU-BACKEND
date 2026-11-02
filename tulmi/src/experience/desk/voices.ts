/**
 * Voices: the tones the person writes in.
 */

import type { ScreenResponse, Node, ActionRef } from "../../../../shared/types/sdui.js";
import { DESK_CONTEXTS, DESK_SAMPLES, DESK_ROOMS } from "../deskSamples.js";
import { applyPresetOverrides } from "../personalityPresets.js";
import type { DeskContext } from "./context.js";
import { row, text, stack, link, screen, page } from "./kit.js";

// ---- VOICES -----------------------------------------------------------------------------

/** Zu's id. Zu is the person's own voice, not a style laid on top — it asserts
 *  nothing and has no prompt to change, so it is never editable, exactly as the
 *  phone's Voice page treats it (phone/you/voices.ts selfBlock only activates Zu). */
const ZU_ID = "signature";

export function deskVoices(ctx: DeskContext): ScreenResponse {
  const p = ctx.personality;
  const active = p.activePresetId || "signature";
  const voices = applyPresetOverrides(p.presetOverrides);
  const ordered = [...voices.filter((v) => v.id === active), ...voices.filter((v) => v.id !== active)];
  // Every voice but Zu can be renamed and re-prompted — a built-in picks up a
  // per-user override, a custom one is edited in place (routes/personality.ts
  // /v1/personality/tone). The same name + "How it writes" prompt the phone's
  // voice editor carries.
  const editable = ordered.filter((v) => v.id !== ZU_ID);

  const seg = row(DESK_CONTEXTS.map((c) => ({
    type: "Button",
    props: { label: c.label, cls: "d-seg-item" },
    on: { onPress: { kind: "setState", path: "ctx", value: c.id } },
    visibleIf: { neq: ["state.ctx", c.id] },
    fallback: { type: "Button", props: { label: c.label, cls: "d-seg-item d-seg-on" } },
  } as Node)), { alignSelf: "flex-start" }, "d-seg");

  const saidLines = DESK_CONTEXTS.map((c) => row([
    text("You said", "d-margin", { marginRight: 10 }),
    text(c.said, "d-said", { fontSize: 18, lineHeight: "24px", color: "var(--d-ink2)" }),
  ], { align: "baseline", flexWrap: "wrap" }, undefined, { visibleIf: { eq: ["state.ctx", c.id] } }));

  // THE DESK HAS NO MODAL. The editor reveals in place, the way the Words page
  // reveals its add-word field and History its delete-reason card: a boolean
  // state path (`edit.<id>`, or `edit.add` for a new one) toggled by setState,
  // and the two fields bound to `vc.<id>.{name,prompt}`, pre-filled from the
  // voice and seeded in the screen's state below. `id` is sent on save when
  // editing; an absent id upserts a new custom voice. Save refreshes — the page
  // comes back with the new/renamed voice and the editor closed.
  const editor = (key: string, id?: string): Node => {
    const save: ActionRef = {
      kind: "callEndpoint", method: "POST", path: "/v1/personality/tone",
      body: { ...(id ? { id } : {}), name: `$state.vc.${key}.name`, promptStyle: `$state.vc.${key}.prompt` },
      onSuccess: { kind: "refresh" },
      onError: { kind: "toast", message: "Couldn't save that voice. Try again." },
    };
    return {
      ...stack([
        text(id ? "Edit voice" : "New voice", "d-eyebrow"),
        text("Name", "d-eyebrow", { marginTop: 14, marginBottom: 6 }),
        { type: "TextField", props: { cls: "d-input", placeholder: "Voice name" }, bind: { value: `vc.${key}.name` } },
        text("How it writes", "d-eyebrow", { marginTop: 14, marginBottom: 6 }),
        {
          type: "TextField",
          props: { cls: "d-input", placeholder: "Short, warm, no filler…", multiline: true },
          bind: { value: `vc.${key}.prompt` }, style: { minHeight: 96, marginTop: 0 },
        },
        row([
          link("Save", save, "d-btn"),
          link("Cancel", { kind: "setState", path: "edit." + key, value: false }),
        ], { gap: 18, marginTop: 16, align: "center" }, "d-tools"),
      ], { marginTop: 12, paddingTop: 16, paddingBottom: 18, paddingLeft: 18, paddingRight: 18, borderRadius: 10, border: "1px solid var(--d-rule)" }),
      visibleIf: { truthy: "edit." + key },
    } as Node;
  };

  const rooms = ordered.map((v) => {
    const on = v.id === active;
    const samples = DESK_SAMPLES[v.id];
    const canEdit = v.id !== ZU_ID;
    // The colour card — what you compare and tap to switch. Unchanged: tapping
    // it still activates the voice, and the active one is not pressable.
    const card = stack([
      text(v.name, "d-world-name"),
      ...(samples
        ? DESK_CONTEXTS.map((c) => ({ ...text(samples[c.id], "d-world-text"), visibleIf: { eq: ["state.ctx", c.id] } } as Node))
        // A custom voice has no hand-written sample; it shows what it was told
        // to do, the way the phone's card does (phone/you/voices.ts voiceCardOf).
        : [text(v.promptStyle || v.tagline, "d-world-text")]),
      text(on ? "In use, everywhere" : (v.tagline || "Your voice"), "d-world-use", { marginTop: "auto" }),
    ], { gap: 14 },
      `d-world ${DESK_ROOMS[v.id] ?? "d-w-zu"}${on ? " d-world-on" : ""}`,
      on ? {} : { on: { onPress: {
        kind: "callEndpoint", method: "PUT", path: "/v1/personality",
        body: { activePresetId: v.id, ...(v.defaultTone ? { activeTone: v.defaultTone } : {}) },
        onError: { kind: "toast", message: "Couldn't switch voices" },
      } } });
    // The card and its Edit affordance are SIBLINGS under a wrapper with no
    // press of its own — the desk renderer does not stop click propagation, so
    // an Edit link inside the pressable card would also switch the voice. Here
    // tapping the card activates; tapping Edit only opens the editor.
    return stack([
      card,
      ...(canEdit ? [
        { ...row([link("Edit", { kind: "setState", path: "edit." + v.id, value: true })], {}, "d-tools"),
          visibleIf: { falsy: "edit." + v.id } } as Node,
        editor(v.id, v.id),
      ] : []),
    ], { flexBasis: "calc(33.333% - 10px)", minWidth: 220, gap: 10, alignSelf: "flex-start" });
  });

  // Field seeds, keyed by voice id: the editor for a voice opens pre-filled
  // with its current name and prompt; `add` starts empty for a new voice.
  const vc: Record<string, { name: string; prompt: string }> = { add: { name: "", prompt: "" } };
  for (const v of editable) vc[v.id] = { name: v.name, prompt: v.promptStyle ?? "" };

  return screen("desk_voices", "Voices", [page([
    text("Voices", "d-eyebrow"),
    text("Same words. The voice you choose.", "d-h1", { marginTop: 6 }),
    text("The voice you pick writes everything you say, on your phone and here. See each one in the kind of writing you do. Add your own, or change how one writes.", "d-lede", { marginTop: 8 }),
    // Add a voice — the one affordance on the page that is not a card, so it is
    // findable. Opens the same inline editor with empty fields.
    { ...row([link("Add voice", { kind: "setState", path: "edit.add", value: true })], { marginTop: 14 }, "d-tools"),
      visibleIf: { falsy: "edit.add" } },
    editor("add"),
    stack([seg], { marginTop: 22, marginBottom: 18 }),
    ...saidLines,
    row(rooms, { gap: 14, flexWrap: "wrap", marginTop: 18, align: "start" }),
  ])], { ctx: "chats", edit: {}, vc });
}
