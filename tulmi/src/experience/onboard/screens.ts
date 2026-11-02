/**
 * THE NEW ONBOARDING, DRAWN BY THE APPS AND WRITTEN HERE.
 *
 * Ten short steps with one friend beside you: Welcome, Sign in, Code,
 * Languages, Keyboard, Try it, Make me yours, Connect apps, How careful, Done.
 * The friend is Blip, a persistent dot bot that each app draws once, above
 * everything, and walks to wherever a step says he should stand. A step is only
 * a `BlipSpot` (an empty box that says "Blip stands here, in this pose, saying
 * this") inside an `OnboardStage` (the container that glides one step out and
 * the next in, and remembers where you are).
 *
 * Two stages, because sign-in happens before there is a session:
 *   onboardAuthTree  Welcome, Sign in, Code. Rides in the bootstrap's
 *                    `auth.screen`, the only channel that reaches the app
 *                    before there is an account.
 *   onboardScreen    Everything after sign-in, the screen `onboard`.
 *
 * The sign-in LOGIC does not move. The tree reuses the pills, the social
 * buttons and the code entry that already run the flow in the app; only how
 * they look changes, through optional props whose defaults draw today's
 * controls.
 *
 * OLD BUILDS KEEP WORKING. Nothing here is sent unless the asking build
 * declared both `OnboardStage` and `BlipSpot` (canOnboard). Any other build is
 * served exactly what it was served before, except a phone build in a store,
 * which runs this on its first launch without either: it is given the same
 * steps, drawn with what it does have (onboardStore.ts, which builds them from
 * the step builders exported below). ONBOARD_V2=0 turns it all off for
 * everyone without a deploy of the apps.
 *
 * THE WORDS are written in English below and looked up in Hinglish from the
 * design's own lines (onboardHinglishSeeds, which i18n.ts applies to the
 * `onboard` screen). The model never guesses them.
 *
 * "HOW CAREFUL" EXPLAINS; IT DOES NOT ASK. Connected apps work one way now:
 * looking just runs, a new kind of change asks once and is remembered, and
 * deleting or paying always asks. Offering "ask me every time / ask only
 * before I send" would promise modes that do not exist, so the step shows the
 * three real rows, and a per-app level stays in Connected apps. The one level
 * it points at is Can look: a yes raises a Can-draft app to Can send
 * (connectors/tasks.ts), and an app added by link keeps its own per-tool
 * choices, so neither "more careful" nor "the same in every app" is true.
 *
 * This file is the entry (who gets the onboarding, where it starts, and the
 * `onboard` screen); the sign-in stage, each step, the words and the shared
 * parts are files of their own beside it.
 */

