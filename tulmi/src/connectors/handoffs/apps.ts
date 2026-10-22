/**
 * THE HAND-OFFS: apps Tailzu opens with everything filled in, for the person
 * to finish there.
 *
 * Each app is a native connector with plain tools and no permission at all:
 * no sign-in, no API, no key. A tool turns what the person said into one link
 * (links.ts) and the line Tailzu says as it opens it (words.ts). Its tier is
 * "write", like compose_email: it runs only on a command, and never asks for
 * a yes of its own, because nothing happens until the person presses Send,
 * Pay or Book in the other app with the whole thing in front of them.
 *
 * A tool that cannot make a link from what it was given (a number that is not
 * one, a UPI ID that is not name@bank, a message too long for a link) refuses
 * with a sentence that can be said aloud, and the run says it.
 *
 * Phone only: a call, a text and a UPI payment open apps a computer does not
 * have (`phoneOnly`). Asked for on the desktop, the run says so in one line
 * and nothing runs (connectors/index.ts).
 *
 * What another app returned never picks who a message goes to or who is
 * paid: once a run has read a result, a call naming a number, a username or
 * a UPI ID opens only when the person said it themselves (`recipientSaid`,
 * asked by connectors/index.ts).
 */
import { ConnectorError } from "../oauth.js";
import type { Args, HandoffWords, NativeConnector, NativeTool } from "../native.js";
import { en, type WordKey } from "../words.js";
import { dateOf, DAY, parseWhen } from "../google/time.js";
import {
  amazonLink, bookingLink, dialNumber, directionsLink, flipkartLink, line, LINK_MAX, mapSearchLink, phoneDigits, smsLink,
  spotifyLink, telegramLink, telLink, text, threadsLink, tooLong, uberLink, upiLink, whatsappLink, youtubeLink, youtubeMusicLink,
} from "./links.js";

export interface HandoffOptions {
  now?: () => number;
  /** The zone "tomorrow" is read in, for hotel dates. India unless told otherwise. */
  tz?: string;
}

/** What a tool made: the link, and the words for it. */
interface Made { url: string; words: HandoffWords }
/** Who a call names: a number (as the tool dials it), a Telegram username or a UPI ID. */
export type Recipient = { phone: string } | { username: string } | { vpa: string };
interface Spec {
  tool: NativeTool;
  make(args: Args, o: Required<HandoffOptions>): Made;
  /** Who this call goes to, when it names someone; null when it leaves the choice to the person in the other app. */
  recipient?(args: Args): Recipient | null;
}

/** A chat message or a text in a link. The apps take more; a link much longer than this does not open everywhere. */
export const MESSAGE_MAX = 1000;
/**
 * What a message may come to once encoded: the link's limit less
 * room for the rest of it (the address, a number or a username). A letter in
 * Hindi is nine characters encoded, so a long Hindi message can be within
 * MESSAGE_MAX and still too long for a link.
 */
const ENCODED_MAX = LINK_MAX - 100;
/** A Threads post is at most 500 characters (Meta's limit). */
export const POST_MAX = 500;
/** A search, a place or a destination. */
const QUERY_MAX = 150;
/** UPI's usual limit for one payment between people. */
export const UPI_MAX_RUPEES = 100_000;
const GUESTS_MAX = 30;

const rejected = (message: string) => new ConnectorError("rejected", message);
/** Their words in what Tailzu says, cut short enough to say. */
const spoken = (s: string, max = 60) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);
const given = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const str = (description: string) => ({ type: "string", description });

/** "Who it is for", which every message tool takes for what Tailzu says and nothing else. */
const WHO = str("Who it is for, as they said it (\"Mom\", \"Rahul\"). Only for what Tailzu says; never sent.");

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], phoneOnly = false): NativeTool {
  return { name, risk: "write", description, inputSchema: { type: "object", properties, required }, annotations: {}, ...(phoneOnly ? { phoneOnly } : {}) };
}

