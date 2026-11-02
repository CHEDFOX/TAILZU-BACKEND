/**
 * The website's layout and its mic mark, shared with the demo page.
 */

import { MIC_MARK, MIC_PROGRAM } from "../keyboard/mic.js";

/** THE MIC KEY, FOR THE SITE. The landing page draws the keyboard's mic key
 *  with the renderer the phones run, from this same mark and program, so
 *  what the site shows is what the key does. `inset` is the key's idle
 *  icon inset, as the keyboard flag `kb.mic.idleIconInset` has it. */
export const SITE_MIC = { mark: MIC_MARK, program: MIC_PROGRAM, inset: 7 };

/**
 * The landing page's look and order, sent with its copy (/v1/site): every
 * CSS custom property the page draws with, the order of its sections, which
 * are hidden, each band's colour class, and the page title and description.
 * These are the values the page's own file uses, so sending them changes
 * nothing — and makes each one changeable from the control console.
 */
export const SITE_SHAPE = {
  "theme": {
    "ink": "#0F0D0B",
    "wash": "#141110",
    "card": "#211C17",
    "raise": "rgba(243,226,198,.055)",
    "rule": "rgba(243,226,198,.15)",
    "white": "#F3E2C6",
    "grey": "rgba(243,226,198,.62)",
    "dim": "rgba(243,226,198,.52)",
    "amber": "#E8A23C",
    "paper": "#FBF8F2",
    "ink2": "#1B1712",
    "ink2-soft": "rgba(27,23,18,.66)",
    "line": "rgba(27,23,18,.12)",
    "saffron": "#F4A72C",
    "saffron-deep": "#B8650C",
    "indigo": "#2A2878",
    "indigo-deep": "#17163F",
    "teal": "#167D71",
    "teal-deep": "#0C4F47",
    "sun": "#F7CF4A",
    "rose": "#E4587B",
    "sky": "#DCEBF7",
    "leaf": "#DDF3E3",
    "butter": "#FFF3C2",
    "violet": "#1C1640",
    "serif": "'Newsreader', Georgia, 'Times New Roman', serif",
    "sans": "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    "mono": "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    // The 2026 redesign's own: the films' violet field (social.html
    // P.violetHi/Lo), so the hero film meets the page edge to edge; the Ask
    // stand-in desk (visuals/mock.css --wall); errors on light grounds; and
    // code. New names, so nothing the old page draws changes.
    "field-hi": "#241C52",
    "field-lo": "#0F0B24",
    "beige": "#CFC7BB",
    "rose-deep": "#A62B4B",
    "code": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  },
  "layout": {
    "order": [
      "river",
      "how",
      "llm",
      "desk",
      "tone",
      "dev",
      "free",
      "questions"
    ],
    "hidden": [],
    "bands": {
      "how": "on-saffron",
      "llm": "on-lilac",
      "desk": "on-indigo",
      "tone": "on-paper",
      "dev": "on-ink",
      "free": "on-sun",
      "questions": "on-paper"
    }
  },
  // What a search result says. The page sets document.title from this, so it
  // IS the title a crawler that runs the script reads; the static <head> is
  // written from the same two lines (scripts/sync-site.mts).
  "meta": {
    "title": "AI Keyboard & Voice Typing in Hindi, Hinglish & 70+ Languages — X0 Bot",
    "description": "Talk. X0 Bot writes. An AI keyboard for iPhone, Android, Windows and Mac: speak Hindi, Hinglish, English or any of 74 languages, and clean text lands in any app."
  }
};

/**
 * THE REDESIGNED PAGE'S ORDER AND GROUNDS, waiting for that page to be live.
 *
 * SITE_SHAPE.layout above is the order and bands of the page that is live
 * today, and it stays until the redesign is deployed: sent to the old page,
 * these bands name classes its CSS does not have, and its sections would
 * lose their colour. The new page copes with either (sections it is not
 * told about ride with the one before them; bands it does not know are
 * ignored), so the order of release is: this backend, then the page, then
 * this layout — by setting `layout: SITE_LAYOUT_REDESIGN` in SITE_SHAPE, or
 * at once from the console with one rule on /layout whose value is this.
 *
 * Questions come before the finale on purpose: objections answered right
 * before the decision, and the page ends on its peak. `ask` is listed but
 * gated by the top-level `ask` flag, not by `hidden`; the hero is never
 * listed, because it is never moved or hidden.
 */
export const SITE_LAYOUT_REDESIGN = {
  "order": ["how", "river", "apps", "films", "tone", "desk", "llm", "dev", "ask", "questions", "free"],
  "hidden": [] as string[],
  "bands": {
    "how": "on-cream",
    "river": "on-violet",
    "apps": "on-cream",
    "films": "on-ink",
    "tone": "on-cream",
    "desk": "on-ink",
    "llm": "on-indigo",
    "dev": "on-indigo",
    "ask": "on-ink",
    "questions": "on-cream",
    "free": "on-ink"
  } as Record<string, string>
};
