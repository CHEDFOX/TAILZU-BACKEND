/**
 * THE PERSON'S TIME ZONE, for the Google apps that have none of their own.
 *
 * Calendar keeps one (the zone set on their Google calendar); Tasks,
 * Classroom and Forms do not, yet they say days and times ("due Friday
 * 23:59"). So, in order:
 *
 *   1. the `timezone` the request named, when the person named a place;
 *   2. the zone on their Google calendar, when Google Calendar is switched on
 *      here and they have it connected: read with Calendar's own connection,
 *      at most once an hour, and only that one value (calendarZone below);
 *   3. India's, the zone the hand-offs assume too.
 *
 * A failed read is never the tool's failure: it falls through to the next.
 */
import type { Args } from "../native.js";
import type { GoogleSession } from "./oauth.js";
import { MIN, validZone } from "./time.js";

export const HOME_ZONE = "Asia/Kolkata";
const CALENDAR = "google-calendar";
/**
 * Where the zone on their Google calendar is read: the `timeZone` Google puts
 * on every events.list answer ("The time zone of the calendar"). events.list
 * is allowed under calendar.events, the one Calendar scope Tailzu asks for;
 * the zone's own setting (users.settings.get) would need calendar.readonly
 * as well, a second line on Google's consent page for one value. And
 * fields=timeZone asks for that value alone, so no event comes back with it.
 */
export const CALENDAR_ZONE_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=timeZone";
const KEEP_MS = 60 * MIN;
/** A read that failed (not connected, signed out) is not tried again for this long. */
const MISS_MS = 10 * MIN;

export type ZoneOf = (userId: string, args: Args) => Promise<string>;

/** The zone set on their Google calendar, or null when Google gives none we know. Throws what the call throws. */
export async function calendarZone(session: GoogleSession, userId: string): Promise<string | null> {
  return validZone((await session.json<{ timeZone?: string }>(userId, CALENDAR, "Google Calendar", CALENDAR_ZONE_URL)).timeZone);
}

export function personZone(o: { session: GoogleSession; calendarOn: boolean; now?: () => number }): ZoneOf {
  const now = () => (o.now ?? Date.now)();
  const known = new Map<string, { tz: string | null; at: number }>();
  return async (userId, args) => {
    const asked = validZone(args.timezone);
    if (asked) return asked;
    if (!o.calendarOn) return HOME_ZONE;
    const hit = known.get(userId);
    if (hit && now() - hit.at < (hit.tz ? KEEP_MS : MISS_MS)) return hit.tz ?? HOME_ZONE;
    let tz: string | null = null;
    try {
      tz = await calendarZone(o.session, userId);
    } catch { /* not connected, or signed out: the home zone */ }
    known.set(userId, { tz, at: now() });
    if (known.size > 5000) known.delete(known.keys().next().value!);
    return tz ?? HOME_ZONE;
  };
}
