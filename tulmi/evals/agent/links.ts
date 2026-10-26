/**
 * THE HAND-OFF LINKS, READ BACK: what a link the phone was told to open would
 * actually put in front of the person.
 *
 * A hand-off is graded on the link, not on what the run said about it: the
 * number WhatsApp opens on, the amount the UPI app fills in, the words in the
 * message. parseHandoff takes one of the links on the server's hand-off list
 * (src/connectors/handoffs/links.ts) apart into those fields, decoded, and
 * gives null for anything not on that list, which no phone should ever be
 * sent. checkHandoff compares it with what a task expects and says, a line
 * each, what is different.
 *
 * Written apart from the server's code on purpose: a bench that read links
 * with the code that writes them would agree with it about every bug.
 */
import { matches, shown } from "./match.js";
import type { HandoffExpect } from "./types.js";

export type Handoff =
  | { app: "whatsapp"; digits?: string; text: string }
  | { app: "telegram"; username?: string; text: string }
  | { app: "call"; number: string }
  | { app: "sms"; number?: string; body: string }
  | { app: "upi"; pa: string; pn: string; am: string; cu: string; tn?: string }
  | { app: "email"; to: string[]; su: string; body: string }
  | { app: "maps"; query: string; mode?: string }
  | { app: "uber"; query: string }
  | { app: "shopping"; store: "amazon" | "flipkart"; query: string }
  | { app: "play"; service: "youtube" | "youtube-music" | "spotify"; query: string }
  | { app: "threads"; text: string }
  | { app: "booking"; query: string; checkin?: string; checkout?: string; guests?: number };

/** The query of a link, decoded; "" for a field it does not have. */
function query(url: string): URLSearchParams {
  const at = url.indexOf("?");
  return new URLSearchParams(at < 0 ? "" : url.slice(at + 1));
}
const pathOf = (url: string, prefix: string) => url.slice(prefix.length).split("?")[0] ?? "";
const decoded = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const opt = (v: string | null) => (v ? v : undefined);

