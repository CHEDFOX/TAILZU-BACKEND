/**
 * Links in an artifact. The viewer never navigates (a sandboxed frame that is sent somewhere else is lost, see docs section 2), so a click on a
 * link, or a call to `window.open`, becomes an `open` message and the APP decides: it confirms with the person and opens the system browser.
 *
 * `openableUrl` is the one rule for what may be asked: an absolute http(s) address, as written. The viewer applies it to what the artifact
 * says, the shell applies it again to what an HTML artifact's frame says, and the app is expected to apply it a third time.
 */

/** The longest address that is passed on. */
export const OPEN_URL_MAX = 2048;

/** The address to ask the app to open, or null if it is not one the app may be asked about. */
export function openableUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > OPEN_URL_MAX) return null;
  // Control characters and spaces hide where a link goes.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(text)) return null;
  // Only an absolute address as written (or a protocol-relative one, which takes the viewer's own https): "foo", "/foo" and "?x" are the artifact's own business.
  if (!/^(?:https?:)?\/\/(?![\/\\])/i.test(text)) return null;
  let u: URL;
  try {
    u = new URL(text.startsWith("//") ? `https:${text}` : text);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  // `https://bank.example@evil.example/` is how a link lies about where it goes.
  if (u.username || u.password) return null;
  return u.href;
}

/** The least time between two `open` messages from one window: a script that calls `window.open` in a loop gets one. */
export const OPEN_GAP_MS = 400;
