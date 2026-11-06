/**
 * HOW A PERSON LOOKS IN SPACES (docs/spaces.md "How people look"): their own tiny bot, never their initials. Wherever a person is
 * shown (a space's people, the "@" list, an invitation, a request to join, Work in space), the screens draw a full tiny bot with an
 * avatar from the looks catalog (shared/bots/looks.json) and one of the group colours. The server picks both, here.
 *
 *   lookOf(id)          the look a person has wherever no space decides it: the same for the same id, every time
 *   looksIn(ids)        a space's people, oldest member first: each keeps their own look when nobody before them has it; a clash
 *                       goes to the one who joined later, who takes the next avatar and the next colour nobody there has yet
 *   seen(look, viewer)  what the viewer is shown: anyone else's look as it is; themself, their own X0 bot (ink, Blip)
 *   shownLook(looks, id, viewer)   one person of a space's looks, as the viewer is shown them
 *
 * The avatar and the colour are picked apart, so in a space of up to five everyone has a colour of their own, and up to seven an
 * avatar of their own. Ids hash with FNV-1a, so the look of an id never changes between deploys or machines.
 */
import { activeLooks } from "../experience/bots/looks.js";

/** A person's tiny bot: whose (`seed`, their id), the avatar's id in the catalog, and the colour. */
export interface PersonLook { seed: string; avatar: string; color: string }

/** The avatars people are drawn with, in the order a clash moves through them. Only those the catalog has are used. */
export const PERSON_AVATARS = ["pip", "dot", "bolt", "sage", "scout", "dapper", "nova"] as const;
/** The group palette (the colours Home gave groups). */
export const PERSON_COLORS = ["#5B7DB1", "#B5654A", "#6B8E4E", "#8A6BB1", "#B18A3D"] as const;
/** The viewer, to themself: their own X0 bot. */
export const SELF_AVATAR = "blip";
export const SELF_COLOR = "#0a0a0a";

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The avatars the catalog has now, in PERSON_AVATARS' order (all of them when no catalog can be read). One the catalog drops is
 * skipped, never shifted out of the list: everyone else keeps the avatar they had.
 */
function avatarsNow(): ReadonlySet<string> {
  const known = activeLooks()?.avatars;
  const have = known ? PERSON_AVATARS.filter((a) => !!known[a]) : [...PERSON_AVATARS];
  return new Set(have.length ? have : PERSON_AVATARS);
}

/** Where a person's avatar and colour start in their lists: from different bits of one hash, so the two don't move together. */
function startOf(id: string): { avatar: number; color: number } {
  const h = fnv1a(id);
  return { avatar: h % PERSON_AVATARS.length, color: Math.floor(h / PERSON_AVATARS.length) % PERSON_COLORS.length };
}

/**
 * From `start` onwards (round the list), the first entry used the fewest times so far: their own when nobody has it, else the next
 * one free, else (everyone's taken) the next of the least used. Only entries `ok` allows.
 */
function pick<T extends string>(list: readonly T[], start: number, used: ReadonlyMap<string, number>, ok: (x: T) => boolean = () => true): T {
  const open = list.filter(ok);
  const least = Math.min(...open.map((x) => used.get(x) ?? 0));
  for (let i = 0; i < list.length; i++) {
    const x = list[(start + i) % list.length]!;
    if (ok(x) && (used.get(x) ?? 0) === least) return x;
  }
  return open[0] ?? list[0]!;
}

/** A person's own look, where no space has decided it (someone known from several spaces, a person not in one yet). */
export function lookOf(id: string): PersonLook {
  const s = startOf(id);
  const have = avatarsNow();
  return { seed: id, avatar: pick(PERSON_AVATARS, s.avatar, new Map(), (a) => have.has(a)), color: PERSON_COLORS[s.color]! };
}

/** Everyone in a space, by id, oldest member first: unique avatars and colours there as far as the lists go. */
export function looksIn(ids: readonly string[]): Map<string, PersonLook> {
  const have = avatarsNow();
  const avatars = new Map<string, number>(), colors = new Map<string, number>();
  const out = new Map<string, PersonLook>();
  for (const id of ids) {
    if (!id || out.has(id)) continue;
    const s = startOf(id);
    const avatar = pick(PERSON_AVATARS, s.avatar, avatars, (a) => have.has(a));
    const color = pick(PERSON_COLORS, s.color, colors);
    avatars.set(avatar, (avatars.get(avatar) ?? 0) + 1);
    colors.set(color, (colors.get(color) ?? 0) + 1);
    out.set(id, { seed: id, avatar, color });
  }
  return out;
}

/** The viewer's own bot: ink, Blip. */
export const selfLook = (id: string): PersonLook => ({ seed: id, avatar: SELF_AVATAR, color: SELF_COLOR });

/** What `viewer` is shown for this look: theirs is their own X0 bot. */
export const seen = (look: PersonLook, viewer: string | null | undefined): PersonLook => (viewer && look.seed === viewer ? selfLook(viewer) : look);

/** One person in a space's looks (looksIn), as the viewer is shown them; someone not in it has their own look. */
export const shownLook = (looks: ReadonlyMap<string, PersonLook>, id: string, viewer: string | null | undefined): PersonLook => seen(looks.get(id) ?? lookOf(id), viewer);
