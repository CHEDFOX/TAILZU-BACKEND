/**
 * WHO GETS A VOCABULARY-2 SCREEN, AND WHAT EVERYONE ELSE GETS INSTEAD (pure/SPEC.md 2.12, principle 6).
 *
 * A screen states the blocks it cannot be drawn without (`needs`). A client states the blocks it has (`blocks`,
 * with `vocab: 2`). If the client has them all, it gets the screen. If it does not, it gets a short screen that
 * says what to do — never a LOWERED version of the screen, because lowering silently drops the gestures and rules
 * a slide-to-confirm is made of, and a control that looks right and does nothing is worse than one that is plainly
 * not there yet:
 *
 *   • the blocks are on their way as an over-the-air update (the client is on the runtime this server expects):
 *     "Open X0 again";
 *   • the binary itself is older: "Update X0", with the store link;
 *   • the window: the same, with the download link.
 *
 * A screen that says no `needs` is a vocabulary-1 screen, frozen: every client gets it exactly as today, and this
 * file does nothing at all.
 *
 * SDUI_V2 / SDUI_V2_USERS hold the whole thing shut until the owner turns it on, the way skin.ts holds the
 * keyboard's skins (docs/renderer.md section 6). With the switch off no client is treated as having any block, so
 * a screen builder's `sduiV2Live()` check keeps building the vocabulary-1 screen and nobody sees the short one.
 */
import {
  SDUI_SCHEMA_VERSION, SDUI_VOCAB, type BlockName, type Node, type ScreenResponse,
} from "../../../../shared/types/sdui.js";
import { getConfig } from "../../config.js";
import { BOTS_THEME, C, button, text } from "../bots/kit.js";
import { kernel } from "./kernel.js";
import { isVocab1, lintScreen } from "./lint.js";

/**
 * The runtime the phone this server was deployed beside is built on (TAILZU-FRONTEND/app/app.config.ts
 * `runtimeVersion`). A client on this string can still receive over-the-air updates, so a block it lacks is one
 * that has not arrived yet: it needs to open the app again. A client on anything else needs a store build.
 */
export const PHONE_RUNTIME = "tailzu-2026-11-x0-blip";

const APP_STORE_ID = /^\d{6,}$/.test(process.env.APP_STORE_ID ?? "") ? (process.env.APP_STORE_ID as string) : "6784811357";
const STORE = {
  ios: `https://apps.apple.com/app/id${APP_STORE_ID}`,
  android: "https://play.google.com/store/apps/details?id=com.tulmi.app",
  desktop: "https://x0bot.com/download",
};

// ===================================================================== the switch

/**
 * The stage. While SDUI_V2_USERS names anyone, only those accounts are served a vocabulary-2 screen, even with
 * SDUI_V2 on. Empty means the switch alone decides. Read the way skin.ts reads its own pair.
 */
export function sduiV2Live(userId?: string): boolean {
  if (!getConfig().SDUI_V2) return false;
  const only = String(getConfig().SDUI_V2_USERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return !only.length || (!!userId && only.includes(userId));
}

// ===================================================================== what a client says it has

export interface ClientVocab {
  /** 2 once the build carries the kernel. */
  vocab: number;
  /** The blocks it really has. */
  blocks: BlockName[];
  /** Its binary's runtime string, when it says one. */
  runtime?: string;
  client: "phone" | "desktop";
  platform?: "ios" | "android";
  /** Who is asking, for the SDUI_V2_USERS stage. */
  userId?: string;
}

/** What the route hands over: the capabilities as they ARRIVED, so every field is read defensively here and the
 *  route keeps no second copy of these rules. */
type CapsLike = {
  vocab?: unknown;
  blocks?: unknown;
  runtime?: unknown;
  platform?: unknown;
} & Record<string, unknown>;

/** What the request said, read defensively: anything missing or odd reads as vocabulary 1 with no blocks. */
export function clientVocab(
  caps: CapsLike | undefined,
  o: { client: "phone" | "desktop"; userId?: string },
): ClientVocab {
  const k = kernel();
  const said: unknown[] = Array.isArray(caps?.blocks) ? (caps!.blocks as unknown[]) : [];
  const vocab = typeof caps?.vocab === "number" && Number.isFinite(caps.vocab) ? Math.trunc(caps.vocab) : 1;
  const live = sduiV2Live(o.userId) && vocab >= SDUI_VOCAB;
  return {
    vocab,
    // A name this kernel does not know is not a block, whoever said it; and with the switch off nobody has any.
    blocks: live ? (said.filter((b) => k.isBlock(b)) as BlockName[]) : [],
    ...(typeof caps?.runtime === "string" && caps.runtime ? { runtime: (caps.runtime as string).slice(0, 64) } : {}),
    client: o.client,
    ...(caps?.platform === "ios" || caps?.platform === "android" ? { platform: caps.platform as "ios" | "android" } : {}),
    ...(o.userId ? { userId: o.userId } : {}),
  };
}

/** Does this client have that block? */
export function has(c: ClientVocab, block: BlockName): boolean {
  return c.blocks.includes(block);
}

/** The blocks a screen needs that this client did not declare. Empty means it can be drawn. */
export function missing(c: ClientVocab, needs: readonly BlockName[] | undefined): BlockName[] {
  return (kernel().missingBlocks(c.blocks, needs ?? []) as BlockName[]);
}

// ===================================================================== the short screen

/** Which of the two it is: an update is waiting to apply, or the binary itself is behind. */
export function waitingKind(c: ClientVocab): "open-again" | "update" {
  if (c.client === "desktop") return "update";
  return c.runtime && c.runtime === PHONE_RUNTIME ? "open-again" : "update";
}

const WORDS = {
  "open-again": {
    title: "Open X0 again",
    line: "This page needs a piece of X0 that is already on its way. Close X0 and open it again, and it will be here.",
    cta: "Go back",
  },
  update: {
    title: "Update X0",
    line: "This page needs a newer X0. Update, and it will be here.",
    cta: "Get the update",
  },
} as const;

/** Where "Get the update" sends them. */
function storeUrl(c: ClientVocab): string {
  if (c.client === "desktop") return STORE.desktop;
  return c.platform === "android" ? STORE.android : STORE.ios;
}

/**
 * The screen a client that lacks a block is sent instead. Drawn from the kit's own nodes only — Stack, Text and a
 * button — so the oldest build there is can draw it, and `lintTree` passes it.
 */
export function waitingScreen(screenId: string, c: ClientVocab): ScreenResponse {
  const kind = waitingKind(c);
  const words = WORDS[kind];
  const root: Node = {
    type: "SafeArea",
    props: { edges: ["top"], barStyle: "dark-content" },
    style: { flex: 1, flexDirection: "column", backgroundColor: C.paper },
    children: [{
      type: "Screen",
      props: { paddingBottom: 24 },
      style: { backgroundColor: C.paper, paddingHorizontal: 20, paddingTop: 48, gap: 16 },
      children: [
        text(words.title, { size: 26, lineHeight: 32, weight: 700, tracking: -0.5 }),
        text(words.line, { size: 15, lineHeight: 21, color: C.meta }),
        button(words.cta, kind === "open-again"
          ? { kind: "navigateBack" }
          : { kind: "openUrl", url: storeUrl(c), external: true }),
      ],
    }],
  };
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId,
    title: words.title,
    hideChrome: true,
    look: "bots",
    theme: BOTS_THEME,
    cacheTtlSeconds: 0,
    state: {},
    root,
  };
}

