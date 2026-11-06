/**
 * THE PLAN BOT'S TRAVEL TIMES: between tomorrow's stops (and from home, when the person said where their day starts), when to leave,
 * which gaps are too short, a gentle word about rain or heat on an outdoor stop, and how much travel a suggested move saves.
 *
 *   travel.plan(user, { tz, events, tomorrow, suggest })   -> { travel, suggestion }    for PlanDays.read (plan.ts)
 *   travel.moved(user, eventId, startIso)                  the person said yes: what that move saved is written down
 *   travel.setHome(user, words)                            where the day starts ("HSR Layout"), or "" to forget it
 *
 * MINUTES SAVED, HONESTLY. A day's travel is the legs between its stops in time order, from home to the first and from the last back
 * home. A move saves (the old day's travel − the old day without it) − (the new day with it − the new day without it), all legs known
 * or no number at all. So without home there is no number: a stop moved to a day with nothing else on still costs the trip to it,
 * and we can't know that trip. A yes to a move that saved some is written down (plan_prefs); the header shows the last 7 days.
 *
 * Places come from the calendar event's location (not a video link, not "call"); only those go to the geocoder, with the country from
 * the person's offset and near their home. Drive times are free-flow times with the buffer (places/index.ts), said as "about".
 */
import type { Credit, Forecast, LatLon, Places } from "../places/index.js";
import { countryForOffset, distanceKm } from "../places/index.js";
import { botTopic } from "../live/topics.js";
import { type Later } from "./later.js";
import { lookNow, type Look } from "./look.js";
import { clock, dayOf, placeText, type PlanEvent, type Suggestion, type TravelCtx } from "./plan.js";
import { type Table } from "./rows.js";
import { planPrefs, planPrefsOver, type LeaveRow, type PlanPrefs, type PlanPrefsRow, type ShownMove } from "./planPrefs.js";

export type { PlanPrefsRow } from "./planPrefs.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const STOPS_MAX = 8;
const SAVES_KEPT = 60;

export interface PlanLeg {
  /** The stop it leaves from ("home" for the start of the day) and the one it goes to. */
  fromId: string;
  toId: string;
  /** Where it goes, in the calendar's words ("Koramangala"). */
  to: string;
  mode: "walk" | "drive";
  minutes: number;
  /** When to leave, UTC ms. */
  leaveBy: number;
  /** Minutes between the end of what comes before and this stop's start; null from home. */
  gapMin: number | null;
  /** That gap is shorter than the trip. */
  tight: boolean;
}

export interface PlanHeadsUp { eventId: string; kind: "rain" | "storm" | "heat"; text: string }

export interface PlanTravel {
  /** Travel times can be worked out here (a geocoder and a router are set up). */
  on: boolean;
  /** Lookups still going: the screen updates itself when they finish. */
  pending: boolean;
  /** Where the day starts, as the person wrote it ("" when not said). */
  home: string;
  /** False when home was said but couldn't be found. */
  homeFound: boolean;
  legs: PlanLeg[];
  headsUp: PlanHeadsUp[];
  /** Travel minutes avoided by moves said yes to, in the last 7 days. */
  savedWeekMin: number;
  credits: Credit[];
}

/** Likely out in the open: rain and heat matter. */
const OUTDOOR = /\b(park|garden|trek|hike|hiking|run|running|jog|marathon|cycl\w*|ride|match|cricket|football|tennis|golf|beach|picnic|walk|zoo|fort|lake|stadium|ground|outdoors?|festival|mela|fair|rooftop|terrace|swim\w*|pool|market|bazaar|sightseeing)\b/i;

export { placeText } from "./plan.js";

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const same = (a: LatLon, b: LatLon) => distanceKm(a, b) < 0.15;

/** Rain, a storm or heat across [start, end) in a forecast; the first such step. */
function weatherFor(f: Forecast, start: number, end: number): { kind: "rain" | "storm" | "heat"; at: number; tempC: number } | null {
  const steps = f.steps.filter((s) => s.t < end && s.t + s.hours * HOUR > start);
  const storm = steps.find((s) => /thunder/.test(s.symbol));
  if (storm) return { kind: "storm", at: Math.max(storm.t, start), tempC: storm.tempC };
  const rain = steps.find((s) => (/rain|sleet|drizzle/.test(s.symbol) && s.rainMm / s.hours >= 0.2) || s.rainMm / s.hours >= 0.5);
  if (rain) return { kind: "rain", at: Math.max(rain.t, start), tempC: rain.tempC };
  const hot = steps.filter((s) => s.tempC >= 35).sort((a, b) => b.tempC - a.tempC)[0];
  if (hot) return { kind: "heat", at: Math.max(hot.t, start), tempC: hot.tempC };
  return null;
}

