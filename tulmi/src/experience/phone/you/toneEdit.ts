/**
 * Editing one tone.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { applyPresetOverrides, PERSONALITY_PRESETS } from "../../personalityPresets.js";
import type { ScreenContext } from "../../screens.js";

/**
 * The two-field tone editor. Opened from a tone card (edit — fields pre-filled)
 * or the "Add a tone" button (create — empty fields). Just a NAME and a PROMPT.
 * Save upserts the tone (POST /v1/personality/tone) and makes it the active
 * voice. A built-in can be Reset; a custom tone can be Deleted.
 */
export function toneEditScreen(ctx: ScreenContext): ScreenResponse {
  const presetId = typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined;
  // Opened from the "New voice for keyboard" button — the save also pins the
  // tone to the keyboard set (it lands in All voices either way).
  const pinOnSave = ctx.params?.pin === true || ctx.params?.pin === "true" || ctx.params?.pin === "1";
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const preset = presetId ? effective.find((e) => e.id === presetId) : undefined;
  const isBuiltin = !!presetId && PERSONALITY_PRESETS.some((b) => b.id === presetId);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  // Save body: bake the id when editing; omit it when creating (backend mints a
  // custom id). $state.name / $state.prompt are the two fields.
  const saveBody: Record<string, unknown> = { name: "$state.name", promptStyle: "$state.prompt" };
  if (presetId) saveBody.id = presetId;
  if (pinOnSave) saveBody.pin = true;

  const label = (t: string): Node => ({ type: "Overline", props: { content: t }, style: { marginBottom: 8 } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "tone_edit",
    title: preset ? `Edit ${preset.name}` : pinOnSave ? "New keyboard voice" : "New tone",
    state: {
      name: preset?.name ?? "",
      prompt: preset?.promptStyle ?? "",
    },
    actions: {
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
      saved: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "navigateBack" },
      ] },
      save: { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone", body: saveBody, onSuccess: "saved", onError: "saveErr" },
      // Reset a built-in / delete a custom — both clear the override.
      remove: { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone", body: { id: presetId, remove: true }, onSuccess: "saved", onError: "saveErr" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
      children: [
        label("Tone name"),
        { type: "TextField", bind: { value: "name" }, props: { placeholder: "e.g. Professional" } },
        gap(18),
        label("Tone prompt"),
        { type: "TextField", bind: { value: "prompt" }, props: { placeholder: "How this voice should write — e.g. Clear, warm, and direct. No filler.", multiline: true }, style: { minHeight: 120 } },
        gap(24),
        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        ...(presetId ? [
          gap(10),
          {
            type: "Button",
            props: { label: isBuiltin ? "Reset to default" : "Delete tone", variant: isBuiltin ? "secondary" : "danger" },
            on: { onPress: "remove" },
          } as Node,
        ] : []),
      ],
    },
    cacheTtlSeconds: 0,
  };
}
