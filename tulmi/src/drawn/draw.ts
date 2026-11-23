/**
 * A SCREEN NOBODY BUILT, DRAWN BY A MODEL AND CHECKED BY CODE (docs/screen-draw.md).
 *
 *   drawnOn(userId)          the switch: SCREEN_DRAW, staged by SCREEN_DRAW_USERS
 *   drawScreen(ctx, dctx)    one small call, its blocks checked, its tree held to the app's design rules
 *
 * Every screen in the Bots app is hand-written TypeScript listed in `BOTS_SCREENS`, and an id nobody built is
 * answered with "coming soon" (`bots/index.ts`). This is the other answer: the model picks the BLOCKS for that
 * screen from the same vocabulary a bot draws under its words (`src/show`), and the kit draws them. The model
 * reasons about what belongs on the screen and never about how it looks — the look is `showNodes`', the same one
 * every drawing in the app already wears.
 *
 * WHY IT PICKS BLOCKS RATHER THAN WRITING NODES. A model that writes nodes has to get styles, contrast and touch
 * sizes right, and `sdui2/design.ts` is then a gate it can fail. A model that picks blocks cannot fail those
 * rules, because the kit writes the nodes. `checkDesign` still runs, but as an ASSERTION over our own renderer
 * rather than a retry loop: an error there is a bug in the kit, not a bad drawing, so the screen falls back
 * instead of the model being asked again. That is the cheapest arrangement that is still honest — the model
 * proposes, code decides, and code is the only thing that ever writes a style.
 *
 * WHAT IT MAY NOT DRAW.
 *   • No asking blocks (`choice`, `suggest`, `form`). Their Send posts into a bot's chat turn, and a screen has no
 *     turn to post into: a control that looks right and does nothing is worse than one that is not there.
 *   • No `link` and no `image`. A drawing under an answer may use an address THAT TURN read; a screen read
 *     nothing, so `Seen` is empty here and every address is dropped by the checker's own rule.
 *
 * IT NEVER FAILS A REQUEST. Off, no money left, a model that is down, blocks that do not survive the checker, an
 * empty drawing, or a tree the design rules refuse: the screen is the "coming soon" it was before.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { getConfig } from "../config.js";
import { coalescer } from "../guard/coalesce.js";
// The house's own small TTL cache, oldest-used dropped first. It lives under places/ because that is where it was first
// needed; its doc presents it as a general one, and a second copy here would be the worse of the two choices.
import { TtlCache } from "../places/cache.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { askJson, type CallFn } from "../code/work/model.js";
import { neutral } from "../bots/prompt.js";
import { checkShown } from "../show/check.js";
import { Seen } from "../show/links.js";
import type { Block, Shown } from "../show/types.js";
import type { Node, ScreenResponse } from "../../../shared/types/sdui.js";
import { BOTS_THEME, page, type BotsCtx } from "../experience/bots/kit.js";
import { showNodes } from "../experience/bots/show.js";
import { checkDesign, designWords } from "../experience/sdui2/design.js";

/** What the model answers. Loose on purpose: `checkShown` reads every block, and one bad block must not lose the others. */
export const DrawReply = z.object({ title: z.unknown().optional(), blocks: z.array(z.unknown()) });

/** The most one drawn screen may cost, in paise. */
export const DRAW_CAP_PAISE = 60;
/** Below this left on the request, no screen is drawn. */
const DRAW_MIN_PAISE = 6;
const DRAW_TOKENS = 900;
/** The dot budget a drawn screen's pictures share (the chat hands its turns the same, `parts.ts SCREEN_DOTS`). */
const DRAW_DOTS = 5_000;
const TITLE_MAX = 60;
const ID_MAX = 80;
const PARAMS_MAX = 400;

/**
 * The blocks a drawn screen may not have: the three that ask, because their Send needs a bot's chat turn. Dropped
 * wherever they are, boxes included, rather than the whole drawing being refused for one of them.
 */
const ASKING = new Set<Block["type"]>(["choice", "suggest", "form"]);