function message(v: unknown, app: string): string {
  const m = text(v);
  if (!m) throw rejected("What should the message say?");
  if (m.length > MESSAGE_MAX || encodeURIComponent(m).length > ENCODED_MAX) throw rejected(`That message is too long for me to open in ${app}. Ask me for a shorter one.`);
  return m;
}

/** Devanagari digits as ASCII, so a number said in Hindi numerals is the same number. */
const asciiDigits = (s: string) => s.replace(/[\u0966-\u096f]/g, (d) => String(d.charCodeAt(0) - 0x966));

/**
 * Whether the person said this recipient: the UPI ID or username as it is
 * (any case), or the number, its last ten digits within a number they said
 * however they spaced it ("98765 43210", "+91-98765-43210").
 */
export function recipientIn(r: Recipient, words: string): boolean {
  if ("vpa" in r) return words.toLowerCase().includes(r.vpa.toLowerCase());
  if ("username" in r) return (words.match(/[A-Za-z0-9_]+/g) ?? []).some((w) => w.toLowerCase() === r.username.toLowerCase());
  const digits = r.phone.replace(/\D/g, "");
  const tail = digits.length > 10 ? digits.slice(-10) : digits;
  return (asciiDigits(words).match(/\d(?:[\s().-]*\d)*/g) ?? []).some((n) => n.replace(/\D/g, "").includes(tail));
}

/** A search or a place. Only punctuation ("..") is nothing to look for, and in Spotify's path it would leave the search. */
function query(v: unknown, ask: string): string {
  const q = line(v, QUERY_MAX);
  if (!q || /^[\p{P}\s]+$/u.test(q)) throw rejected(ask);
  return q;
}

// ------------------------------------------------------------------ messages

const WHATSAPP: Spec[] = [{
  tool: tool("send_message",
    "Open WhatsApp with a message written, for the person to send. Nothing is sent: they press Send. With a phone number it opens that chat; without one WhatsApp lets them pick the chat, so never ask for a number they did not give.",
    { text: str("The message, in the words they asked for."), phone: str("Their phone number, only if the person said it."), name: WHO },
    ["text"]),
  make(a) {
    const m = message(a.text, "WhatsApp");
    const phone = given(a.phone) ? phoneDigits(a.phone) : undefined;
    if (phone === null) throw rejected(`"${spoken(String(a.phone), 30)}" doesn't look like a phone number. What's their number?`);
    const who = line(a.name, 40);
    const say: WordKey = phone ? (who ? "wa.done.to" : "wa.done") : who ? "wa.pick.to" : "wa.pick";
    return { url: whatsappLink(m, phone), words: { say, open: "wa.open", ...(who ? { vars: { name: who } } : {}) } };
  },
  recipient(a) {
    const phone = given(a.phone) ? phoneDigits(a.phone) : null;
    return phone ? { phone } : null;
  },
}];

