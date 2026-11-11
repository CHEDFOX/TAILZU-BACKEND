/**
 * WHEN AND WHERE SOMEONE WAS BORN, FROM THEIR OWN WORDS: "13 July 1994, 9:30 am, Mumbai", "born 1994-07-13 at 21:15 in Pune",
 * "13/07/1994 subah 9 baje Delhi". The same reading serves the chat and the Oracle's card (routes/bots/oracle.ts).
 *
 *   readBirth(words)  the date, the time if given, and the words for the place; never a model, the same answer for the same words
 *   skyOf(read, place)  what the oracle's engine is given: the local time at the place, which the engine turns into UT itself
 *
 * A date is read as day before month ("05/07/1994" is the 5th of July), as people in India and most of the world write it, unless the first number
 * cannot be a month. A time not given is noon, and says so (`timeKnown: false`): the reading is gentler about the hour then.
 */
import type { Place } from "../places/types.js";

export interface BirthRead {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeKnown: boolean;
  /** The words left for the place, if any. */
  placeWords: string;
}

/** What the oracle's engine reads (oracle-worker/server/answer.py Birth). */
export interface Sky {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  lat: number;
  lng: number;
  place: string;
  timeKnown: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
const YEAR = "(1[89]\\d\\d|20\\d\\d)";
const DATE_FORMS: Array<{ re: RegExp; read: (m: RegExpExecArray) => [number, number, number] }> = [
  { re: new RegExp(`\\b${YEAR}-(\\d{1,2})-(\\d{1,2})\\b`, "i"), read: (m) => [+m[1]!, +m[2]!, +m[3]!] },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH},?\\s+${YEAR}\\b`, "i"), read: (m) => [+m[3]!, MONTHS[m[2]!.toLowerCase().slice(0, 3)]!, +m[1]!] },
  { re: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+${YEAR}\\b`, "i"), read: (m) => [+m[3]!, MONTHS[m[1]!.toLowerCase().slice(0, 3)]!, +m[2]!] },
  { re: new RegExp(`\\b(\\d{1,2})[/.\\-](\\d{1,2})[/.\\-]${YEAR}\\b`), read: (m) => (+m[1]! > 12 || +m[2]! <= 12 ? [+m[3]!, +m[2]!, +m[1]!] : [+m[3]!, +m[1]!, +m[2]!]) },
];
const TIME_12 = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i;
const TIME_24 = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\s*[-/.]\d)/;
// Hinglish: "subah 9 baje" (morning), "dopahar 2 baje" (afternoon), "shaam 6 baje" (evening), "raat 11 baje" (night).
const TIME_HG = /\b(subah|savere|dopahar|shaam|sham|raat)\s+(\d{1,2})(?:[:.](\d{2}))?\s*baje\b/i;
// After the LAST "in", "at" or "from" (the greedy start): "born at 21:15 in Pune" is Pune.
const PLACE_LEAD = /^.*\b(?:in|at|from|janm|janam)\s+([\p{L}][\p{L} ,'-]{1,60})$/isu;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

/** The birth details in the words, or null when there is no full date. */
export function readBirth(words: string, nowYear = new Date().getUTCFullYear()): BirthRead | null {
  const text = (words ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 400);
  // The sentence that holds the date: a question after it ("... Mumbai. When will I marry?") is not part of the place.
  const sentences = text.split(/(?<=[.?!])\s+|\n+/);
  let rest = "";
  let date: [number, number, number] | null = null;
  for (const sentence of sentences) {
    for (const f of DATE_FORMS) {
      const m = f.re.exec(sentence);
      if (!m) continue;
      const got = f.read(m);
      if (validDate(...got) && got[0] <= nowYear) { date = got; rest = sentence.replace(m[0], " "); break; }
    }
    if (date) break;
  }
  if (!date) return null;

  let hour = 12, minute = 0, timeKnown = false;
  const hg = TIME_HG.exec(rest), t12 = TIME_12.exec(rest), t24 = TIME_24.exec(rest);
  if (hg) {
    const h = +hg[2]! % 12, part = hg[1]!.toLowerCase();
    hour = part.startsWith("sub") || part === "savere" ? h : part === "dopahar" ? (h < 6 ? h + 12 : h) : h + 12;
    minute = hg[3] ? +hg[3] : 0; timeKnown = true; rest = rest.replace(hg[0], " ");
  } else if (t12 && +t12[1]! >= 1 && +t12[1]! <= 12) {
    const pm = /p/i.test(t12[3]!);
    hour = (+t12[1]! % 12) + (pm ? 12 : 0); minute = t12[2] ? +t12[2] : 0; timeKnown = true; rest = rest.replace(t12[0], " ");
  } else if (t24) {
    hour = +t24[1]!; minute = +t24[2]!; timeKnown = true; rest = rest.replace(t24[0], " ");
  }
  if (minute > 59) { minute = 0; }

  const cleaned = rest.replace(/\b(i was born|born on|born|on|at|around|about|approx(?:imately)?|time|date|place|birth|ki|ko|mera|meri|janm|janam|hua|tha|baje)\b/gi, " ")
    .replace(/[,;:|]+/g, " , ").replace(/\s+/g, " ").trim();
  const lead = PLACE_LEAD.exec(rest.trim());
  const placeWords = (lead?.[1] ?? cleaned.split(" , ").map((s) => s.trim()).filter((s) => /\p{L}{2,}/u.test(s)).pop() ?? "")
    .split(/[.?!]/)[0]!.replace(/^[\s,.-]+|[\s,.-]+$/g, "").replace(/\s+/g, " ").slice(0, 80);
  return { year: date[0], month: date[1], day: date[2], hour, minute, timeKnown, placeWords };
}

/** What the engine is given, with the place found. */
export function skyOf(r: BirthRead, place: Place): Sky {
  return { year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, lat: place.lat, lng: place.lon, place: place.label, timeKnown: r.timeKnown };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "13 July 1994, 9:30 am, Mumbai" (or "time not known"): how the card and the chat say it back. */
export function skyLine(s: Pick<Sky, "year" | "month" | "day" | "hour" | "minute" | "place" | "timeKnown">): string {
  const h = s.hour % 12 === 0 ? 12 : s.hour % 12;
  const time = s.timeKnown ? `${h}:${String(s.minute).padStart(2, "0")} ${s.hour < 12 ? "am" : "pm"}` : "time not known";
  return `${s.day} ${MONTH_NAMES[s.month - 1]} ${s.year}, ${time}, ${s.place.split(",")[0]}`;
}
