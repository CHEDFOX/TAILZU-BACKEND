/**
 * THE NATIVE LOOKS: the designs the Home Screen widgets, the iOS Live Activity and the Android notice draw, and the files they
 * draw with (experience/native/*; shared/native/looks.json; docs/native-looks.md).
 *
 *   GET    /v1/native/looks?v=            the catalog this build can draw, for this platform (public read, cached by its v).
 *                                         Designs above the build's format are left out, Live Activity designs go only to iOS,
 *                                         and the targeting rules are stripped — a phone never sees who else gets what
 *   GET    /v1/native/art/<sha>@<n>.png   one art file BY CONTENT. Immutable, a year in the cache, and no cookies: a design can
 *                                         never carry a tracking pixel, because the URL holds nothing but the hash
 *   GET    /v1/native/font/<sha>          one hooked font file, the same way
 *   PUT    /v1/admin/native/looks[?dry=1] push a catalog without a deploy (ADMIN_SECRET): every design checked as all five sides
 *                                         read it, `v` above the HIGH-WATER MARK, `since` computed here. dry: only checked, and
 *                                         it answers with every problem and what each design would lose
 *   DELETE /v1/admin/native/looks         take a pushed one back: the file's is served again, under a HIGHER v
 *
 * LAUNCH DARK: with NATIVE_LOOKS off (the default) the read answers 404 and the bootstrap names no catalog, so every widget
 * draws the hand-written view in its own build. The admin routes still work, so a catalog can be published and checked long
 * before anyone is allowed to see it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { requireAdmin } from "../../control/index.js";
import {
  activeNativeLooks, cleanCatalog, dropPushedNativeLooks, drawsFormat, nativeFilesDir, nativeSwitches, NLOOK_SERVER_FORMAT,
  nudgeLooks, pushNativeLooks, servedCatalog, type Platform,
} from "../../experience/native/catalog.js";
import { pushEngine } from "../../push/index.js";
import { NLOOK_CAPS } from "../../../../shared/types/nlook.js";

const LOOKS_ROUTE = "/v1/native/looks";
const ADMIN_ROUTE = "/v1/admin/native/looks";

/**
 * A file name that is nothing but a content hash: 64 hex characters, and for art a screen scale. Never a path from a request.
 * A font is the BARE hash with no extension, which is what the phone asks for and what the publish check requires on disk.
 */
const ART_FILE = /^([0-9a-f]{64})@([123])\.png$/;
const FONT_FILE = /^[0-9a-f]{64}$/;

const header = (req: FastifyRequest, k: string): string => {
  const v = req.headers[k];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
};

/**
 * What this build says it can draw. A phone asks with "?can=NativeLook1,WidgetBoard1"; anything it does not say, it does not
 * get. A request with no list gets the baseline, NativeLook1, because only a build that carries the renderer asks at all.
 */
function canOf(req: FastifyRequest): Set<string> {
  const raw = String((req.query as { can?: unknown } | undefined)?.can ?? "");
  const can = new Set(raw.split(/[,\s]+/).filter(Boolean).slice(0, 8));
  if (!can.size) can.add(NLOOK_CAPS.look1);
  return can;
}

/** Which phone is asking. An unknown client is treated as iOS, whose projection is the safe one to hand anybody. */
function platformOf(req: FastifyRequest): Platform {
  const q = (req.query as { platform?: unknown } | undefined)?.platform;
  if (q === "android" || q === "ios") return q;
  return /okhttp|dalvik|android/i.test(header(req, "user-agent")) ? "android" : "ios";
}

