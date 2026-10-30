/**
 * THE BOTS APP'S "BOTS" AREA, BEHIND ITS SCREENS (experience/bots/screens/bots.ts) AND ITS ROUTES (routes/botsBots.ts).
 *
 *   chat.ts     a chat with a bot, turn by turn, as the bot's page shows it (Bots.ask underneath)
 *   maker.ts    Make a bot: the draft kept while it is shaped (Bots.draft / test / approve underneath)
 *   shop.ts     Find a bot: Tailzu's ready-made bots and the ones people listed; add a copy
 *   usage.ts    what each API key of a bot used this month
 *   spaces.ts   spaces: members, shared bots, who approves payments, invites by code
 *   plan.ts     Plan Ease's tomorrow and week from the person's own calendar and to-dos (src/calendar), and the change it suggests
 *   trips.ts    the Travel bot's trip: where, when, who, packing, its main places and stays
 *   planTravel.ts, tripExtras.ts   travel times, weather and stays compared, over src/places (look.ts, later.ts: from memory now,
 *               the rest looked up after and the screen told); stays.ts, tripDates.ts
 *   rows.ts     the tables (migration 0042), in memory or Supabase
 *
 * Everything is the signed-in person's own; another person's row is "not found".
 */
import type { Bots } from "../bots/index.js";
import type { Connectors } from "../connectors/index.js";
import { BotChat } from "./chat.js";
import { BotMaker } from "./maker.js";
import { PlanDays, type PlanReader } from "./plan.js";
import { BotShop } from "./shop.js";
import { Spaces } from "./spaces.js";
import { Trips } from "./trips.js";
import { KeyUsage } from "./usage.js";
import { places as serverPlaces, type Places } from "../places/index.js";
import { Later } from "./later.js";
import { PlanTravelling } from "./planTravel.js";
import { webStaySource, type StaySource } from "./stays.js";
import { TripExtrasReader } from "./tripExtras.js";

export { BotChat, type ChatTurn } from "./chat.js";
export { BotMaker, type DraftView } from "./maker.js";
export { BotShop, READY_MADE, type ShopEntry } from "./shop.js";
export { KeyUsage, type MonthUsage } from "./usage.js";
export { Spaces, type SpaceView } from "./spaces.js";
export { PlanDays, calendarPlanReader, suggestionFor, clock, dayWords, dayOf, shiftDay, mondayOf, isoAt, type PlanRead, type PlanEvent, type PlanReader, type Suggestion } from "./plan.js";
export { Trips, STARTER_LIST, type Trip } from "./trips.js";
export { PlanTravelling, type PlanTravel, type PlanLeg } from "./planTravel.js";
export { TripExtrasReader, type TripExtras } from "./tripExtras.js";
export { webStaySource, compareStays, type StaySource, type StayRow } from "./stays.js";
export { Later } from "./later.js";
export { table, resetAreaTablesForTests, MemoryTable, AREA_TABLES } from "./rows.js";

export interface BotsAreaParts {
  chat: BotChat | null;
  maker: BotMaker | null;
  shop: BotShop | null;
  usage: KeyUsage;
  spaces: Spaces;
  plan: PlanDays;
  trips: Trips;
  /** A trip's weather, places and stays compared (routes/botsTrips.ts). */
  tripExtras: TripExtrasReader;
}

/** The parts, for the routes. Those that need the bots platform are null while BOTS is off. */
export function botsAreaParts(o: {
  bots: Bots | null; connectors: Connectors | null; reader?: PlanReader | null; now?: () => number;
  /** Geocoder, router and weather (src/places): the server's from the config unless given. */
  places?: Places; stays?: StaySource | null; later?: Later; waitMs?: number;
}): BotsAreaParts {
  const now = o.now ?? Date.now;
  // Tailzu's own calendar and to-dos (src/calendar/bots.ts) by their names; the old Google ids mean them now.
  const OWN: Record<string, string> = { calendar: "Calendar", tasks: "Tasks", "google-calendar": "Calendar", "google-tasks": "Tasks" };
  const appName = (id: string): string => OWN[id] ?? o.connectors?.hub.catalog.find((d) => d.id === id)?.name ?? id;
  // The person's own calendar and to-dos (src/calendar) unless a test hands in its own.
  const reader = o.reader ?? null;
  const places = o.places ?? serverPlaces();
  const later = o.later ?? new Later();
  const trips = new Trips(now);
  return {
    chat: o.bots ? new BotChat(o.bots, now) : null,
    maker: o.bots ? new BotMaker(o.bots, now) : null,
    shop: o.bots ? new BotShop(o.bots, appName, now) : null,
    usage: new KeyUsage(now),
    spaces: new Spaces(o.bots, now),
    plan: new PlanDays(reader, null, now, undefined, new PlanTravelling({ places, later, now, ...(o.waitMs !== undefined ? { waitMs: o.waitMs } : {}) })),
    trips,
    tripExtras: new TripExtrasReader({ places, later, trips, source: o.stays !== undefined ? o.stays : webStaySource(), now, ...(o.waitMs !== undefined ? { waitMs: o.waitMs } : {}) }),
  };
}

/** What a shared thing is called in the message to a bot: "a link", "a file", or the text itself. */
export function shareMessage(what: string, shared: { name?: string; text?: string; url?: string }): string {
  const ask = what.trim() || "Have a look at this.";
  const parts: string[] = [ask];
  if (shared.url) parts.push(`The link: ${shared.url}`);
  if (shared.text) parts.push(`What was shared:\n${shared.text}`);
  if (shared.name && !shared.url && !shared.text) parts.push(`(The file: ${shared.name})`);
  return parts.join("\n\n").slice(0, 8000);
}

/** The line a shared thing is sent to a bot with, until the person changes it. */
export function shareAsk(slug: string, kind: "file" | "link" | "text"): string {
  switch (slug) {
    case "travel": return kind === "file" ? "Add this trip to my plan" : "Keep this with my trip";
    case "plan": return "Put this on my calendar";
    case "code": return kind === "link" ? "Look at this and tell me what to change" : "Look at this";
    case "keybot": return "Write a reply to this";
    default: return kind === "file" ? "What's in this?" : "What should I do with this?";
  }
}

/** What a bot will do with it, and what it won't, in a line (said before it acts). */
export function shareLine(slug: string, name: string): string {
  switch (slug) {
    case "travel": return "Travel bot adds the times and booking details to your trip. It won't book or pay for anything.";
    case "plan": return "Plan Ease puts it on your calendar in X0 Bot. You can change it or take it out any time.";
    case "code": return "Xode reads it and answers. It changes code only through a pull request you approve.";
    case "keybot": return "Keylessbord writes it in your voice. You send it yourself.";
    default: return `${name} reads it and answers here. It asks before it changes anything or spends money.`;
  }
}
