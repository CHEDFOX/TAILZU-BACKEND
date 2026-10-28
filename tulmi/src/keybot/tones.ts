/**
 * TONE PER APP: Keybot writes like you, a bit different per kind of app (KeyTone / DKeyTone).
 *
 * Three kinds of app (Chats, Mail, Work chat), four presets, and three little things per kind. A choice is kept in
 * the Keybot prefs (prefs.ts) and compiled into personality.appStyles for every app of that kind, which is what the
 * writer reads (prompts.ts resolveAppStyle: matched by the app's name, case-insensitively). Nothing is written for a
 * kind until the person picks a preset for it: until then Keybot writes it as they said it.
 */
import type { AppStyle, Personality } from "../../../shared/types/api.js";
import type { KeybotPrefs, ToneGroup } from "./prefs.js";

export interface TonePreset {
  id: string;
  name: string;
  /** The card's line. */
  blurb: string;
  style: AppStyle;
  /** "main 10 min late hoon, shuru karo", written in this tone (the board's line for each). */
  sample: string;
}

export const TONE_PRESETS: TonePreset[] = [
  {
    id: "casual_hinglish", name: "Casual Hinglish", blurb: "Hindi and English mixed, like you text",
    style: { formality: "casual", emoji: "minimal", note: "Casual Hinglish: Hindi and English mixed the way they text." },
    sample: "10 min late hoon yaar, tum log shuru karo!",
  },
  {
    id: "clear_polite", name: "Clear and polite", blurb: "Full sentences, please and thanks",
    style: { formality: "neutral", emoji: "none", note: "Clear and polite: full sentences, please and thank you." },
    sample: "I’m running about 10 minutes late. Please go ahead and start.",
  },
  {
    id: "short_direct", name: "Short and direct", blurb: "Few words, no extra",
    style: { formality: "neutral", emoji: "none", dial: { length: 15 }, note: "Short and direct: as few words as it takes, nothing extra." },
    sample: "10 min late. Start without me.",
  },
  {
    id: "warm_formal", name: "Warm and formal", blurb: "For elders, clients and teachers",
    style: { formality: "formal", emoji: "none", dial: { warmth: 80 }, note: "Warm and formal: respectful and kind, for elders, clients and teachers." },
    sample: "So sorry, I’m running about 10 minutes late. Please do begin, I’ll join you shortly.",
  },
];

export interface ToneGroupDef {
  id: ToneGroup;
  label: string;
  /** The apps it covers, by the names the clients send as targetApp. */
  apps: string[];
  /** Under the label in the window: the apps people know. */
  appsLine: string;
}

export const TONE_GROUP_DEFS: ToneGroupDef[] = [
  { id: "chats", label: "Chats", apps: ["WhatsApp", "Messages", "Telegram", "Instagram", "Signal"], appsLine: "WhatsApp, Messages" },
  { id: "mail", label: "Mail", apps: ["Gmail", "Email", "Mail", "Outlook"], appsLine: "Gmail, Outlook" },
  { id: "work", label: "Work chat", apps: ["Slack", "Teams", "Microsoft Teams", "Discord"], appsLine: "Slack, Teams" },
];

/** What they said, for "One line, each tone". */
export const TONE_SAID = "main 10 min late hoon, shuru karo";

export const presetById = (id: string | undefined): TonePreset | undefined => TONE_PRESETS.find((p) => p.id === id);

/** Which kind an app is, by its name (case-insensitive); undefined for one outside the three. */
export function groupOfApp(app: string | undefined): ToneGroupDef | undefined {
  const a = String(app ?? "").trim().toLowerCase();
  return a ? TONE_GROUP_DEFS.find((g) => g.apps.some((x) => x.toLowerCase() === a)) : undefined;
}

/** The style one kind's choice writes for each of its apps: the preset's, with the little things in its note. */
export function compileStyle(t: NonNullable<KeybotPrefs["tones"]>[ToneGroup]): AppStyle | undefined {
  const p = presetById(t?.preset);
  if (!p) return undefined;
  const extra = [
    t?.noStop ? "Skip the full stop at the end of a message." : "",
    t?.latin ? "Write Hindi words in English letters." : "",
    t?.signOff ? "End with their sign-off." : "",
  ].filter(Boolean);
  return { ...p.style, note: [p.style.note, ...extra].filter(Boolean).join(" ") };
}

/** personality.appStyles with one kind's apps rewritten (or cleared, with no preset). Other apps are kept as they were. */
export function withGroupStyles(personality: Personality, group: ToneGroup, t: NonNullable<KeybotPrefs["tones"]>[ToneGroup]): Personality {
  const def = TONE_GROUP_DEFS.find((g) => g.id === group)!;
  const mine = new Set(def.apps.map((a) => a.toLowerCase()));
  const kept = Object.fromEntries(Object.entries(personality.appStyles ?? {}).filter(([k]) => !mine.has(k.trim().toLowerCase())));
  const style = compileStyle(t);
  return { ...personality, appStyles: { ...kept, ...(style ? Object.fromEntries(def.apps.map((a) => [a, style])) : {}) } };
}
