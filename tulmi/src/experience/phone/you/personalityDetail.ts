/**
 * One voice preset in detail.
 */

import type { Personality } from "../../../../../shared/types/api.js";
import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { applyPresetOverrides } from "../../personalityPresets.js";

/**
 * Tone detail — reached by tapping a tone card on the Voice (You) page.
 * Deliberately spare: the tone name and its prompt, then two actions —
 * "Use this voice" (make it active) and add/remove it from the keyboard
 * toggle set. No taglines, no emoji, no supporting copy.
 */
export function personalityDetailScreen(p: Personality, presetId: string | undefined): ScreenResponse {
  const effective = applyPresetOverrides(p.presetOverrides);
  const preset = effective.find((e) => e.id === presetId) ?? effective[0]!;
  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  const isPinned = pinned.includes(preset.id);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_detail",
    title: preset.name,
    state: { presetId: preset.id, status: "" },
    actions: {
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
      used: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "navigateBack" },
      ] },
      use: { kind: "sequence", actions: [
        { kind: "haptic", style: "medium" },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: {
          activePresetId: preset.id,
          activeTone: preset.defaultTone,
        }, onSuccess: "used", onError: "saveErr" },
      ] },
      togglePin: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/pin", body: { presetId: preset.id }, onSuccess: "refresh", onError: "saveErr" },
      ] },
      refresh: { kind: "refresh" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: preset.name }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 16 } },
        // A voice's own instruction is what describes it — except Zu's, which
        // is deliberately empty, because Zu asserts nothing and lets the
        // portrait describe the voice. Its description says so in words.
        // The voice's own instructions, as written: keepCase (titleCase.ts).
        { type: "Text", props: { content: preset.promptStyle || preset.description, keepCase: true }, style: { fontSize: 16, color: "$color.text", lineHeight: 24 } },
        gap(28),
        { type: "Button", props: { label: "Use this voice", variant: "primary" }, on: { onPress: "use" } },
        gap(10),
        { type: "Button", props: { label: isPinned ? "Remove from keyboard" : "Add to keyboard", variant: "secondary" }, on: { onPress: "togglePin" } },
      ],
    },
    cacheTtlSeconds: 300,
  };
}
