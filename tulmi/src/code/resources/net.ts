/**
 * THE ONE WAY LAYER 6 SENDS A POST: THROUGH THE EGRESS GUARD, WITH TEN SECONDS AND A SIZE CAP.
 *
 * Layer 3's httpGet (web/search/http.ts) is a GET. OSV's queries are POSTs with a
 * JSON body, so this is the same discipline for them: https only and public
 * addresses only (connectors/egress.ts), our User-Agent, a time limit, a cap on
 * how much is read, gzip handled by the bytes, and an injectable `fetchFn` so the
 * tests answer from fixtures. A status outside 2xx is `http_<status>`; a body that
 * is not JSON is `unsupported_type`. The body that was sent is never in an error.
 */
import { gunzipSync } from "node:zlib";
import { egressFetchWith, type FetchLike } from "../../connectors/egress.js";
import { WebError } from "../../web/error.js";
import { botUa } from "../../web/search/http.js";

export const POST_TIMEOUT_MS = 10_000;
export const POST_MAX_BYTES = 2 * 1024 * 1024;

export interface PostOptions { fetchFn?: FetchLike; timeoutMs?: number; maxBytes?: number }

let guarded: FetchLike | null = null;

export async function postJson<T = unknown>(url: string, body: unknown, o: PostOptions = {}): Promise<T> {
  const timeoutMs = o.timeoutMs ?? POST_TIMEOUT_MS;
  const max = o.maxBytes ?? POST_MAX_BYTES;
  const fetchFn = o.fetchFn ?? (guarded ??= egressFetchWith({ timeoutMs: POST_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024 }));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "POST", signal: ctl.signal, body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": botUa() },
    });
    if (res.status < 200 || res.status >= 300) { await res.body?.cancel().catch(() => {}); throw new WebError(`http_${res.status}`); }
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try { bytes = gunzipSync(bytes, { maxOutputLength: max }); } catch { throw new WebError("too_large"); }
    }
    if (bytes.byteLength > max) throw new WebError("too_large");
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      throw new WebError("unsupported_type", "json");
    }
  } catch (err) {
    if (err instanceof WebError) throw err;
    const e = err as { name?: string; cause?: { name?: string } } | null;
    if (e?.name === "AbortError" || e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError") throw new WebError("timeout");
    throw new WebError("bad_url", "unreachable");
  } finally {
    clearTimeout(timer);
  }
}
