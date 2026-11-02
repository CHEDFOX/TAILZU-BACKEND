/**
 * Settings: the plan, the account, Ask and the connected apps.
 */

import type { Node, ScreenResponse } from "../../../../shared/types/sdui.js";
import type { AssistantView } from "../../connectors/list.js";
import { LANGUAGE_NAMES } from "../../history/writtenIn.js";
import { nicknameOf } from "../assistantName.js";
import { sw as say } from "../settingsWords.js";
import { isValidTtsVoice, DEFAULT_TTS_VOICE, ttsVoiceById } from "../ttsVoices.js";
import { askSetupCard, askFoldersCard } from "./askSetup.js";
import { connectedApps } from "./connectedApps.js";
import type { DeskContext } from "./context.js";
import { link, text, stack, screen, page, defRow, n, row, keys, shownIf } from "./kit.js";
import { planWords } from "./plan.js";

/**
 * A Razorpay subscription's end of the Plan row: it is cancelled here in the
 * app, and once it has been, the row says when Unlimited ends instead.
 * Undefined for any other store, which keeps its Manage link.
 */
function razorpayPlan(ctx: DeskContext): Node | undefined {
  if (String(ctx.entitlement?.store ?? "").toLowerCase() !== "razorpay") return undefined;
  if (ctx.entitlement?.renews !== false) return link("Cancel", { kind: "navigate", screenId: "cancel_subscription" });
  const end = ctx.entitlement?.expiresAt ? Date.parse(ctx.entitlement.expiresAt) : NaN;
  return text(Number.isFinite(end)
    ? `Ends ${new Date(end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "Cancelled", "d-margin");
}

const sw = (key: string, labelText: string): Node => ({
  type: "Switch", props: { cls: "d-switch", accessibilityLabel: labelText },
  bind: { value: "desktop." + key }, on: { onChange: { kind: "desktop.config", key, value: "$toggle" } },
});

/**
 * SETTINGS — FIVE SECTIONS, in this order, each with a short heading and one
 * line under it (the words are settingsWords.ts, in the onboarding's voice):
 *   You               the plan, the account and Sign out
 *   Writing           languages, voice and tone, the read-aloud voice, its name
 *   Connected apps    the assistant's apps (only while they are switched on here)
 *   This computer     the shortcut, the pill, Ask's permissions
 *   Privacy and data  what is kept, the privacy policy
 *   Help and about    write to us, the terms
 * Every section is spaced the same (a heading, a line, its rows) and every row
 * is a defRow, so no row is taller than its neighbours.
 */
export function deskSettings(ctx: DeskContext): ScreenResponse {
  const q = planWords(ctx);
  const langs = (ctx.personality.languages ?? []).filter((l) => l && l !== "auto");
  const who = ctx.email || ctx.phone || "";
  // The read-aloud voice, as a friendly label — the stored one, or the default.
  const readVoice = isValidTtsVoice(ctx.personality.ttsVoice) ? ctx.personality.ttsVoice : DEFAULT_TTS_VOICE;
  const readVoiceLabel = ttsVoiceById(readVoice)?.label ?? readVoice;
  const nick = nicknameOf(ctx.personality);
  /** A section: its heading, its one line, its rows. */
  const part = (heading: string, line: string, rows: Node[], last = false): Node =>
    stack([
      text(heading, "d-h2", { marginBottom: 4 }),
      text(line, "d-lede", { marginBottom: 8 }),
      ...rows,
    ], last ? {} : { marginBottom: 40 });
  const legal = ctx.legal;
  return screen("desk_settings", "Settings", [page([
    text("Settings", "d-eyebrow"),
    text(say("d.h1"), "d-h1", { marginTop: 6, marginBottom: 26 }),

    // ---- You ---------------------------------------------------------------
    part(say("you.h"), say("you.p"), [
      ctx.free && !q.paid
        ? defRow("Free", "Every word, on every device. Nothing to pay.", text("No limit", "d-margin"))
        : defRow(q.paid ? "Unlimited" : "Free", q.paid ? "Every word, on every device" : `${n(q.used)} of ${n(q.of)} words this month`,
            q.paid
              ? razorpayPlan(ctx) ?? (ctx.manageUrl ? link("Manage", { kind: "openUrl", url: ctx.manageUrl }) : undefined)
              : link("See plans", { kind: "navigate", screenId: "desk_plan" })),
      defRow("Signed in as", who || "This account", link("Sign out", { kind: "signOut" })),
    ]),

    // ---- Writing -----------------------------------------------------------
    part(say("write.h"), say("write.p"), [
      defRow("You speak", langs.length ? langs.map((l) => (Object.hasOwn(LANGUAGE_NAMES, l) ? LANGUAGE_NAMES[l] : l)).join(", ") : say("r.lang.none"),
        link("Change", { kind: "navigate", screenId: "languages" })),
      defRow(say("r.tone"), say("r.tone.d"), link(say("d.tone.go"), { kind: "switchTab", tabId: "desk_voices" })),
      defRow(say("r.read"), readVoiceLabel, link("Change", { kind: "navigate", screenId: "desk_voice_read" })),
      defRow(say("r.name"), nick ? `X0, or ${nick}` : "X0",
        link(nick ? "Change" : say("d.name.give"), { kind: "navigate", screenId: "desk_assistant_name" })),
    ]),

    // ---- Connected apps ----------------------------------------------------
    // Its own heading and line (connectedApps), only while the apps are on here.
    ...(ctx.assistant?.apps && (ctx.assistant.apps.length || ctx.assistant.custom) ? [connectedApps(ctx.assistant)] : []),

    // ---- This computer -----------------------------------------------------
    part(say("comp.h"), say("comp.p"), [
      defRow("Shortcut", stack([
        // The one key: held to talk, tapped to keep listening; picked in Keylessbord's settings.
        row([text("Hold", "d-v"), keys("hotkey", true), text("to talk, tap it to keep listening", "d-v")],
          { gap: 8, align: "center", flexWrap: "wrap" }, undefined, { visibleIf: { truthy: "desktop.oneKeyOn" } }),
        row([
          text("Tap", "d-v"), keys("tap", true), text("twice, or press", "d-v"), keys("hotkey", true),
        ], { gap: 8, align: "center", flexWrap: "wrap" }, undefined, { visibleIf: { falsy: "desktop.oneKeyOn" } }),
      ]), shownIf(text("Change it from the tray", "d-margin"), { falsy: "desktop.oneKey" })),
      // One switch: with the one key a single tap keeps it listening; without it, the pair.
      defRow("Tap to talk", stack([
        shownIf(text("Tap the key twice to start, twice again to finish", "d-v"), { falsy: "desktop.oneKey" }),
        shownIf(text("Tap the key to keep listening, tap again to finish", "d-v"), { truthy: "desktop.oneKey" }),
      ]), sw("tap", "Tap to talk")),
      defRow("The pill", say("d.pill"), sw("pill", "Show the pill")),
      defRow("Write on a pause", say("d.pause"), sw("pauseFlush", "Write on a pause")),
      defRow("Live words", say("d.live"), sw("live", "Live words")),
      defRow("Start with the computer", say("d.auto"), sw("autoStart", "Start with the computer")),
      // Ask's three permissions, always here with their states, so a yes given
      // once on the home card can be seen and taken back.
      ...(ctx.askSetup ? [
        text("Ask", "d-k", { marginTop: 28, marginBottom: 12 }),
        askSetupCard(ctx.askSetup, "settings"),
        ...(ctx.askSetup.folders ? [askFoldersCard(ctx.askSetup)] : []),
      ] : []),
    ]),

    // ---- Privacy and data --------------------------------------------------
    part(say("priv.h"), say("priv.p"), [
      defRow("Your audio", say("d.audio"), text("Always", "d-margin")),
      defRow("History", say("d.history"), {
        type: "Switch", props: { cls: "d-switch", accessibilityLabel: "Keep history" },
        bind: { value: "retainHistory" },
        on: { onChange: { kind: "sequence", actions: [
          { kind: "toggleState", path: "retainHistory" },
          { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { retainHistory: "$state.retainHistory" } },
        ] } },
      }),
      ...(legal ? [defRow(say("r.privacy"), "What I keep, and why", link("Read it", { kind: "openUrl", url: legal.privacy }))] : []),
    ]),

    // ---- Help and about ----------------------------------------------------
    part(say("help.h"), say("help.p"), [
      defRow("Questions", "support@x0bot.com", link(say("r.mail"), { kind: "openUrl", url: "mailto:support@x0bot.com" })),
      ...(legal ? [defRow(say("r.terms"), "The rules of using me", link("Read them", { kind: "openUrl", url: legal.terms }))] : []),
    ], true),
  ], { maxWidth: 820 })], { retainHistory: ctx.personality.retainHistory !== false, ...appsState(ctx.assistant) });
}

/** What the rows and forms below read: each added app's name and hosts, the add form, the search. */
function appsState(view: AssistantView | undefined): Record<string, unknown> {
  if (!view?.apps) return {};
  const mine = view.apps.filter((c) => c.custom);
  return {
    n: Object.fromEntries(mine.map((c) => [c.id, c.name])),
    host: Object.fromEntries(mine.map((c) => [c.id, c.host ?? ""])),
    si: Object.fromEntries(mine.map((c) => [c.id, c.signInHost ?? ""])),
    ...(view.custom ? { addOpen: false, add: { name: "", url: "", clientId: "", clientSecret: "", adv: false }, q: "", dir: {} } : {}),
  };
}
