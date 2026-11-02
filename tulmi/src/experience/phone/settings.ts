/**
 * Settings.
 */

import { type ScreenResponse, type ActionRef, type Condition, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { en as assistantWords } from "../../connectors/words.js";
import { nicknameOf } from "../assistantName.js";
import { label, caption, PHONE_LOOK, t } from "../phoneLook.js";
import { POLICY, freeForAll } from "../policy.js";
import type { ScreenContext } from "../screens.js";
import { sw } from "../settingsWords.js";
import { screenHero } from "./hero.js";
import { LANGUAGE_NAMES } from "./pie.js";
import { MANAGE_AT } from "./subscription.js";

/** The languages the person writes in, as a short value for a row: two names, then how many more. */
function languageValue(languages: readonly string[] | undefined): string {
  const named = (languages ?? [])
    .filter((l) => l && l !== "auto")
    .map((l) => (Object.hasOwn(LANGUAGE_NAMES, l) ? LANGUAGE_NAMES[l]! : l));
  if (!named.length) return sw("r.lang.none");
  return named.length > 2 ? `${named.slice(0, 2).join(", ")} +${named.length - 2}` : named.join(", ");
}

/**
 * Settings — server-driven app info, account, and links.
 *
 * FIVE SECTIONS, IN THIS ORDER, each with a short heading and one line under it:
 *   You               the plan (Upgrade, or where to change it), Sign out
 *   Writing           languages, voice and tone, keyboard, the read-aloud voice, its name
 *   Connected apps    Ask me, the apps, their tasks (only while connected apps are on)
 *   Privacy and data  the privacy policy, deleting the account
 *   Help and about    write to us, terms
 *
 * Every row is a direct child of the screen so a row is found by its label,
 * and every action keeps its route and its id (signOut, privacy, terms, err).
 * The words are settingsWords.ts: the onboarding's voice, "I" for Tailzu.
 */
export function settingsScreen(ctx: ScreenContext): ScreenResponse {
  // Row helper attaches a Button-styled-as-row fallback so old bundles that
  // lack the "Row" component still render each Settings item as a full-width
  // tappable strip, not a pill. Uses only v1 primitives (Button + style
  // overrides) which the shipped bundle understands.
  //
  // ONE HEIGHT FOR EVERY ROW: the same vertical padding on the Row and on its
  // fallback, so a section never has a tall row among short ones.
  const ROW_PAD = 17;
  const row = (
    label: string,
    action: ActionRef,
    opts: { value?: string; danger?: boolean; chevron?: boolean; visibleIf?: Condition } = {},
  ): Node => {
    const { value, danger, chevron, visibleIf } = opts;
    // Use the value in the label if present (v1 Button only shows props.label,
    // not a separate value slot). Wraps the label to avoid missing context.
    const rowLabel = value ? `${label}    ${value}` : label;
    return {
      type: "Row",
      props: {
        label, paddingVertical: ROW_PAD,
        ...(value ? { value } : {}), ...(danger ? { danger: true } : {}), ...(chevron === false ? { chevron: false } : {}),
      },
      on: { onPress: action },
      ...(visibleIf ? { visibleIf } : {}),
      fallback: {
        type: "Button",
        props: {
          label: rowLabel,
          variant: danger ? "danger" : "secondary",
        },
        on: { onPress: action },
        // Style the button to read as a full-width row with a hairline
        // divider below — closer to iOS list rows than a pill.
        style: {
          width: "100%",
          borderRadius: 0,
          paddingVertical: ROW_PAD,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderColor: "rgba(255,255,255,0.06)",
          backgroundColor: "transparent",
        },
      },
    };
  };

  /** A section's heading and its one line. The line is a sentence, so it keeps its case. */
  const section = (heading: string, line: string, first = false): Node[] => [
    label(heading, { marginTop: first ? 28 : 44, marginBottom: 6 }),
    { ...caption(line, { marginBottom: 4 }), props: { content: line, keepCase: true } },
  ];

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "settings",
    title: "",
    state: { language: ctx.language },
    actions: {
      signOut: { kind: "signOut" },
      privacy: { kind: "openUrl", url: POLICY.privacy, external: true },
      terms: { kind: "openUrl", url: POLICY.terms, external: true },
      // openHistory / historyOn removed with the rows that fired them —
      // Settings no longer has a History entry or a retention toggle. History
      // stays reachable from Stats, which keeps its own openHistory alias.
      err: { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" },
    },
    root: {
      type: "Screen",
      // The refresh: the warm ground and the page's sides (phoneLook.ts).
      style: { backgroundColor: PHONE_LOOK.ground, paddingHorizontal: PHONE_LOOK.side },
      children: [
        ...screenHero("settings"),
        // The page title in the onboarding's heading face (touches.ts); the
        // sections under small mono labels, each with one line of its own.
        t("Settings", "grotesk", 30, { letterSpacing: -0.8, marginBottom: 2 }),

        // ---- You ------------------------------------------------------------
        ...section(sw("you.h"), sw("you.p"), true),

        // Personality and Stats are BOTTOM TABS — listing them here too was
        // two doors to one room. Dictionary is reached from the You tab.
        //
        // History and "Keep my history" are gone from Settings by owner
        // decision. History is therefore kept by DEFAULT (history/store.ts,
        // HISTORY_DEFAULT_ON) — the phone has no switch; the desktop's
        // Settings page still carries "Keep history" (desk.ts).

        // THE WAY IN. Until this row existed there was none.
        //
        // The paywall could only be reached by running out of words: the
        // post-onboarding prompt is off, the hard gate is off, and nothing else
        // navigated there. So a user who wanted to pay had to first be stopped,
        // and an App Review tester — who will never dictate eight hundred words —
        // would have reported the in-app purchases as unlocatable and had
        // them rejected. Two auto-renewing products, submitted with no door.
        //
        // Hidden from anyone who has already paid, by the flag the client
        // already holds from the bootstrap, so it costs no extra call and
        // updates on the next foreground. `not` + `flag` are both understood by
        // every shipped bundle, and visibleIf is evaluated before the fallback,
        // so an old client renders nothing rather than a row it cannot hide.
        // Not while Tailzu is free: there is nothing to upgrade to.
        ...(freeForAll() ? [] : [
          row("Upgrade", { kind: "navigate", screenId: "paywall" }, { visibleIf: { not: { flag: "billing.entitled" } } }),
        ]),
        // AND ITS OPPOSITE, for the people the row above hides itself from.
        //
        // Someone who had paid was shown nothing at all: no plan, no renewal,
        // no way to stop. Where to go is not ours to choose — it is decided by
        // where they bought it, and a subscription bought on a phone cannot be
        // cancelled anywhere else. At most one of these is visible, and none
        // is for a store nothing here can send them to.
        ...MANAGE_AT.map(([key, , label, url]) =>
          row(label, { kind: "openUrl", url }, { visibleIf: { all: [{ flag: "billing.entitled" }, { flag: `billing.manage.${key}` }] } })),
        // Razorpay, billed on the web, is cancelled here in the app.
        row("Cancel subscription · billed on the web", { kind: "navigate", screenId: "cancel_subscription" },
          { visibleIf: { all: [{ flag: "billing.entitled" }, { flag: "billing.manage.razorpay" }, { not: { flag: "billing.ending" } }] } }),
        row("Sign out", "signOut", { chevron: false }),

        // ---- Writing --------------------------------------------------------
        ...section(sw("write.h"), sw("write.p")),
        row(sw("r.lang"), { kind: "navigate", screenId: "languages" }, { value: languageValue(ctx.personality?.languages) }),
        row(sw("r.tone"), { kind: "navigate", screenId: "voices" }),
        row(sw("r.kb"), { kind: "navigate", screenId: "haptics" }),
        // The voice the app reads answers back in. A pick from the curated
        // set, saved to personality.ttsVoice and used by /v1/speak.
        row(sw("r.read"), { kind: "navigate", screenId: "voice_read" }),
        // Its name: Tailzu always, and a name of their own beside it.
        row(sw("r.name"), { kind: "navigate", screenId: "assistant_name" },
          { value: nicknameOf(ctx.personality) ? `X0, ${nicknameOf(ctx.personality)}` : "X0" }),

        // ---- Connected apps -------------------------------------------------
        // What it can reach in the person's apps, and what it is doing there.
        // Only while connected apps are on; the words are the assistant's own.
        ...(ctx.connectorsOn ? [
          ...section(assistantWords("apps.h"), assistantWords("apps.p")),
          row(assistantWords("ask.h"), { kind: "navigate", screenId: "assistant_ask" }),
          row(sw("r.apps"), { kind: "navigate", screenId: "assistant_apps" }),
          row(assistantWords("a4.h"), { kind: "navigate", screenId: "assistant_tasks" }),
        ] : []),

        // ---- Privacy and data -----------------------------------------------
        ...section(sw("priv.h"), sw("priv.p")),
        row(sw("r.privacy"), "privacy"),
        row(sw("r.delete"), { kind: "navigate", screenId: "delete_account" }, { danger: true, chevron: false }),

        // ---- Help and about -------------------------------------------------
        ...section(sw("help.h"), sw("help.p")),
        row(sw("r.mail"), { kind: "openUrl", url: "mailto:support@x0bot.com" }, { chevron: false }),
        row(sw("r.terms"), "terms"),
      ],
    },
    cacheTtlSeconds: 300,
  };
}
