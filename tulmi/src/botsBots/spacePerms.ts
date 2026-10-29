/**
 * WHAT A PERSON MAY DO IN A SPACE: the permissions, the three presets, and the rules for changing them.
 *
 *   PERMS                     every permission, in the order the "What Mom can do" screen lists them
 *   PRESETS                   Family, Kid, Guest
 *   canGrant(mine, wanted)    the permissions in `wanted` that `mine` does not have (empty: allowed)
 *   covers(mine, theirs)      may someone with `mine` change or remove someone with `theirs`: only if they can do everything the other can
 *
 * The space's maker is its admin: they can do everything, nobody changes what they can do, and it can't be handed over. Everyone else
 * has a set of permissions, chosen when they are invited and changed later by someone allowed to. Nobody can give a permission they
 * don't have, or take one away that they don't have. The server checks every one of these; the screens only hide what won't work.
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

export interface Preset { id: "family" | "kid" | "guest"; name: string; sub: string; perms: readonly Perm[] }

export const PRESETS: readonly Preset[] = [
  { id: "family", name: "Family", sub: "Invite, share, give tasks, plan, ask for payments, chat", perms: ["invite", "share", "bots", "addBots", "tasks", "plan", "askPay", "message", "groups", "activity"] },
  { id: "kid", name: "Kid", sub: "Use bots, add to lists, ask for payments, chat", perms: ["share", "bots", "askPay", "message"] },
  { id: "guest", name: "Guest", sub: "See what's shared, use bots, chat", perms: ["bots", "message"] },
];

export const presetOf = (id: unknown): Preset | undefined => PRESETS.find((p) => p.id === id);
export const isPerm = (p: unknown): p is Perm => typeof p === "string" && (PERMS as readonly string[]).includes(p);

/** A clean, ordered, de-duplicated list of permissions from anything (unknown names are dropped). */
export function permsOf(v: unknown): Perm[] {
  if (Array.isArray(v)) { const set = new Set(v.filter(isPerm)); return PERMS.filter((p) => set.has(p)); }
  if (v && typeof v === "object") return PERMS.filter((p) => (v as Record<string, unknown>)[p] === true);
  return [];
}

/** People picked on a screen: a list of ids, or switches ({ id: true }). */
export function pickedIds(v: unknown): string[] {
  if (Array.isArray(v)) return [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))];
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, on]) => on === true).map(([k]) => k);
  return [];
}

/** What a member whose row predates permissions may do: Family, and approving if they could. */
export const legacyPerms = (canApprove: boolean): Perm[] => permsOf([...presetOf("family")!.perms, ...(canApprove ? ["approve"] : [])]);

/** The permissions in `wanted` that `mine` lacks. */
export const lacking = (mine: readonly Perm[], wanted: readonly Perm[]): Perm[] => wanted.filter((p) => !mine.includes(p));

/** Someone with `mine` may change or remove someone with `theirs` only if they can do everything the other can. */
export const covers = (mine: readonly Perm[], theirs: readonly Perm[]): boolean => lacking(mine, theirs).length === 0;

/** "Approve payments and Rename the space": the words for a list of permissions. */
export function permNames(list: readonly Perm[]): string {
  const w = list.map((p) => PERM_WORDS[p].label);
  return w.length <= 1 ? w[0] ?? "" : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

/** The role that has exactly these permissions: a preset, else one of the space's own, else null (just for them). */
export function roleFor(perms: readonly Perm[], custom: ReadonlyArray<{ id: string; perms: readonly Perm[] }>): string | null {
  const same = (a: readonly Perm[]) => a.length === perms.length && a.every((p) => perms.includes(p));
  return PRESETS.find((p) => same(p.perms))?.id ?? custom.find((r) => same(r.perms))?.id ?? null;
}
