/**
 * THE ADDRESSES A TURN SAW, SO A DRAWING LINKS AND SHOWS ONLY THOSE.
 *
 *   linksIn(text)            every https address in some text, as written
 *   class Seen               what one turn read: the person's words, what they attached, the bot's files, every tool's result
 *
 * A picture loads by itself and a link carries whatever is in its address, so a drawing that could make up addresses could also
 * be talked by a page into building one with the person's details in it ("…/pixel?email=…"). A block's address must therefore be
 * one this turn read, character for character (check.ts): an address copied whole from a page cannot carry anything the page did
 * not already hold. The bot's own answer is NOT read into it, for the same reason: its addresses are the model's making. Only
 * https, and never one with a user name or password in it.
 */

const URL_RE = /https:\/\/[^\s<>"'`()[\]{}|\\^]+/g;
/** What often ends a sentence round an address, and is not part of it. */
const TRAIL = /[.,;:!?)\]}'"»”’]+$/;

/** An address fit to draw: https, a host, no user or password in it. Else null. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length > 2_000 || !s.startsWith("https://")) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return s;
  } catch { return null; }
}

/** Every https address in `text`, as written, without the punctuation round it. */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = safeUrl(m[0].replace(TRAIL, ""));
    if (url) out.push(url);
  }
  return out;
}

/** The addresses one turn saw. At most `max`, the first ones kept. */
export class Seen {
  private readonly urls = new Set<string>();
  constructor(private readonly max = 200) {}

  add(text: string | null | undefined): void {
    if (!text) return;
    for (const u of linksIn(text)) {
      if (this.urls.size >= this.max) return;
      this.urls.add(u);
    }
  }

  has(url: string): boolean { return this.urls.has(url); }

  /** The first `n`, for the designer to choose from. */
  list(n = 12): string[] { return [...this.urls].slice(0, n); }
}
