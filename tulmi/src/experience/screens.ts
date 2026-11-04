/**
 * THE SCREENS: buildScreen, the one entry every SDUI screen request goes through.
 *
 * This is where the backend "owns the UI". Each screen is built as data (a tree
 * of SDUI Nodes) and handed to the generic renderer in the app. Change these
 * builders and the app changes, with no client rebuild.
 *
 * A desktop that draws the desk's own pages gets them (desk/); everything else is
 * the phone app's (phone/screens.ts). See ../../../shared/types/sdui.ts for the contract.
 */

import type { Personality, UsageSummary, StatsResponse, HistoryEntry, NoteSummary, Note } from "../../../shared/types/api.js";
import type { ScreenResponse } from "../../../shared/types/sdui.js";
import type { AssistantView } from "../connectors/list.js";
import type { StatsForUser } from "../history/stats.js";
import type { Allowance } from "../usage/allowance.js";
import { DESK_SCREENS, buildDeskScreen } from "./desk/screens.js";
import { DESKTOP_LATEST, updateFor } from "./desktopRelease.js";
import { canOnboard } from "./onboard/screens.js";
import { neuralField, fieldGrowth, FIELD_SIGNAL_AT_REST } from "./phone/neuralField.js";
import { PAYWALL_CONFIG } from "./phone/paywall.js";
import { phoneScreen } from "./phone/screens.js";
import { manageFlags } from "./phone/subscription.js";
import { POLICY, freeForAll } from "./policy.js";
import { titleCaseScreen } from "./titleCase.js";

export interface ScreenContext {
  personality: Personality;
  /**
   * The live subscription, if there is one — the entitlement row, not a
   * boolean, because which STORE sold it decides where it can be changed and
   * nothing else can answer that.
   *
   * Only the paywall reads it, and only the paywall route pays for the read.
   * Absent means "not entitled, or nobody asked", and both draw the sales
   * page: a screen that hid the plans because a lookup failed would be a
   * screen nobody could buy from.
   */
  entitlement?: { store?: string; expiresAt?: string; renews?: boolean } | null;
  language: string;
  email?: string;
  /** Set instead of `email` for an SMS-only account. */
  phone?: string;
  usage?: UsageSummary;
  /** Words available and words earned, for the stats meter. Absent for a
   *  signed-out or unreadable user; the meter is then not drawn at all rather
   *  than drawn with zeros, which would read as "you have nothing left". */
  allowance?: Allowance | null;
  /**
   * Optional per-user stats projection for the "stats" screen. Populated by
   * the screen route handler when it has been wired to fetch statsForUser();
   * when absent, the stats screen falls back to the numbers in `usage`.
   */
  stats?: StatsResponse;
  /** Pre-fetched history for the "history" screen (optional; the screen also
   * refetches via callEndpoint on mount for freshness). */
  history?: HistoryEntry[];
  /** The desk's Notes page: the person's notes, newest first. */
  notes?: NoteSummary[];
  /** The desk's note page: the one asked for (params.noteId), null if gone. */
  note?: Note | null;
  /** The assistant's connected apps and tasks, for the desk's Settings and
   *  Tasks page (only for a window that said "DeskConnectors", with
   *  CONNECTORS on). */
  assistant?: AssistantView;
  /** Connected apps are switched on (CONNECTORS): the phone's Settings offers
   *  Connected apps and Tasks. Off, neither row is drawn. */
  connectorsOn?: boolean;
  name?: string;
  /** Whether the user has completed onboarding — routes the intro's `done`
   * action to onboarding (new user) vs home, so the intro never skips it. */
  onboarded?: boolean;
  dictionary?: Array<{ word: string; replacement: string }>;
  frequentWords?: string[];
  /** Deep-link / navigation params — e.g. keyboard_record receives
   * { session, host } from the keyboard extension's tulmi://s/... URL. */
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Which OS is asking. Defaults to iOS for a client that does not say.
   *
   * Lets a screen be BUILT differently per platform rather than built once
   * with both branches inside it. Prefer `visibleIf: { platform }` for a
   * single node; use this when the difference is structural, or when an
   * Android change must not alter the bytes iOS receives.
   */
  platform?: "ios" | "android";
  /**
   * The window the phone says it has, in points. Absent for a client that
   * does not report it.
   *
   * A screen that scrolls cannot lay its opening view out with flex — a
   * scroll container is sized by its content, so a child asking for flex: 1
   * inside one collapses. "One window tall" has to be a number, and the phone
   * is the only thing that knows it.
   */
  viewport?: { width: number; height: number };
  /**
   * What the asking bundle says it can render.
   *
   * Empty for a client that does not say, which is the conservative reading:
   * a screen that needs something new is withheld rather than sent broken.
   */
  can?: Set<string>;
  /**
   * "phone" (the default) or "desktop". A window, not a handset.
   *
   * Separate from `platform`, which is a drawing question — the desktop
   * answers "ios" there because that is the tree it can render — and from
   * `viewport`, which is a width. This is the input device: a window is driven
   * by a mouse, and a few layouts turn on that and not on either of the other
   * two.
   */
  formFactor?: "phone" | "desktop";
  /** The caller's UTC offset in minutes, so a desk page's "today" and its
   *  times are the person's own. */
  tzOffsetMinutes?: number;
  /** The build asking, and the computer it runs on — a desk page offers a
   *  newer build when one has been published for that OS. */
  appVersion?: string;
  os?: string;
  /**
   * What the phone says about itself on every screen fetch, for the new
   * onboarding (experience/onboard/): whether the keyboard already has Full
   * Access (a cold start lands past the Keyboard step) and the device's
   * locale ("en-IN" starts the language chips on Hinglish, Hindi and English).
   */
  keyboardReady?: boolean;
  locale?: string;
  /**
   * The Bots app is asking (bots/index.ts botsAppOn). The keyboard's handoff screens keep their ids, which the
   * keyboard's own config names for every app, and are drawn in the Bots app's look (bots/screens/handoff.ts).
   */
  bots?: boolean;
}

