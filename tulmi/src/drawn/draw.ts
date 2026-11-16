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
import { z } from "zod";
import { getConfig } from "../config.js";
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

/**
 * The screen a model draws for an id nobody built, or null: off, no money, a model that is down, or a drawing that
 * did not survive the checker and the rules. Never throws.
 */
export async function drawScreen(ctx: BotsCtx, dctx: DrawCtx, i: DrawInput): Promise<ScreenResponse | null> {
  if (dctx.signal?.aborted) return null;
  if (dctx.leftPaise < DRAW_MIN_PAISE) return null;
  const r = await askJson({
    ...(dctx.call ? { call: dctx.call } : {}), ...(dctx.gateway ? { gateway: dctx.gateway } : {}), userId: dctx.userId,
    budget: { maxPaise: Math.min(DRAW_CAP_PAISE, dctx.leftPaise) }, ...(dctx.signal ? { signal: dctx.signal } : {}),
  }, { tier: "cheap", purpose: "screen.draw", role: "screen_draw", user: drawUser(i), schema: DrawReply, maxTokens: DRAW_TOKENS });
  if (!r.ok) return null;
  // An empty `Seen`: a screen read nothing, so the checker drops every link and image by its own rule.
  const shown = checkShown({ blocks: r.value.blocks }, { seen: new Seen() });
  if (!shown) return null;
  return screenFrom(ctx, shown, titleOf(r.value.title));
}
