/**
 * LINK A COMPUTER (bots.link): the phone's side of signing in on a computer with the phone (docs/bots-gaps.md item 16;
 * the window's side is its sign-in's QR panel, DeskLinkSignIn, firstRun.ts).
 *
 *   bots.link            You › Link a computer: how it goes (the phone's camera opens the computer's QR code), and the
 *                        typed way for a phone that cannot scan: the 8-letter code under the QR. Continue opens the
 *                        page below with that code.
 *   bots.link?l=<token>  where the QR's link lands (https://app.tailzu.space/s/bots.link?l=…, a link the app claims)
 *   bots.link?c=<code>   the same, from the typed code
 *                        "Sign in on <computer>?": which computer, when it asked, which account it signs in as, and
 *                        Approve / Not me. Approved, the computer signs itself in a moment later.
 *
 * Reads POST /v1/auth/link/view; writes POST /v1/auth/link/approve and /deny (routes/deviceLink.ts). The token or code
 * travels in the bodies only.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  blip, box, C, call, col, FACE, icon, listCard, listRow, meta, open, page, primaryButton, row, SCREENS, secondaryButton, seq,
  text, title, toTab, when, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

/** POST /v1/auth/link/view, as this page reads it. */
export interface LinkData {
  deviceName: string;
  platform: "mac" | "windows" | "linux" | "";
  status: "pending" | "approved" | "denied" | "used" | "expired";
  createdAt: number;
  expiresAt: number;
  /** The account can approve (it has an address to sign the computer in with). */
  canApprove: boolean;
  /** Which account the computer would be signed in as. */
  account?: string;
}

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const toast = (message: string): ActionSpec => ({ kind: "toast", message, tone: "error" } as ActionSpec);
/** Continue with the typed code, once there is one. */
const withCode: ActionSpec = { kind: "condition", if: { falsy: "code" }, then: toast("Type the code from your computer first"), else: open(SCREENS.link, { c: "$state.code" }) } as ActionSpec;

/** The request this page is about, as the routes take it: the QR's token, or the typed code. */
function refOf(ctx: BotsCtx): { token: string } | { code: string } | null {
  const l = ctx.params.l, c = ctx.params.c;
  if (typeof l === "string" && /^[A-Za-z0-9_-]{43}$/.test(l)) return { token: l };
  if (typeof c === "string" && c.trim()) return { code: c.trim().slice(0, 16) };
  return null;
}

const SYSTEM: Record<string, string> = { mac: "Mac", windows: "Windows", linux: "Linux" };

function askedAgo(ctx: BotsCtx, at: number): string {
  const min = Math.floor(Math.max(0, ctx.live.now - at) / 60_000);
  return min < 1 ? "just now" : min === 1 ? "1 min ago" : min < 60 ? `${min} min ago` : "over an hour ago";
}

/** One small step: its number in a ring, its words. */
const step = (n: number, words: string): Node => row([
  box([text(String(n), { size: 12, weight: 600, lineHeight: 14 })], {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0,
  }),
  text(words, { size: 15, lineHeight: 21, style: { flexShrink: 1 } }),
], { gap: 12 });

/** Where to go once it is answered: a link may have opened this page alone, so Home rather than back. */
const finish: ActionRef = toTab("bots");

// ----------------------------------------------------------------- You › Link a computer

