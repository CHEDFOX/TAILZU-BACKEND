/**
 * WHAT KIND OF SITE THIS IS, AND THE LITTLE THAT DIFFERS BY KIND (docs/site-portrait.md §1b).
 *
 *   kindOf(site)     food, shopping, travel or parcels, from the catalog
 *   KINDS[kind]      the words, the reading and the ordering that belong to that kind and to no other
 *
 * THE PIPELINE IS ONE PIPELINE. Reading an orders page, keeping a history, finding the usual, telling a creature of habit
 * from an explorer, noticing what is due to be bought again, working out what someone would like next, finding it on the
 * web with reviews to show for it, and filling a cart while they watch: all of it is the same for Swiggy, Amazon or
 * Flipkart. What is not the same is small and lives here, one entry a kind:
 *
 *   the words      an order of dishes from a restaurant, or of products from a shop; "order" or "buy"
 *   the lexicon    what an item's name says (a dish's heat and cuisine; a product's category and whether it is a value pack)
 *   the web        how to search for somewhere new (a restaurant near them; a product people rate)
 *   the cart       whether a cart can be filled, and how: a menu (open the restaurant, Add by each dish) or a product page
 *                  (open the product, Add to cart)
 *   the rebuy      whether "you are due more of this" means anything (detergent, yes; a sofa, no)
 *
 * Adding a kind of site is adding an entry here and a category in the catalog. Nothing else in the pipeline changes.
 */
import { catalogFor } from "../catalog.js";

