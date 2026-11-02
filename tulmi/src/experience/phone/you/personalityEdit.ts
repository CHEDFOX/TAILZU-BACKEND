/**
 * Editing the person's style by hand.
 */

import type { Personality } from "../../../../../shared/types/api.js";
import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { findPreset, TONE_LABELS } from "../../personalityPresets.js";

/**
 * Per-preset editor. Reached from a preset card's ✎ button. Lets the user
 * override any of the built-in preset's cosmetic + prompt fields (name,
 * emoji, tagline, description, defaultTone, promptStyle) without changing
 * the preset itself — the override lives on their profile as
 * `presetOverrides[<id>]` and is merged in on every read.
 */
export function personalityEditScreen(p: Personality, presetId: string | undefined): ScreenResponse | null {
  const id = presetId ?? p.activePresetId ?? "signature";
  const base = findPreset(id);
  const override = p.presetOverrides?.[id] ?? {};
  const eff = {
    name: (override.name ?? base.name),
    tagline: (override.tagline ?? base.tagline),
    description: (override.description ?? base.description),
    defaultTone: (override.defaultTone ?? base.defaultTone),
    promptStyle: (override.promptStyle ?? base.promptStyle),
  };

  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });
  const label = (content: string): Node => ({
    type: "Text", props: { content, variant: "label" },
    style: { fontSize: 11, color: "$color.muted", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  });
  const chip = (title: string, value: string): Node => ({
    type: "Chip",
    props: { label: title, group: "editTone", value },
    on: { onPress: { kind: "haptic", style: "selection" } },
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_edit",
    title: `Edit ${eff.name}`,
    state: {
      editPresetId: id,
      editName: eff.name,
      editTagline: eff.tagline,
      editDescription: eff.description,
      editTone: eff.defaultTone,
      editPromptStyle: eff.promptStyle,
      status: "",
    },
    actions: {
      save: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "medium" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: {
              presetOverrides: {
                [id]: {
                  name: "$state.editName",
                  tagline: "$state.editTagline",
                  description: "$state.editDescription",
                  defaultTone: "$state.editTone",
                  promptStyle: "$state.editPromptStyle",
                },
              },
            },
            onSuccess: "saved",
            onError: "saveErr",
          },
        ],
      },
      reset: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "medium" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: {
              presetOverrides: { [id]: null },
            },
            onSuccess: "resetDone",
            onError: "saveErr",
          },
        ],
      },
      saved: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "success", message: "Saved." },
          { kind: "navigateBack" },
        ],
      },
      resetDone: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "info", message: "Reset to default." },
          { kind: "navigateBack" },
        ],
      },
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Edit voice" },
          style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginBottom: 4 } },
        { type: "Paragraph",
          props: { content: "Rename it or reshape how it writes. Reset any time to bring the original back." },
          style: { fontSize: 13, color: "$color.muted", marginBottom: 20 } },

        label("Name"),
        { type: "TextField", bind: { value: "editName" }, props: { placeholder: "Voice name" } },
        gap(16),

        label("Emoji"),
                gap(16),

        label("Tagline"),
        { type: "TextField", bind: { value: "editTagline" }, props: { placeholder: "Short one-liner" } },
        gap(16),

        label("Description"),
        { type: "TextField", bind: { value: "editDescription" }, props: { placeholder: "How this voice sounds", multiline: true, rows: 3 } },
        gap(16),

        label("Default tone"),
        { type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }, children: [
          chip(TONE_LABELS.none, "none"),
          chip(TONE_LABELS.formal, "formal"),
          chip(TONE_LABELS.casual, "casual"),
          chip(TONE_LABELS["very-casual"], "very-casual"),
          chip(TONE_LABELS.excited, "excited"),
        ] },
        gap(16),

        label("Prompt style"),
        { type: "Paragraph",
          props: { content: "The instruction the refine step reads. Advanced — change only if you know the phrasing you want." },
          style: { fontSize: 12, color: "$color.muted", marginBottom: 8 } },
        { type: "TextField", bind: { value: "editPromptStyle" },
          props: { placeholder: "e.g. Write with a poetic ear…", multiline: true, rows: 5 } },
        gap(24),

        { type: "Button", props: { label: "Save changes", variant: "primary" }, on: { onPress: "save" } },
        gap(10),
        { type: "Button", props: { label: "Reset to default", variant: "secondary" }, on: { onPress: "reset" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}