function howTo(ctx: BotsCtx) {
  const desk = ctx.client === "desktop";
  const codeField: Node = {
    type: "TextField", id: "link.code", bind: { value: "code" },
    props: {
      placeholder: "K7Q4-2MXP", placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, autoCapitalize: "characters", autoCorrect: false, returnKeyType: "go", maxLength: 12,
    },
    on: { onSubmit: withCode },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.mono, fontSize: 18,
      letterSpacing: 2, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  return page(ctx, {
    back: true, nav: "settings", title: "Link a computer", gap: 20, state: { code: "" },
    body: [
      col([
        title("Link a computer"),
        text(desk ? "Signing in on another computer is done from your phone." : "Sign in on your computer without typing anything.", { size: 15, lineHeight: 22, color: C.grey70 }),
      ], { gap: 6 }),
      col([
        step(1, "On the computer, open Tailzu. Its sign-in shows a code."),
        step(2, "Point this phone's camera at the code."),
        step(3, "Tap Approve here. The computer signs itself in."),
      ], { gap: 14 }),
      ...(desk ? [] : [col([
        text("No camera? Type the code", { size: 15, weight: 600, lineHeight: 20 }),
        meta("It's the 8 letters and numbers under the code on the computer.", { size: 13, lineHeight: 18 }),
        row([codeField], { borderWidth: 1.5, borderColor: C.ink, borderRadius: 14, paddingHorizontal: 14, minHeight: 52 }),
      ], { gap: 8 })]),
    ],
    ...(desk ? {} : { footer: [primaryButton("Continue", withCode, { wide: true })] }),
  });
}

// ----------------------------------------------------------------- Sign in on <computer>?

function gone(ctx: BotsCtx, head: string, words: string) {
  return page(ctx, {
    back: ctx.params.l ? finish : true, title: "Link a computer", gap: 18,
    body: [
      box([blip("think", 120)], { alignItems: "center", paddingTop: 12 }),
      col([title(head, { align: "center" }), text(words, { size: 15, lineHeight: 22, color: C.grey70, align: "center" })], { gap: 8, alignItems: "center" }),
    ],
    footer: [secondaryButton("Done", finish, { wide: true })],
  });
}

function approve(ctx: BotsCtx, d: LinkData, ref: { token: string } | { code: string }) {
  const name = d.deviceName;
  const system = SYSTEM[d.platform] ?? "Computer";
  const decided: ActionRef = { kind: "refresh" };
  const yes = call("POST", "/v1/auth/link/approve", ref, {
    ok: setState("done", "approved"),
    fail: seq(toast("Couldn't approve that. Show a new code on your computer and try again."), decided),
  });
  const no = call("POST", "/v1/auth/link/deny", ref, {
    ok: setState("done", "denied"),
    fail: seq(toast("Couldn't send that. Try again."), decided),
  });
  const asking = { falsy: "done" } as const;
  return page(ctx, {
    back: ctx.params.l ? finish : true, title: "Link a computer", gap: 18, state: { done: "" },
    body: [
      when(asking, col([
        box([blip("needs", 112)], { alignItems: "center", paddingTop: 4 }),
        col([
          title(`Sign in on ${name}?`, { align: "center" }),
          text(`${system} · asked ${askedAgo(ctx, d.createdAt)}`, { size: 15, lineHeight: 22, color: C.grey70, align: "center" }),
        ], { gap: 6, alignItems: "center" }),
        listCard([
          listRow({ label: "Computer", value: name, chevron: false }),
          ...(d.account ? [listRow({ label: "Signs in as", value: d.account, chevron: false })] : []),
        ]),
        row([
          icon("shield", { size: 18, color: C.grey70 }),
          text("Approve only if you're at this computer and signing in right now. Tailzu never asks for this in a message or a call.", {
            size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 },
          }),
        ], { gap: 10, alignItems: "flex-start" }),
      ], { gap: 18 })),
      when({ eq: ["done", "approved"] }, col([
        box([blip("done", 120)], { alignItems: "center", paddingTop: 12 }),
        col([
          title(`Signed in on ${name}`, { align: "center" }),
          text("It's ready on the computer in a moment. You can sign it out from its Settings.", { size: 15, lineHeight: 22, color: C.grey70, align: "center" }),
        ], { gap: 8, alignItems: "center" }),
      ], { gap: 18 })),
      when({ eq: ["done", "denied"] }, col([
        box([blip("hello", 120)], { alignItems: "center", paddingTop: 12 }),
        col([
          title("Okay, it stays signed out", { align: "center" }),
          text("Nothing was shared with that computer.", { size: 15, lineHeight: 22, color: C.grey70, align: "center" }),
        ], { gap: 8, alignItems: "center" }),
      ], { gap: 18 })),
    ],
    footer: [
      when(asking, col([primaryButton("Approve", yes, { wide: true }), secondaryButton("Not me", no, { wide: true })], { gap: 10 })),
      when({ truthy: "done" }, primaryButton("Done", finish, { wide: true })),
    ],
  });
}

function link(ctx: BotsCtx, d: LinkData | undefined) {
  const ref = refOf(ctx);
  if (!ref) return howTo(ctx);
  if (ctx.client === "desktop") {
    return gone(ctx, "Approve it on your phone", "Signing in on a computer is approved from Tailzu on your phone.");
  }
  if (!d) {
    return "code" in ref
      ? gone(ctx, "That code didn't work", "Check the code on your computer and type it again. It changes every few minutes.")
      : gone(ctx, "We couldn't find that sign-in", "Show a new code on your computer and scan it again.");
  }
  const expired = d.status === "expired" || (d.status === "pending" && d.expiresAt <= ctx.live.now);
  if (expired) return gone(ctx, "This code ran out", "Codes last 5 minutes. Show a new one on your computer and scan it again.");
  if (d.status === "approved" || d.status === "used") return gone(ctx, "Already approved", `${d.deviceName} is signed in.`);
  if (d.status === "denied") return gone(ctx, "You said not you", "That computer stays signed out. Show a new code there to try again.");
  if (!d.canApprove) {
    return gone(ctx, "Sign in with your number there", "This account uses a phone number to sign in. On the computer, choose Phone and type your number.");
  }
  return approve(ctx, d, ref);
}

export const linkScreens: BotsScreen[] = [
  screen<LinkData>({
    id: SCREENS.link,
    load: async (ctx, deps) => {
      const ref = refOf(ctx);
      if (!ref || ctx.client === "desktop") throw new Error("nothing to read");
      return deps.api<LinkData>("POST", "/v1/auth/link/view", ref);
    },
    build: link,
  }),
];
