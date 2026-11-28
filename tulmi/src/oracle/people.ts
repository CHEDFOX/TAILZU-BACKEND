/**
 * WHO CHAMEN READS FOR (docs/oracle.md "People"): the person themselves, the people they added, and the charts shared with them.
 *
 *   circleView(viewer)         what Chamen's page draws: who is picked, their own chart, the people they added (with what each is shared
 *                              into), the charts shared with them (a name and who shared it, never when or where), and their spaces to share into
 *   readFor(viewer)            who the next question is read against: the picked one's chart, name and gender, or null with why
 *   refOf / parseRef           "me", "p:<id>" (one they added), "s:<owner>:<ref>" (one shared with them)
 *
 * ONE CHAT. Picking someone does not open another conversation: each question is read against whoever is picked when it is asked.
 *
 * SHARED, NOT SHOWN. A chart shared into a space can be picked and asked about by its members. The server reads it for them: they get its
 * name, and the readings, and never the date, the time or the place. Membership is checked every time (on the page and on each question),
 * so leaving the space, or the owner taking the share back, ends it at once.
 *
 * GENDER. Their own chart is read with the gender they set in Chamen, else the profile's; the profile is never changed from here. Someone
 * they added has the gender they gave for them (none pre-selected when they were added).
 */
import { isComplete, skyLine, type Sky, type SkyDraft } from "./birth.js";
import type { OraclePerson } from "./worker.js";
import { oracleStore, type OracleGender, type OracleShare, type OracleStore, type OtherPerson } from "./store.js";

/** The spaces a person is in (botsBots/spaces.ts mine): set once at boot (server.ts); none without Spaces. */
export interface OracleSpaces {
  mine(userId: string): Promise<Array<{ id: string; name: string }>>;
  /** What the viewer calls someone (the name a member has in the space, or their profile name). */
  nameOf?(viewerId: string, userId: string): Promise<string>;
}
let spacesAccess: OracleSpaces | null = null;
export function setOracleSpaces(s: OracleSpaces | null): void { spacesAccess = s; }
export const oracleSpaces = (): OracleSpaces | null => spacesAccess;

export type Ref = { kind: "me" } | { kind: "other"; id: string } | { kind: "shared"; ownerId: string; ref: string };

const OWN = /^(me|p:[A-Za-z0-9-]{1,40})$/;
export function parseRef(v: unknown): Ref | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "me" || s === "") return { kind: "me" };
  let m = /^p:([A-Za-z0-9-]{1,40})$/.exec(s);
  if (m) return { kind: "other", id: m[1]! };
  m = /^s:([0-9a-f-]{8,40}):(me|p:[A-Za-z0-9-]{1,40})$/i.exec(s);
  if (m) return { kind: "shared", ownerId: m[1]!.toLowerCase(), ref: m[2]! };
  return null;
}
export const isOwnRef = (v: unknown): v is string => typeof v === "string" && OWN.test(v);
export const sharedRef = (ownerId: string, ref: string): string => `s:${ownerId}:${ref}`;

export interface CircleView {
  active: string;
  me: { ref: "me"; name: string; gender: OracleGender | null; genderFrom: "chamen" | "profile" | null; line: string | null; ready: boolean; sharedIn: string[] };
  others: Array<{ ref: string; name: string; gender: OracleGender | null; line: string | null; ready: boolean; sharedIn: string[] }>;
  shared: Array<{ ref: string; name: string; by: string; space: string; ready: boolean }>;
  spaces: Array<{ id: string; name: string }>;
}

const lineOf = (s: SkyDraft | null): string | null => (isComplete(s) ? skyLine(s) : null);
const shownGender = (g: unknown): OracleGender | null => (g === "male" || g === "female" || g === "other" ? g : null);

/** The charts shared with this viewer, from the spaces they are in now (never their own). */
async function sharedWith(viewerId: string, store: OracleStore): Promise<{ shares: OracleShare[]; spaces: Array<{ id: string; name: string }> }> {
  const spaces = spacesAccess ? await spacesAccess.mine(viewerId).catch(() => []) : [];
  const shares = spaces.length ? (await store.sharesIn(spaces.map((s) => s.id)).catch(() => [])).filter((x) => x.ownerId !== viewerId) : [];
  return { shares, spaces };
}

/** The person a shared ref points at, if it is shared with this viewer now. */
async function sharedPerson(viewerId: string, ownerId: string, ref: string, store: OracleStore): Promise<{ name: string; gender: OracleGender | null; sky: SkyDraft | null; ownerName: string } | null> {
  const { shares } = await sharedWith(viewerId, store);
  if (!shares.some((x) => x.ownerId === ownerId && x.ref === ref)) return null;
  const row = await store.get(ownerId).catch(() => null);
  if (!row) return null;
  const ownerName = (await spacesAccess?.nameOf?.(viewerId, ownerId).catch(() => "")) || "Someone";
  if (ref === "me") return { name: ownerName, gender: row.gender, sky: row.sky, ownerName };
  const o = row.others.find((x) => `p:${x.id}` === ref);
  return o ? { name: o.name, gender: o.gender, sky: o.sky, ownerName } : null;
}

