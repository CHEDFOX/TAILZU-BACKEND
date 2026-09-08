/**
 * Dump every screen exactly as a device receives it, for a design handoff.
 *
 * Not a summary — the whole node tree, plus the theme and the state each screen
 * starts with. A renderer can rebuild the real screen from this, which is the
 * point: a spec drawn by hand drifts from the app the day after it is written,
 * and this cannot.
 *
 *   npm run spec > spec.json
 *
 * Config resolves at boot and the catalogue reads it (the free-word allowance
 * is served from config, so the paywall cannot be built without one). These are
 * stubs for a local dump; nothing here talks to a network.
 */
process.env.NODE_ENV ??= "test";
process.env.OPENROUTER_API_KEY ??= "spec-dump";
process.env.OPENAI_API_KEY ??= "spec-dump";
process.env.STT_PROVIDER ??= "openai";
process.env.DEV_SKIP_AUTH ??= "true";

import { buildScreen, THEME, setMediaRegistryAccessor } from "../src/experience/catalog.js";

/**
 * Every media key the catalogue asks for, stubbed as present.
 *
 * An empty slot renders NOTHING — that is deliberate in the product and wrong
 * for a spec: a screen designed around a full-bleed clip would appear here as
 * the text that sits on top of it. Stubbing the registry makes the media nodes
 * real, with their true geometry, so the handoff shows the screen as built.
 */
const MEDIA_KEYS = [
  "intro", "mic.animation", "mic.animation.mp4", "mic.animation.recording",
  "hero.training", "hero.training_chat", "hero.flow_arm", "hero.stats",
  "hero.voices", "hero.subtitle", "hero.settings", "hero.history",
  "hero.dictionary", "hero.languages",
  "hero.onboarding_keyboard.ios", "hero.onboarding_keyboard.android",
  "card.voice", "card.dictionary", "card.haptics", "card.languages",
];
setMediaRegistryAccessor(() =>
  Object.fromEntries(
    MEDIA_KEYS.map((k) => [k, {
      url: `https://media.tailzu.space/${k}`,
      contentType: k.includes("animation") && !k.endsWith(".mp4") ? "image/gif" : "video/mp4",
      sha256: "0".repeat(64),
      bytes: 0,
    }]),
  ) as any,
);

const IDS = [
  "home", "training_chat", "training_live",
  "personality", "voices", "tone_edit", "personality_customize",
  "personality_edit", "dictionary", "haptics", "languages",
  "stats", "history",
  "settings", "language_select", "delete_account",
  "intro", "onboarding", "onboarding_keyboard", "keyboard_primer",
  "keyboard_record", "flow_arm", "reply",
  "paywall",
];

const ctx = { personality: {}, language: "en" } as any;
const screens = IDS.map((id) => {
  const s = buildScreen(id, ctx) as any;
  if (!s) return { id, missing: true };
  return {
    id,
    title: s.title ?? "",
    hideChrome: s.hideChrome === true,
    template: s.template ?? null,
    cacheTtlSeconds: s.cacheTtlSeconds ?? null,
    state: s.state ?? {},
    actionNames: Object.keys(s.actions ?? {}),
    root: s.root ?? null,
    blocks: s.blocks ?? null,
    bytes: JSON.stringify(s).length,
  };
});

console.log(JSON.stringify({ theme: THEME, screens }, null, 0));
