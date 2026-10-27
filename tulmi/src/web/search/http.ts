/**
 * THE ONE WAY A SEARCH SOURCE GOES OUT: A GET THROUGH THE EGRESS GUARD, WITH
 * TEN SECONDS AND A SIZE CAP.
 *
 * Every source (sources/*.ts) asks the world through httpGet, and httpGet asks
 * through connectors/egress.ts: https only, public addresses only, checked at
 * connect time. The fetch is injectable (`fetchFn`) so the tests answer from
 * fixtures, and whatever fetch is behind it the limits are enforced here again,
 * as the page reader does (web/reader.ts): a fetch that forgets its timeout
 * cannot hang a search, and one that forgets its cap cannot flood us.
 *
 * Three things the public APIs need that a plain fetch does not give:
 *   - our User-Agent with a way to reach us (crates.io refuses a call without
 *     one, GitHub asks for one);
 *   - gzip handled by what the bytes ARE, not by what a header says: Node's own
 *     fetch has already inflated a gzip answer, an injected one has not, and
 *     Stack Exchange compresses every answer. A body that starts 1f 8b is
 *     inflated, with the same size cap on the inflated bytes;
 *   - the answer's headers and status come back even when the status is an
 *     error, because GitHub says "you are rate limited" in a header on a 403.
 *
 * Nothing here logs. An error carries a code (web/error.ts) and never the
 * address, which holds the question.
 */
import { gunzipSync } from "node:zlib";
import { DEFAULT_WEB_BOT_UA, getConfig } from "../../config.js";
import { EgressRefused, type FetchLike } from "../../connectors/egressTypes.js";
import { safeFetchWith } from "../safeFetch.js";
import { WebError } from "../error.js";
import { decodeBody } from "../extract.js";

/** Longest a source's answer may take, headers and body together. */
export const SEARCH_TIMEOUT_MS = 10_000;
/** Most bytes read from a source unless it says otherwise. */
export const SEARCH_MAX_BYTES = 1024 * 1024;
/** How much of an error's body is read. */
const ERROR_BODY_BYTES = 32 * 1024;
/** The most any source may ask for (PyPI's JSON for a package with a thousand releases). */
const HARD_MAX_BYTES = 8 * 1024 * 1024;

const guarded = new Map<number, FetchLike>();
/** The egress fetch with a time limit of its own (the usual one unless a caller asks for longer) and the hard size cap. */
function defaultFetch(timeoutMs: number): FetchLike {
  let f = guarded.get(timeoutMs);
  if (!f) { f = safeFetchWith({ timeoutMs, maxBytes: HARD_MAX_BYTES }); guarded.set(timeoutMs, f); }
  return f;
}

/** The User-Agent we say we are: the reader's WEB_BOT_UA. */
export function botUa(): string {
  try { return getConfig().WEB_BOT_UA; } catch { return DEFAULT_WEB_BOT_UA; }
}

export interface HttpOptions {
  fetchFn?: FetchLike;
  headers?: Record<string, string>;
  /** Default SEARCH_MAX_BYTES; at most 8 MiB. */
  maxBytes?: number;
  /** Default SEARCH_TIMEOUT_MS (10 seconds). Only the seed script asks for longer, for a slow sitemap. */
  timeoutMs?: number;
}

export interface HttpReply {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  /** The body as text (charset from the header, else UTF-8). */
  text: string;
}

/** Whatever went wrong in a fetch, as the WebError a caller can switch on. Never carries an address. */
function failure(err: unknown): WebError {
  if (err instanceof WebError) return err;
  if (err instanceof EgressRefused) {
    if (err.reason === "private_address") return new WebError("blocked_address");
    if (err.reason === "too_large") return new WebError("too_large");
    return new WebError("bad_url", err.reason);
  }
  const e = err as { name?: string; code?: string; cause?: unknown } | null;
  if (e?.cause instanceof EgressRefused) return failure(e.cause);
  const code = e?.code ?? (e?.cause as { code?: string } | undefined)?.code ?? "";
  if (e?.name === "AbortError" || e?.name === "TimeoutError" || /TIMEOUT|TIMEDOUT/.test(code)) return new WebError("timeout");
  return new WebError("bad_url", "unreachable");
}

