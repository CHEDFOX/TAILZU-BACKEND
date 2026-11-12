/**
 * FOLLOW-THROUGH'S REAL PHONE CALL: ITS WORDS AND ITS PURE PARTS (CHANNEL_PHONE_CALLS; botsBots/followPhone.ts, docs/follow-channels.md).
 * Nothing here reads the clock, the network or a table.
 *
 *   promptWords / afterKeyWords / ...   every line X0 says on a call, in English and Hindi: fixed words, never written by an AI. The item's
 *                                       title arrives already through forOthers (no amount, no health or medicine title: a call may be on
 *                                       speaker); every name, title and clock put into a line goes through lockSafe again here, and every
 *                                       prompt offers 9 to stop
 *   keyAnswer                           the keypad: 1 done, 2 later, 3 can't, 9 stop
 *   promptXml / sayXml / hangupXml      the Plivo XML a callback answers with (every text and URL escaped)
 *   v3Base / v3Sign / v3Ok              Plivo's request signature (X-Plivo-Signature-V3), exactly as Plivo's own SDKs build it, compared in
 *                                       constant time
 *   plivoNumber / maskNumber / spacedNumber / prefixAllowed / quietFor   numbers as Plivo sends them, as a person sees them, and when a
 *                                       call may not go
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { inQuietHours, type NotifySettings } from "../you/settings.js";
import { cutAt, lockSafe } from "./planSafe.js";

/** The wording version kept with every yes to real calls (plan_phones.consent[].v). Bump it when the words below that ask for it change. */
export const PHONE_CONSENT_V = 2;
export type PhoneLang = "en" | "hi";
export type KeyAnswer = "done" | "later" | "cant" | "stop";

/** A person with no quiet hours of their own is never called for real between 10 pm and 7 am. */
export const NIGHT_FROM = 22 * 60;
export const NIGHT_TO = 7 * 60;

/** The keypad: 1 done, 2 later, 3 can't, 9 stop these calls; anything else is null (asked again once). */
export function keyAnswer(digits: unknown): KeyAnswer | null {
  const d = typeof digits === "string" ? digits.trim() : "";
  return d === "1" ? "done" : d === "2" ? "later" : d === "3" ? "cant" : d === "9" ? "stop" : null;
}

// ------------------------------------------------------------------ what X0 says