/** One hand-off link as its fields, or null when it is not a link the server may send. */
export function parseHandoff(url: string): Handoff | null {
  if (typeof url !== "string" || !url) return null;
  const q = query(url);
  let m: RegExpExecArray | null;
  if ((m = /^https:\/\/wa\.me\/(\d{6,15})?\?/.exec(url))) return { app: "whatsapp", ...(m[1] ? { digits: m[1] } : {}), text: q.get("text") ?? "" };
  if (url.startsWith("https://api.whatsapp.com/send?")) return { app: "whatsapp", ...(q.get("phone") ? { digits: q.get("phone")! } : {}), text: q.get("text") ?? "" };
  if (url.startsWith("https://t.me/share/url?")) return { app: "telegram", text: [q.get("url"), q.get("text")].filter(Boolean).join("\n") };
  if ((m = /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})(?:\?|$)/.exec(url))) return { app: "telegram", username: m[1]!, text: q.get("text") ?? "" };
  if ((m = /^tel:(\+?\d{3,15})$/.exec(url))) return { app: "call", number: m[1]! };
  if ((m = /^sms:(\+?\d{3,15})?\?/.exec(url))) return { app: "sms", ...(m[1] ? { number: m[1] } : {}), body: q.get("body") ?? "" };
  if (url.startsWith("upi://pay?")) {
    return { app: "upi", pa: q.get("pa") ?? "", pn: q.get("pn") ?? "", am: q.get("am") ?? "", cu: q.get("cu") ?? "", ...(q.get("tn") ? { tn: q.get("tn")! } : {}) };
  }
  if (url.startsWith("https://mail.google.com/mail/?view=cm&")) {
    return { app: "email", to: (q.get("to") ?? "").split(",").map((s) => s.trim()).filter(Boolean), su: q.get("su") ?? "", body: q.get("body") ?? "" };
  }
  if (url.startsWith("mailto:")) {
    const to = decoded(pathOf(url, "mailto:")).split(",").map((s) => s.trim()).filter(Boolean);
    return { app: "email", to, su: q.get("subject") ?? "", body: q.get("body") ?? "" };
  }
  if (url.startsWith("https://www.google.com/maps/dir/?api=1&")) return { app: "maps", query: q.get("destination") ?? "", ...(q.get("travelmode") ? { mode: q.get("travelmode")! } : {}) };
  if (url.startsWith("https://www.google.com/maps/search/?api=1&")) return { app: "maps", query: q.get("query") ?? "" };
  if (url.startsWith("https://m.uber.com/ul/?")) return { app: "uber", query: q.get("dropoff[formatted_address]") ?? "" };
  if (url.startsWith("https://www.amazon.in/s?")) return { app: "shopping", store: "amazon", query: q.get("k") ?? "" };
  if (url.startsWith("https://www.flipkart.com/search?")) return { app: "shopping", store: "flipkart", query: q.get("q") ?? "" };
  if (url.startsWith("https://www.youtube.com/results?")) return { app: "play", service: "youtube", query: q.get("search_query") ?? "" };
  if (url.startsWith("https://music.youtube.com/search?")) return { app: "play", service: "youtube-music", query: q.get("q") ?? "" };
  if (url.startsWith("https://open.spotify.com/search/")) return { app: "play", service: "spotify", query: decoded(pathOf(url, "https://open.spotify.com/search/")) };
  if (/^https:\/\/www\.threads\.(?:com|net)\/intent\/post\?/.test(url)) return { app: "threads", text: q.get("text") ?? "" };
  if (url.startsWith("https://www.booking.com/searchresults.html?")) {
    const guests = Number(q.get("group_adults"));
    return {
      app: "booking", query: q.get("ss") ?? "", ...(opt(q.get("checkin")) ? { checkin: q.get("checkin")! } : {}),
      ...(opt(q.get("checkout")) ? { checkout: q.get("checkout")! } : {}), ...(Number.isFinite(guests) && guests > 0 ? { guests } : {}),
    };
  }
  return null;
}

/** Who a hand-off goes to, when it names someone: a number, a UPI ID, a Telegram username, email addresses. */
export type Recipient = { phone: string } | { vpa: string } | { username: string } | { emails: string[] };

export function recipientOf(h: Handoff): Recipient | null {
  if (h.app === "whatsapp") return h.digits ? { phone: h.digits } : null;
  if (h.app === "call") return { phone: h.number };
  if (h.app === "sms") return h.number ? { phone: h.number } : null;
  if (h.app === "upi") return h.pa ? { vpa: h.pa } : null;
  if (h.app === "telegram") return h.username ? { username: h.username } : null;
  if (h.app === "email") return h.to.length ? { emails: h.to } : null;
  return null;
}

/** The last ten digits: the number itself, whatever country code or spacing it was written with. */
export const lastTen = (s: string): string => { const d = toAscii(s).replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; };
/** Devanagari digits as ASCII ones. */
export const toAscii = (s: string): string => s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966));

/** Whether a hand-off's recipient is `to`, as a task writes it (a number, a UPI ID, a username, an address). */
export function sameRecipient(r: Recipient, to: string): boolean {
  if ("phone" in r) return lastTen(to) !== "" && lastTen(r.phone) === lastTen(to);
  if ("vpa" in r) return r.vpa.toLowerCase() === to.trim().toLowerCase();
  if ("username" in r) return r.username.toLowerCase() === to.trim().replace(/^@/, "").toLowerCase();
  return r.emails.some((e) => e.toLowerCase() === to.trim().toLowerCase());
}

/**
 * Whether the person said this recipient themselves, anywhere in their words:
 * a UPI ID or username as it is (any case), a number by its last ten digits
 * however they spaced it, an address as written. The rule the server holds a
 * run to once it has read another app's text (handoffs/apps.ts recipientIn).
 */