/**
 * The body, read only as far as `max`; past it is too_large, or, with `soft`,
 * just the first `max` bytes. Aborts with `stop`.
 */
async function readUpTo(res: Response, max: number, stop: Promise<never>, soft = false): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  // A declared length is of the compressed bytes, which can only be smaller than what is inflated: over the cap already is over.
  if (declared > max && !soft) { await res.body?.cancel().catch(() => {}); throw new WebError("too_large"); }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) break;
      if (soft && total + value.byteLength > max) {
        chunks.push(value.subarray(0, max - total));
        total = max;
        await reader.cancel().catch(() => {});
        break;
      }
      total += value.byteLength;
      if (total > max) { await reader.cancel().catch(() => {}); throw new WebError("too_large"); }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** An error's bytes as they can be used: inflated if they are whole gzip, else as they are. */
function errorText(raw: Uint8Array): Uint8Array {
  try { return maybeGunzip(raw, ERROR_BODY_BYTES * 4); } catch { return new Uint8Array(0); }
}

/** The bytes inflated if they are gzip (starting 1f 8b), with the cap applied to what comes out. */
export function maybeGunzip(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  try {
    return gunzipSync(bytes, { maxOutputLength: max });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "ERR_BUFFER_TOO_LARGE") throw new WebError("too_large");
    throw new WebError("unsupported_type", "gzip");
  }
}

/**
 * One GET. Throws WebError for a call that did not get an answer (timeout,
 * refused address, too large); a status of 400 or more is returned, not thrown.
 */
export async function httpGet(url: string, o: HttpOptions = {}): Promise<HttpReply> {
  const max = Math.min(Math.max(o.maxBytes ?? SEARCH_MAX_BYTES, 1), HARD_MAX_BYTES);
  const timeoutMs = o.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const fetchFn = o.fetchFn ?? defaultFetch(timeoutMs);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const stop = new Promise<never>((_, reject) => ctl.signal.addEventListener("abort", () => reject(new WebError("timeout"))));
  stop.catch(() => {}); // rejecting after the read is over is not an unhandled rejection
  try {
    const res = await Promise.race([
      fetchFn(url, { method: "GET", headers: { "User-Agent": botUa(), ...o.headers }, signal: ctl.signal }),
      stop,
    ]);
    const ok = res.status >= 200 && res.status < 300;
    // An error's body is read too, a little of it: it is where a service says why (GitHub's "rate limit exceeded").
    const raw = await readUpTo(res, ok ? max : ERROR_BODY_BYTES, stop, !ok);
    const bytes = ok ? maybeGunzip(raw, max) : errorText(raw);
    return { status: res.status, headers: res.headers, bytes, text: bytes.byteLength ? decodeBody(bytes, res.headers.get("content-type") ?? "") : "" };
  } catch (err) {
    ctl.abort(); // whatever is still open goes
    throw failure(err);
  } finally {
    clearTimeout(timer);
  }
}

/** A GET whose answer is JSON. A status outside 2xx is `http_<status>`; a body that is not JSON is `unsupported_type`. */
export async function getJson<T = unknown>(url: string, o: HttpOptions = {}): Promise<{ data: T; headers: Headers }> {
  const r = await httpGet(url, { ...o, headers: { Accept: "application/json", ...o.headers } });
  if (r.status < 200 || r.status >= 300) throw new WebError(`http_${r.status}`);
  try {
    return { data: JSON.parse(r.text) as T, headers: r.headers };
  } catch {
    throw new WebError("unsupported_type", "json");
  }
}

/** A GET whose answer is text (HTML, XML). A status outside 2xx is `http_<status>`. */
export async function getText(url: string, o: HttpOptions = {}): Promise<{ text: string; status: number; headers: Headers }> {
  const r = await httpGet(url, o);
  if (r.status < 200 || r.status >= 300) throw new WebError(`http_${r.status}`);
  return { text: r.text, status: r.status, headers: r.headers };
}
