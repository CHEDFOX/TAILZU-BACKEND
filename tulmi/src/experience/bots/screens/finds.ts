/**
 * WHAT THE EVERYDAY TOOLS FOUND, ON THE SCREEN (src/everyday, docs/everyday.md): flights, hotels, currency and weather.
 *
 * Not a tab and not a page of its own. They show where they are useful:
 *
 *   under an answer   Ask's answer page draws the cards an answer found (its `finds`): flights with their times and a booking link,
 *                     hotels with a photo, rating, price a night and a deal link, the money converted, the days' weather. A tap on a
 *                     flight or hotel opens Kiwi.com or trivago, where the person books. Nothing is booked here.
 *   in Ask            a quiet "Live" row over "Or try": Flights, Hotels, Weather, Currency. A tap writes a starter the person edits
 *                     ("Cheapest flight from Delhi to Goa next Friday") and hands it to Travel bot.
 *   on Travel bot     with a trip, three one-tap searches for it: flights there, hotels for its dates, its weather.
 *
 * Each card says where its numbers come from, as the services ask.
 */
import type { ActionRef, Node } from "../../../../../shared/types/sdui.js";
import type { Card, Flight, FlightsCard, MoneyCard, Stay, StaysCard, WeatherCard } from "../../../everyday/index.js";
import { box, C, col, divider, grow, icon, labelled, meta, open, PALETTE_HEX, picture, RADIUS, row, SCREENS, sectionLabel, text, type BotsCtx } from "../kit.js";

export const FINDS_PATH = "/v1/everyday/finds";
export const isFindsId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

const openOut = (url: string): ActionRef => ({ kind: "openUrl", url, external: true });