export class PlanTravelling {
  private readonly prefs: PlanPrefs;
  private readonly now: () => number;

  constructor(private readonly o: { places: Places; later: Later; waitMs?: number; now?: () => number; prefs?: Table<PlanPrefsRow> }) {
    this.now = o.now ?? Date.now;
    this.prefs = o.prefs ? planPrefsOver(o.prefs, this.now) : planPrefs(this.now);
  }

  get on(): boolean { return this.o.places.locates && this.o.places.routes; }

  private async row(userId: string): Promise<PlanPrefsRow | null> {
    try { return await this.prefs.get(userId); } catch { return null; }
  }

  async setHome(userId: string, words: unknown): Promise<string> {
    const home = clean(words, 120);
    await this.prefs.patch(userId, { home });
    return home;
  }

  /**
   * The person said yes to a move: what it saved is written down, against the suggestion they were last shown. That one is kept in
   * plan_prefs (not one server's memory), so a restart or a second server still gives the credit.
   */
  async moved(userId: string, eventId: string, startIso: string): Promise<void> {
    const had = await this.row(userId);
    const s = had?.shown;
    if (!s || s.eventId !== eventId || s.startIso !== startIso || !s.savedMin || s.savedMin <= 0) return;
    const saves = (had?.saves ?? []).filter((x) => x.key !== s.key);
    saves.push({ key: s.key, min: s.savedMin, at: this.now() });
    await this.prefs.patch(userId, { saves: saves.slice(-SAVES_KEPT), shown: null });
  }

  /** The suggestion shown, kept for moved(); written only when it changed. Plan Ease's Move card says its own (planEase.ts). */
  async keepShown(userId: string, had: PlanPrefsRow | null | undefined, s: Pick<Suggestion, "eventId" | "startIso" | "key" | "savedMin"> | null): Promise<void> {
    if (had === undefined) had = await this.row(userId);
    const next: ShownMove | null = s ? { eventId: s.eventId, startIso: s.startIso, key: s.key, ...(s.savedMin ? { savedMin: s.savedMin } : {}) } : null;
    if (JSON.stringify(had?.shown ?? null) === JSON.stringify(next)) return;
    if (!had && !next) return;
    await this.prefs.patch(userId, { shown: next }).catch(() => undefined);
  }

  /**
   * The day's leave-by times, for the leave-by reminder (planEase.ts): each event's, with whether its reminder went (kept as it was for
   * one that is still the same), and the next one due. Other days' are kept; those past are dropped.
   */
  private async keepLeaves(userId: string, had: PlanPrefsRow | null, day: string, tz: number, legs: PlanLeg[], events: PlanEvent[]): Promise<void> {
    const now = this.now();
    const was = had?.leaves ?? [];
    const mine = legs.filter((l) => l.leaveBy > now - 60 * MIN).map((l): LeaveRow => {
      const e = events.find((x) => x.id === l.toId);
      const old = was.find((x) => x.eventId === l.toId && x.start === (e?.start ?? 0));
      return { eventId: l.toId, start: e?.start ?? l.leaveBy, leaveBy: l.leaveBy, minutes: l.minutes, mode: l.mode, to: l.to, title: e?.title ?? "", ...(old?.sent ? { sent: true } : {}) };
    });
    const others = was.filter((x) => dayOf(x.start, tz) !== day && x.start > now);
    const leaves = [...others, ...mine].sort((a, b) => a.leaveBy - b.leaveBy).slice(0, 24);
    if (JSON.stringify(leaves) === JSON.stringify(was)) return;
    const due = leaves.filter((x) => !x.sent).map((x) => x.leaveBy - 10 * MIN).sort((a, b) => a - b)[0] ?? null;
    await this.prefs.patch(userId, { leaves, next_leave_ms: due === null ? null : Math.max(due, now) }).catch(() => undefined);
  }

