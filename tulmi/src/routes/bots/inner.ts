/**
 * ONE OF THE APP'S OWN ROUTES, CALLED AS THE SAME PERSON: what the bots area's routes use to build on the routes that already own a thing
 * (a job, a branch, a project's brain), so every check those make is made again, never skipped.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { INNER_MARK, innerMark } from "../../http/deviceScope.js";

/** An inner route's refusal, passed on as it was. */
export class Inner extends Error {
  constructor(readonly status: number, readonly body: unknown) { super(`inner ${status}`); }
}

export type InnerCall = <T = Record<string, unknown>>(req: FastifyRequest, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: Record<string, unknown>) => Promise<T>;

/** Calls `url` with the request's own authorization. Throws Inner for anything but a 2xx. */
export function innerCall(app: FastifyInstance): InnerCall {
  return async <T = Record<string, unknown>>(req: FastifyRequest, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: Record<string, unknown>): Promise<T> => {
    const r = await app.inject({
      method, url, ...(payload ? { payload } : {}),
      // Marked as the app's own call (http/deviceScope.ts): a terminal's sign-in reaches a route this way only through Xode's.
      headers: { authorization: String(req.headers["authorization"] ?? ""), [INNER_MARK]: innerMark(), ...(payload ? { "content-type": "application/json" } : {}) },
    });
    let parsed: unknown = null;
    try { parsed = r.body ? JSON.parse(r.body) : null; } catch { parsed = { message: r.body }; }
    if (r.statusCode < 200 || r.statusCode >= 300) throw new Inner(r.statusCode, parsed);
    return parsed as T;
  };
}
