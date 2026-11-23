/**
 * WHAT A PERSON MAY DO IN A SPACE. There are no roles any more: the space's maker is its admin, for good, and may do everything;
 * everyone else may do the same fixed set (MEMBER_PERMS). The admin alone also does ADMIN_ONLY: invite, see the space's code and let
 * people in, remove people, rename and delete the space (docs/spaces.md).
 *
 *   PERMS, PERM_WORDS         every permission, and how each reads (the old builds' screens still show them)
 *   MEMBER_PERMS, ADMIN_ONLY  what every member may do; what only the admin may do on top
 *   pickedIds(v)              a clean list of people picked, from anything a screen sends
 *
 * The server checks every permission; screens only hide what won't work.
 *
 * THE ADMIN HAS NO AUTOMATIC SIGHT OF ANYONE'S THINGS, and never had any business having it. What the admin may do is in
 * ADMIN_ONLY and it is all about the space itself — who is in it, what it is called, whether it exists — never about what a
 * member keeps in their own bots. Nothing is shared out of someone's account unless they shared it (docs/social.md §4).
 *
 * So the line members used to agree to ("The space's admin can see and share your work and messages here.") is gone, with the
 * CONSENT_VERSION it was versioned by and the hasConsent that read it. `space_members.consent_ms` and `consent_v` stay in the
 * database and nothing reads them, as the old perms columns and space_roles do, so this can be rolled back. The routes still
 * take a `consent` and a `consentV` from builds that send them, and ignore both.
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
