/**
 * A TERMINAL'S SIGN-IN IS ONLY FOR XODE (docs/xode-cli.md "Scope").
 *
 * A request signed with a terminal's device token (Authorization: Bearer xdt_…, auth/deviceTokens.ts) may reach Xode's routes
 * and nothing else: /v1/code/…, /v1/bots/code/…, the terminal's own /v1/auth/device…, and /v1/rooms/… (a job's live room, kept
 * for when this server serves one; today it is the jobs Worker's, reached with a ticket from /v1/code/…). Everything else
 * answers 403 device_scope, before its handler runs.
 *
 * One hook for the whole app, because resolveUser only sees a header, not the route. It reads the route the request matched
 * (its pattern, so an odd spelling of a path cannot pass for another), or the path itself when nothing matched.
 *
 * WebSockets that take their sign-in in a message, not the upgrade's header (/v1/live, the live dictation), are outside the
 * scope too: they turn a device token away themselves (isDeviceBearer).
 *
 * One way past it: a route of Xode's calling another of the app's own routes as the same person (routes/bots/inner.ts: the
 * plan flow's mockup and its build). Such a call carries INNER_MARK with a secret made when this process starts, which no
 * request from outside can know; so a terminal reaches those routes only through Xode's own, never directly.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isDeviceBearer } from "../auth/deviceTokens.js";

/** The header an inner call carries, and its value: this process's own, never sent anywhere but app.inject. */
export const INNER_MARK = "x-tulmi-inner";
const INNER_SECRET = randomBytes(32).toString("hex");
export const innerMark = (): string => INNER_SECRET;
const isInner = (v: unknown): boolean => {
  if (typeof v !== "string" || v.length !== INNER_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(v), Buffer.from(INNER_SECRET));
};

const PREFIXES = ["/v1/code/", "/v1/bots/code/", "/v1/rooms/", "/v1/auth/device/"];

/** Whether a route a device token may reach. "/v1/auth/devices" (the person's list) is not one of them. */
export function inDeviceScope(path: string): boolean {
  const p = path.split(/[?#]/, 1)[0] ?? "";
  return p === "/v1/auth/device" || PREFIXES.some((x) => p.startsWith(x));
}

const routeOf = (req: FastifyRequest): string => req.routeOptions?.url || req.url;

export function registerDeviceScope(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!isDeviceBearer(req.headers.authorization)) return;
    if (inDeviceScope(routeOf(req))) return;
    if (isInner(req.headers[INNER_MARK])) return;
    return reply.code(403).send({ code: "device_scope", message: "This sign-in is only for Xode in the terminal." });
  });
}
