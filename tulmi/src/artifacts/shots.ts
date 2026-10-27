/**
 * SCREENSHOTS: OF A PAGE ON THE WEB, AND OF AN ARTIFACT IN THE VIEWER (docs/artifacts.md section 11).
 *
 *   shootUrl(url, {viewport, cookies?, waitFor?})                    a page, through Cloudflare Browser Rendering's /screenshot endpoint (or, with
 *                                                                    WEB_BROWSER=local, our own headless Chrome over the DevTools protocol)
 *   shootArtifact(artifact, version, kit, viewport)                  an artifact as the viewer draws it: a host page (shothost.ts) that frames the viewer,
 *                                                                    posts `load`, and marks `#done` when the viewer says `rendered`; the shot waits for `#done`
 *
 * Both give PNG bytes (checked: the signature, and at most 8 MB). Viewports are the two the compare uses: mobile 390 x 844 and desktop 1280 x 800.
 *
 * WHAT THE ENDPOINT IS (developers.cloudflare.com/browser-run/quick-actions/screenshot-endpoint/, checked 2026-10-27):
 *   POST https://api.cloudflare.com/client/v4/accounts/<account>/browser-run/screenshot     (the API reference still says /browser-rendering/...: that one is
 *   tried on a 404, as cloudflare.ts does for /content)
 *   { url | html (one of the two), viewport: {width, height, deviceScaleFactor, isMobile, hasTouch}, cookies: [{name, value, url|domain, path...}],
 *     waitForSelector: {selector, timeout, visible}   <- an OBJECT, not a string
 *     gotoOptions: {waitUntil, timeout <= 60 s}, screenshotOptions: {type: "png", fullPage}, allowRequestPattern: [regex], bestAttempt }
 * and the answer is the image itself (the docs' examples write it to a .png); if it is JSON with the picture in `result` (base64) that is read too.
 *
 * WHERE SHOTS ARE KEPT. The jobs Worker has no R2 bound and tulmi has none at all, so a shot is kept in the artifact's saved data (artifact_data, migration
 * 0032: a key and a JSON value of up to 64 KB, so a picture is cut into pieces of 40 KB and stored as base64), in a scope of its own for the owner
 * (`shotScope`: a UUID made from the owner's id, which the table's check accepts and which no route of the artifact's own data can name, so the artifact
 * can neither read its screenshots nor spend its 500 keys on them), under keys that begin `_tz/shot/`, with an index that is kept to 40 shots and 480
 * keys and dropped as it expires (7 days). The id of a shot is 128 random bits. The link to one is
 * SIGNED (HMAC over the owner, the artifact, the shot and the time) and is served only to the owner's own signed-in session
 * (`GET /v1/artifacts/:id/shots/:shotId?exp=&sig=`, routes/artifacts.ts), so a link that leaks is of no use to anyone else. MemoryShotStore is the same for tests.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { isIpLiteral } from "../connectors/egressTypes.js";
import { CLOUDFLARE_API } from "../web/browser/cloudflare.js";
import { BrowserError, type Screenshotter, type ShotOptions } from "../web/browser/types.js";
import { isPrivateName } from "../web/workerSafeFetch.js";
import type { DesignKitCss } from "./protocol.js";
import { isPng } from "./pixels.js";
import { SHOT_DONE_SELECTOR, SHOT_VIEWPORTS, shotAllowPatterns, shotHostHtml, viewerOrigin, type ViewportName } from "./shothost.js";

export { SHOT_VIEWPORTS, VIEWPORT_NAMES } from "./shothost.js";
export type { ViewportName } from "./shothost.js";

export type ShotErrorCode = "no_browser" | "no_viewer" | "bad_url" | "blocked" | "timeout" | "busy" | "unavailable" | "failed" | "not_png" | "store";

export class ShotError extends Error {
  constructor(readonly code: ShotErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ShotError";
  }
}

/** A picture is at most this big. */
export const SHOT_MAX_BYTES = 8 * 1024 * 1024;
/** Shots are kept this long, and so are the links to them. */
export const SHOT_TTL_MS = 7 * 24 * 60 * 60_000;
const PATHS = ["browser-run", "browser-rendering"] as const;