export async function circleView(viewerId: string, profile: { name?: string; gender?: string | null }, store: OracleStore = oracleStore()): Promise<CircleView> {
  const [row, mine, { shares, spaces }] = await Promise.all([
    store.get(viewerId).catch(() => null), store.sharesOf(viewerId).catch(() => []), sharedWith(viewerId, store),
  ]);
  const spaceIds = new Set(spaces.map((s) => s.id));
  // Only into spaces they are still in: a share into a space they left is not shown as theirs to take back.
  const sharedIn = (ref: string) => mine.filter((x) => x.ref === ref && spaceIds.has(x.spaceId)).map((x) => x.spaceId);
  const own = shownGender(row?.gender), prof = shownGender(profile.gender);
  const shared: CircleView["shared"] = [];
  for (const x of shares) {
    const p = await sharedPerson(viewerId, x.ownerId, x.ref, store);
    if (!p || shared.some((s) => s.ref === sharedRef(x.ownerId, x.ref))) continue;
    shared.push({ ref: sharedRef(x.ownerId, x.ref), name: p.name, by: p.ownerName, space: spaces.find((s) => s.id === x.spaceId)?.name ?? "", ready: isComplete(p.sky) });
  }
  const others = (row?.others ?? []).map((o: OtherPerson) => ({ ref: `p:${o.id}`, name: o.name, gender: o.gender, line: lineOf(o.sky), ready: isComplete(o.sky), sharedIn: sharedIn(`p:${o.id}`) }));
  // The pick, as long as it still points at someone: an added person taken out, or a share taken back, falls back to their own.
  const want = row?.active ?? "me";
  const active = want === "me" || others.some((o) => o.ref === want) || shared.some((s) => s.ref === want) ? want : "me";
  return {
    active,
    me: { ref: "me", name: profile.name?.trim() || "You", gender: own ?? prof, genderFrom: own ? "chamen" : prof ? "profile" : null, line: lineOf(row?.sky ?? null), ready: isComplete(row?.sky), sharedIn: sharedIn("me") },
    others, shared, spaces,
  };
}

export interface ReadFor { ref: string; name: string; sky: Sky | null; person: OraclePerson | null; own: boolean; why?: "not_ready" | "gone" }

/**
 * Who the next question is read against. The person's own chart unless they picked someone; a pick that no longer points at anyone (taken
 * out, or the share taken back) is read as their own, and says so (`why: "gone"`).
 */
export async function readFor(viewerId: string, profile: OraclePerson | null, store: OracleStore = oracleStore()): Promise<ReadFor> {
  const row = await store.get(viewerId).catch(() => null);
  const engineGender = (g: OracleGender | null | undefined): OraclePerson["gender"] => (g === "male" || g === "female" ? g : undefined);
  const mine = (why?: ReadFor["why"]): ReadFor => {
    const gender = row?.gender ? engineGender(row.gender) : profile?.gender;
    const person: OraclePerson | null = profile?.name || gender ? { ...(profile?.name ? { name: profile.name } : {}), ...(gender ? { gender } : {}) } : null;
    return { ref: "me", name: profile?.name ?? "You", sky: isComplete(row?.sky) ? row!.sky as Sky : null, person, own: true, ...(why ? { why } : {}) };
  };
  const ref = parseRef(row?.active ?? "me");
  if (!ref || ref.kind === "me") return mine();
  if (ref.kind === "other") {
    const o = row?.others.find((x) => x.id === ref.id);
    if (!o) return mine("gone");
    const gender = engineGender(o.gender);
    return { ref: `p:${o.id}`, name: o.name, sky: isComplete(o.sky) ? o.sky as Sky : null, person: { name: o.name, ...(gender ? { gender } : {}) }, own: false, ...(isComplete(o.sky) ? {} : { why: "not_ready" as const }) };
  }
  const p = await sharedPerson(viewerId, ref.ownerId, ref.ref, store);
  if (!p) return mine("gone");
  const gender = engineGender(p.gender);
  return { ref: sharedRef(ref.ownerId, ref.ref), name: p.name, sky: isComplete(p.sky) ? p.sky as Sky : null, person: { name: p.name, ...(gender ? { gender } : {}) }, own: false, ...(isComplete(p.sky) ? {} : { why: "not_ready" as const }) };
}
