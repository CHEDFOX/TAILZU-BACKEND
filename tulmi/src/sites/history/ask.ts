/**
 * IS THIS AN ASK TO ORDER FOOD? Read off the words alone, with no model, so it costs nothing and says the same every time
 * (routes/bots/botsTalk.ts), the way botsBots/pictureAsk.ts reads an ask for a picture.
 *
 * NARROW ON PURPOSE, but for the other reason. Nothing here spends money: a yes draws a card with an order on it, and the
 * person still taps it, checks the cart and pays on the site. What a wrong yes costs is the answer they wanted instead,
 * so it takes a verb of getting and a thing that is food (or a food site, or "the usual"), and never a question about an
 * order that already exists:
 *
 *   yes   "order dinner", "order my usual", "get me a biryani", "same as last time from swiggy", "khana mangwa do",
 *         "biryani order karo", "kuch khane ko mangao", "I'm hungry", "what should I order for dinner?"
 *   no    "where is my order", "cancel my swiggy order", "track my order", "how do I order on zomato?",
 *         "order these names alphabetically", "what did I order yesterday?"
 */
import type { Slot } from "./types.js";

export interface OrderAsk {
  /** "the usual", "my regular": the order they come back to most. */
  usual: boolean;
  /** "same as last time", "repeat my last order": the newest one. */
  last: boolean;
  /** The words that might name a dish or a place ("biryani", "behrouz"), lower case. */
  want: string[];
  /** A part of the day they named ("for lunch"). */
  slot?: Slot;
  /** A site they named ("on swiggy"). */
  site?: string;
}

const FOOD = String.raw`(?:food|khana|khaana|dinner|lunch|breakfast|brunch|snacks?|meal|biryani|biriyani|pizza|burgers?|dosa|idli|thali|momos?|noodles|chinese|rolls?|shawarma|paneer|chicken|mutton|fish|sandwich(?:es)?|coffee|chai|tea|dessert|ice\s*cream|cake|curry|paratha|pasta|salad|sushi|kebabs?|tikka|dal|chole|pav\s*bhaji|samosas?|wraps?|fries|juice|shakes?|waffles?|tacos?|bowl|something\s+to\s+eat)`;
const SITE = String.raw`(?:swiggy|zomato|instamart|blinkit)`;
const USUAL = String.raw`(?:usual|regular|same\s+as\s+(?:last\s+time|always|before)|last\s+order|repeat|reorder|wahi|vahi|hamesha\s+wala)`;
const GET = String.raw`(?:order|re-?order|get|send|deliver|bring|book)`;
const HINGLISH = String.raw`(?:mang(?:wa|a)(?:o|do|de|na|iye|dijiye|ana|wao|wado)?|manga\s+(?:do|de|lo)|order\s+kar(?:o|do|de|na|iye|dijiye)?|order\s+kr(?:o|do)?|mangwao|mangao)`;