/** One spoken line, on one line. The fixed words are ours; only what goes into them (below) is cleaned, so "press 1" is never touched. */
const line = (s: string): string => s.replace(/\s+/g, " ").trim();
/** A name or a title inside a line: one line, short, no amount (lockSafe), no markup. */
const bit = (s: string, max: number): string => cutAt(lockSafe(s.replace(/[<>&"]/g, " "), max), max);

export interface PromptIn {
  /** The asker's first name when the item is someone else's; "" for the person's own. */
  asker: string;
  /** forOthers(title): "" for a health-looking title. */
  what: string;
  /** whenWords(...): "9 pm", "Thu 9 pm", "today". */
  when: string;
  lang: PhoneLang;
}

/** "your 9 pm reminder", "today's reminder": what a reminder with no sayable title is called. */
const theReminder = (when: string): string => (when === "today" ? "today's reminder" : `your ${when} reminder`);

/** The call's opening, with the keys. Every prompt offers 9 to stop (a call is a message too). */
export function promptWords(o: PromptIn): string {
  const asker = bit(o.asker, 24), what = bit(o.what, 60), when = bit(o.when, 24);
  if (o.lang === "hi") {
    const lead = asker
      ? `${asker} ने आपको याद दिलाने को कहा है: ${what || "आपका रिमाइंडर"}, ${when}।`
      : `आपका रिमाइंडर: ${what || "आपका रिमाइंडर"}, ${when}।`;
    return line(`नमस्ते, यह X0 है। ${lead} हो गया हो तो 1 दबाएँ। बाद में के लिए 2। नहीं हो पाएगा तो 3। ये कॉल बंद करने के लिए 9 दबाएँ।`);
  }
  const lead = asker
    ? (what ? `${asker} asked me to remind you: ${what}, ${when}.` : `${asker} asked me to remind you about ${theReminder(when)}.`)
    : (what ? `It's time for ${what}, ${when}.` : `It's time for ${theReminder(when)}.`);
  return line(`Hello, this is X0. ${lead} If it's done, press 1. For later, press 2. If you can't, press 3. To stop these calls, press 9.`);
}

/** The prompt again after a key that means nothing. */
export function againWords(o: PromptIn): string {
  return line(`${o.lang === "hi" ? "माफ़ कीजिए, समझ नहीं आया।" : "Sorry, I didn't get that."} ${promptWords(o)}`);
}

/** What X0 says after an answer, by what the one reply door did with it. */
export type AfterKey =
  | { k: "done"; asker: string }
  | { k: "later"; clock: string }
  | { k: "last" }
  | { k: "passed"; to: string }
  | { k: "nobody"; asker: string }
  | { k: "dropped" }
  | { k: "already"; who: string }
  | { k: "moved" }
  | { k: "stop" };

export function afterKeyWords(a: AfterKey, lang: PhoneLang): string {
  const hi = lang === "hi";
  switch (a.k) {
    case "done": {
      const who = bit(a.asker, 24);
      return line(hi ? (who ? `धन्यवाद। मैं ${who} को बता दूँगा।` : "धन्यवाद। हो गया।") : (who ? `Thank you. I'll tell ${who}.` : "Thank you. That's done."));
    }
    case "later": {
      const clock = bit(a.clock, 24);
      return line(hi ? `ठीक है। मैं ${clock} पर फिर याद दिलाऊँगा।` : `Okay. I'll remind you at ${clock}.`);
    }
    case "last": return line(hi ? "यह आख़िरी बार था। X0 में बताइए, हो गया या नहीं हो पाएगा।" : "That was the last Later. Open X0 to say done, or that you can't.");
    case "passed": {
      const to = bit(a.to, 24);
      return line(hi ? `ठीक है। मैं ${to} से कहूँगा।` : `Okay. I'll ask ${to}.`);
    }
    case "nobody": {
      const who = bit(a.asker, 24);
      return line(hi ? (who ? `ठीक है। मैं ${who} को बता दूँगा।` : "ठीक है। मैं बता दूँगा।") : (who ? `Okay. I'll let ${who} know.` : "Okay. I'll let them know."));
    }
    case "dropped": return line(hi ? "ठीक है, इस बार नहीं।" : "Okay, not this time.");
    case "already": {
      const who = bit(a.who, 24);
      return line(hi ? "यह पहले ही हो चुका है। धन्यवाद।" : `${who ? `${who} already said done.` : "That's already done."} Thank you.`);
    }
    case "moved": return line(hi ? "यह रिमाइंडर अब बदल गया है। धन्यवाद।" : "That reminder has moved on. Thank you.");
    case "stop": return line(hi ? "ठीक है। X0 इस फ़ोन पर फिर कॉल नहीं करेगा। आप इसे X0 में फिर चालू कर सकते हैं।" : "Okay. X0 won't call this phone again. You can turn calls back on in X0.");
  }
}

/** The call was answered after the reminder closed or moved on (Done in the app while it rang). */
export function overWords(lang: PhoneLang): string {
  return lang === "hi" ? "नमस्ते, यह X0 है। यह रिमाइंडर अब खुला नहीं है। धन्यवाद।" : "Hello, this is X0. That reminder isn't open any more. Thank you.";
}

/** The number's own lines, when someone calls X0's number (the proof that a number is theirs). English: the caller is not known yet. */
export const INBOUND = {
  unknown: "This number only makes reminder calls for X0. Goodbye.",
  prove: "This is X0. To let X0 call this phone when you miss something important, type the 4 digit code shown in your X0 app now. X0 never calls in your quiet hours.",
  proved: "You're set. X0 may call this phone when you miss something important. To stop, press 9 on any call from X0, or turn it off in X0.",
  wrong: "That code doesn't match. Check the code in your X0 app, then call once more. Goodbye.",
  late: "That took too long. Add your number again in X0, then call once more. Goodbye.",
  already: "This phone is already set up for X0's calls. To stop them, press 9.",
  stopped: "Okay. X0 won't call this phone again. You can turn calls back on in X0.",
  bye: "Okay. Nothing has changed. Goodbye.",
} as const;

// ------------------------------------------------------------------ Plivo XML

export interface Voices { en: string; hi: string }
/** Text inside an element: &, < and > escaped. An attribute (always in double quotes): the double quote too. */
const escText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => escText(s).replace(/"/g, "&quot;");
const LANG_TAG: Record<PhoneLang, string> = { en: "en-IN", hi: "hi-IN" };

function speakXml(words: string, lang: PhoneLang, voices: Voices): string {
  return `<Speak voice="${escAttr(voices[lang])}" language="${LANG_TAG[lang]}">${escText(words)}</Speak>`;
}

/**
 * Ask for one key (or `digits` keys: the setup code): the words inside GetInput (8 seconds after they end), then `fallback` when no key
 * came: a Redirect (the answer URL's second try, which hangs up) or, with none, a closing line and Hangup.
 */
export function promptXml(o: { words: string; action: string; lang: PhoneLang; voices: Voices; redirect?: string; closing?: string; digits?: number }): string {
  const after = o.redirect
    ? `<Redirect method="POST">${escText(o.redirect)}</Redirect>`
    : `${o.closing ? speakXml(o.closing, o.lang, o.voices) : ""}<Hangup/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><GetInput action="${escAttr(o.action)}" method="POST" inputType="dtmf" numDigits="${Math.max(1, Math.min(8, Math.floor(o.digits ?? 1)))}" executionTimeout="8" digitEndTimeout="auto" redirect="true">${speakXml(o.words, o.lang, o.voices)}</GetInput>${after}</Response>`;
}

/** Say one line, then hang up. */
export function sayXml(words: string, lang: PhoneLang, voices: Voices): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${speakXml(words, lang, voices)}<Hangup/></Response>`;
}

export function hangupXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}

// ------------------------------------------------------------------ Plivo's signature (V3)

export type Form = Record<string, string[]>;

/** A form body (application/x-www-form-urlencoded) as every value of every key; anything else is empty. */
export function formOf(raw: unknown): Form {
  const out: Form = {};
  if (typeof raw === "string") {
    for (const [k, v] of new URLSearchParams(raw)) (out[k] ??= []).push(v);
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const vals = Array.isArray(v) ? v : [v];
      for (const x of vals) if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") (out[k] ??= []).push(String(x));
    }
  }
  return out;
}
export const first = (f: Form, k: string): string => f[k]?.[0] ?? "";

/**
 * The string Plivo signs for a POST, as its SDKs build it: scheme://host/path, then "?" and the URL's query (keys sorted, "k=v" joined by
 * "&", decoded) when there is a query or a body, then "." when there are both, then the body (keys sorted, each value sorted, "kv" with
 * nothing between).
 */
export function v3Base(url: string, body: Form): string {
  const u = new URL(url);
  const q = new Map<string, string[]>();
  for (const [k, v] of u.searchParams) q.set(k, [...(q.get(k) ?? []), v]);
  const query = [...q.keys()].sort().flatMap((k) => [...q.get(k)!].sort().map((v) => `${k}=${v}`)).join("&");
  const keys = Object.keys(body).sort();
  const post = keys.flatMap((k) => [...body[k]!].sort().map((v) => `${k}${v}`)).join("");
  let s = `${u.protocol}//${u.host}${u.pathname}`;
  if (query || keys.length) s += `?${query}`;
  if (query && keys.length) s += ".";
  return s + post;
}

/** base64(HMAC-SHA256(auth token, base + "." + nonce)). */
export function v3Sign(token: string, base: string, nonce: string): string {
  return createHmac("sha256", token).update(`${base}.${nonce}`).digest("base64");
}

/**
 * Whether a callback is Plivo's: one of the comma-separated signatures matches, compared in constant time. Missing token, nonce or
 * signature is false.
 */
export function v3Ok(o: { url: string; body: Form; nonce: unknown; signatures: unknown; token: string | undefined }): boolean {
  if (!o.token || typeof o.nonce !== "string" || !o.nonce || typeof o.signatures !== "string" || !o.signatures) return false;
  let want: Buffer;
  try { want = Buffer.from(v3Sign(o.token, v3Base(o.url, o.body), o.nonce)); } catch { return false; }
  let ok = false;
  for (const s of o.signatures.split(",")) {
    const got = Buffer.from(s.trim());
    if (got.length === want.length && timingSafeEqual(got, want)) ok = true;
  }
  return ok;
}

// ------------------------------------------------------------------ numbers

/** A number as Plivo sends or keeps it ("918041234567", "+91 80 4123 4567") as "+<8–15 digits>"; null otherwise. */
export function plivoNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 32 || !/^\+?[\d\s().-]+$/.test(s)) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 && !d.startsWith("0") ? `+${d}` : null;
}

/** "+91 98••• ••210": enough for the person to know it's theirs, never the whole number. */
export function maskNumber(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("91") && d.length === 12) return `+91 ${d.slice(2, 4)}••• ••${d.slice(-3)}`;
  return `+${d.slice(0, 2)}•••${d.slice(-3)}`;
}

/** X0's own number as it is read: "+91 80412 34567" (an Indian number in two fives), else "+<digits>". */
export function spacedNumber(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.startsWith("91") && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
}

/** PLIVO_ALLOWED_PREFIXES ("+91", or "+91,+44"): whether a real call may go to this number. Nothing allowed is never allowed. */
export function prefixAllowed(e164: string, prefixes: string): boolean {
  const list = prefixes.split(",").map((p) => p.trim()).filter((p) => /^\+\d{1,6}$/.test(p));
  return list.some((p) => e164.startsWith(p));
}

/** Inside the person's own quiet hours, or, with none set, 10 pm to 7 am: no real call. */
export function quietFor(n: NotifySettings, minute: number): boolean {
  if (n.quiet && n.quietFrom !== n.quietTo) return inQuietHours(n, minute);
  return minute >= NIGHT_FROM || minute < NIGHT_TO;
}

/** What the setup screen says about when calls never come. */
export function quietLine(n: NotifySettings, clock: (minute: number) => string): string {
  return n.quiet && n.quietFrom !== n.quietTo
    ? `Never in your quiet hours (${clock(n.quietFrom)} to ${clock(n.quietTo)}).`
    : "Never between 10 pm and 7 am. Set quiet hours in What pings you to change that.";
}
