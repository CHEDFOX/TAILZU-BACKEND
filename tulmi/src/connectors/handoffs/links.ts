/**
 * THE HAND-OFF LINKS: the only links Tailzu ever opens for a person, and the
 * code that writes them.
 *
 * A hand-off is the other app opened with everything filled in: a WhatsApp
 * chat with the message written, the UPI app with the amount, Google Maps
 * with the route. Tailzu sends nothing and pays nothing; the person reads it
 * there and presses Send, Pay or Book themselves.
 *
 * Every word that goes into a link is percent-encoded (encodeURIComponent), so
 * nothing in a message can add a parameter, end one or move the link to
 * another host, and each is cut to what the other app takes. `linkKind` is the
 * last lock before a link leaves the server: a link not on LINKS is a bug and
 * is never sent, and a phone's own link (tel:, sms:, upi:) never goes to a
 * computer, which could not open it.
 *
 * Formats were read from each vendor's docs on 2026-10-22, where they have
 * any; the ones that are not documented say so beside their builder, and in
 * DEPLOY.md. Vendors move these: try each on a phone before relying on it.
 */

/** Where a link may be opened: anywhere, or only on a phone. */
export type LinkKind = "any" | "phone";

/**
 * The longest a hand-off link may be: what the desktop opens (agent.js
 * OPEN_URL_MAX) and the phone too. A message or an email in Hindi is a long
 * link, since each of its letters is nine characters once encoded.
 */
export const LINK_MAX = 8000;
/** Google Maps URLs are limited to 2,048 characters (Maps URLs docs). */
export const MAPS_LINK_MAX = 2048;