export interface ShootDeps {
  /** Cloudflare's Browser Rendering: the account and a token with "Browser Rendering - Edit". Absent: not used. */
  accountId?: string;
  apiToken?: string;
  baseUrl?: string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  /** Our own Chrome (web/browser getScreenshotter()), used when Cloudflare is not set up. */
  local?: Screenshotter | null;
  /** The viewer the shots of artifacts are made with (the one deployed for shots: VIEWER_PARENT_ORIGINS=null). */
  viewerUrl?: string;
}

/** The deps from the settings: WEB_BROWSER=cloudflare gives the REST endpoint, "local" gives `local` (the caller passes it: the Chrome engine is not in a Worker). */
export function shootDepsFromConfig(o: { local?: Screenshotter | null; fetchFn?: ShootDeps["fetchFn"] } = {}): ShootDeps {
  const cfg = getConfig();
  const viewerUrl = cfg.ARTIFACT_SHOT_VIEWER_URL || undefined;
  return {
    ...(cfg.WEB_BROWSER === "cloudflare" && cfg.CLOUDFLARE_ACCOUNT_ID && cfg.CLOUDFLARE_API_TOKEN ? { accountId: cfg.CLOUDFLARE_ACCOUNT_ID, apiToken: cfg.CLOUDFLARE_API_TOKEN } : {}),
    ...(cfg.WEB_BROWSER === "local" && o.local ? { local: o.local } : {}),
    ...(o.fetchFn ? { fetchFn: o.fetchFn } : {}),
    ...(viewerUrl ? { viewerUrl } : {}),
  };
}

/** Why shots cannot be made here, in a sentence; null when they can. */
export function shootProblem(d: ShootDeps, o: { artifact?: boolean } = {}): string | null {
  if (!(d.accountId && d.apiToken) && !d.local) return "No browser is set up for screenshots (WEB_BROWSER=cloudflare with a Cloudflare account and token, or WEB_BROWSER=local).";
  if (o.artifact && !d.viewerUrl) return "No viewer is set up for screenshots of a design (ARTIFACT_SHOT_VIEWER_URL).";
  return null;
}

// ------------------------------------------------------------------ the options

export interface Cookie { name: string; value: string; url?: string; domain?: string; path?: string }

export interface ShootUrlOptions {
  viewport: ViewportName | { width: number; height: number; mobile?: boolean };
  cookies?: Cookie[];
  /** Wait for an element (a CSS selector) after the page has loaded, at most `timeoutMs`. */
  waitFor?: { selector: string; timeoutMs?: number };
  /** The whole shot. Default 45 s. */
  timeoutMs?: number;
}

const sizeOf = (v: ShootUrlOptions["viewport"]): { width: number; height: number; mobile: boolean } =>
  typeof v === "string" ? { width: SHOT_VIEWPORTS[v].width, height: SHOT_VIEWPORTS[v].height, mobile: SHOT_VIEWPORTS[v].mobile } : { width: v.width, height: v.height, mobile: v.mobile === true };