/**
 * Whether drawing a screen is on for this account (`SCREEN_DRAW`, off by default). `SCREEN_DRAW_USERS`, while it has
 * any name in it, is the stage before everyone: only those accounts. Read as the other stages are
 * (`show/design.ts showOn`). Off when the settings cannot be read.
 */
export function drawnOn(userId?: string): boolean {
  try {
    const cfg = getConfig();
    if (cfg.SCREEN_DRAW !== true) return false;
    const only = String(cfg.SCREEN_DRAW_USERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return !only.length || (!!userId && only.includes(userId));
  } catch {
    return false;
  }
}

/** Every asking block taken out, at any depth. A box left with no children at all goes too: an empty card is a tell, not a design. */
export function withoutAsking(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (ASKING.has(b.type)) continue;
    if ("children" in b && Array.isArray(b.children)) {
      const kids = withoutAsking(b.children as Block[]);
      if (!kids.length) continue;
      out.push({ ...b, children: kids } as Block);
      continue;
    }
    out.push(b);
  }
  return out;
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fence = (name: string, body: string): string => `${name}:\n<<<\n${neutral(body)}\n>>>`;

export interface DrawInput {
  /** The screen id that was asked for and nobody built: "bots.travel.places". */
  screenId: string;
  /** Its params, as the request sent them. */
  params?: Record<string, unknown>;
  /** Which client asked: a phone or the window. */
  client?: string;
}

/** The model's message: the id and its params, fenced as data. Nothing here is ours to trust — a params value came off a link. */
export function drawUser(i: DrawInput): string {
  const params = Object.entries(i.params ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${String(v)}`)
    .join("\n");
  return [
    fence("Screen", cut(i.screenId.trim(), ID_MAX)),
    ...(params ? [fence("Params", cut(params, PARAMS_MAX))] : []),
    ...(i.client ? [fence("Drawn on", i.client === "desktop" ? "a computer's window" : "a phone")] : []),
  ].join("\n");
}

export interface DrawCtx {
  /** The model door, already held to the request's cap: what the call costs comes off it. */
  call?: CallFn;
  gateway?: GatewayDeps;
  userId: string;
  /** What the request has left, in paise. */
  leftPaise: number;
  signal?: AbortSignal;
}

/** The title a drawn screen carries, cleaned. Absent or unusable: the screen has no title and its body speaks for itself. */
function titleOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = neutral(raw).replace(/\s+/g, " ").trim();
  return t ? cut(t, TITLE_MAX) : undefined;
}

/**
 * The blocks turned into a screen, or null if there is nothing to draw or the tree is one this app would not serve.
 * Separate from the call so a test can hold the renderer and the gates without a model.
 */
export function screenFrom(ctx: BotsCtx, shown: Shown, title?: string): ScreenResponse | null {
  const blocks = withoutAsking(shown.blocks);
  if (!blocks.length) return null;
  let body: Node[];
  try {
    // live: false — nothing here is the newest turn of a chat, so no picks are kept and no spring is replayed.
    body = showNodes(ctx, { ...shown, blocks }, { slug: "", turn: "", live: false, budget: { left: DRAW_DOTS } });
  } catch {
    return null;
  }
  if (!body.length) return null;
  const screen = page(ctx, { ...(title ? { title } : {}), body });
  // The assertion, not a retry: the kit wrote every style here, so an error is ours.
  const checked = checkDesign(screen, { theme: BOTS_THEME, drawn: true });
  if (checked.errors.length) {
    console.warn(`[drawn] ${ctx.screenId}: the kit's own nodes broke the design rules, so it is not served: ${designWords(checked).slice(0, 3).join(" ")}`);
    return null;
  }
  return screen;
}

// ------------------------------------------------------------------ kept, so the same screen is drawn once

/** What was drawn, before a client turned it into nodes: the blocks and the title, which is all the model answered. */
export interface Drawn { shown: Shown; title?: string }

/**
 * WHAT IS KEPT, AND WHY THE KEY IS THE MODEL'S OWN MESSAGE.
 *
 * A drawn screen is a model call in front of a page, so drawing it on every request is both slow and dear. What is kept is
 * the **blocks**, never the built screen: the blocks depend only on what the model was told, while the screen depends on
 * the client as well (a phone and the window draw the same blocks differently), so one entry serves both and rendering it
 * again is a pure function.
 *
 * The key is a hash of `drawUser(i)` — the exact message the model is given. That is not a shortcut, it is the proof: two
 * requests share an answer only when the model would have been asked the very same thing. If the input ever grows to
 * carry the person's own facts, the key grows with it and the sharing narrows by itself, with nothing here to remember.
 *
 * A "nothing to draw" is kept too (`null`), so an id the model has already judged bare is not paid for again on every
 * open. A call that FAILED is not kept at all: a model down for a moment must not blank a screen for an hour.
 */
const KEPT_MAX = 500;
const drawnCache = new TtlCache<Drawn>(KEPT_MAX);
/** A drawing the model declined to make is kept for less than one it made: it is the cheaper mistake to re-ask. */
const NOTHING_TTL_MS = 2 * 60_000;

const keyOf = (input: string): string => createHash("sha256").update(input).digest("hex").slice(0, 32);

/** How long a drawing is kept, from `SCREEN_DRAW_CACHE_MIN` (60 minutes; 0 keeps nothing). */
function keptMs(): number {
  try { return Math.max(0, getConfig().SCREEN_DRAW_CACHE_MIN) * 60_000; } catch { return 0; }
}

export function resetDrawnCacheForTests(): void { drawnCache.clear(); }
/** For a test: how many drawings are being kept. */
export const drawnKept = (): number => drawnCache.size;

/** One call, its blocks checked. `null` means the model answered and there was nothing worth drawing; it throws for nothing. */
async function askDraw(dctx: DrawCtx, input: string): Promise<{ ok: true; drawn: Drawn | null } | { ok: false }> {
  const r = await askJson({
    ...(dctx.call ? { call: dctx.call } : {}), ...(dctx.gateway ? { gateway: dctx.gateway } : {}), userId: dctx.userId,
    budget: { maxPaise: Math.min(DRAW_CAP_PAISE, dctx.leftPaise) }, ...(dctx.signal ? { signal: dctx.signal } : {}),
  }, { tier: "cheap", purpose: "screen.draw", role: "screen_draw", user: input, schema: DrawReply, maxTokens: DRAW_TOKENS });
  if (!r.ok) return { ok: false };
  // An empty `Seen`: a screen read nothing, so the checker drops every link and image by its own rule.
  const shown = checkShown({ blocks: r.value.blocks }, { seen: new Seen() });
  if (!shown || !withoutAsking(shown.blocks).length) return { ok: true, drawn: null };
  const title = titleOf(r.value.title);
  return { ok: true, drawn: { shown, ...(title ? { title } : {}) } };
}

/**
 * The screen a model draws for an id nobody built, or null: off, no money, a model that is down, or a drawing that did not
 * survive the checker and the rules. Never throws.
 *
 * A drawing already kept costs nothing and is NOT held to the money check — no call is made for it. One that is not kept is
 * drawn once however many ask for it at the same moment (`Coalescer`), so a link everybody opens at once is one call.
 */
export async function drawScreen(ctx: BotsCtx, dctx: DrawCtx, i: DrawInput): Promise<ScreenResponse | null> {
  if (dctx.signal?.aborted) return null;
  const input = drawUser(i);
  const key = keyOf(input);

  const kept = drawnCache.get(key);
  if (kept !== undefined) return kept ? screenFrom(ctx, kept.shown, kept.title) : null;

  if (dctx.leftPaise < DRAW_MIN_PAISE) return null;
  const got = await coalescer().run(`drawn:${key}`, async () => {
    const r = await askDraw(dctx, input);
    if (!r.ok) return null;
    const ttl = keptMs();
    if (ttl > 0) drawnCache.set(key, r.drawn, r.drawn ? ttl : Math.min(NOTHING_TTL_MS, ttl));
    return r.drawn;
  }, { ...(dctx.signal ? { signal: dctx.signal } : {}) }).catch(() => null);

  return got ? screenFrom(ctx, got.shown, got.title) : null;
}
