/**
 * WHAT A PERSON MAY DO IN A SPACE. There are no roles any more: the space's maker is its admin, for good, and may do everything;
 * everyone else may do the same fixed set (MEMBER_PERMS). The admin alone also does ADMIN_ONLY: invite, see the space's code and let
 * people in, remove people, rename and delete the space (docs/spaces.md).
 *
 *   PERMS, PERM_WORDS         every permission, and how each reads (the old builds' screens still show them)
 *   MEMBER_PERMS, ADMIN_ONLY  what every member may do; what only the admin may do on top
 *   pickedIds(v)              a clean list of people picked, from anything a screen sends
 *   ADMIN_LINE, hasConsent    the line about the admin every member agrees to, and whether they agreed to it as it is now
 *   lineShown(v)              which line a screen showed when its yes was tapped (the version it sends with it)
 *
 * The server checks every permission; screens only hide what won't work.
 */

export const PERMS = ["invite", "remove", "manage", "share", "bots", "addBots", "tasks", "plan", "approve", "askPay", "message", "groups", "activity", "rename"] as const;
export type Perm = (typeof PERMS)[number];

export const PERM_WORDS: Record<Perm, { label: string; sub: string }> = {
  invite: { label: "Invite people", sub: "By link or email" },
  remove: { label: "Remove people", sub: "Only people who can't do more than them" },
  manage: { label: "Change what others can do", sub: "Only things they can do themselves" },
  share: { label: "Add, edit and remove shared things", sub: "Lists, trips, notes, files and links" },
  bots: { label: "Use the shared bots", sub: "The bots can read what's shared here" },
  addBots: { label: "Add or take out bots", sub: "Their own bots, or X0 Bot's" },
  tasks: { label: "Give tasks to others", sub: "With a due time and a place" },
  plan: { label: "Plan for others", sub: "Put something on someone's day" },
  approve: { label: "Approve payments", sub: "Then they pay in their own UPI app" },
  askPay: { label: "Ask for payments", sub: "Someone who approves says yes or no" },
  message: { label: "Message people here", sub: "One to one, and the space's chat" },
  groups: { label: "Start group chats", sub: "With people in this space" },
  activity: { label: "See the space's activity", sub: "Who joined, shared, asked and paid" },
  rename: { label: "Rename the space", sub: "" },
};

/** What everyone in a space may do. The admin (the space's maker) may also do ADMIN_ONLY. There are no roles any more. */
export const MEMBER_PERMS: readonly Perm[] = ["share", "bots", "addBots", "tasks", "plan", "approve", "askPay", "message", "groups", "activity"];
export const ADMIN_ONLY: readonly Perm[] = ["invite", "remove", "manage", "rename"];

/** People picked on a screen: a list of ids, or switches ({ id: true }). */
export function pickedIds(v: unknown): string[] {
  if (Array.isArray(v)) return [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))];
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, on]) => on === true).map(([k]) => k);
  return [];
}

/**
 * The line every member agrees to before they write in a space (the feed's card, the invitation, the invite mail). Version 2 added
 * "and share": the admin may share any member's thing with someone there (spaceFeed.ts). Someone who agreed to version 1 is asked
 * once more; until then the admin sees only what they share, as before they agreed at all.
 */
export const CONSENT_VERSION = 2;
export const ADMIN_LINE = "The space's admin can see and share your work and messages here.";
/** The same line, said of a space the person isn't in yet (an invitation, the invite mail). */
export const ADMIN_LINE_THERE = "The space's admin can see and share your work and messages there.";
/** Which line about the admin a member (or a request to join) agreed to: 0 none, 1 the one before ("can see"), or CONSENT_VERSION. */
export const agreedTo = (m: { consent_ms?: number | null; consent_v?: number | null }): number =>
  m.consent_ms !== null && m.consent_ms !== undefined ? Math.max(1, Number(m.consent_v ?? 1) || 1) : 0;
/** Whether a member (or a request to join) agreed to the line about the admin as it is now. */
export const hasConsent = (m: { consent_ms?: number | null; consent_v?: number | null }): boolean => agreedTo(m) >= CONSENT_VERSION;
/**
 * Which line a screen showed when its yes was tapped, from the `consentV` it sends with it (start.ts Accept and Join, the feed's OK).
 * A screen drawn before the line changed (still open, or kept by the app) sends none: its yes is to the line before, so they are
 * asked once more.
 */
export const lineShown = (v: unknown): number => (Number(v) >= CONSENT_VERSION ? CONSENT_VERSION : 1);