/** A Telegram username: 4 to 32 letters, digits and underscores, starting with a letter; "@name" and t.me/name are taken too. */
const TG_USER = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const tgUser = (v: unknown) => (given(v) ? String(v).trim().replace(/^(?:https?:\/\/)?t\.me\//i, "").replace(/^@/, "") : "");

const TELEGRAM: Spec[] = [{
  tool: tool("send_message",
    "Open Telegram with a message written, for the person to send. Nothing is sent: they press Send. With a username it opens that chat; without one Telegram lets them pick the chat.",
    { text: str("The message, in the words they asked for."), username: str("Their Telegram @username, only if the person said it."), name: WHO },
    ["text"]),
  make(a) {
    const m = message(a.text, "Telegram");
    const raw = tgUser(a.username);
    if (raw && !TG_USER.test(raw)) throw rejected(`"${spoken(raw, 30)}" doesn't look like a Telegram username. What's their @username?`);
    const who = line(a.name, 40);
    if (raw) return { url: telegramLink(m, raw), words: { say: "tg.done.to", open: "tg.open", vars: { name: who || `@${raw}` } } };
    return { url: telegramLink(m), words: { say: who ? "tg.pick.to" : "tg.pick", open: "tg.open", ...(who ? { vars: { name: who } } : {}) } };
  },
  recipient(a) {
    const username = tgUser(a.username);
    return TG_USER.test(username) ? { username } : null;
  },
}];

const PHONE: Spec[] = [
  {
    tool: tool("call",
      "Open the phone's dialer with a number, for the person to tap Call. Phone only. Use only a number they said.",
      { number: str("The number to call, as they said it."), name: WHO },
      ["number"], true),
    make(a) {
      const n = dialNumber(a.number);
      if (!n) throw rejected(given(a.number) ? `"${spoken(String(a.number), 30)}" doesn't look like a phone number. What's the number?` : "What number should I call?");
      return { url: telLink(n), words: { say: "call.done", open: "call.open", vars: { name: line(a.name, 40) || n } } };
    },
    recipient(a) {
      const n = dialNumber(a.number);
      return n ? { phone: n } : null;
    },
  },
  {
    tool: tool("text",
      "Open the phone's Messages with a text written, for the person to send. Phone only. Without a number they pick who it is for.",
      { body: str("The text, in the words they asked for."), number: str("Their number, only if the person said it."), name: WHO },
      ["body"], true),
    make(a) {
      const body = message(a.body, "Messages");
      const n = given(a.number) ? dialNumber(a.number) : undefined;
      if (n === null) throw rejected(`"${spoken(String(a.number), 30)}" doesn't look like a phone number. What's their number?`);
      const who = line(a.name, 40) || n;
      return { url: smsLink(body, n), words: who && n ? { say: "sms.done.to", open: "sms.open", vars: { name: who } } : { say: "sms.pick", open: "sms.open" } };
    },
    recipient(a) {
      const n = given(a.number) ? dialNumber(a.number) : null;
      return n ? { phone: n } : null;
    },
  },
];

// ------------------------------------------------------------------- money

/** A UPI ID: name@handle, as NPCI's apps write them. */
const VPA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

/** "500", "₹1,500.50", "Rs 200" -> "1500.50", or null. */
export function rupees(v: unknown): string | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.replace(/₹|rs\.?|inr|rupees?|,|\s/gi, "") : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= UPI_MAX_RUPEES ? n.toFixed(2) : null;
}

const UPI: Spec[] = [{
  tool: tool("pay",
    "Open the person's UPI app (Google Pay, PhonePe, Paytm, BHIM) with a payment filled in, for them to check and enter their own PIN. Tailzu pays nothing. Phone only. Needs the payee's UPI ID (name@bank) and the amount in rupees: if they gave no UPI ID, ASK for it, never make one up from a name or a number.",
    { vpa: str("The payee's UPI ID, like rahul@okhdfcbank, exactly as they gave it."), amount: str("Rupees, like 500 or 1250.50."), name: str("The payee's name, as they said it."), note: str("What it is for, a few words.") },
    ["vpa", "amount"], true),
  make(a) {
    const vpa = typeof a.vpa === "string" ? a.vpa.trim() : "";
    if (!VPA.test(vpa)) throw rejected(vpa ? `"${spoken(vpa, 40)}" doesn't look like a UPI ID. What's their UPI ID, like name@bank?` : "What's their UPI ID, like name@bank?");
    const amount = rupees(a.amount);
    if (!amount) throw rejected(`How much should I fill in? Up to ₹${UPI_MAX_RUPEES.toLocaleString("en-IN")}.`);
    const name = line(a.name, 50);
    const note = line(a.note, 50);
    return {
      url: upiLink({ vpa, name: name || vpa, amount, ...(note ? { note } : {}) }),
      words: { say: "upi.done", open: "upi.open", vars: { name: name || vpa, amount: amount.replace(/\.00$/, "") } },
    };
  },
  recipient(a) {
    const vpa = typeof a.vpa === "string" ? a.vpa.trim() : "";
    return VPA.test(vpa) ? { vpa } : null;
  },
}];

// ------------------------------------------------------------- going places

const MODES = ["driving", "walking", "bicycling", "two-wheeler", "transit"] as const;

const MAPS: Spec[] = [
  {
    tool: tool("directions",
      "Open Google Maps with directions from where the person is to a place.",
      { destination: str("Where to, as they said it."), mode: { type: "string", enum: [...MODES], description: "How they are going, only if they said." } },
      ["destination"]),
    make(a) {
      const place = query(a.destination, "Where to?");
      const mode = MODES.find((m) => m === a.mode);
      return { url: directionsLink(place, mode), words: { say: "maps.dir", open: "maps.open", vars: { place: spoken(place) } } };
    },
  },
  {
    tool: tool("search",
      "Open Google Maps on a place or a search (\"chai near me\", \"Phoenix Mall\").",
      { query: str("What to find, as they said it.") },
      ["query"]),
    make(a) {
      const q = query(a.query, "What should I look for in Maps?");
      return { url: mapSearchLink(q), words: { say: "maps.find", open: "maps.open", vars: { place: spoken(q) } } };
    },
  },
];

const UBER: Spec[] = [{
  tool: tool("ride",
    "Open Uber with a ride from where the person is to a place, for them to pick the ride and book it.",
    { destination: str("Where to, as they said it.") },
    ["destination"]),
  make(a) {
    const place = query(a.destination, "Where should the ride go?");
    return { url: uberLink(place), words: { say: "uber.done", open: "uber.open", vars: { place: spoken(place) } } };
  },
}];

/** Hotel dates: what they said ("tomorrow", "25 dec", "2026-12-25") as YYYY-MM-DD, or null. */
function dayOf(v: unknown, o: Required<HandoffOptions>): string | null {
  const w = parseWhen(v, o.tz, o.now());
  return w ? dateOf(w.ms, o.tz) : null;
}

const BOOKING: Spec[] = [{
  tool: tool("hotels",
    "Open Booking.com on hotels in a place, for the person to pick one and book it.",
    { city: str("Where, as they said it."), checkin: str("The day they arrive, as they said it (\"tomorrow\", \"25 dec\")."), checkout: str("The day they leave, as they said it."), guests: { type: "number", description: "How many adults, only if they said." } },
    ["city"]),
  make(a, o) {
    const place = query(a.city, "Hotels where?");
    const checkin = given(a.checkin) ? dayOf(a.checkin, o) : undefined;
    let checkout = given(a.checkout) ? dayOf(a.checkout, o) : undefined;
    if (checkin === null || checkout === null) throw rejected("Which days? Say them like \"25 December\" or \"tomorrow\".");
    // One night when only the first day was said; a stay that ends before it starts is asked about.
    if (checkin && !checkout) checkout = dateOf(Date.parse(`${checkin}T12:00:00Z`) + DAY, "UTC");
    if (checkin && checkout && checkout <= checkin) throw rejected("The day you leave is before the day you arrive. Which days?");
    const guests = given(a.guests) ? Math.round(Number(a.guests)) : undefined;
    const fine = guests === undefined || (guests >= 1 && guests <= GUESTS_MAX);
    return {
      url: bookingLink({ place, ...(checkin ? { checkin } : {}), ...(checkout && checkin ? { checkout } : {}), ...(fine && guests ? { guests } : {}) }),
      words: { say: "booking.done", open: "booking.open", vars: { place: spoken(place) } },
    };
  },
}];

// --------------------------------------------------------- finding and playing

function search(name: string, description: string, link: (q: string) => string, say: WordKey, open: WordKey, ask: string): Spec {
  return {
    tool: tool(name, description, { query: str("What to look for, as they said it.") }, ["query"]),
    make: (a) => {
      const q = query(a.query, ask);
      return { url: link(q), words: { say, open, vars: { query: spoken(q) } } };
    },
  };
}

const SHOPPING: Spec[] = [
  search("amazon_search", "Open Amazon India's search for something to buy, for the person to pick and order it.", amazonLink, "shop.amazon", "shop.open.amazon", "What should I look for on Amazon?"),
  search("flipkart_search", "Open Flipkart's search for something to buy, for the person to pick and order it.", flipkartLink, "shop.flipkart", "shop.open.flipkart", "What should I look for on Flipkart?"),
];

const PLAY: Spec[] = [
  search("youtube", "Open YouTube's search for a video or song, for the person to tap the one they want.", youtubeLink, "play.yt", "play.open.yt", "What should I find on YouTube?"),
  search("youtube_music", "Open YouTube Music's search for a song, an artist or an album.", youtubeMusicLink, "play.ytm", "play.open.ytm", "What should I play?"),
  search("spotify", "Open Spotify's search for a song, an artist, an album or a podcast.", spotifyLink, "play.spotify", "play.open.spotify", "What should I play?"),
];

const THREADS: Spec[] = [{
  tool: tool("post",
    "Open Threads with a post written, for the person to check and post. Nothing is posted until they press Post.",
    { text: str(`The post, in the words they asked for, at most ${POST_MAX} characters.`) },
    ["text"]),
  make(a) {
    const post = text(a.text);
    if (!post) throw rejected("What should the post say?");
    if (post.length > POST_MAX) throw rejected(`That's longer than a Threads post can be (${POST_MAX} characters). Ask me for a shorter one.`);
    return { url: threadsLink(post), words: { say: "threads.done", open: "threads.open" } };
  },
}];

// ------------------------------------------------------------------ assembled

/** The hand-off apps by catalog id, with the name a refusal uses. */
const APPS: Record<string, { name: string; specs: Spec[] }> = {
  whatsapp: { name: "WhatsApp", specs: WHATSAPP },
  telegram: { name: "Telegram", specs: TELEGRAM },
  phone: { name: "Phone", specs: PHONE },
  upi: { name: "UPI", specs: UPI },
  maps: { name: "Google Maps", specs: MAPS },
  uber: { name: "Uber", specs: UBER },
  shopping: { name: "Shopping", specs: SHOPPING },
  play: { name: "Play", specs: PLAY },
  threads: { name: "Threads", specs: THREADS },
  booking: { name: "Booking.com", specs: BOOKING },
};

export const HANDOFF_IDS: readonly string[] = Object.keys(APPS);

/** The hand-off app behind a catalog id, or undefined when it is not one. */
export function handoffApp(id: string, options: HandoffOptions = {}): NativeConnector | undefined {
  const app = APPS[id];
  if (!app) return undefined;
  const o: Required<HandoffOptions> = { now: options.now ?? Date.now, tz: options.tz ?? "Asia/Kolkata" };
  const tools = app.specs.map((s) => s.tool);
  return {
    tools: () => tools,
    async call(_userId: string, name: string, args: Args) {
      const spec = app.specs.find((s) => s.tool.name === name);
      if (!spec) throw rejected(`${app.name} doesn't have an action called ${name.slice(0, 40)}.`);
      const made = spec.make(args ?? {}, o);
      // Every tool keeps within its link's limit; one that did not is said as too long, never failed later as a bug.
      if (tooLong(made.url)) throw rejected(`That's too long for me to open in ${app.name}. Ask me for a shorter one.`);
      return { ok: true, text: en(made.words.say, made.words.vars), open: { url: made.url, label: en(made.words.open), words: made.words } };
    },
    recipientSaid(name: string, args: Args, words: string) {
      const r = app.specs.find((s) => s.tool.name === name)?.recipient?.(args ?? {});
      return !r || recipientIn(r, words);
    },
  };
}
