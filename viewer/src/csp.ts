/** The shell page's Content-Security-Policy and the other headers it is served with. */

export interface CspInput {
  /** Origins that may embed the viewer (`frame-ancestors`). Empty: nobody. */
  parents: readonly string[];
  /**
   * The viewer is kept for screenshots: its parent is a page made from inline HTML, whose origin is opaque, and `frame-ancestors` cannot name one
   * (not even `*` matches it), so the directive is left out and any page may frame the viewer. Everything else about the policy is the same.
   */
  anyParent?: boolean;
  /** `'sha256-…'` of the page's import map, the one inline script it has. */
  importMapHash: string | null;
}

/**
 * - default-src 'none': nothing is allowed unless a line below says so.
 * - script-src: this origin's own files (the runtime and the vendored libraries), `blob:` for the code the viewer compiles in the browser
 *   (a React artifact is imported as a blob module; an HTML artifact's scripts run as blob scripts), and the hash of the import map.
 *   No 'unsafe-inline', no 'unsafe-eval': the compile path does not need them, so an artifact cannot use them either.
 * - style-src: inline styles (artifacts and the design kit) and the Google Fonts stylesheet host.
 * - font-src: the Google Fonts file host.
 * - img-src: data:, blob: and https: images.
 * - connect-src 'none': fetch, XHR, WebSocket, EventSource, sendBeacon: all refused. The artifact has no network.
 * - form-action 'none', base-uri 'none': no form can leave the page; no <base> can redirect relative URLs.
 * - frame-ancestors: only the app.
 * - sandbox allow-scripts: even if someone opens the page in a window or forgets the iframe's sandbox attribute, the document is
 *   in an opaque origin without cookies, storage, popups, forms or top navigation.
 */
export function buildCsp({ parents, importMapHash, anyParent }: CspInput): string {
  return [
    "default-src 'none'",
    `script-src 'self' blob:${importMapHash ? ` 'sha256-${importMapHash}'` : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src data: blob: https:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    ...(anyParent ? [] : [`frame-ancestors ${parents.length ? parents.join(" ") : "'none'"}`]),
    "sandbox allow-scripts",
  ].join("; ");
}

/** Everything the platform lets a page ask for, refused. (An iframe can only be given less than its parent allows, never more.) */
export const PERMISSIONS_POLICY = [
  "accelerometer", "autoplay", "camera", "clipboard-read", "clipboard-write", "display-capture", "encrypted-media", "fullscreen", "gamepad",
  "geolocation", "gyroscope", "hid", "idle-detection", "local-fonts", "magnetometer", "microphone", "midi", "payment", "picture-in-picture",
  "publickey-credentials-get", "screen-wake-lock", "serial", "usb", "xr-spatial-tracking",
]
  .map((f) => `${f}=()`)
  .join(", ");

export function shellHeaders(csp: string): Headers {
  return new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": PERMISSIONS_POLICY,
    "x-robots-tag": "noindex, nofollow",
    // The page changes only with a deployment, but the CSP is part of it: a short life lets a change of VIEWER_PARENT_ORIGINS take effect soon.
    "cache-control": "public, max-age=300",
  });
}

export async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let s = "";
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s);
}
