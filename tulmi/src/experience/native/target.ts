/**
 * WHICH DESIGN A SURFACE GETS (native/SPEC.md section 5.3). Kept small on purpose in format 1: a default per surface and a named
 * list of users. Percentages, cohorts, locales, themes and time windows come when they are needed, not before.
 *
 * THERE IS NO `?preview=`. An internal account is named in a rule's `when.users`, which is how the testers' stage works: that
 * reaches the widgets, the Live Activity and the Android notice alike, because all three ask through `pickDesign` with a
 * `userId`. A query parameter reached only the glance, and any signed-in account could send it.
 *
 * THE FOUR THINGS THAT MUST ALL BE TRUE before a design is named for a phone, and they are why a widget never meets an id it does
 * not hold:
 *   1. the build says it can draw the format (NativeLook1, drawsFormat)
 *   2. the phone already holds a catalog at least as new as the one the design first appeared in (`since` <= `nl`)
 *   3. the design is for this surface and this platform
 *   4. this device has not reported it bad (the crash marker, section 3.7)
 * When one of them is false the `fallback` chain is walked, and when that runs out NO look is sent at all and the hand-written
 * native view draws. That is the whole safety story: the server never names a design a phone cannot draw.
 */
import type { GlanceLook, NLookCatalog, NLookDesign, NLookTargetSurface } from "../../../../shared/types/nlook.js";
import { NLOOK_CAPS, NLOOK_TARGET_SURFACES } from "../../../../shared/types/nlook.js";
import { activeNativeLooks, drawsFormat, nativeSwitches, NLOOK_SERVER_FORMAT, type Platform } from "./catalog.js";

/** The surfaces a targeting rule may name (`NLookTargetSurface` in shared/types/nlook.ts, where `NLookTarget` reads it too). */
export type TargetSurface = NLookTargetSurface;

export interface PickOptions {
  /** What the asking build says it can draw (its binaryFeatures, mapped to capability names). */
  can: ReadonlySet<string>;
  platform: Platform;
  userId?: string;
  /** The catalog version the phone says it holds (`nl=` on the glance, or on the Activity token). Absent: it holds none. */
  nl?: number;
  /** Ids this device's widgets marked bad after a crash. The server stops naming them for that device. */
  bad?: readonly string[];
}

const SURFACE_OF = NLOOK_TARGET_SURFACES;

/**
 * Whether this build could draw this one design at all, on its own, before any chain is walked.
 *
 * `since` is normally stamped by the admin PUT (catalog.ts stampSince). The ordinary publish path — edit looks.json, raise
 * `v`, deploy — never writes one, so a MISSING `since` counts as the active catalog's own `v`: that design first appeared in
 * the catalog being served, and a phone holding an older one has not downloaded it. Reading a missing `since` as 0 would
 * have skipped rule 2 entirely on the path we actually publish by.
 */
function drawable(d: NLookDesign | undefined, surface: TargetSurface, o: PickOptions, catalogV: number): boolean {
  if (!d) return false;
  const want = SURFACE_OF[surface];
  if (!want || d.surface !== want) return false;
  if (o.bad?.includes(d.id)) return false;
  const format = Math.min(drawsFormat(o.can), NLOOK_SERVER_FORMAT);
  if (format < 1 || Number(d.format) > format) return false;
  const since = typeof d.since === "number" && Number.isFinite(d.since) ? d.since : catalogV;
  if (since > (o.nl ?? 0)) return false;
  if (d.surface === "activity" && (o.platform !== "ios" || !nativeSwitches().activity)) return false;
  // Android's ongoing notice is Android's alone, a build that says LiveUpdate1 draws it, and it has its own switch — the same
  // shape as the Live Activity's above, so neither surface can be named while its own switch is off.
  if (d.surface === "liveupdate" && (o.platform !== "android" || !o.can.has(NLOOK_CAPS.liveUpdate1) || !nativeSwitches().notice)) return false;
  // The spare board kind is a kind in the BINARY: a build without it has no widget to draw a board in.
  if (surface === "widget:board" && !o.can.has(NLOOK_CAPS.widgetBoard1)) return false;
  // Android draws the three sizes; a design with none of them is not for it.
  if (o.platform === "android" && d.surface === "widget" && !(d.roots?.small || d.roots?.medium || d.roots?.large)) return false;
  return true;
}

/**
 * The design this phone should be told to draw for one surface, or null for "draw today's native view". Walks the `fallback` chain
 * when the first choice cannot be drawn, with a bound, because a chain the publish check somehow let through must never hang a push.
 */
export function pickDesign(surface: TargetSurface, o: PickOptions): string | null {
  if (!nativeSwitches().looks) return null;
  const c = activeNativeLooks();
  if (!c) return null;

  let at: string | undefined = defaultFor(surface, o.userId);
  for (let hops = 0; at && hops < 8; hops++) {
    const d: NLookDesign | undefined = c.designs[at];
    if (d && drawable(d, surface, o, c.v)) return d.id;
    at = d ? d.fallback : undefined;
  }
  return null;
}

