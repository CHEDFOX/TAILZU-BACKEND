/**
 * What every desk page is built from: the person's data, as the screen route hands it over.
 */

import type { Personality, HistoryEntry, UsageSummary, PaywallPlan, NoteSummary, Note } from "../../../../shared/types/api.js";
import type { Node } from "../../../../shared/types/sdui.js";
import type { AssistantView } from "../../connectors/list.js";
import type { StatsForUser } from "../../history/stats.js";
import type { Allowance } from "../../usage/allowance.js";

/** Words a minute a person types on a keyboard — the same figure the stats
 *  screen's "minutes saved" has always used (history/stats.ts). */
export const TYPING_WPM = 40;

/** What a desk page is built from. A subset of the catalog's ScreenContext,
 *  named here so this module does not import the catalog it is imported by. */
export interface DeskContext {
  personality: Personality;
  history?: HistoryEntry[];
  usage?: UsageSummary;
  stats?: StatsForUser;
  allowance?: Allowance | null;
  entitlement?: { store?: string; expiresAt?: string; renews?: boolean } | null;
  email?: string;
  phone?: string;
  name?: string;
  tzOffsetMinutes?: number;
  /** Navigation params from the window (fetchScreen sends cur.params): which
   *  day square or app row a detail page was opened from. */
  params?: Record<string, string | number | boolean | undefined>;
  /** The paywall's plans, passed in for the same reason. */
  plans?: PaywallPlan[];
  /** The billing flags the bootstrap would send (manage URL etc.). */
  manageUrl?: string;
  /** This person's network, at the growth they have earned — built by the
   *  catalog, and only for a window that can show it on a page (DeskField). */
  field?: Node;
  /** A newer build published for this window's OS (desktopRelease.ts). */
  update?: { version: string; url: string; sha512?: string } | null;
  /** This build installs its own update in place (it said "DeskSelfUpdate"). */
  selfUpdate?: boolean;
  /** The Notes page's list, newest first. */
  notes?: NoteSummary[];
  /** The note page's note; null when it is gone. */
  note?: Note | null;
  /** This window has the notes hotkey (it said "DeskNotes"). */
  notesHotkey?: boolean;
  /** This window draws the new onboarding (it said "OnboardStage" and "BlipSpot",
   *  and ONBOARD_V2 is on). It then has the onboarding's typefaces, so the page
   *  titles are set in its heading face. Absent, the desk is drawn as it was. */
  onboard?: boolean;
  /** Where the privacy policy and the terms are (the one every surface uses). */
  legal?: { privacy: string; terms: string };
  /** Tailzu is free for everyone right now (FREE_FOR_ALL): no plan, no price. */
  free?: boolean;
  /** This window can open the Mac's permission for the computer's sound
   *  (it said "DeskSystemAudio"). */
  allowSystemAudio?: boolean;
  /** This window draws Ask's one-time setup card (it said "DeskAskSetup",
   *  which it says only while Ask is on there): where the card's privacy
   *  link goes, and the computer it is on ("mac", "windows"), when known. */
  askSetup?: { privacyUrl: string; os?: string; folders?: boolean };
  /** The assistant's connected apps and tasks (CONNECTORS is on, and this
   *  window said "DeskConnectors"): the apps for Settings, the tasks for the
   *  Tasks page. Absent, and neither is drawn. */
  assistant?: AssistantView;
}