// ===================================================================== the gate

export interface GateResult {
  /** What to serve: the screen itself, or the short one. */
  screen: ScreenResponse;
  /** "screen" when it went out as built. */
  served: "screen" | "open-again" | "update" | "refused";
  /** The blocks this client was missing. */
  missing: BlockName[];
  /** Anything lint refused (the screen is then not served at all). */
  errors: string[];
  warnings: string[];
  /** The blocks the screen needs, as lint worked them out. */
  needs: BlockName[];
}

/**
 * The one door every screen goes through. A vocabulary-1 screen passes straight back, untouched and unlinted, so
 * nothing about today's screens changes or costs anything. A screen that says `needs` is checked with the device's
 * own compiler first, and then matched against what the client has.
 *
 * A screen that FAILS lint is never served: that is the publish gate (SPEC 5.2). The caller gets `refused` with
 * the reasons, and shows the short screen rather than a broken one.
 */
export function gateScreen(screen: ScreenResponse, c: ClientVocab): GateResult {
  if (isVocab1(screen)) return { screen, served: "screen", missing: [], errors: [], warnings: [], needs: [] };

  const checked = lintScreen(screen);
  if (checked.errors.length) {
    return {
      screen: waitingScreen(screen.screenId, c), served: "refused", missing: [],
      errors: checked.errors, warnings: checked.warnings, needs: checked.needs,
    };
  }

  const gap = missing(c, checked.needs);
  if (gap.length) {
    return {
      screen: waitingScreen(screen.screenId, c), served: waitingKind(c), missing: gap,
      errors: [], warnings: checked.warnings, needs: checked.needs,
    };
  }
  return { screen, served: "screen", missing: [], errors: [], warnings: checked.warnings, needs: checked.needs };
}

/**
 * One line in the log for every vocabulary-2 screen that goes out, and for every one that does not: publishing
 * screens now changes what every phone does, so there is a record of which screen, with which blocks, reached
 * whom and what the gate decided (SPEC 5.5, "Who can publish").
 */
export function auditLine(screenId: string, c: ClientVocab, r: GateResult): string {
  const parts = [
    `sdui2 ${r.served}`,
    `screen=${screenId}`,
    `needs=${r.needs.join("+") || "-"}`,
    `blocks=${c.blocks.join("+") || "-"}`,
    `vocab=${c.vocab}`,
    `runtime=${c.runtime ?? "-"}`,
    `client=${c.client}`,
  ];
  if (r.missing.length) parts.push(`missing=${r.missing.join("+")}`);
  if (r.errors.length) parts.push(`refused=${r.errors.slice(0, 3).join(" | ")}`);
  if (r.warnings.length) parts.push(`warned=${r.warnings.length}`);
  return parts.join(" ");
}

/** The whole door, for the screen route: gate the screen, and hand back the line to log. */
export function serveScreen(
  screen: ScreenResponse,
  caps: CapsLike | undefined,
  o: { client: "phone" | "desktop"; userId?: string },
): { screen: ScreenResponse; audit: string | null; result: GateResult } {
  // A screen that says nothing of vocabulary 2 is handed back before anything here is touched — the generated
  // kernel is not even loaded — so today's screens cost nothing and cannot be hurt by this file at all.
  if (isVocab1(screen)) {
    return { screen, audit: null, result: { screen, served: "screen", missing: [], errors: [], warnings: [], needs: [] } };
  }
  const c = clientVocab(caps, o);
  const result = gateScreen(screen, c);
  return { screen: result.screen, audit: auditLine(screen.screenId, c, result), result };
}


/** Re-exported so a screen builder can ask one question: "may I use the blocks at all?" */
export { lintScreen } from "./lint.js";
