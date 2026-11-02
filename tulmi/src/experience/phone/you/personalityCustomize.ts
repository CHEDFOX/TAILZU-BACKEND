/**
 * Customising a voice preset.
 */

import type { Personality } from "../../../../../shared/types/api.js";
import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";

/**
 * The "advanced" customize screen — the OLD personality form. Only reached
 * from the new personality picker when the user wants to add a dictionary
 * word, a snippet, or a sign-off on top of a selected preset. Kept
 * intentionally out of the main flow so first-time users don't stall on it.
 */
export function personalityCustomizeScreen(p: Personality): ScreenResponse {
  const SECTION = 24;
  const label = (content: string): Node => ({ type: "Text", props: { content, variant: "label" }, style: { marginBottom: 8 } });
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_customize",
    title: "Customize",
    state: {
      form: {
        tone: p.tone ?? "",
        formality: p.formality ?? "neutral",
        emoji: p.emoji ?? "minimal",
        vocabulary: p.vocabulary ?? "",
        customInstructions: p.customInstructions ?? "",
        signature: p.signature ?? "",
        snippets: p.snippets ?? "",
      },
      status: "",
      sample: "",
    },
    actions: {
      save: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Saving…" },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: "$state.form", onSuccess: "saved", onError: "saveErr" },
      ] },
      saved: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Saved." },
        { kind: "haptic", style: "success" },
      ] },
      saveErr: { kind: "toast", message: "Couldn't save.", tone: "error" },
      learn: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Learning your voice…" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/learn", body: { sample: "$state.sample" }, onSuccess: "learned", onError: "saveErr" },
      ] },
      learned: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "Learned.", tone: "success" },
        { kind: "refresh" },
      ] },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Customize" }, style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
        { type: "Paragraph", props: { content: "Fine-tune the selected voice with your own dictionary, sign-off, and instructions." }, style: { marginBottom: SECTION } },

        label("Sign-off (optional)"),
        { type: "TextField", bind: { value: "form.signature" }, props: { placeholder: "— A" } },
        gap(SECTION),

        label("Words it should know"),
        { type: "TextField", bind: { value: "form.vocabulary" }, props: { placeholder: "Aarav\nNykaa\nKubernetes", multiline: true } },
        gap(SECTION),

        label("Custom instructions"),
        { type: "TextField", bind: { value: "form.customInstructions" }, props: { placeholder: "avoid exclamation marks, use British spelling", multiline: true } },
        gap(SECTION),

        label("Snippets — trigger = expansion, one per line"),
        { type: "TextField", bind: { value: "form.snippets" }, props: { placeholder: "brb = be right back\naddr = 42 Baker St", multiline: true } },
        gap(SECTION),

        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        { type: "Text", bind: { content: "status" }, props: { variant: "muted" }, style: { marginTop: 10, textAlign: "center" } },

        gap(28),
        { type: "Divider" },
        gap(20),

        label("Or learn my voice from a sample"),
        { type: "TextField", bind: { value: "sample" }, props: { placeholder: "Paste a few messages you've written…", multiline: true } },
        gap(10),
        { type: "Button", props: { label: "Learn my voice", variant: "secondary" }, on: { onPress: "learn" } },
      ],
    },
    cacheTtlSeconds: 300,
  };
}