/**
 * Whether one rule's `when.users` names this person. `users` is checked with Array.isArray first: a rule that wrote it as a
 * STRING would otherwise be substring-matched by String.prototype.includes, so "abc" would reach the account "b".
 */
const namesUser = (r: { when?: { users?: unknown } }, userId?: string): boolean =>
  !!userId && Array.isArray(r.when?.users) && (r.when.users as unknown[]).includes(userId);

/** The design a targeting rule names for this surface: a rule listing this person first, then the surface's plain default. */
function defaultFor(surface: TargetSurface, userId?: string): string | undefined {
  const rules = activeNativeLooks()?.targets ?? [];
  const mine = rules.find((r) => r.surface === surface && namesUser(r, userId));
  if (mine) return mine.design;
  return rules.find((r) => r.surface === surface && !r.when)?.design;
}


/** The palette the designs for this phone resolve their roles against: the chosen design's, else the catalog's first. */
export function paletteFor(designId: string | null): string | undefined {
  const c = activeNativeLooks();
  if (!c) return undefined;
  const named = designId ? c.designs[designId]?.palette : undefined;
  return named ?? Object.keys(c.palettes)[0];
}

/**
 * What the glance adds for a build that says NativeLook1 and sent its `nl`: the design for each SURFACE, the palette they
 * resolve against, the board list the spare widget's settings offer, and the free `vars` map. Nothing at all when no design
 * can be drawn — and then today's native view draws, which is exactly what every build does today.
 *
 * `bots` is "Bots at work", and the glance is the only place that knows THIS phone (its `nl`, its `can`, its platform):
 *   iOS      the Live Activity's design. The app's own in-process updates can only set it from here, so without it every
 *            local update would clear what the last APNs push named and the views would flap.
 *   Android  the ongoing notice's design. The binary reads it from the stored glance and ignores the one in the push.
 */
export function glanceLook(o: PickOptions & {
  vars?: Record<string, string>;
  /** This person's name for a board design, in their language. A board with no name is not offered. */
  boardName?: (designId: string) => string | null;
}): GlanceLook | null {
  const x0 = pickDesign("widget:x0", o);
  const board = pickDesign("widget:board", o);
  const bots = pickDesign(o.platform === "ios" ? "activity:bots" : "notice:bots", o);
  if (!x0 && !board && !bots) return null;
  const look: Record<string, string> = {};
  if (x0) look.x0 = x0;
  if (board) look.board = board;
  if (bots) look.bots = bots;
  // The palette is the WIDGETS' palette: an Activity or notice design names its own, and the natives read it there.
  const palette = paletteFor(x0 ?? board);
  const boards = o.boardName ? boardList(o, o.boardName) : [];
  return {
    look,
    ...(palette ? { palette } : {}),
    ...(boards.length ? { boards } : {}),
    ...(o.vars && Object.keys(o.vars).length ? { vars: o.vars } : {}),
  };
}

/** At most this many boards travel on a glance, and a name is cut to this. Both are the readers' own caps. */
const BOARDS_MAX = 12;
const BOARD_NAME_MAX = 40;

/**
 * The boards the "X0 Board" widget's own settings offer: every `board.*` widget design a TARGETING RULE REACHES THIS PERSON
 * WITH and this phone could actually draw, except `board.base` (the bundled "Overview", which the widget lists itself).
 * Already in this person's language, because nobody — not iOS, not Android — may make a name out of an id.
 *
 * The rules are read here for the same reason pickDesign reads them: a board staged for the testers (`when.users`) must not
 * be offered in anyone else's picker. Their phone holds the whole catalog — the plain x0 rule puts it there — so leaving the
 * rules out of this list was the one way a staged design reached a person no rule named.
 */
function boardList(o: PickOptions, name: (id: string) => string | null): { id: string; name: string }[] {
  if (!nativeSwitches().looks || !o.can.has(NLOOK_CAPS.widgetBoard1)) return [];
  const c = activeNativeLooks();
  if (!c) return [];
  const out: { id: string; name: string }[] = [];
  for (const d of reachableBoards(c, o.userId)) {
    if (d.id === "board.base") continue;
    if (!drawable(d, "widget:board", o, c.v)) continue;
    const n = name(d.id)?.trim();
    if (!n) continue;
    out.push({ id: d.id, name: n.slice(0, BOARD_NAME_MAX) });
    if (out.length >= BOARDS_MAX) break;
  }
  return out;
}

/** The `board.*` designs some rule reaches this person with: a plain rule, or one whose `when.users` lists them. In order. */
function reachableBoards(c: NLookCatalog, userId?: string): NLookDesign[] {
  const out: NLookDesign[] = [];
  const seen = new Set<string>();
  for (const r of c.targets ?? []) {
    if (r.surface !== "widget:board") continue;
    if (r.when && !namesUser(r, userId)) continue;
    const d = c.designs?.[r.design];
    if (!d?.id?.startsWith("board.") || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}
