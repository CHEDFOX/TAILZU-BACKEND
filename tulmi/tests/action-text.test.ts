import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { buildScreen } from "../src/experience/catalog.js";

// What a toast or a copy puts in front of someone. An installed phone fills in
// a message that IS "$state.x" and nothing else: "@history.detail.toast" and
// "Writing as $state.vcName." reached the screen as written. Newer bundles say
// "ActionText" and fill both; the server sends those only to them.

const SCREENS = [
  "home", "training_chat", "training_live", "dictionary", "haptics", "language_select", "languages",
  "delete_account", "reply", "personality", "voices", "tone_edit", "personality_customize",
  "personality_edit", "personality_detail", "settings", "stats", "history", "onboarding",
  "onboarding_keyboard", "keyboard_record", "keyboard_primer", "flow_arm", "intro", "paywall",
];
const WHOLE_REF = /^\$(event|state\.[\w.]*\w|flags\.[\w.]*\w)$/;
const said = (a: any): string[] =>
  a.kind === "copyToClipboard" ? [a.text, a.toastMessage] : [a.message];
const textActions = (n: any, out: any[] = []): any[] => {
  if (Array.isArray(n)) { n.forEach((c) => textActions(c, out)); return out; }
  if (!n || typeof n !== "object") return out;
  if (["toast", "snackbar", "copyToClipboard"].includes(n.kind)) out.push(n);
  for (const k of Object.keys(n)) textActions(n[k], out);
  return out;
};
const build = (id: string, can: string[]) =>
  buildScreen(id, {
    personality: {}, language: "en", onboarded: true, params: {}, can: new Set(can),
    history: [{ id: "h1", input: "hi", output: "Hi.", createdAt: new Date().toISOString() }],
  } as never) as any;

describe("words an action shows", () => {
  it("an installed phone is never sent a label key or a half-filled sentence", () => {
    for (const id of SCREENS) {
      const s = build(id, []);
      if (!s) continue;
      for (const a of textActions(s)) {
        for (const m of said(a)) {
          if (typeof m !== "string") continue;
          expect(m.startsWith("@"), `${id}: ${m}`).toBe(false);
          if (m.includes("$state.") || m.includes("$flags.")) expect(m, `${id}`).toMatch(WHOLE_REF);
        }
      }
    }
  });

  it("no toast anywhere says a feature is coming", () => {
    for (const id of SCREENS) for (const can of [[], ["ActionText"]]) {
      const s = build(id, can);
      if (!s) continue;
      for (const a of textActions(s)) for (const m of said(a)) {
        if (typeof m === "string") expect(m, id).not.toMatch(/coming soon/i);
      }
    }
  });

  it("a history card copies what Tailzu wrote, where the build can", () => {
    const tap = (can: string[]) => build("history", can).actions.openDetail;
    expect(JSON.stringify(tap(["ActionText"]))).toContain('"text":"$state.item.output"');
    // An older build gets the touch, not a placeholder and not a literal "$state".
    expect(tap([])).toEqual({ kind: "haptic", style: "selection" });
    const sub = (can: string[]) => JSON.stringify(build("history", can).root);
    expect(sub(["ActionText"])).toContain("@history.subtitle");
    expect(sub([])).toContain("× to remove.");
    expect(sub([])).not.toContain("@history.subtitle");
  });

  it("switching voice says the voice's name, made on the server", () => {
    const s = build("voices", []);
    const toast = textActions(s.actions.activated)[0];
    expect(toast.message).toBe("$state.vcToast");
    expect(JSON.stringify(s)).toContain('"path":"vcToast","value":"Writing as ');
  });
});
