/**
 * THE SITES SOMEBODY MAY SIGN IN TO, AND WHERE EACH ONE'S SIGN-IN REALLY IS (docs/sites.md).
 *
 *   SITE_CATALOG     the vetted list: a name, the ways people write it, the host, and the page its sign-in is on
 *   searchSites(q)   the entries that match what was typed, best first
 *   catalogSite(h)   the entry for a host, if it is one of ours
 *   catalogHosts()   every host here, for the gate
 *
 * WHY THIS IS CODE AND NOT A SETTING. A search that sends somebody to sign in is the one screen in the product
 * where landing on the wrong host costs them their password, so what it may offer is a reviewed change with a
 * test beside it, never a line someone can mistype on a server — the same reasoning web/search/catalog.ts gives
 * for its own lists. CLOUD_BROWSER_SITES stays as it was, for a host an operator adds on purpose; this list is
 * what a person can FIND by typing, and nothing reaches the panel that is not on one of the two.
 *
 * WHAT AN ENTRY PROMISES. `signIn` is the site's own sign-in page, on `host` or a sign-in host the same company
 * runs, read from the site itself. It is not a search result and never a link anybody sent us: `sign-in by
 * search result` is how phishing works, and the whole value of typing a name here is that the name decides the
 * host rather than the person having to read one. A site that moves its sign-in gets an edit here, which is a
 * pull request somebody reads.
 *
 * Adding one: check the page is the real sign-in (open it, see the company's own certificate), keep `host` to
 * what the cookies belong to, and add the ways people say the name to `aliases` — searching is for people who
 * know the shop, not the domain.
 */

export interface SiteEntry {
  /** Stable id, and the key of a row in the store. */
  id: string;
  /** What it is called, as a person would say it. */
  name: string;
  /** The host the session belongs to: what store.ts keeps a cookie jar under. */
  host: string;
  /**
   * Where the phone starts to sign in: the site's own sign-in page, or — for a site that keeps its sign-in in a drawer
   * on the home page — the home page. It is only ever a START. The phone checks it really is a sign-in (phone.ts
   * PAGE_SHAPE) and, if not, presses the site's own "Sign in" (FIND_LOGIN), so an address that has moved since it
   * was written here degrades to one extra step instead of a 404.
   *
   * Seen working in a phone's browser on 21 Nov 2026: amazon (its home opens a sign-in sheet), flipkart and
   * swiggy (straight to the form), bluedart (home, then its own "Sign in"). Amazon's old /ap/signin is a 404
   * without its query string, and bluedart's /login is not a sign-in — both caught by testing, not by reading.
   */
  signIn: string;
  /**
   * The site's own list of the person's orders, to keep an eye on once they are signed in ("Keep an eye on my
   * orders"). Only where the site has one address for it: a site whose orders page carries the person's id in the
   * address, or that has no such page, has none, and is offered no watch.
   */
  orders?: string;
  /**
   * The site's own search, with `{q}` where the words go: where an order starts when the restaurant's own page is not
   * known yet (src/sites/history/plan.ts). Only on the site's host, like everything else here.
   */
  search?: string;
  /**
   * What the address of one restaurant's or product's page has in it on this site ("/restaurants/", "/dp/"), so a link to
   * it can be picked out of the orders page and an order can start there instead of at the search.
   */
  placePath?: string;
  /** What it is for, shown beside the name. */
  category: string;
  /** Other ways it is typed, lower case. Searching is by name, host and these. */
  aliases: string[];
}

/**
 * Deliberately short. Every line is a host somebody's password may be typed at, so this grows by review, one
 * site at a time, and an operator who wants a host that is not here adds it to CLOUD_BROWSER_SITES instead.
 */
export const SITE_CATALOG: readonly SiteEntry[] = [
  {
    id: "amazon-in", name: "Amazon", host: "amazon.in", category: "Shopping",
    signIn: "https://www.amazon.in/", orders: "https://www.amazon.in/gp/css/order-history",
    search: "https://www.amazon.in/s?k={q}", placePath: "/dp/",
    aliases: ["amazon", "amazon india", "amzn", "orders", "parcel", "delivery"],
  },
  {
    id: "flipkart", name: "Flipkart", host: "flipkart.com", category: "Shopping",
    signIn: "https://www.flipkart.com/account/login", orders: "https://www.flipkart.com/account/orders",
    search: "https://www.flipkart.com/search?q={q}", placePath: "/p/",
    aliases: ["flipkart", "orders", "parcel", "delivery"],
  },
  {
    id: "swiggy", name: "Swiggy", host: "swiggy.com", category: "Food",
    signIn: "https://www.swiggy.com/auth", orders: "https://www.swiggy.com/my-account/orders",
    search: "https://www.swiggy.com/search?query={q}", placePath: "/restaurants/",
    aliases: ["swiggy", "food", "order food", "instamart"],
  },
  {
    id: "zomato", name: "Zomato", host: "zomato.com", category: "Food",
    signIn: "https://www.zomato.com/login",
    aliases: ["zomato", "food", "order food", "blinkit"],
  },
  {
    id: "irctc", name: "IRCTC", host: "irctc.co.in", category: "Travel",
    signIn: "https://www.irctc.co.in/nget/train-search",
    aliases: ["irctc", "train", "trains", "railway", "rail", "pnr", "ticket"],
  },
  {
    id: "bluedart", name: "Blue Dart", host: "bluedart.com", category: "Parcels",
    signIn: "https://www.bluedart.com/",
    aliases: ["blue dart", "bluedart", "courier", "parcel", "shipment"],
  },
];

const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, " ");

/**
 * The entries that match what was typed, best first: the name it starts, then a word of it, then an alias, then
 * the host. Nothing matches an empty query — a search box that answers everything before a letter is typed is a
 * list, and this one is a list of places to type a password.
 */
export function searchSites(q: string, limit = 8): SiteEntry[] {
  const needle = norm(q);
  if (needle.length < 2) return [];
  const scored: Array<{ e: SiteEntry; score: number }> = [];
  for (const e of SITE_CATALOG) {
    const name = norm(e.name);
    let score = 0;
    if (name === needle) score = 100;
    else if (name.startsWith(needle)) score = 80;
    else if (name.includes(needle)) score = 60;
    else if (e.host.startsWith(needle) || e.host.includes(needle)) score = 50;
    else if (e.aliases.some((a) => a === needle)) score = 45;
    else if (e.aliases.some((a) => a.startsWith(needle))) score = 30;
    else if (e.aliases.some((a) => a.includes(needle))) score = 15;
    if (score) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e);
}

export const catalogSite = (host: string): SiteEntry | undefined => SITE_CATALOG.find((e) => e.host === norm(host));
/** The entry a host belongs to, subdomains included ("www.swiggy.com" is Swiggy's). */
export const catalogFor = (host: string): SiteEntry | undefined => {
  const h = norm(host).replace(/\.$/, "");
  return SITE_CATALOG.find((e) => h === e.host || h.endsWith(`.${e.host}`));
};

/**
 * Where a site's sign-in may hand off to, as well as the site: the sign-in pages people actually use to get into
 * a shop with — Google's and Apple's. The phone lets the page go to these and nowhere else.
 */
export const SIGN_IN_HANDOFFS: readonly string[] = ["accounts.google.com", "appleid.apple.com"];
export const catalogHosts = (): string[] => SITE_CATALOG.map((e) => e.host);
