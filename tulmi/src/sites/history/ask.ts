/**
 * IS THIS AN ASK TO ORDER OR BUY SOMETHING, AND FROM WHAT KIND OF SITE? Read off the words alone, with no model, so it costs
 * nothing and says the same every time (routes/bots/botsTalk.ts), the way botsBots/pictureAsk.ts reads an ask for a picture.
 *
 * NARROW ON PURPOSE, but for the other reason. Nothing here spends money: a yes draws a card, and the person still taps it,
 * checks the cart and pays on the site. What a wrong yes costs is the answer they wanted instead, so it takes a verb of
 * getting and a thing (food, a product, "the usual"), and never a question about an order that already exists:
 *
 *   food       "order dinner", "order my usual", "get me a biryani", "khana mangwa do", "biryani order karo", "I'm hungry"
 *   shopping   "reorder my detergent", "buy more shampoo", "I'm out of coffee pods", "running low on rice",
 *              "surf excel khatam ho gaya", "order a phone charger from amazon", "buy new earphones"
 *   no         "where is my order", "cancel my order", "track my parcel", "how do I order on zomato?", "book a cab",
 *              "order these names alphabetically", "what did I order yesterday?"
 *
 * The kind it hears decides which of their sites answers (plan.ts): a dish goes to a food site, a product to a shop. "My
 * usual" alone names no kind, and the planner takes it to the site they order from most.
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
  /** A site they named ("on swiggy", "from amazon"). */
  site?: string;
  /** The kind of site the words are for, when they say: food or shopping (history/kinds.ts). */
  kind?: "food" | "shopping";
}

const FOOD = String.raw`(?:food|khana|khaana|dinner|lunch|breakfast|brunch|snacks?|meal|something\s+to\s+eat|biryani|biriyani|pulao|haleem|nihari|kebabs?|kababs?|tikka|tandoori|shawarma|rolls?|frankie|momos?|noodles|chowmein|hakka|manchurian|fried\s+rice|chinese|thali|meals|dosa|idli|vada|uttapam|appam|parotta|paratha|naan|kulcha|roti|curry|dal|chole|rajma|paneer|chicken|mutton|fish|prawns?|egg|keema|butter\s+chicken|korma|pav\s*bhaji|vada\s*pav|chaat|pani\s*puri|samosas?|kachori|pizza|pasta|lasagna|burgers?|fries|wings|sandwich(?:es)?|subs?|wraps?|tacos?|burritos?|nachos|sushi|ramen|pho|bao|dim\s*sum|dumplings?|bibimbap|thai|curry\s+rice|salad|bowls?|poke|soup|waffles?|pancakes?|cake|pastry|brownies?|ice\s*cream|desserts?|sweets?|mithai|kulfi|falooda|kheer|halwa|jalebi|gulab\s*jamun|rasmalai|coffee|chai|tea|juice|shakes?|smoothie|lassi|falafel|hummus|mandi|steak|grill)`;
const SITE = String.raw`(?:swiggy|zomato|instamart|blinkit)`;
const SHOP = String.raw`(?:amazon|flipkart)`;
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

/** Asks to buy a thing: more of what runs out, or something new. */
const SHOP_ASK = [
  // "buy more shampoo", "reorder my detergent", "order another pack of coffee", "get a refill of the hand wash"
  /\b(?:buy|rebuy|re-?order|order|get|restock)\b(?:\s+\S+){0,3}?\s+(?:more|again|another|refills?|a\s+new|new)\b/i,
  /\bre-?order\s+(?:my|the|our)\s+\S+/i,
  // "I'm out of coffee pods", "we're running low on rice"
  /\b(?:i'?m|we'?re|i\s+am|we\s+are)\s+(?:all\s+)?(?:out\s+of|running\s+(?:low|out)\s+(?:on|of))\s+\S+/i,
  /\b(?:out\s+of|running\s+(?:low|out)\s+(?:on|of))\s+\S+.{0,30}\b(?:order|buy|get|reorder)\b/i,
  // "surf excel khatam ho gaya", "atta khatam hai"
  /\b\S+\s+(?:khatam|khtm|khatm)\s+(?:ho\s+)?(?:gaya|gayi|gaye|gya|gyi|hai|ho\s+raha)\b/i,
  // "order a phone charger from amazon", "buy earphones on flipkart", "amazon se detergent mangwa do"
  new RegExp(String.raw`\b(?:buy|order|get|reorder)\b.{0,60}\b(?:from|on)\s+${SHOP}\b`, "i"),
  new RegExp(String.raw`\b${SHOP}\s+(?:se|pe|par)\b.{0,40}\b${HINGLISH}`, "i"),
  // "buy new earphones", "buy a yoga mat": buying is shopping.
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?buy\b/i,
];

