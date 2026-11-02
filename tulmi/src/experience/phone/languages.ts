/**
 * The Languages screen: the languages a person speaks day to day.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { LANGS as ALL_LANGS } from "../languages.js";
import { t, PHONE_LOOK } from "../phoneLook.js";
import type { ScreenContext } from "../screens.js";
import { YOU_UI, youHead, youLabel } from "./you/copy.js";

/**
 * Daily languages — a multi-select, saved to personality.languages.
 *
 * This is the one question worth asking, and it replaces the single-choice
 * onboarding pick. A person who speaks Hindi AND English is not served by
 * being made to choose: the answer feeds three things at once, and each of
 * them is better with the whole set than with one of it.
 *
 *   - Recognition. Every selected language contributes a short line in its
 *     own script to the recognizer's prompt, which is what stops Hindi
 *     coming back romanized (see sttPrompt).
 *   - Writing. The prompt already states preferred languages/scripts, so
 *     code-switched text is written the way the user actually mixes.
 *   - Order matters. The first selection is the primary — what "auto" falls
 *     back to when nothing else decides.
 *
 * No Save button: each tap writes. A preferences screen that can be left in
 * an unsaved state is a screen that loses answers.
 */
export function languagesScreen(ctx: ScreenContext): ScreenResponse {
  const selected = (ctx.personality.languages ?? []).map(String);
  const up = YOU_UI.pill;
  const row = (l: (typeof DAILY_LANGUAGES)[number], _i: number): Node => ({
    // The same pill as every other list on the You screens. A run of pills
    // needs no rules between them: the gap already says where one stops.
    type: "Stack",
    props: { pressOpacity: 0.7 },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: up.gap,
      backgroundColor: up.background,
      borderRadius: up.radius,
      paddingLeft: up.paddingLeft,
      paddingRight: 18,
      paddingVertical: up.paddingVertical,
      minHeight: up.minHeight,
      marginBottom: up.marginBottom,
    },
    on: {
      onPress: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "selection" },
          // A plain toggle: tap to select, tap to unselect, including the
          // last one. Clearing the set is a real answer — the recognizer
          // falls back to the single language hint, which is exactly how it
          // behaved before this card existed. A row that refuses to
          // deselect reads as broken, and the degradation here is mild.
          { kind: "toggleInArray", path: "langs", value: l.value },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: { languages: "$state.langs" },
            onError: "err",
          },
        ],
      },
    },
    children: [
      {
        type: "Stack",
        style: { flex: 1, gap: 1 },
        children: [
          t(l.label, "uiMedium", 15),
          // The language in its own script, which the book face does not
          // carry: set in the system font, so every script draws.
          ...(l.native && l.native !== l.label
            ? [{ type: "Text", props: { content: l.native },
                 style: { fontSize: 13, lineHeight: 21, color: PHONE_LOOK.ink2 } } as Node]
            : []),
        ],
      },
      // The tick is the whole state display: present means selected. Rendered
      // from `langs`, so it follows the tap without a refetch. Pale ink, in
      // the label's own face colour and heavy — not amber: a chosen language
      // is a setting, not something live.
      {
        type: "Text",
        visibleIf: { contains: ["langs", l.value] },
        props: { content: "✓" },
        style: { fontSize: 17, fontWeight: "800", color: PHONE_LOOK.ink },
      },
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "languages",
    title: "",
    // Seeded from the saved set so the ticks are right on open, and mutated
    // in place by every tap after that.
    state: { langs: selected },
    actions: {
      err: { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" },
    },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // No hero. The amber block IS the top of this screen now, and a banner
        // above it would put two different treatments in the first 200 points.
        // The art it used to carry is on the deck card that opens this screen.
        youHead("Languages", "Tap each one you speak."),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: PHONE_LOOK.side, paddingTop: 8, paddingBottom: 40,
          },
          children: [
            youLabel("India"),
            ...DAILY_LANGUAGES.filter((l) => l.india).map(row),
            youLabel("The world"),
            ...DAILY_LANGUAGES.filter((l) => !l.india).map(row),
          ],
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** Languages offered in onboarding + settings. */
/**
 * The languages a user can say they speak day to day.
 *
 * Wider than LANGUAGES (the single output-language picker) and ordered by who
 * actually uses Tailzu: the Indic set first, then the rest. Each carries its
 * own name in its own script, because a list of English names is a worse
 * question — a Marathi speaker looks for "मराठी".
 *
 * `value` doubles as the STT exemplar key (see sttPrompt), so adding a row
 * here is all it takes for that language's script to prime the recognizer.
 */
/**
 * EVERY LANGUAGE THE MODELS HANDLE, for the Languages screen — the same list
 * the site's /languages pages show (experience/languages.ts). India first
 * (Hindi, then Hinglish, then the other scheduled languages), then the world
 * (English first). A value is what the pipeline reads: Hinglish is
 * "hinglish", the rest their language code.
 */
export const DAILY_LANGUAGES: Array<{ value: string; label: string; native: string; india: boolean }> = [
  ...ALL_LANGS.filter((l) => l.india),
  ...ALL_LANGS.filter((l) => !l.india && l.code === "en"),
  ...ALL_LANGS.filter((l) => !l.india && l.code !== "en"),
].map((l) => ({
  value: l.slug === "hinglish" ? "hinglish" : l.code,
  label: l.name,
  native: l.slug === "hinglish" ? "Hindi + English, in English letters" : l.native,
  india: l.india,
}));