export function buildScreen(screenId: string, ctx: ScreenContext): ScreenResponse | null {
  // The desk's own pages, for a desktop that can draw them (experience/desk/).
  if (DESK_SCREENS.has(screenId)) {
    return buildDeskScreen(screenId, {
      personality: ctx.personality,
      history: ctx.history,
      notes: ctx.notes,
      note: ctx.note,
      assistant: ctx.assistant,
      notesHotkey: ctx.can?.has("DeskNotes") === true,
      // The window draws the new onboarding, so it has that onboarding's
      // typefaces: the page titles are set in the heading face. Absent, not.
      onboard: canOnboard(ctx.can),
      legal: { privacy: POLICY.privacy, terms: POLICY.terms },
      free: freeForAll(),
      allowSystemAudio: ctx.can?.has("DeskSystemAudio") === true,
      usage: ctx.usage,
      stats: ctx.stats as unknown as StatsForUser | undefined,
      allowance: ctx.allowance,
      entitlement: ctx.entitlement,
      email: ctx.email,
      phone: ctx.phone,
      name: ctx.name,
      tzOffsetMinutes: ctx.tzOffsetMinutes,
      params: ctx.params,
      plans: PAYWALL_CONFIG.plans,
      manageUrl: ctx.entitlement ? String(manageFlags(ctx.entitlement.store)["billing.manage.url"] ?? "") || undefined : undefined,
      // Dimmed to sit behind the Train page's words, as on the phone's card.
      // A Microsoft Store install (DeskStore) is updated by the Store; the
      // website's installer offered here would put a second copy beside it.
      update: ctx.can?.has("DeskStore") ? undefined : updateFor(ctx.appVersion, ctx.os, DESKTOP_LATEST),
      selfUpdate: ctx.can?.has("DeskSelfUpdate") === true,
      field: screenId === "desk_train" && ctx.can?.has("DeskField")
        ? neuralField(0.5, fieldGrowth(ctx.personality), undefined, FIELD_SIGNAL_AT_REST)
        : undefined,
    });
  }
  // The phone's screens: every word of the app's own starts with a capital
  // (titleCase.ts). The desk keeps its sentence case.
  const built = phoneScreen(screenId, ctx);
  return built && titleCaseScreen(built);
}