function money(n: number, currency: string): string {
  try { return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n); } catch { return `${n} ${currency}`; }
}
const hm = (iso: string): string => iso.slice(11, 16);
const dur = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const stopsWords = (n: number): string => (n === 0 ? "Non-stop" : n === 1 ? "1 stop" : `${n} stops`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayWords = (key: string): string => { const d = new Date(`${key.slice(0, 10)}T00:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** MET Norway's symbol in a word or two. */
export function skyWords(symbol: string): string {
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (/thunder/.test(s)) return "Storms";
  if (/snow|sleet/.test(s)) return "Snow";
  if (/heavyrain/.test(s)) return "Heavy rain";
  if (/rain/.test(s)) return /showers/.test(s) ? "Showers" : "Rain";
  if (s === "clearsky") return "Clear";
  if (s === "fair") return "Fair";
  if (s === "partlycloudy") return "Some cloud";
  if (s === "fog") return "Fog";
  return "Cloudy";
}

/** A card's frame: an icon, a title, a line of where it is from, and what it holds. */
function frame(ctx: BotsCtx, glyph: "plane" | "bed" | "swap" | "sun", head: string, sub: string, body: Node[], from: string): Node {
  const desk = ctx.client === "desktop";
  return col([
    row([
      box([icon(glyph, { size: 18, color: C.ink })], { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
      col([text(head, { size: 15, weight: 600, lineHeight: 20, lines: 1 }), ...(sub ? [meta(sub, { size: 12, lines: 1 })] : [])], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 10 }),
    ...body,
    meta(from, { size: 11 }),
  ], { gap: 12, padding: desk ? 18 : 16, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

function flightRow(f: Flight, currency: string): Node {
  const label = `${money(f.price, currency)}, ${hm(f.out.depart)} to ${hm(f.out.arrive)}, ${stopsWords(f.out.stops)}, ${f.out.airlines.join(" and ")}. Opens Kiwi.com`;
  return labelled(row([
    col([
      text(money(f.price, currency), { size: 17, weight: 700, lineHeight: 22, tracking: -0.3 }),
      meta(f.out.airlines.join(" · ") || f.cabin, { size: 12, lines: 1 }),
    ], { gap: 1, width: 116, flexShrink: 0 }),
    col([
      text(`${hm(f.out.depart)} → ${hm(f.out.arrive)}`, { size: 15, weight: 500, lineHeight: 20 }),
      meta(`${dur(f.out.minutes)} · ${stopsWords(f.out.stops)}${f.back ? ` · back ${dayWords(f.back.depart)}` : ""}`, { size: 12, lines: 1 }),
    ], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    icon("chevron", { size: 16, color: C.meta }),
  ], { gap: 12, paddingVertical: 10 }, openOut(f.url)), label);
}

export function flightsCard(ctx: BotsCtx, c: FlightsCard): Node {
  const first = c.results[0];
  const head = first ? `${first.out.fromCity || first.out.from} → ${first.out.toCity || first.out.to}` : "Flights";
  const sub = first ? `${dayWords(first.out.depart)} · cheapest first` : "";
  const rows = c.results.slice(0, 4).flatMap((f, i) => [...(i ? [divider()] : []), flightRow(f, c.currency)]);
  return frame(ctx, "plane", head, sub, [col(rows, { gap: 0 })], "Live prices from Kiwi.com. You book there.");
}

function stayRow(ctx: BotsCtx, h: Stay): Node {
  const size = ctx.client === "desktop" ? 76 : 68;
  const line = [h.stars ? `${h.stars}★` : "", h.rating ? `${h.rating}/10` : "", h.area.split(",")[0] ?? ""].filter(Boolean).join(" · ");
  return labelled(row([
    h.image ? picture(h.image, size, size, { radius: 12, background: C.surface, fit: "cover", label: "" }) : box([icon("bed", { size: 22, color: C.meta })], { width: size, height: size, borderRadius: 12, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
    col([
      text(h.name, { size: 15, weight: 600, lineHeight: 20, lines: 2 }),
      meta(line, { size: 12, lines: 1 }),
      ...(h.perks.length ? [text(h.perks.join(" · "), { size: 12, lineHeight: 16, color: PALETTE_HEX.moss!, lines: 1 })] : []),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    col([
      text(h.perNight, { size: 16, weight: 700, lineHeight: 21, align: "right" }),
      meta(`a night · ${h.advertiser}`, { size: 11, align: "right", lines: 1 }),
    ], { gap: 1, alignItems: "flex-end", flexShrink: 0, maxWidth: 120 }),
  ], { gap: 12, paddingVertical: 8, alignItems: "center" }, openOut(h.url)), `${h.name}, ${h.perNight} a night on ${h.advertiser}. Opens trivago`);
}

export function staysCard(ctx: BotsCtx, c: StaysCard): Node {
  const rows = c.results.slice(0, 4).flatMap((h, i) => [...(i ? [divider()] : []), stayRow(ctx, h)]);
  return frame(ctx, "bed", `Hotels in ${c.query}`, `${dayWords(c.checkIn)} – ${dayWords(c.checkOut)}`, [col(rows, { gap: 0 })], "Live deals compared by trivago. You book on the site you pick.");
}

export function moneyCard(ctx: BotsCtx, c: MoneyCard): Node {
  return frame(ctx, "swap", `${money(c.amount, c.from)} in ${c.to}`, "", [
    text(money(c.result, c.to), { size: 30, weight: 700, lineHeight: 36, tracking: -0.8 }),
    meta(`1 ${c.from} = ${c.rate} ${c.to}`, { size: 13 }),
  ], `Central-bank reference rate of ${c.day ? dayWords(c.day) : "the last working day"}, via Frankfurter. Banks and cards add their own fees.`);
}

export function weatherCard(ctx: BotsCtx, c: WeatherCard): Node {
  const days = c.days.slice(0, ctx.client === "desktop" ? 5 : 4);
  return frame(ctx, "sun", c.place, c.now ? `Now ${c.now.tempC}°C · ${skyWords(c.now.symbol)}` : "", [
    row(days.map((d) => col([
      meta(WEEKDAYS[new Date(`${d.day}T00:00:00Z`).getUTCDay()]!, { size: 12, align: "center" }),
      text(`${d.maxC}°`, { size: 17, weight: 600, lineHeight: 22, align: "center" }),
      meta(`${d.minC}°`, { size: 12, align: "center" }),
      text(d.rainMm >= 1 ? `${Math.round(d.rainMm)} mm` : skyWords(d.symbol), { size: 11, lineHeight: 14, color: d.rainMm >= 1 ? PALETTE_HEX.sea! : C.grey70, align: "center", lines: 1 }),
    ], { gap: 2, flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: C.surface })), { gap: 8 }),
  ], "Forecast from MET Norway.");
}

/** Every card an answer found, in the order they were found. */
export function findsCards(ctx: BotsCtx, cards: Card[] | undefined): Node[] {
  return (cards ?? []).map((c) => (c.kind === "flights" ? flightsCard(ctx, c) : c.kind === "stays" ? staysCard(ctx, c) : c.kind === "money" ? moneyCard(ctx, c) : weatherCard(ctx, c)));
}

// ===================================================================== where they are found

/** Starters for the Live row: something real to edit, in the person's part of the world. */
function starters(india: boolean): Array<{ glyph: "plane" | "bed" | "sun" | "swap"; label: string; ask: string }> {
  return india
    ? [
      { glyph: "plane", label: "Flights", ask: "Cheapest flight from Delhi to Goa next Friday" },
      { glyph: "bed", label: "Hotels", ask: "Hotels in Jaipur this weekend under ₹5,000 a night" },
      { glyph: "sun", label: "Weather", ask: "Weather in Manali this week" },
      { glyph: "swap", label: "Currency", ask: "100 dollars in rupees" },
    ]
    : [
      { glyph: "plane", label: "Flights", ask: "Cheapest flight from London to Lisbon next Friday" },
      { glyph: "bed", label: "Hotels", ask: "Hotels in Lisbon this weekend under $150 a night" },
      { glyph: "sun", label: "Weather", ask: "Weather in Lisbon this week" },
      { glyph: "swap", label: "Currency", ask: "100 euros in dollars" },
    ];
}

/** Ask's Live row: four quiet tiles; a tap writes the starter into Ask and hands it to Travel bot (`choose`). */
export function liveRow(ctx: BotsCtx, choose: ActionRef | undefined): Node {
  const desk = ctx.client === "desktop";
  const tile = (s: ReturnType<typeof starters>[number]): Node => labelled(col([
    box([icon(s.glyph, { size: desk ? 18 : 20, color: C.ink })], { width: desk ? 36 : 40, height: desk ? 36 : 40, borderRadius: desk ? 18 : 20, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
    text(s.label, { size: 12, lineHeight: 16, color: C.grey70 }),
  ], { gap: 6, alignItems: "center", flexGrow: 1, flexBasis: 0, paddingVertical: 4 }, { kind: "sequence", actions: [{ kind: "setState", path: "ask", value: s.ask }, ...(choose ? [choose] : [])] }), `${s.label}: ${s.ask}`);
  return col([
    row([sectionLabel("Live"), grow(), meta("free, no sign-in", { size: 11 })], { gap: 8 }),
    row(starters(ctx.tzOffsetMinutes === 330).map(tile), { gap: 4 }),
  ], { gap: 8 });
}

/** Travel bot's page, with a trip: flights there, hotels for its dates, its weather, one tap each (Ask, Travel bot chosen). */
export function tripSearches(_ctx: BotsCtx, trip: { place: string; when?: string | null }): Node {
  const when = trip.when ? ` ${trip.when}` : "";
  const chip = (glyph: "plane" | "bed" | "sun", label: string, ask: string): Node => labelled(row([icon(glyph, { size: 15, color: C.ink }), text(label, { size: 13, lineHeight: 17 })], {
    gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline, backgroundColor: C.paper,
  }, open(SCREENS.ask, { message: ask, bot: "travel" })), label);
  return col([
    sectionLabel("Search live"),
    row([
      chip("plane", "Flights", `Cheapest flights to ${trip.place}${when}`),
      chip("bed", "Hotels", `Hotels in ${trip.place}${when}`),
      chip("sun", "Weather", `Weather in ${trip.place}${when}`),
    ], { gap: 8, flexWrap: "wrap" }),
  ], { gap: 8 });
}