export function registerNativeLooksRoutes(app: FastifyInstance, deps: { rateLimit: unknown }): void {
  const rl = { config: deps.rateLimit as never };

  app.get(LOOKS_ROUTE, rl, async (req, reply) => {
    const can = canOf(req);
    const platform = platformOf(req);
    const c = servedCatalog(can, platform);
    if (!c) {
      // Honest about which of the three it is, so a phone's log says why it drew its own view.
      const why = !nativeSwitches().looks ? "Native looks are off on this server"
        : drawsFormat(can) < 1 ? "This build draws no nlook format"
          : "No looks catalog on this server";
      return reply.code(404).send({ code: "not_found", message: why });
    }
    const etag = `"nlook-${c.v}-${Math.min(drawsFormat(can), NLOOK_SERVER_FORMAT)}-${platform}"`;
    // The answer differs by platform and by what the build draws, and `platform` is only a HINT: without it the platform is
    // sniffed off the User-Agent. A shared cache told this was `public` with no `Vary` could hand the iOS projection (the
    // Activity designs, the accessory roots) to an Android phone, or the reverse. Both inputs are named.
    reply.header("etag", etag).header("vary", "User-Agent").header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(c);
  });

  /**
   * One file, by content. The NAME IS THE ONLY INPUT and it must be a hash, so no path from a request ever reaches the disk.
   * Immutable by construction: a changed file is a different URL. No cookies, no id, nothing that ties a fetch to a person —
   * which is what lets a design carry art at all (section 7).
   */
  const sendFile = (reply: FastifyReply, kind: "art" | "fonts", name: string, pattern: RegExp, type: string) => {
    if (!pattern.test(name)) return reply.code(400).send({ code: "bad_request", message: "A file is named by its content hash." });
    const dir = nativeFilesDir(kind);
    const file = dir ? join(dir, name) : "";
    if (!file || !existsSync(file)) return reply.code(404).send({ code: "not_found", message: "No such file." });
    reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("content-type", type)
      .header("content-length", String(statSync(file).size))
      .header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(file));
  };

  const fileOf = (req: FastifyRequest): string => String((req.params as { file?: unknown }).file ?? "");

  app.get("/v1/native/art/:file", rl, async (req, reply) => sendFile(reply, "art", fileOf(req), ART_FILE, "image/png"));
  app.get("/v1/native/font/:file", rl, async (req, reply) => sendFile(reply, "fonts", fileOf(req), FONT_FILE, "font/ttf"));

  /**
   * "A new catalog is out", to the phones that can draw one. Started and not waited for: a publish must answer at once, and
   * the batches are deliberately spread over ten minutes. `?nudge=0` skips it (a correction a moment after a publish).
   */
  const nudge = (app2: FastifyInstance, v: number, on: boolean): void => {
    if (!on) return;
    const engine = pushEngine();
    if (!engine) return;
    void nudgeLooks(v, {
      phones: (cap, only) => engine.everyoneWith(cap, only ? { only } : {}),
      send: (messages) => engine.sendData(messages as never),
      log: { info: (m) => app2.log.info(m), warn: (m) => app2.log.warn(m) },
    }).catch((err) => app2.log.warn(`native looks: the nudge failed (${(err as Error)?.name ?? "error"})`));
  };

  app.put(ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = req.query as { dry?: string; nudge?: string } | undefined;
    const dry = q?.dry === "1";
    const r = pushNativeLooks(req.body, { dry });
    if (!r.ok) return reply.code(r.status).send({ code: r.status === 409 ? "conflict" : "bad_request", errors: r.errors });
    // What each design would lose, so a dry run reads like a review rather than a yes.
    const designs = cleanCatalog(req.body).map((c) => ({ id: c.id, verdict: c.verdict, issues: c.issues }));
    nudge(app, r.v, !dry && q?.nudge !== "0" && q?.nudge !== "false");
    return reply.send({ ok: true, v: r.v, dry, since: r.since, designs });
  });

  app.delete(ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const v = dropPushedNativeLooks();
    const q = req.query as { nudge?: string } | undefined;
    // A rollback changes the active v too, so the phones are told about it the same way.
    if (v !== null) nudge(app, v, q?.nudge !== "0" && q?.nudge !== "false");
    return reply.send({ ok: true, v, serving: activeNativeLooks()?.v ?? null });
  });
}
