/**
 * THE ORACLE, FROM THE VPS'S SIDE: A SIGNED, STREAMED CALL TO THE PYTHON SERVICE IN oracle-worker/ (docs/oracle.md).
 *
 * The service is Plutto's oracle: it routes the question to the subsystems that answer it, computes them from the person's birth details, weighs
 * them, and writes the reply (Claude Sonnet 5.5 at low thinking, with spares from other companies, chosen and failed over on its side). Every call
 * is signed exactly as the media worker's are (media/worker.ts `workerSignature`: timestamp, nonce, method, path and the body's hash), with
 * ORACLE_WORKER_SECRET. The answer comes back as NDJSON: status lines, the words as they are written, and the result (or one error line, with
 * a message already written for a person).
 */
import { randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { workerSignature } from "../media/worker.js";
import type { Sky } from "./birth.js";

export interface OracleTurn { role: "user" | "assistant"; content: string }

export interface OracleAsk {
  message: string;
  history: OracleTurn[];
  sky: Sky | null;
  route: unknown;
  /** Not the person's id: a hash of it, so the service can keep one model for the whole conversation (core/llm.py on its side). */
  session: string;
  language?: string;
}

export interface OracleCast { deck: string; title: string; spread: string; picks: Array<{ position: string; name: string; reversed: boolean }> }

export interface OracleAnswer {
  text: string;
  route: unknown;
  cast: OracleCast | null;
  /** Whether a chart was read (birth details were known). */
  chart: boolean;
  model: string | null;
  usd: number;
}

export type OracleEvent = { t: "status"; stage: string } | { t: "text"; text: string };

export interface OracleWorker {
  answer(ask: OracleAsk, on: (e: OracleEvent) => void, signal?: AbortSignal): Promise<OracleAnswer>;
}

/** The service could not answer: down, busy, or no model reachable on its side. `message` is for the person. */
export class OracleUnavailable extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "OracleUnavailable"; }
}

const PATH = "/v1/answer";
const TIMEOUT_MS = 150_000;
const DOWN = "The Oracle couldn't be reached just now. Nothing was lost; try again in a moment.";

type FetchFn = typeof fetch;

/** The worker, or null when ORACLE_WORKER_URL and ORACLE_WORKER_SECRET are not both set. */
export function oracleWorker(o: { fetchFn?: FetchFn; url?: string; secret?: string; now?: () => number } = {}): OracleWorker | null {
  const c = getConfig();
  const url = (o.url ?? c.ORACLE_WORKER_URL ?? "").replace(/\/+$/, "");
  const secret = o.secret ?? c.ORACLE_WORKER_SECRET ?? "";
  if (!url || !secret) return null;
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? Date.now;

  return {
    async answer(ask, on, signal) {
      const body = Buffer.from(JSON.stringify({
        message: ask.message, history: ask.history,
        birth: ask.sky ? { year: ask.sky.year, month: ask.sky.month, day: ask.sky.day, hour: ask.sky.hour, minute: ask.sky.minute, lat: ask.sky.lat, lng: ask.sky.lng, place: ask.sky.place.slice(0, 120) } : null,
        last_route: ask.route ?? null, session: ask.session, language: (ask.language ?? "en").slice(0, 16), stream: true,
      }), "utf8");
      const timestamp = Math.floor(now() / 1000);
      const nonce = randomBytes(16).toString("hex");
      const signature = workerSignature(secret, { timestamp, nonce, method: "POST", pathWithQuery: PATH, body });
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchFn(`${url}${PATH}`, {
          method: "POST", body,
          headers: { "content-type": "application/json", "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": signature },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if ((err as { name?: unknown } | null)?.name === "AbortError" && signal?.aborted) throw err;
        throw new OracleUnavailable("down", DOWN);
      }
      if (!res.ok || !res.body) {
        const e = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
        throw new OracleUnavailable(e?.code ?? "down", e?.message && res.status >= 500 ? e.message : DOWN);
      }

      let result: OracleAnswer | null = null;
      const decoder = new TextDecoder();
      let buf = "";
      const line = (raw: string): void => {
        if (!raw.trim()) return;
        let e: { t?: string; stage?: string; text?: string; code?: string; message?: string; result?: Record<string, unknown> };
        try { e = JSON.parse(raw); } catch { return; }
        if (e.t === "status" && typeof e.stage === "string") on({ t: "status", stage: e.stage });
        else if (e.t === "text" && typeof e.text === "string") on({ t: "text", text: e.text });
        else if (e.t === "error") throw new OracleUnavailable(String(e.code ?? "failed"), String(e.message ?? DOWN));
        else if (e.t === "result" && e.result) {
          const r = e.result;
          result = {
            text: String(r.text ?? ""), route: r.route_state ?? null, cast: (r.cast as OracleCast | null) ?? null, chart: r.chart === true,
            model: typeof r.model === "string" ? r.model : null, usd: typeof r.usd === "number" && Number.isFinite(r.usd) ? r.usd : 0,
          };
        }
      };
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        line(buf + decoder.decode());
      } catch (err) {
        if (err instanceof OracleUnavailable) throw err;
        if ((err as { name?: unknown } | null)?.name === "AbortError" && signal?.aborted) throw err;
        throw new OracleUnavailable("down", DOWN);
      } finally {
        reader.releaseLock();
      }
      if (!result) throw new OracleUnavailable("down", DOWN);
      return result;
    },
  };
}