const ASK = [
  // "order dinner", "order me some biryani", "get us pizza", "order my usual", "order from swiggy"
  new RegExp(String.raw`\b${GET}\b(?:\s+\S+){0,4}?\s+(?:${FOOD}|${USUAL}|${SITE})\b`, "i"),
  new RegExp(String.raw`^\s*(?:${FOOD}|${USUAL})\b(?:\s+\S+){0,3}?\s+${GET}\b`, "i"),
  // "khana mangwa do", "biryani order karo", "kuch khane ko mangao", "swiggy se pizza manga do"
  new RegExp(String.raw`\b(?:${FOOD}|khane|${USUAL}|${SITE})\b(?:\s+\S+){0,4}?\s+${HINGLISH}\b`, "i"),
  new RegExp(String.raw`\b${HINGLISH}\b(?:\s+\S+){0,3}?\s+(?:${FOOD}|khane)\b`, "i"),
  // "my usual", "the usual please", "same as last time from swiggy": the habit named on its own is the ask.
  new RegExp(String.raw`^\s*(?:(?:my|the)\s+)?${USUAL}(?:\s+(?:order|one|again))?(?:\s+(?:please|pls|plz))?(?:\s+(?:from|on)\s+${SITE})?(?:\s+(?:please|pls|plz))?\s*[.!]*\s*$`, "i"),
  new RegExp(String.raw`\b${USUAL}\b(?:\s+\S+){0,3}?\s+(?:from|on)\s+${SITE}\b`, "i"),
  // "I'm hungry", "bhook lagi hai", "what should I order for dinner?", "what should I eat tonight?"
  /\b(?:i'?m|i\s+am|feeling|so|very)\s+(?:hungry|starving)\b|\bbh(?:oo|u)k(?:h)?\s+lag(?:i|ri|rahi)\b/i,
  new RegExp(String.raw`\bwhat\s+(?:should|shall|can)\s+(?:i|we)\s+(?:order|eat|get)\b`, "i"),
];

/** What makes words about an order a question about one that exists, a how-to, or not about food at all. */
const NOT = [
  /\b(?:where(?:'s|\s+is)|track|tracking|status|cancel|refund|complain|complaint|late|delayed|missing|wrong|deliver(?:ed|y\s+boy))\b[^.?!]{0,40}\border\b/i,
  /\border\b[^.?!]{0,30}\b(?:status|tracking|cancel(?:led)?|refund|delayed|late|missing|arrive|arrived|reached|kab\s+aayega)\b/i,
  /\bhow\s+(?:do|can|to|should|would)\b/i,
  /\bwhat\s+did\s+i\s+order\b|\bi\s+(?:ordered|had\s+ordered)\b/i,
  /\b(?:in\s+order|order\s+of|alphabetical|sort|ascending|descending|chronological|purchase\s+order|work\s+order)\b/i,
];

const STOP = new Set(("order reorder re get send deliver bring book me us my our the a an some something to eat for from on at with and please pls "
  + "plz can you could would will i we want like need tonight today now usual regular same as last time always before repeat "
  + "food khana khaana khane mangwa mangwao mangao manga mangwado do de lo karo kardo kar kr kuch ko se pe par hai hain wala wahi vahi "
  + "hungry starving what should shall eat one two again also just quick quickly fast order. it this that dinner lunch breakfast brunch "
  + "snack snacks meal late night evening morning afternoon swiggy zomato instamart blinkit hamesha mujhe hume humein").split(" "));

const SLOT_WORDS: Array<[RegExp, Slot]> = [
  [/\bbreakfast|nashta|morning\b/i, "breakfast"],
  [/\blunch|afternoon\b/i, "lunch"],
  [/\bsnacks?|evening|chai\s+time\b/i, "evening"],
  [/\bdinner|tonight|raat\s+ka\b/i, "dinner"],
  [/\blate[\s-]night|midnight\b/i, "late"],
];

/** The ask to order food these words make, or null when they make none. */
export function readOrderAsk(words: string): OrderAsk | null {
  const w = String(words ?? "").replace(/\s+/g, " ").trim();
  if (w.length < 4 || w.length > 400) return null;
  if (NOT.some((r) => r.test(w))) return null;
  if (!ASK.some((r) => r.test(w))) return null;
  const lower = w.toLowerCase();
  const last = /\b(?:same\s+as\s+last\s+time|last\s+order|repeat|reorder|again|wahi|vahi)\b/.test(lower);
  const usual = !last && new RegExp(String.raw`\b${USUAL}\b`, "i").test(lower);
  const slot = SLOT_WORDS.find(([r]) => r.test(lower))?.[1];
  const site = /\bswiggy\b/.test(lower) ? "swiggy.com" : /\bzomato\b/.test(lower) ? "zomato.com" : undefined;
  const want = [...new Set(lower.replace(/[^a-z0-9ऀ-ॿ ]+/g, " ").split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))].slice(0, 6);
  return { usual, last, want, ...(slot ? { slot } : {}), ...(site ? { site } : {}) };
}
