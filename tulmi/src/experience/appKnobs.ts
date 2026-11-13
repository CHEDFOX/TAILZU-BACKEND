/**
 * Every knob the app reads (app/src/sdui/knobs.ts in the frontend) goes out
 * in the bootstrap with a value, so nothing on the phone decides it and the
 * control console can find and change each one.
 *
 * The bootstrap wins: a label or flag it already sets is left alone. The knob
 * values fill everything else.
 */
import type { BootstrapResponse } from "../../../shared/types/sdui.js";
import { APP_KNOB_FLAGS, APP_KNOB_LABELS } from "./appKnobsData.js";
import { KEYBOARD_KNOBS } from "./keyboardKnobsData.js";
import { spacesOn } from "../botsBots/spacesSwitch.js";
import { CALL_CATEGORIES, FOLLOW_CATEGORIES, PLAN_CATEGORIES, PLAN_CHANNELS } from "../botsBots/planKinds.js";
import { callsOn, followOn, planOn } from "../botsBots/planSwitch.js";

/** The Home Screen's long-press actions, a list per platform (appKnobsData.ts). */
const QUICK_ACTIONS = ["app.quickActions.android", "app.quickActions.ios"] as const;

/** Spaces switched off (SPACES_ENABLED, botsBots/spacesSwitch.ts): the long press has no Spaces either. */
function withoutSpacesAction(flags: Record<string, unknown>): Record<string, unknown> {
  if (spacesOn()) return flags;
  const out = { ...flags };
  for (const k of QUICK_ACTIONS) {
    const list = out[k];
    if (Array.isArray(list)) out[k] = list.filter((a) => (a as { id?: unknown } | null)?.id !== "spaces");
  }
  return out;
}

/**
 * Plan Ease's notification buttons and Android channels (botsBots/planKinds.ts), after the app's own: the phone registers the buttons at
 * launch and makes the channels at its next push registration. A category or channel the app already lists is left as it is. While its
 * reminders are switched off (PLAN_V2_REMINDERS) no push carries them, so none is listed. A call's buttons (Answer, Not now, Call back)
 * come too while calls are on (BOT_CALLS): an older JS registers them harmlessly, since no push of its uses them. A call's channels never
 * do: the phone's own JS makes them (planKinds.ts CALL_CHANNELS).
 */
function withPlanPush(flags: Record<string, unknown>): Record<string, unknown> {
  if (!planOn("reminders")) return flags;
  const out = { ...flags };
  const cats = Array.isArray(out["push.categories"]) ? (out["push.categories"] as Array<{ id?: unknown }>) : [];
  const haveCats = new Set(cats.map((c) => c?.id));
  // Follow-through's buttons (Done, Later, Can't...) only while PLAN_V2_FOLLOW is on; the call's only while calls ring.
  const ours = [...PLAN_CATEGORIES, ...(followOn() ? FOLLOW_CATEGORIES : []), ...(callsOn() ? CALL_CATEGORIES : [])];
  out["push.categories"] = [...cats, ...ours.filter((c) => !haveCats.has(c.id)).map((c) => ({ id: c.id, actions: c.actions.map((a) => ({ ...a, ...(a.call ? { call: { ...a.call } } : {}) })) }))];
  const chans = Array.isArray(out["push.android.channels"]) ? (out["push.android.channels"] as Array<{ id?: unknown }>) : [];
  const haveChans = new Set(chans.map((c) => c?.id));
  out["push.android.channels"] = [...chans, ...PLAN_CHANNELS.filter((c) => !haveChans.has(c.id)).map((c) => ({ ...c }))];
  return out;
}

/**
 * Flags whose ABSENCE means something ("no arrival prompt this launch"). The
 * catalog sets them only when they apply; filling them with the knob default
 * would say "ask" or "wait 9s" when it meant nothing at all. A control rule
 * can still set them.
 */
export const CATALOG_CONDITIONAL: ReadonlySet<string> = new Set([
  "promptScreenId", "promptAfterMs",
  // Only the desk's own window is told it is the desk; an older desktop, and
  // every phone, must not be told it is not.
  "desktop.desk",
  // Setup's Live Activity: present while setup is unfinished, absent once done.
  "liveActivity.setup",
  // The launch's motion goes to phones only (phone/launch.ts); a desktop has no launch to play.
  "app.launch",
  // The nlook catalog. The manifest lists it as `{}` (from the app's own `obj("native.looks", {})`), and the phone reads
  // `{}` as off — but "nothing at all while the switch is off" (native/catalog.ts) should stay exactly that, not an empty
  // object in every bootstrap. The flag is present only when a catalog is actually being served to this person.
  "native.looks",
]);

export function withAppKnobs<T extends Pick<BootstrapResponse, "labels" | "flags">>(boot: T): T {
  const fill: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(APP_KNOB_FLAGS)) if (!CATALOG_CONDITIONAL.has(k)) fill[k] = v;
  // The offline card's colours read with the theme's as their fallback (OfflineScreen.tsx), so the manifest has
  // no value for them and the console could not see them. They are the same bootstrap's theme colours, as the
  // card would have used: listed, and nothing drawn differently until one is changed.
  const c = (boot as { theme?: { color?: Record<string, unknown> } }).theme?.color;
  if (c) {
    const pick = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
    fill["app.offline.bg"] = pick(c.bg, "#000000");
    fill["app.offline.text"] = pick(c.text, "#FFFFFF");
    fill["app.offline.muted"] = pick(c.muted, "#8A857C");
    fill["app.offline.accent"] = pick(c.primary, "#F3E2C6");
  }
  return {
    ...boot,
    labels: { ...APP_KNOB_LABELS, ...(boot.labels ?? {}) },
    flags: withPlanPush(withoutSpacesAction({ ...fill, ...(boot.flags ?? {}) })) as T["flags"],
  };
}

/**
 * The same for the keyboards: every flag and label the iOS or Android
 * keyboard reads goes out with a value — the catalog's where it has one,
 * else the default that keyboard's native code would have used — so no
 * keyboard decides anything the server did not send. Per platform, because
 * the two read different keys (keyboardKnobsData.ts, synced from the app's
 * tools/knobs/keyboard-knobs.json).
 */
export function withKeyboardKnobs<T extends { labels?: Record<string, string>; flags?: Record<string, unknown> }>(
  platform: string, config: T,
): T {
  const k = platform === "android" ? KEYBOARD_KNOBS.android : KEYBOARD_KNOBS.ios;
  return {
    ...config,
    labels: { ...k.labels, ...(config.labels ?? {}) },
    flags: { ...k.flags, ...(config.flags ?? {}) },
  };
}