/** Each link on the list: its pattern, where it opens, and, when it is shorter than LINK_MAX, its own limit. */
const LINKS: ReadonlyArray<readonly [RegExp, LinkKind, number?]> = [
  [/^https:\/\/wa\.me\/(?:\d{6,15})?\?text=/, "any"],
  [/^https:\/\/api\.whatsapp\.com\/send\?/, "any"],
  [/^https:\/\/t\.me\/share\/url\?url=/, "any"],
  [/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,31}(?:\?text=|$)/, "any"],
  [/^tel:\+?\d{3,15}$/, "phone"],
  [/^sms:(?:\+?\d{3,15})?\?body=/, "phone"],
  [/^upi:\/\/pay\?pa=/, "phone"],
  [/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/, "any", MAPS_LINK_MAX],
  [/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&/, "any", MAPS_LINK_MAX],
  [/^https:\/\/m\.uber\.com\/ul\/\?/, "any"],
  [/^https:\/\/www\.amazon\.in\/s\?k=/, "any"],
  [/^https:\/\/www\.flipkart\.com\/search\?q=/, "any"],
  [/^https:\/\/www\.youtube\.com\/results\?search_query=/, "any"],
  [/^https:\/\/music\.youtube\.com\/search\?q=/, "any"],
  // One path segment, and never "." or ".." (spelled out or encoded), which a URL parser would walk out of /search/ on.
  [/^https:\/\/open\.spotify\.com\/search\/(?!(?:\.|%2[eE]){1,2}$)[^/?#]+$/, "any"],
  [/^https:\/\/www\.threads\.(?:com|net)\/intent\/post\?text=/, "any"],
  [/^https:\/\/www\.booking\.com\/searchresults\.html\?/, "any"],
  [/^https:\/\/mail\.google\.com\/mail\/\?view=cm&/, "any"],
  [/^mailto:/, "any"],
];

/**
 * Where this link may be opened, or null when it is not one of ours. A link
 * with a space, a line break or anything below U+0021 in it was not encoded,
 * so it is refused whatever it starts with.
 */
export function linkKind(url: unknown): LinkKind | null {
  if (typeof url !== "string" || !url || url.length > LINK_MAX || /[\u0000- \u007f-\u009f]/.test(url)) return null;
  const hit = LINKS.find(([re]) => re.test(url));
  if (!hit || url.length > (hit[2] ?? LINK_MAX)) return null;
  // A web link must also read as one, with the host its pattern names.
  if (url.startsWith("https://")) {
    try { if (new URL(url).protocol !== "https:") return null; } catch { return null; }
  }
  return hit[1];
}

/** A link longer than its kind takes: the tool that wrote it says so, rather than the run failing it as a bug. */
export function tooLong(url: string): boolean {
  const hit = LINKS.find(([re]) => re.test(url));
  return url.length > (hit?.[2] ?? LINK_MAX);
}

/** The two platforms a phone's own links open on. */
export const onPhone = (platform: string | undefined): boolean => platform === "ios" || platform === "android";

const enc = encodeURIComponent;

/** One line of text, cut to `max`: for a search, a place, a name. */
export const line = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();

/** A message with its line breaks kept, nothing else invisible: for a chat, a text, a post. */
export const text = (v: unknown): string =>
  (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+\n/g, "\n").trim();

/**
 * A phone number as digits with the country code, or null. Ten digits are an
 * Indian mobile (+91), and so is a leading 0 before them; + or 00 starts an
 * international number. Spaces, dashes, dots and brackets are dropped.
 */
export function phoneDigits(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!/^[+\d][\d\s().-]*$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  if (digits.startsWith("00")) return digits.length - 2 >= 8 && digits.length - 2 <= 15 ? digits.slice(2) : null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/**
 * A number to dial: a full number with its country code, or, as it is, a
 * short service number (100, 112, 139) or an Indian toll-free one (1800…,
 * 1860…), which a country code would send abroad.
 */
export function dialNumber(raw: unknown): string | null {
  const s = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!/^[+\d][\d\s().-]*$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (!s.startsWith("+") && (/^\d{3,8}$/.test(digits) || /^18[06]0\d{6,8}$/.test(digits))) return digits;
  const full = phoneDigits(s);
  return full ? `+${full}` : null;
}

// ------------------------------------------------------------------ the links

/** WhatsApp's click to chat: the chat with this number, or with no number WhatsApp's own chat picker. */
export const whatsappLink = (message: string, digits?: string): string => `https://wa.me/${digits ?? ""}?text=${enc(message)}`;

/**
 * Telegram: a person's or group's chat by username, with the message as its
 * draft (t.me/<username>?text=), or the share sheet, which asks which chat.
 * The share link's `url` is its one required field and goes first in the text
 * box, so a message with no link of its own is the `url` (core.telegram.org/api/links).
 */
export const telegramLink = (message: string, username?: string): string =>
  username ? `https://t.me/${username}?text=${enc(message)}` : `https://t.me/share/url?url=${enc(message)}`;

/** A call (RFC 3966). The phone asks before it dials. */
export const telLink = (number: string): string => `tel:${number}`;

/**
 * A text message (RFC 5724, sms:<number>?body=). With no number the phone asks
 * who it is for; the phone app's own `sms` action writes the same link.
 */
export const smsLink = (body: string, number?: string): string => `sms:${number ?? ""}?body=${enc(body)}`;

/**
 * A UPI payment (NPCI's UPI linking specification: upi://pay?pa=&pn=&am=&cu=&tn=).
 * The VPA was checked to be letters, digits, . - _ and one @, and keeps its @:
 * it is legal in a query, and a UPI app that does not decode %40 would not
 * find the payee. Some UPI apps decline a prefilled payment to a personal UPI
 * ID (one that is not a merchant's); the PIN is always the person's, typed in
 * their own UPI app.
 */
export const upiLink = (p: { vpa: string; name: string; amount: string; note?: string }): string =>
  `upi://pay?pa=${enc(p.vpa).replace("%40", "@")}&pn=${enc(p.name)}&am=${p.amount}&cu=INR${p.note ? `&tn=${enc(p.note)}` : ""}`;

/** Google Maps URLs (api=1), directions from where they are. */
export const directionsLink = (destination: string, mode?: string): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${enc(destination)}${mode ? `&travelmode=${mode}` : ""}`;

/** Google Maps URLs (api=1), a search or a place. */
export const mapSearchLink = (query: string): string => `https://www.google.com/maps/search/?api=1&query=${enc(query)}`;

/**
 * Uber's universal link, pickup where they are. Uber's deep-link page now
 * documents uber://?action=setPickup&pickup=my_location&dropoff[...] and the
 * universal link https://m.uber.com/looking?drop[0]=<Location JSON>, both with
 * coordinates; m.uber.com/ul/ is the older universal link, still widely used,
 * and a drop given only as an address is not documented. The brackets are
 * encoded so every phone's URL parser takes the link.
 */
export const uberLink = (destination: string): string =>
  `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=${enc(destination)}`;

/** Amazon India's search page. Not documented by Amazon; it is the address its own search box goes to. */
export const amazonLink = (query: string): string => `https://www.amazon.in/s?k=${enc(query)}`;

/** Flipkart's search page. Not documented by Flipkart; it is the address its own search box goes to. */
export const flipkartLink = (query: string): string => `https://www.flipkart.com/search?q=${enc(query)}`;

/** YouTube's search results. Not documented as a link format; it is YouTube's own search address. */
export const youtubeLink = (query: string): string => `https://www.youtube.com/results?search_query=${enc(query)}`;

/** YouTube Music's search. Not documented; it is the app's own search address. */
export const youtubeMusicLink = (query: string): string => `https://music.youtube.com/search?q=${enc(query)}`;

/** Spotify's search on the web player, which hands over to the app. Not documented; it is Spotify's own search address. */
export const spotifyLink = (query: string): string => `https://open.spotify.com/search/${enc(query)}`;

/** Threads' post web intent (Meta's Threads Web Intents page names threads.com). On a phone it opens the Threads app. */
export const threadsLink = (post: string): string => `https://www.threads.com/intent/post?text=${enc(post)}`;

/**
 * Booking.com's search results for a place. Not documented publicly; these are
 * the parameters its own search form sends (ss, checkin, checkout as
 * YYYY-MM-DD, group_adults, no_rooms).
 */
export function bookingLink(p: { place: string; checkin?: string; checkout?: string; guests?: number }): string {
  const q = [`ss=${enc(p.place)}`];
  if (p.checkin) q.push(`checkin=${p.checkin}`);
  if (p.checkout) q.push(`checkout=${p.checkout}`);
  if (p.guests) q.push(`group_adults=${p.guests}`, "no_rooms=1");
  return `https://www.booking.com/searchresults.html?${q.join("&")}`;
}