import { type ActionSpec, type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { CATALOG } from "../../connectors/catalog.js";
import { DAILY_LANGUAGES } from "../phone/languages.js";
import type { ScreenContext } from "../screens.js";
import { appsStep } from "./apps.js";
import { carefulStep } from "./careful.js";
import { EN, shownChip } from "./copy.js";
import { doneStep } from "./done.js";
import { keyboardStep } from "./keyboard.js";
import { toast, seq, setState, when, bothPerms, haptic, type Plan, STEP, SPOT, stageProps } from "./kit.js";
import { languagesStep } from "./languages.js";
import { tryStep } from "./try.js";
import { yoursStep } from "./yours.js";

// ---------------------------------------------------------------------------
// The gate: who gets the new flow
// ---------------------------------------------------------------------------

/**
 * Does the asking build draw the new onboarding? Only a build that declared
 * both new node types does, and only while ONBOARD_V2 is not "0". Anything else
 * is served exactly what it was served before: a build that cannot draw an
 * OnboardStage must never be handed one.
 *
 * Takes the list a bootstrap carries or the Set a screen request becomes. Read
 * per call (not at import) so the switch is the environment's alone.
 */
export function canOnboard(c?: unknown): boolean {
  if (process.env.ONBOARD_V2 === "0") return false;
  const has = c instanceof Set ? (n: string) => c.has(n) : Array.isArray(c) ? (n: string) => c.includes(n) : null;
  return !!has && has("OnboardStage") && has("BlipSpot");
}

/**
 * Are the "Connect your apps" and "How careful" steps part of the flow? When
 * connected apps are off there is nothing to connect and nothing to be careful
 * about, so both are left out (and the words that mention apps change).
 */
export function onboardAppsOn(connectorsOn: boolean): boolean {
  return connectorsOn && CATALOG.some((c) => !c.hidden && c.auth === "oauth");
}

/**
 * How many steps there are in all, for the progress bar. The three before the
 * session (Welcome, Sign in, Code) and the ones after it: on a phone Languages,
 * Keyboard, Try it, Make me yours, [Connect apps, How careful,] Done; in a
 * window, no Keyboard (it has none to add) and no Make me yours (the OS asks).
 * The bootstrap works this out too, so the bar never changes length at the
 * boundary between the two stages.
 */
export function onboardTotal(desktop: boolean, appsOn: boolean): number {
  return 3 + postAuthSteps(desktop, appsOn).length;
}

export function postAuthSteps(desktop: boolean, appsOn: boolean): string[] {
  const apps = appsOn ? ["apps", "careful"] : [];
  return desktop
    ? ["languages", "try", ...apps, "done"]
    : ["languages", "keyboard", "try", "yours", ...apps, "done"];
}

/**
 * Where a cold start lands inside `onboard`, as an index into the steps built.
 * Languages are asked once: someone who has answered goes on to the next thing
 * still missing (the phone's keyboard, else Try it; a window goes to Try it).
 * Within a running app the stage also remembers the step, so a refetch never
 * moves anyone backward.
 */
export function onboardStart(f: {
  desktop: boolean;
  languagesSet: boolean;
  keyboardReady: boolean;
  /** Step id -> index, for the list actually built. */
  I: Record<string, number>;
}): number {
  if (!f.languagesSet) return f.I.languages!;
  if (f.desktop) return f.I.try!;
  return f.keyboardReady ? f.I.try! : f.I.keyboard!;
}

/**
 * The language the screen `onboard` is written in.
 *
 * Everywhere else the app's language is the profile's, which stays "auto"
 * (English) until someone changes it in Settings. Here that would mean nobody
 * ever met the Hinglish: the Languages step only saves the person's languages
 * (personality.languages), never the profile's. So while the profile has said
 * nothing, the first language they chose is the one the rest of the flow
 * speaks, the same fallback effectiveLanguage() makes for a request. A language
 * set in the profile still wins.
 */
export function onboardLanguage(profileLanguage: string | undefined, chosen: readonly unknown[] | undefined): string {
  const set = typeof profileLanguage === "string" ? profileLanguage.trim() : "";
  if (set && set !== "auto") return set;
  const first = chosen?.[0];
  return typeof first === "string" && first.trim() && first.trim() !== "auto" ? first.trim() : "auto";
}

/** What Make me yours does with its three switches (phone). A yes cannot be taken back in the app: only Settings can. */
export function permActions(): Record<string, ActionSpec> {
  const blocked = toast(EN["s5.blocked"]);
  return {
    checkPerms: seq(
      { kind: "checkPermission", permission: "notifications", onGranted: setState("perm.n", true) },
      { kind: "checkPermission", permission: "microphone", onGranted: setState("perm.m", true) },
      when(bothPerms, setState("perm.all", true)),
    ),
    askPush: when(
      { truthy: "perm.n" },
      { kind: "requestPushPermission", onGranted: seq(setState("perm.n", true), haptic("success"), "syncAll"), onDenied: seq(setState("perm.n", false), blocked) },
      seq(setState("perm.n", true), toast(EN["s5.off"])),
    ),
    askMic: when(
      { truthy: "perm.m" },
      {
        kind: "requestPermission", permission: "microphone",
        onGranted: seq(setState("perm.m", true), "syncAll"),
        onDenied: seq(setState("perm.m", false), blocked),
        onBlocked: seq(setState("perm.m", false), blocked, { kind: "openSettings", target: "app" }),
      },
      seq(setState("perm.m", true), toast(EN["s5.off"])),
    ),
    allowBoth: when(
      { truthy: "perm.all" },
      seq(
        { kind: "requestPushPermission", onGranted: setState("perm.n", true) },
        { kind: "requestPermission", permission: "microphone", onGranted: setState("perm.m", true), onBlocked: blocked },
        "syncAll",
      ),
      seq("syncAll", toast(EN["s5.off"])),
    ),
    syncAll: when(bothPerms, seq(setState("perm.all", true), haptic("success")), setState("perm.all", false)),
  };
}

/**
 * The screen after sign-in. Phone: Languages, Keyboard, Try it, Make me yours,
 * [Connect apps, How careful,] Done. Window: Languages, Try it, [Connect apps,
 * How careful,] Done. `firstTabId` is where Done lands a window without the
 * desk.
 */
export function onboardScreen(ctx: ScreenContext, firstTabId = "home"): ScreenResponse {
  const desktop = ctx.formFactor === "desktop";
  const desk = desktop && !!ctx.can?.has("DeskShell");
  const ios = ctx.platform !== "android";
  const apps = ctx.assistant?.apps ?? [];
  // The tiles: the catalog's own apps that sign in (not one added by link), in
  // catalog order, the first five.
  const five = apps.filter((a) => !a.custom && a.auth === "oauth").slice(0, 5);
  // The apps steps need the feature on AND something to connect: a read that
  // failed (no assistant) leaves them out rather than drawing an empty grid.
  const appsOn = ctx.connectorsOn === true && five.length > 0;
  const ids = postAuthSteps(desktop, appsOn);
  const I = Object.fromEntries(ids.map((id, i) => [id, i]));
  const p: Plan = {
    desktop, ios, appsOn, I,
    next: (id) => I[ids[ids.indexOf(id) + 1]!]!,
    apps, five,
    step: STEP, spot: SPOT,
  };

  const build: Record<string, () => Node> = {
    languages: () => languagesStep(p),
    keyboard: () => keyboardStep(p),
    try: () => tryStep(p),
    yours: () => yoursStep(p),
    apps: () => appsStep(p),
    careful: () => carefulStep(p),
    done: () => doneStep(p),
  };

  // What the person already told us, else a guess from where the phone is.
  const saved = (ctx.personality.languages ?? []).map(String);
  const langs = saved.length ? saved : /-IN$/i.test(ctx.locale ?? "") ? ["hinglish", "hi", "en"] : ["en"];

  // The apps' names and first letters are theirs, not ours: in state, so the
  // translator never sees them (assistant.ts says why).
  const state: Record<string, unknown> = {
    step: onboardStart({ desktop, languagesSet: saved.length > 0, keyboardReady: ctx.keyboardReady === true, I }),
    langs,
    ln: Object.fromEntries(DAILY_LANGUAGES.filter(shownChip).map((l) => [l.value, l.label])),
    // Overwritten live by the app, which re-reads the device on a timer and on
    // every return to the foreground. Declared with the conservative answer.
    keyboardReady: false, keyboardEnabled: false, micGranted: false,
    mic: "idle", tried: "",
    perm: { all: false, n: false, m: false },
    sheet: Object.fromEntries(five.map((a) => [a.id, false])),
    link: {},
    n: Object.fromEntries(five.map((a) => [a.id, a.name])),
    ini: Object.fromEntries(five.map((a) => [a.id, a.name.trim().charAt(0).toUpperCase() || "?"])),
  };

  // Where Done lands: the phone on You (where the name card still appears, as
  // before), a window on the desk's Today, or on its first tab without the desk.
  const landed: ActionSpec = {
    kind: "sequence",
    actions: [haptic("success"), { kind: "switchTab", tabId: desktop ? (desk ? "desk_today" : firstTabId) : "personality" }],
  };
  const actions: Record<string, ActionSpec> = {
    finish: { kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { onboarded: true }, onSuccess: "finishOk", onError: "finishErr" },
    finishOk: landed,
    finishErr: toast(EN["ob.err.finish"], "error"),
    ...(desktop ? {} : permActions()),
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboard",
    title: "",
    hideChrome: true,
    state,
    actions,
    root: {
      type: "OnboardStage",
      bind: { step: "step" },
      props: stageProps("onboard", 3, 3 + ids.length),
      children: ids.map((id) => build[id]!()),
    },
    cacheTtlSeconds: 0,
  };
}