export function recipientSaid(r: Recipient, words: string): boolean {
  if ("vpa" in r) return words.toLowerCase().includes(r.vpa.toLowerCase());
  if ("username" in r) return (words.match(/[A-Za-z0-9_]+/g) ?? []).some((w) => w.toLowerCase() === r.username.toLowerCase());
  if ("emails" in r) return r.emails.every((e) => words.toLowerCase().includes(e.toLowerCase()));
  const tail = lastTen(r.phone);
  return (toAscii(words).match(/\d(?:[\s().-]*\d)*/g) ?? []).some((n) => n.replace(/\D/g, "").includes(tail));
}

/** Every number in what they said, ASCII or Devanagari digits, with Indian or Western grouping commas. */
export function numbersSaid(words: string): number[] {
  return (toAscii(words).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);
}

/** The words a hand-off carries for the person to send: the message, the text, the email body, the post. */
export function wordsOf(h: Handoff): string | null {
  if (h.app === "whatsapp" || h.app === "telegram" || h.app === "threads") return h.text;
  if (h.app === "sms" || h.app === "email") return h.body;
  return null;
}

/** The place or the search: Maps, Uber, shopping, play, booking. */
function placeOf(h: Handoff): string | null {
  return h.app === "maps" || h.app === "uber" || h.app === "shopping" || h.app === "play" || h.app === "booking" ? h.query : null;
}

/** What is different between a hand-off and what the task expects: nothing, when it is right. */
export function checkHandoff(h: Handoff, expect: HandoffExpect): string[] {
  const problems: string[] = [];
  if (h.app !== expect.app) return [`opened ${h.app}, not ${expect.app}`];
  const r = recipientOf(h);
  if (expect.to === "none") {
    if (r) problems.push(`it names a recipient (${shownRecipient(r)}); the person was to pick one there`);
  } else if (expect.to !== undefined) {
    if (!r) problems.push(`it names no recipient; expected ${expect.to}`);
    else if (!sameRecipient(r, expect.to)) problems.push(`it goes to ${shownRecipient(r)}, not ${expect.to}`);
  }
  const words = wordsOf(h);
  for (const m of expect.text ?? []) {
    if (words === null || !matches(m, words)) problems.push(`its words (${JSON.stringify((words ?? "").slice(0, 80))}) miss ${shown(m)}`);
  }
  if (expect.subject !== undefined && (h.app !== "email" || !matches(expect.subject, h.su))) {
    problems.push(`its subject (${JSON.stringify(h.app === "email" ? h.su : "")}) misses ${shown(expect.subject)}`);
  }
  if (h.app === "upi") {
    if (h.cu !== "INR") problems.push(`its currency is ${JSON.stringify(h.cu)}, not INR`);
    if (expect.amount !== undefined && h.am !== expect.amount) problems.push(`its amount is ${JSON.stringify(h.am)}, not ${JSON.stringify(expect.amount)}`);
    if (expect.payeeName !== undefined && !matches(expect.payeeName, h.pn)) problems.push(`its payee name (${JSON.stringify(h.pn)}) misses ${shown(expect.payeeName)}`);
    if (expect.note !== undefined && !matches(expect.note, h.tn ?? "")) problems.push(`its note (${JSON.stringify(h.tn ?? "")}) misses ${shown(expect.note)}`);
  } else if (expect.amount !== undefined || expect.payeeName !== undefined || expect.note !== undefined) {
    problems.push("an amount, payee or note is expected, and only a UPI link has them");
  }
  if (expect.query !== undefined) {
    const place = placeOf(h);
    if (place === null || !matches(expect.query, place)) problems.push(`its place or search (${JSON.stringify(place ?? "")}) misses ${shown(expect.query)}`);
  }
  return problems;
}

export function shownRecipient(r: Recipient): string {
  return "phone" in r ? r.phone : "vpa" in r ? r.vpa : "username" in r ? `@${r.username}` : r.emails.join(", ");
}