  async plan(userId: string, o: { tz: number; events: PlanEvent[]; tomorrow: string; suggest: (ctx?: TravelCtx) => Suggestion | null; keepShown?: boolean }): Promise<{ travel: PlanTravel; suggestion: Suggestion | null }> {
    const prefs = await this.row(userId);
    const home = prefs?.home ?? "";
    const savedWeekMin = (prefs?.saves ?? []).filter((s) => s.at >= this.now() - 7 * DAY).reduce((n, s) => n + s.min, 0);
    const places = this.o.places;
    const country = countryForOffset(o.tz);
    const tomorrowEvents = o.events.filter((e) => !e.allDay && dayOf(e.start, o.tz) === o.tomorrow).sort((a, b) => a.start - b.start).slice(0, STOPS_MAX * 2);

    const compute = (look: Look) => {
      const homePoint = home ? look.place(home, { ...(country ? { country } : {}) }) : null;
      const hints = { ...(country ? { country } : {}), ...(homePoint ? { near: homePoint } : {}) };
      const pointOf = (e: PlanEvent): LatLon | null | undefined => {
        if (!this.on) return null;
        const t = placeText(e);
        if (!t) return null;
        if (homePoint === undefined) return undefined;
        return look.place(t, hints);
      };
      const legMin = (a: LatLon, b: LatLon): number | undefined => {
        if (same(a, b)) return 0;
        const l = look.travel(a, b);
        return l ? l.minutes : undefined;
      };
      // Every lookup a day needs is asked for in one go (not stopping at the first unknown), so they are all made in one round.
      const dayCost = (events: PlanEvent[]): number | undefined => {
        if (!homePoint) return undefined; // the trips from and to home can't be known: no number, and nothing to look up
        const stops: LatLon[] = [];
        let unknown = false;
        for (const e of [...events].filter((x) => !x.allDay).sort((a, b) => a.start - b.start).slice(0, STOPS_MAX)) {
          const p = pointOf(e);
          if (p === undefined) unknown = true;
          else if (p) stops.push(p);
        }
        if (!stops.length) return unknown ? undefined : 0;
        const path = [homePoint, ...stops, homePoint];
        let total = 0;
        for (let i = 0; i + 1 < path.length; i += 1) {
          const m = legMin(path[i]!, path[i + 1]!);
          if (m === undefined) unknown = true;
          else total += m;
        }
        return unknown ? undefined : total;
      };
      const ctx: TravelCtx = {
        between(a, b) {
          const pa = pointOf(a), pb = pointOf(b);
          return pa && pb ? legMin(pa, pb) : undefined;
        },
        dayCost,
      };
      const suggestion = this.on ? o.suggest(ctx) : o.suggest();

      // tomorrow's legs, in order
      const legs: PlanLeg[] = [];
      let at: { point: LatLon; id: string } | null = homePoint ? { point: homePoint, id: "home" } : null;
      let lastEnd: number | null = null;
      for (const e of tomorrowEvents) {
        const p = pointOf(e);
        if (p === undefined) break; // not known yet: a leg from an earlier stop would be the wrong one
        if (p) {
          if (at && !same(at.point, p)) {
            const l = look.travel(at.point, p);
            if (l) {
              const gapMin = lastEnd === null ? null : Math.round((e.start - lastEnd) / MIN);
              legs.push({ fromId: at.id, toId: e.id, to: e.where || (placeText(e) ?? "").split(",")[0]!.trim(), mode: l.mode, minutes: l.minutes, leaveBy: e.start - l.minutes * MIN, gapMin, tight: gapMin !== null && gapMin < l.minutes });
            }
          }
          at = { point: p, id: e.id };
        }
        lastEnd = Math.max(lastEnd ?? 0, e.end);
      }

      // rain or heat on an outdoor stop
      const headsUp: PlanHeadsUp[] = [];
      for (const e of tomorrowEvents) {
        if (!OUTDOOR.test(`${e.title} ${e.where ?? ""}`)) continue;
        const p = pointOf(e) || homePoint;
        if (!p) continue;
        const f = look.forecast(p);
        if (!f) continue;
        const w = weatherFor(f, e.start, e.end);
        if (!w) continue;
        const when = clock(w.at, o.tz);
        headsUp.push({
          eventId: e.id, kind: w.kind,
          text: w.kind === "storm" ? `Thunderstorms likely around ${when}. Maybe plan it indoors.` : w.kind === "rain" ? `Rain likely around ${when}. Carry an umbrella.` : `Hot, ${Math.round(w.tempC)}° around ${when}. Carry water.`,
        });
      }
      return { suggestion, legs, headsUp, homeFound: !home || !!homePoint };
    };

    const { value, pending } = await lookNow({ places, later: this.o.later, userId, key: `plan:${o.tomorrow}`, topics: [botTopic("plan")], waitMs: this.o.waitMs ?? 1200, compute });
    if (o.keepShown !== false) await this.keepShown(userId, prefs, value.suggestion);
    if (this.on) await this.keepLeaves(userId, prefs, o.tomorrow, o.tz, value.legs, tomorrowEvents);
    return {
      suggestion: value.suggestion,
      travel: {
        on: this.on, pending, home, homeFound: value.homeFound, legs: value.legs, headsUp: value.headsUp, savedWeekMin,
        credits: places.credits({ map: this.on, weather: value.headsUp.length > 0 }),
      },
    };
  }
}