export const SITE_KINDS = ["food", "shopping", "travel", "parcels"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export interface KindSpec {
  kind: SiteKind;
  /** What one thing bought is called, and what the place it comes from is called. */
  item: string;
  place: string;
  /** The verb: "order" food, "buy" things. */
  verb: string;
  /** The icon on its cards (experience/bots/glyphs.ts). */
  icon: "pot" | "bag" | "plane";
  /**
   * What the site's search should look for when an order starts somewhere it has no link to: the place (a restaurant has
   * a menu of the dishes) or the item (a product is its own page).
   */
  searchBy: "place" | "item";
  /** How the cart is filled on the phone (history/phone.ts orderStep), or null when this kind has no cart to fill. */
  cart: "menu" | "product" | null;
  /** Whether "about time for more of this" is worth saying: things that run out. */
  rebuy: boolean;
  /** What an item's name says about the kind of thing it is: a cuisine, a product category. */
  categories: Array<[string, RegExp]>;
  /** What an item's name says about how they like things: heat and richness, or value packs and premium brands. */
  traits: Array<[string, RegExp]>;
  /** A web search for somewhere or something new that people who bought it vouch for. */
  query(item: string, near: string): string;
}

const FOOD: KindSpec = {
  kind: "food", item: "dish", place: "restaurant", verb: "order", icon: "pot", searchBy: "place", cart: "menu", rebuy: false,
  categories: [
    ["Hyderabadi / biryani", /\b(?:biryani|biriyani|haleem|mandi|behrouz|paradise|meghana|bawarchi)/i],
    ["North Indian", /\b(?:butter\s+chicken|dal\s+makhani|paneer|naan|kulcha|roti|tandoori|chole|rajma|punjabi|dhaba|kadai|kadhai)/i],
    ["South Indian", /\b(?:dosa|idli|vada|uttapam|sambar|rasam|appam|chettinad|andhra|kerala|udupi|pongal|meals)/i],
    ["Chinese", /\b(?:noodles|hakka|manchurian|fried\s+rice|schezwan|chilli\s+chicken|chow|dim\s*sum|momos?|wonton|chinese)/i],
    ["Burgers & American", /\b(?:burger|fries|wings|hot\s*dog|nuggets|mac\s*(?:n|and)\s*cheese|truffles|leon|american)/i],
    ["Pizza & Italian", /\b(?:pizza|pasta|lasagna|risotto|garlic\s+bread|alfredo|arrabbiata|italian|calzone)/i],
    ["Mexican", /\b(?:burrito|taco|quesadilla|nachos|enchilada|mexican|chinita|salsa)/i],
    ["Middle Eastern", /\b(?:shawarma|falafel|hummus|kebab|kabab|lebanese|arabian|pita)/i],
    ["Asian (Thai, Japanese, Korean)", /\b(?:sushi|ramen|thai|curry\s+rice|bibimbap|korean|kimchi|pho|bao|teriyaki|katsu|tom\s*yum|pad\s*thai|khow\s*suey|burma)/i],
    ["Healthy & bowls", /\b(?:salad|bowl|poke|quinoa|smoothie|healthy|millet|oats|protein)/i],
    ["Desserts & bakery", /\b(?:cake|pastry|brownie|ice\s*cream|waffle|dessert|bakery|cookie|donut|sundae|kulfi)/i],
    ["Café & drinks", /\b(?:coffee|latte|cappuccino|cold\s+brew|tea|chai|frappe|third\s+wave|starbucks|blue\s+tokai)/i],
    ["Street food & chaat", /\b(?:chaat|pani\s*puri|pav\s*bhaji|vada\s+pav|samosa|kachori|rolls?|frankie|kathi)/i],
  ],
  traits: [
    ["spicy", /\b(?:spicy|chill?i|chilly|mirchi|peri[\s-]?peri|schezwan|szechuan|andhra|chettinad|kolhapuri|vindaloo|laal\s*maas|65|pepper|jalape(?:n|ñ)o|sriracha|hot\b|fiery|bhut|naga|piri)/i],
    ["rich", /\b(?:butter|makhani|malai|cheese|cheesy|cream|creamy|korma|biryani|nihari|shahi|mughlai|ghee|lababdar|loaded|alfredo|carbonara|double|mac\s*(?:n|and)\s*cheese)/i],
    ["sweet", /\b(?:gulab|jamun|rasmalai|rasgulla|kheer|halwa|jalebi|kulfi|brownie|cake|pastry|ice\s*cream|sundae|waffle|pancake|donut|doughnut|cookie|mithai|phirni|shake|dessert|chocolate|tiramisu|cheesecake|falooda)/i],
    ["smoky", /\b(?:tandoori|tikka|kebab|kabab|seekh|grill(?:ed)?|bbq|barbe(?:cue|que)|smoked|charcoal|roast(?:ed)?|wings|shawarma|flame)/i],
    ["fresh", /\b(?:salad|bowl|poke|sushi|steamed|sprouts|quinoa|smoothie|fresh|healthy|lite|light|wrap|millet|oats|greek|lemon)/i],
    ["chicken", /\b(?:chicken|murg|wings)\b/i],
    ["mutton", /\b(?:mutton|lamb|goat|gosht|keema)\b/i],
    ["seafood", /\b(?:fish|prawns?|shrimp|crab|seafood|pomfret|surmai|squid)\b/i],
    ["paneer", /\b(?:paneer|cottage\s+cheese)\b/i],
    ["tangy", /\b(?:chaat|pani\s*puri|golgappa|tamarind|imli|lime|achari|pickle|kimchi|tom\s*yum|thai|sour|tangy|raw\s+mango|chutney|pav\s*bhaji)/i],
  ],
  query: (item, near) => `best ${item} restaurant ${near} reviews`,
};

const SHOPPING: KindSpec = {
  kind: "shopping", item: "product", place: "brand", verb: "buy", icon: "bag", searchBy: "item", cart: "product", rebuy: true,
  categories: [
    ["Groceries & household", /\b(?:detergent|surf|ariel|tide|dishwash|vim|harpic|lizol|cleaner|tissue|toilet\s+paper|atta|rice|dal|oil|ghee|sugar|salt|tea|coffee|biscuits?|snacks?|masala|spices?|garbage\s+bags?|batteries)/i],
    ["Personal care", /\b(?:shampoo|conditioner|soap|body\s*wash|face\s*wash|toothpaste|toothbrush|deodorant|razor|shaving|sunscreen|moisturi[sz]er|lotion|serum|hair\s+oil|sanitary|pads?|diapers?)/i],
    ["Electronics", /\b(?:phone|charger|cable|earbuds?|earphones?|headphones?|speaker|laptop|tablet|mouse|keyboard|monitor|power\s*bank|smart\s*watch|tv|camera|router|ssd|pendrive|usb)/i],
    ["Fashion", /\b(?:shirt|t-?shirt|jeans|trousers?|kurta|saree|dress|jacket|shoes?|sneakers?|sandals?|socks|innerwear|watch|bag|wallet|belt|cap)/i],
    ["Home & kitchen", /\b(?:bedsheet|pillow|curtain|mattress|towel|cookware|pan|kadai|pressure\s+cooker|bottle|container|mixer|kettle|lamp|storage|organi[sz]er)/i],
    ["Books & stationery", /\b(?:book|novel|notebook|pen|pencil|diary|paperback|hardcover|kindle)/i],
    ["Health & fitness", /\b(?:protein|whey|vitamins?|supplement|yoga\s+mat|dumbbells?|resistance\s+band|fitness|multivitamin|omega)/i],
    ["Baby & kids", /\b(?:baby|kids|toddler|toy|lego|wipes|feeding)/i],
    ["Pet supplies", /\b(?:dog|cat|pet|kibble|litter|pedigree|whiskas|drools)/i],
  ],
  traits: [
    ["value packs", /\b(?:pack\s+of|combo|value\s+pack|family\s+pack|\d+\s*(?:kg|l|litre|liter)\b|x\s*\d|\d\s*x\b|bulk|refill)/i],
    ["premium", /\b(?:premium|pro\b|max\b|ultra|signature|original|professional|luxury|imported)/i],
    ["natural", /\b(?:organic|natural|herbal|ayurvedic|chemical[\s-]free|vegan|plant[\s-]based|eco)/i],
    ["fitness-minded", /\b(?:protein|whey|fitness|gym|workout|sugar[\s-]free|low[\s-]fat|keto)/i],
  ],
  query: (item) => `best ${item} India reviews which to buy`,
};

const TRAVEL: KindSpec = {
  kind: "travel", item: "journey", place: "route", verb: "book", icon: "plane", searchBy: "item", cart: null, rebuy: false,
  categories: [["Trains", /\b(?:express|rajdhani|shatabdi|vande|mail|train|sleeper|3a|2a|1a|cc)\b/i]],
  traits: [["comfort first", /\b(?:1a|2a|first\s+class|ac\s+(?:first|2)|business)\b/i], ["value first", /\b(?:sleeper|sl\b|general|2s)\b/i]],
  query: (item, near) => `${item} ${near} reviews tips`,
};

const PARCELS: KindSpec = {
  kind: "parcels", item: "parcel", place: "courier", verb: "send", icon: "bag", searchBy: "item", cart: null, rebuy: false,
  categories: [], traits: [],
  query: (item) => `${item} reviews`,
};

export const KINDS: Readonly<Record<SiteKind, KindSpec>> = { food: FOOD, shopping: SHOPPING, travel: TRAVEL, parcels: PARCELS };

/** The kind a site is, from its catalog category. A site the catalog does not know is shopping, the most general kind. */
export function kindOf(site: string): KindSpec {
  const c = (catalogFor(site)?.category ?? "").toLowerCase();
  if (c === "food") return FOOD;
  if (c === "travel") return TRAVEL;
  if (c === "parcels") return PARCELS;
  return SHOPPING;
}
