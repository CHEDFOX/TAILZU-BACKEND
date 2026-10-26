/**
 * WHAT READING A PAGE CAN FAIL WITH.
 *
 * One error type for the whole of src/web, with a code the caller can switch
 * on and a sentence a person may read. The sentence never holds the address
 * that was asked for (it may carry a query string, and nothing here logs one),
 * and the code is the only thing a caller should depend on:
 *
 *   blocked_address   the host is, or resolves to, a private, loopback or
 *                     reserved address (connectors/egress.ts decides)
 *   bad_url           not a web address we will fetch: not http(s), a port we
 *                     do not use, a name:password@, no such host, too many
 *                     redirects, or a server we could not reach at all
 *   too_large         the answer was over the size cap
 *   timeout           it took longer than the time we give a page
 *   http_<status>     the site answered with an error status (http_404, http_503)
 *   unsupported_type  a PDF, an image, a download: not text we can read
 *   robots            the site's robots.txt asks indexers to stay away
 *                     (only ever for purpose "index")
 *   needs_browser     the page only exists once its JavaScript has run, and
 *                     there is no browser to run it in
 */
export type WebErrorCode =
  | "blocked_address" | "bad_url" | "too_large" | "timeout" | "unsupported_type" | "robots" | "needs_browser"
  | `http_${number}`;

/** Plain words for each code. */
export function webErrorWords(code: WebErrorCode): string {
  if (code.startsWith("http_")) return `That site answered with an error (${code.slice(5)}).`;
  switch (code) {
    case "blocked_address": return "That address points into a private network, so Tailzu won't connect to it.";
    case "bad_url": return "That isn't a web address Tailzu can open.";
    case "too_large": return "That page was too big to read.";
    case "timeout": return "That page took too long to answer.";
    case "unsupported_type": return "That isn't a web page or a text file (it may be a PDF, an image or a download).";
    case "robots": return "That site asks automated readers to stay away from this page.";
    case "needs_browser": return "That page only shows up once its scripts have run, and there is no browser to run them in.";
    default: return "That page could not be read.";
  }
}

export class WebError extends Error {
  /** The status behind an `http_<status>` code, else undefined. */
  readonly status?: number;

  /**
   * `detail` is one short word for logs and tests ("no_address", "unreachable",
   * "render_failed"): never an address, never any of the page.
   */
  constructor(readonly code: WebErrorCode, readonly detail?: string) {
    super(webErrorWords(code));
    this.name = "WebError";
    if (code.startsWith("http_")) this.status = Number(code.slice(5));
  }
}