/** What makes words about an order a question about one that exists, a how-to, or not about food at all. */
const NOT = [
  /\b(?:where(?:'s|\s+is)|track|tracking|status|cancel|refund|complain|complaint|late|delayed|missing|wrong|deliver(?:ed|y\s+boy))\b[^.?!]{0,40}\border\b/i,
  /\border\b[^.?!]{0,30}\b(?:status|tracking|cancel(?:led)?|refund|delayed|late|missing|arrive|arrived|reached|kab\s+aayega)\b/i,
  /\bhow\s+(?:do|can|to|should|would)\b/i,
  /\bwhat\s+did\s+i\s+order\b|\bi\s+(?:ordered|had\s+ordered)\b/i,
  /\b(?:in\s+order|order\s+of|alphabetical|sort|ascending|descending|chronological|purchase\s+order|work\s+order)\b/i,
  /\b(?:where(?:'s|\s+is)|track|tracking)\b[^.?!]{0,30}\b(?:parcel|package|shipment|delivery)\b/i,
  // Rides, tickets and stays are bookings, not orders: no site here can take them.
  /\b(?:cab|taxi|uber|ola|auto|ride|ticket|tickets|flight|flights|train|bus|hotel|table\s+for)\b/i,
];

const STOP = new Set(("order reorder re get send deliver bring book me us my our the a an some something to eat for from on at with and please pls "
  + "plz can you could would will i we want like need tonight today now usual regular same as last time always before repeat "
  + "food khana khaana khane mangwa mangwao mangao manga mangwado do de lo karo kardo kar kr kuch ko se pe par hai hain wala wahi vahi "
  + "hungry starving what should shall eat one two again also just quick quickly fast order. it this that dinner lunch breakfast brunch "
  + "snack snacks meal late night evening morning afternoon swiggy zomato instamart blinkit hamesha mujhe hume humein "
  + "buy rebuy restock more another refill refills new out running low all khatam khtm khatm gaya gayi gaye gya gyi raha amazon flipkart "
  + "pack packs bottle bottles box").split(" "));

const SLOT_WORDS: Array<[RegExp, Slot]> = [
  [/\bbreakfast|nashta|morning\b/i, "breakfast"],
  [/\blunch|afternoon\b/i, "lunch"],
  [/\bsnacks?|evening|chai\s+time\b/i, "evening"],
  [/\bdinner|tonight|raat\s+ka\b/i, "dinner"],
  [/\blate[\s-]night|midnight\b/i, "late"],
];

const FOOD_WORD = new RegExp(String.raw`\b${FOOD}\b|\b${SITE}\b|\bkhane\b|\bhungry|bh(?:oo|u)k`, "i");

/** The ask these words make, or null when they make none. */
export function readOrderAsk(words: string): OrderAsk | null {
  const w = String(words ?? "").replace(/\s+/g, " ").trim();
  if (w.length < 4 || w.length > 400) return null;
  if (NOT.some((r) => r.test(w))) return null;
  const food = ASK.some((r) => r.test(w));
  const shop = SHOP_ASK.some((r) => r.test(w));
  if (!food && !shop) return null;
  const lower = w.toLowerCase();
  // A named shop is shopping; a named food site or a food word is food; a shopping shape with no food in it is shopping.
  // Running out, and buying, are restocking: shopping even when the thing is coffee, unless a food site is named.
  const restock = /\b(?:out\s+of|running\s+(?:low|out)|khatam|khtm|khatm|restock|refills?)\b|^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?buy\b/i.test(lower);
  const kind: OrderAsk["kind"] = new RegExp(String.raw`\b${SHOP}\b`, "i").test(lower) ? "shopping"
    : new RegExp(String.raw`\b${SITE}\b`, "i").test(lower) ? "food"
    : restock ? "shopping"
    : FOOD_WORD.test(lower) ? "food"
    : shop ? "shopping" : undefined;
  const last = /\b(?:same\s+as\s+last\s+time|last\s+order|repeat|reorder|again|wahi|vahi)\b/.test(lower);
  const usual = !last && new RegExp(String.raw`\b${USUAL}\b`, "i").test(lower);
  const slot = SLOT_WORDS.find(([r]) => r.test(lower))?.[1];
  const site = /\bswiggy\b/.test(lower) ? "swiggy.com" : /\bzomato\b/.test(lower) ? "zomato.com"
    : /\bamazon\b/.test(lower) ? "amazon.in" : /\bflipkart\b/.test(lower) ? "flipkart.com" : undefined;
  const want = [...new Set(lower.replace(/[^a-z0-9ऀ-ॿ ]+/g, " ").split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))].slice(0, 6);
  return { usual, last, want, ...(slot && kind !== "shopping" ? { slot } : {}), ...(site ? { site } : {}), ...(kind ? { kind } : {}) };
}