function checkTarget(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ShotError("bad_url", "That is not an address."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ShotError("bad_url", "Only http and https addresses can be shot.");
  if (isIpLiteral(u.hostname) || isPrivateName(u.hostname)) throw new ShotError("blocked", "That address is a private one.");
  return u;
}

// ------------------------------------------------------------------ the REST call

interface RestBody { url?: string; html?: string; waitForSelector?: { selector: string; timeout: number; visible?: true }; allowRequestPattern?: string[]; cookies?: Cookie[] }

function restBody(b: RestBody, vp: { width: number; height: number; mobile: boolean }, timeoutMs: number, waitUntil: "load" | "networkidle2"): Record<string, unknown> {
  return {
    ...(b.url !== undefined ? { url: b.url } : { html: b.html }),
    viewport: { width: vp.width, height: vp.height, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile },
    screenshotOptions: { type: "png", fullPage: false },
    // A page that never settles (a dev server's live-reload socket) is shot as it stands.
    gotoOptions: { waitUntil, timeout: Math.min(60_000, Math.max(5_000, timeoutMs - 5_000)) },
    bestAttempt: true,
    ...(b.waitForSelector ? { waitForSelector: b.waitForSelector } : {}),
    ...(b.allowRequestPattern ? { allowRequestPattern: b.allowRequestPattern } : {}),
    ...(b.cookies?.length ? { cookies: b.cookies } : {}),
  };
}

async function rest(d: ShootDeps, body: Record<string, unknown>, timeoutMs: number): Promise<Uint8Array> {
  const base = (d.baseUrl ?? CLOUDFLARE_API).replace(/\/+$/, "");
  const call = d.fetchFn ?? ((url, init) => fetch(url, init));
  let res: Response | null = null;
  for (const path of PATHS) {
    try {
      res = await call(`${base}/accounts/${encodeURIComponent(d.accountId!)}/${path}/screenshot?cacheTTL=0`, {
        method: "POST",
        headers: { Authorization: `Bearer ${d.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs + 15_000),
      });
    } catch (err) {
      const e = err as { name?: string } | null;
      if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new ShotError("timeout", "Cloudflare did not answer in time.");
      throw new ShotError("unavailable", "Cloudflare could not be reached.");
    }
    if (res.status !== 404) break;
    await res.body?.cancel().catch(() => undefined);
  }
  if (!res) throw new ShotError("unavailable", "Cloudflare could not be reached.");
  const drop = async () => { await res!.body?.cancel().catch(() => undefined); };
  if (res.status === 429) { await drop(); throw new ShotError("busy", "Cloudflare's browsers are busy."); }
  if (res.status === 401 || res.status === 403) { await drop(); throw new ShotError("unavailable", "Cloudflare refused the API token."); }
  if (res.status === 408 || res.status === 504) { await drop(); throw new ShotError("timeout", "The page took too long."); }
  if (res.status >= 500) { await drop(); throw new ShotError("unavailable", `Cloudflare answered ${res.status}.`); }

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  let bytes: Uint8Array;
  if (type.startsWith("image/") || type.startsWith("application/octet-stream")) {
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    let json: { success?: boolean; result?: unknown; errors?: Array<{ message?: string }> };
    try { json = (await res.json()) as typeof json; } catch { throw new ShotError("failed", "The answer could not be read."); }
    if (!res.ok || json.success === false) {
      const msg = (json.errors ?? []).map((e) => e.message ?? "").join(" ").toLowerCase();
      throw new ShotError(/timeout|timed out|selector|waiting/.test(msg) ? "timeout" : "failed", "The page could not be shot.");
    }
    const b64 = typeof json.result === "string" ? json.result : typeof (json.result as { screenshot?: unknown } | null)?.screenshot === "string" ? ((json.result as { screenshot: string }).screenshot) : "";
    if (!b64) throw new ShotError("failed", "The answer held no picture.");
    bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  }
  if (!res.ok) throw new ShotError("failed", "The page could not be shot.");
  if (bytes.length > SHOT_MAX_BYTES) throw new ShotError("failed", "The picture is too big.");
  if (!isPng(bytes)) throw new ShotError("not_png", "What came back was not a PNG.");
  return bytes;
}

async function local(d: ShootDeps, o: ShotOptions): Promise<Uint8Array> {
  try {
    const bytes = await d.local!(o);
    if (bytes.length > SHOT_MAX_BYTES) throw new ShotError("failed", "The picture is too big.");
    if (!isPng(bytes)) throw new ShotError("not_png", "What came back was not a PNG.");
    return bytes;
  } catch (err) {
    if (err instanceof ShotError) throw err;
    if (err instanceof BrowserError) throw new ShotError(err.code === "timeout" ? "timeout" : err.code === "blocked" || err.code === "bad_url" ? "blocked" : err.code === "busy" ? "busy" : "failed", "The page could not be shot.");
    throw new ShotError("failed", "The page could not be shot.");
  }
}

// ------------------------------------------------------------------ the two shots

/** A page, as PNG bytes. The address is judged first (http or https, a public name) like the page reader's. */
export async function shootUrl(rawUrl: string, o: ShootUrlOptions, d: ShootDeps = shootDepsFromConfig()): Promise<Uint8Array> {
  const u = checkTarget(rawUrl);
  const vp = sizeOf(o.viewport);
  const timeoutMs = o.timeoutMs ?? 45_000;
  const cookies = o.cookies?.map((c) => (c.domain || c.url ? c : { ...c, url: u.origin }));
  if (d.accountId && d.apiToken) {
    return rest(d, restBody({
      url: u.href, ...(cookies ? { cookies } : {}),
      ...(o.waitFor ? { waitForSelector: { selector: o.waitFor.selector, timeout: Math.min(60_000, o.waitFor.timeoutMs ?? 20_000), visible: true as const } } : {}),
    }, vp, timeoutMs, "networkidle2"), timeoutMs);
  }
  if (d.local) {
    return local(d, {
      url: u.href, viewport: vp, ...(cookies ? { cookies } : {}), timeoutMs,
      ...(o.waitFor ? { waitForSelector: o.waitFor.selector, selectorTimeoutMs: o.waitFor.timeoutMs ?? 20_000 } : {}),
    });
  }
  throw new ShotError("no_browser", shootProblem(d) ?? "No browser is set up.");
}

/** What `shootArtifact` needs of an artifact. */
export interface ShotArtifact { id: string; type: "html" | "react" | "svg" | "mermaid" | "markdown"; title: string; content: string }

/**
 * An artifact at `version`, as the viewer draws it with the project's `kit`, at `viewport`. Cloudflare is sent the host page as `html` and
 * `waitForSelector: #done`, and may make only the requests the viewer needs (its own origin and Google's font hosts).
 */
export async function shootArtifact(
  artifact: ShotArtifact, version: number, kit: DesignKitCss | undefined, viewport: ViewportName, d: ShootDeps = shootDepsFromConfig(), o: { theme?: "light" | "dark"; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  if (!d.viewerUrl || !viewerOrigin(d.viewerUrl)) throw new ShotError("no_viewer", shootProblem(d, { artifact: true }) ?? "No viewer is set up for screenshots of a design.");
  const vp = sizeOf(viewport);
  const html = shotHostHtml({ viewerUrl: d.viewerUrl, artifact: { ...artifact, version }, ...(kit ? { kit } : {}), ...(o.theme ? { theme: o.theme } : {}), viewport: vp });
  const timeoutMs = o.timeoutMs ?? 45_000;
  const allow = shotAllowPatterns(d.viewerUrl);
  if (d.accountId && d.apiToken) {
    return rest(d, restBody({ html, waitForSelector: { selector: SHOT_DONE_SELECTOR, timeout: 25_000 }, allowRequestPattern: allow }, vp, timeoutMs, "load"), timeoutMs);
  }
  if (d.local) return local(d, { html, viewport: vp, waitForSelector: SHOT_DONE_SELECTOR, selectorTimeoutMs: 25_000, allow: allow.map((p) => new RegExp(p)), timeoutMs });
  throw new ShotError("no_browser", shootProblem(d) ?? "No browser is set up.");
}

// ------------------------------------------------------------------ keeping shots

export interface ShotMeta {
  artifactId: string;
  version: number;
  kind: "built" | "approved";
  viewport: ViewportName;
  jobId?: string;
  at: number;
}

export interface StoredShot { png: Uint8Array; meta: ShotMeta; expiresAt: number }

export interface ShotStore {
  put(userId: string, meta: ShotMeta, png: Uint8Array, o?: { ttlMs?: number }): Promise<{ id: string }>;
  /** The picture, or null when there is none, it is another artifact's, or it has expired. */
  get(userId: string, artifactId: string, id: string): Promise<StoredShot | null>;
}

const newShotId = (): string => randomBytes(16).toString("hex");
export const isShotId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);

export class MemoryShotStore implements ShotStore {
  private readonly rows = new Map<string, StoredShot & { userId: string }>();
  constructor(private readonly now: () => number = Date.now) {}
  async put(userId: string, meta: ShotMeta, png: Uint8Array, o: { ttlMs?: number } = {}) {
    const id = newShotId();
    this.rows.set(id, { userId, png: Uint8Array.from(png), meta: { ...meta }, expiresAt: this.now() + (o.ttlMs ?? SHOT_TTL_MS) });
    return { id };
  }
  async get(userId: string, artifactId: string, id: string) {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId || r.meta.artifactId !== artifactId || r.expiresAt <= this.now()) return null;
    return { png: Uint8Array.from(r.png), meta: { ...r.meta }, expiresAt: r.expiresAt };
  }
  get size(): number { return this.rows.size; }
}

/** The part of the artifact store a shot needs (store.ts ArtifactStore). */
export interface ShotData {
  dataGet(id: string, scope: string, key: string): Promise<{ value: unknown } | null>;
  dataPut(id: string, scope: string, key: string, value: unknown): Promise<"ok" | "too_many">;
  dataDelete(id: string, scope: string, key: string): Promise<boolean>;
}

const PREFIX = "_tz/shot/";
const PIECE_BYTES = 40 * 1024;
/** How many shots one artifact keeps for one person. */
export const SHOTS_KEPT = 40;
/** A scope holds 500 keys (LIMITS.storageKeys); the shots keep to this many of them, the oldest going first. */
export const SHOT_KEYS_MAX = 480;

/**
 * The scope the owner's shots of an artifact are kept in: a UUID (what the table's check allows besides 'shared') made from the owner's id and a label.
 * It is nobody's user id, so no route that serves an artifact's saved data (the person's own scope, or the shared one) can reach it.
 */
export function shotScope(userId: string): string {
  const h = createHash("sha256").update(`tailzu-shots-v1:${userId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface IndexEntry { id: string; exp: number; pieces: number }

/** Shots in the owner's shot scope of the artifact's saved data, in pieces of 40 KB (a value is at most 64 KB), with an index that is pruned as it goes. */
export class ArtifactDataShotStore implements ShotStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly data: ShotData, private readonly now: () => number = Date.now) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async index(artifactId: string, userId: string): Promise<IndexEntry[]> {
    const row = await this.data.dataGet(artifactId, shotScope(userId), `${PREFIX}index`);
    const v = row?.value;
    return Array.isArray(v) ? v.filter((e): e is IndexEntry => !!e && typeof e.id === "string" && typeof e.exp === "number" && typeof e.pieces === "number") : [];
  }

  private async drop(artifactId: string, userId: string, e: IndexEntry): Promise<void> {
    await this.data.dataDelete(artifactId, shotScope(userId), `${PREFIX}${e.id}/m`).catch(() => undefined);
    for (let i = 0; i < e.pieces; i += 1) await this.data.dataDelete(artifactId, shotScope(userId), `${PREFIX}${e.id}/${i}`).catch(() => undefined);
  }

  put(userId: string, meta: ShotMeta, png: Uint8Array, o: { ttlMs?: number } = {}): Promise<{ id: string }> {
    return this.serial(async () => {
      const id = newShotId();
      const exp = this.now() + (o.ttlMs ?? SHOT_TTL_MS);
      const pieces = Math.max(1, Math.ceil(png.length / PIECE_BYTES));
      // The scope's keys are few: a picture takes a key a piece, one for its meta, and the index is one more.
      if (pieces + 2 > SHOT_KEYS_MAX) throw new ShotError("store", "That picture is too big to keep in this artifact's saved data.");
      // Expired shots go, and the oldest past the limit.
      const kept: IndexEntry[] = [];
      for (const e of await this.index(meta.artifactId, userId)) {
        if (e.exp <= this.now()) await this.drop(meta.artifactId, userId, e);
        else kept.push(e);
      }
      while (kept.length >= SHOTS_KEPT) await this.drop(meta.artifactId, userId, kept.shift()!);
      const used = (): number => kept.reduce((n, e) => n + e.pieces + 1, 1);
      while (kept.length && used() + pieces + 1 > SHOT_KEYS_MAX) await this.drop(meta.artifactId, userId, kept.shift()!);
      for (let i = 0; i < pieces; i += 1) {
        const put = await this.data.dataPut(meta.artifactId, shotScope(userId), `${PREFIX}${id}/${i}`, Buffer.from(png.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES)).toString("base64"));
        if (put !== "ok") { await this.drop(meta.artifactId, userId, { id, exp, pieces: i }); throw new ShotError("store", "There is no room for another picture in this artifact's saved data."); }
      }
      const put = await this.data.dataPut(meta.artifactId, shotScope(userId), `${PREFIX}${id}/m`, { meta, size: png.length, pieces, exp });
      if (put !== "ok") { await this.drop(meta.artifactId, userId, { id, exp, pieces }); throw new ShotError("store", "There is no room for another picture in this artifact's saved data."); }
      await this.data.dataPut(meta.artifactId, shotScope(userId), `${PREFIX}index`, [...kept, { id, exp, pieces }]);
      return { id };
    });
  }

  async get(userId: string, artifactId: string, id: string): Promise<StoredShot | null> {
    if (!isShotId(id)) return null;
    const m = (await this.data.dataGet(artifactId, shotScope(userId), `${PREFIX}${id}/m`))?.value as { meta?: ShotMeta; size?: number; pieces?: number; exp?: number } | undefined;
    if (!m?.meta || typeof m.pieces !== "number" || typeof m.exp !== "number" || typeof m.size !== "number" || m.exp <= this.now() || m.meta.artifactId !== artifactId) return null;
    const parts: Uint8Array[] = [];
    for (let i = 0; i < m.pieces; i += 1) {
      const p = (await this.data.dataGet(artifactId, shotScope(userId), `${PREFIX}${id}/${i}`))?.value;
      if (typeof p !== "string") return null;
      parts.push(Uint8Array.from(Buffer.from(p, "base64")));
    }
    const png = new Uint8Array(m.size);
    let at = 0;
    for (const p of parts) { png.set(p.subarray(0, Math.max(0, m.size - at)), at); at += p.length; }
    return at >= m.size ? { png, meta: m.meta, expiresAt: m.exp } : null;
  }
}

// ------------------------------------------------------------------ signed links

const sigOf = (secret: string, userId: string, artifactId: string, shotId: string, exp: number): string =>
  createHmac("sha256", secret).update(`tailzu-shot-v1\n${userId}\n${artifactId}\n${shotId}\n${exp}`).digest("hex").slice(0, 43);

/** The path (and query) of a shot's link, valid for the person it is made for until `exp`. The server's address goes in front. */
export function signShotPath(o: { secret: string; userId: string; artifactId: string; shotId: string; ttlMs?: number; now?: number }): string {
  const exp = (o.now ?? Date.now()) + (o.ttlMs ?? SHOT_TTL_MS);
  return `/v1/artifacts/${o.artifactId}/shots/${o.shotId}?exp=${exp}&sig=${sigOf(o.secret, o.userId, o.artifactId, o.shotId, exp)}`;
}

/** Whether a link is good for this person: not expired, and signed for exactly this owner, artifact and shot. */
export function verifyShotLink(o: { secret: string; userId: string; artifactId: string; shotId: string; exp: unknown; sig: unknown; now?: number }): boolean {
  const exp = Number(o.exp);
  if (!Number.isFinite(exp) || exp <= (o.now ?? Date.now()) || typeof o.sig !== "string" || o.sig.length !== 43) return false;
  const want = Buffer.from(sigOf(o.secret, o.userId, o.artifactId, o.shotId, exp));
  const got = Buffer.from(o.sig);
  return got.length === want.length && timingSafeEqual(got, want);
}
