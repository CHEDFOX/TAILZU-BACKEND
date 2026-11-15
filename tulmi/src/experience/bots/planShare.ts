/**
 * SHARING A PLAN — THE RENDERER'S HALF: the payload, the switch, the paths, the ask as a thing that needs you, and the
 * notification's two buttons.
 *
 * A plan is a month's allowance on one account. Sharing it means other accounts draw on that same allowance — one pot,
 * no seat count, no per-seat price. Someone on your plan uses your month; nothing else of yours is shared.
 *
 * Everything here is behind PLAN_SHARE (config.ts), off by default, with PLAN_SHARE_USERS as the account list while it
 * is tried. With it off: no row, no screen, no card, no notification category, and loadShare() reads nothing at all, so
 * a screen that asks for the share draws exactly what it drew before.
 *
 * NO MONEY ANYWHERE. The house rule in screens/you.ts:7-12 holds here too: nothing below names a price, an amount or a
 * renewal date, and nothing says anything about another person's money beyond whether they have a plan — and that only
 * to decide which row to draw (spec §8).
 *
 * The screens are built in screens/you/planShareCard.ts (Plan and billing's section, "Share with someone", the refused
 * screen's way out) and screens/safety.ts (one row on a person's page). The ask reaches Activity, Home's first card and
 * the window through live.ts, which pushes `planAskNeeds()` beside the jobs and the tasks.
 */
import type { ActionSpec } from "../../../../shared/types/sdui.js";
import { getConfig } from "../../config.js";
import { SCREENS } from "./ids.js";
import type { BotsDeps, Choice, NeedsItem } from "./live.js";

// ===================================================================== the payload (shared/types/api.ts PlanShareView)

/** Someone on my plan, and how much of this month they have used (0-100). Never an amount. */
export interface PlanShareMember { userId: string; name: string; usedPct: number }
/** Set when I am on someone else's plan: whose, which, since when, and how much of their month is gone (0-100). */
export interface PlanShareOn { ownerId: string; name: string; planName: string; since: number; monthUsedPct: number; myUsedPct: number }
/** Someone I share a space with. `hasPlan` is a yes/no and nothing more (spec §8). */
export interface PlanSharePerson { userId: string; name: string; hasPlan: boolean; onMyPlan: boolean }
/** Someone asking to be put on my plan. `about` ("Diwali party") is the card's second line; never required. */
export interface PlanShareAsk { id: string; askerId: string; name: string; about?: string; at: number }

/**
 * What GET /v1/botsapp/bots/plan/share answers, for one signed-in person. The server half writes this same shape into
 * shared/types/api.ts; this copy is what the screens are built against, and the two are structurally the same.
 */
export interface PlanShareView {
  /** I have a plan of my own, so I have something to share. */
  canShare: boolean;
  /** The people on my plan. */
  members: PlanShareMember[];
  /** Set when I am on someone else's plan instead. */
  on?: PlanShareOn;
  /** The people I share a space with — the only people a plan can be handed to (spec §8: no email, no link, no code). */
  people: PlanSharePerson[];
  /** Asks waiting on my answer. */
  asks: PlanShareAsk[];
  /** An ask of mine, waiting on someone else's answer. */
  asked?: { id: string; ownerId: string; name: string; at: number };
}

// ===================================================================== the routes

/** The app's existing bots prefix, as safety.ts and planMake.ts use it. */
export const PLAN_SHARE_API = "/v1/botsapp/bots/plan/share";
/** Stop sharing with one person (the owner's side). */
export const stopSharingPath = (memberId: string): string => `${PLAN_SHARE_API}/${encodeURIComponent(memberId)}`;
/** Leave the plan I am on (the member's side). */
export const LEAVE_PLAN_PATH = `${PLAN_SHARE_API}/mine`;
/** Ask someone for theirs. */
export const ASK_PATH = `${PLAN_SHARE_API}/ask`;
/** Answer an ask: share | promise | decline. */
export const answerAskPath = (askId: string): string => `${ASK_PATH}/${encodeURIComponent(askId)}`;

// ===================================================================== the switch

/**
 * PLAN_SHARE and PLAN_SHARE_USERS, read on every call (the config is parsed once and cached, so this is cheap), the way
 * spacesOn() and notifyReplyOn() read theirs, so a test can flip them with resetConfigForTests. A process whose config
 * cannot be read (only a unit test with none set up) reads the variables themselves, as spacesSwitch.ts does.
 */
function switches(): { on: boolean; only: string } {
  try {
    const c = getConfig();
    return { on: c.PLAN_SHARE, only: c.PLAN_SHARE_USERS };
  } catch {
    return { on: (process.env.PLAN_SHARE ?? "").toLowerCase() === "true", only: process.env.PLAN_SHARE_USERS ?? "" };
  }
}

/** Is sharing a plan on for this person? Off: nothing new is drawn, read or sent anywhere. */
export function planShareOn(userId?: string | null): boolean {
  const { on, only } = switches();
  if (!on) return false;
  const list = only.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return !!userId && list.includes(userId);
}

// ===================================================================== reading it

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * What came back, made safe to draw: every list a list, every number a number. A screen must not go blank because one
 * field of one row was missing.
 */
export function cleanShare(v: unknown): PlanShareView | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const on = r.on && typeof r.on === "object" ? (r.on as Record<string, unknown>) : null;
  const asked = r.asked && typeof r.asked === "object" ? (r.asked as Record<string, unknown>) : null;
  return {
    canShare: r.canShare === true,
    members: (Array.isArray(r.members) ? r.members : []).map((m) => {
      const x = (m ?? {}) as Record<string, unknown>;
      return { userId: str(x.userId), name: str(x.name) || "Someone", usedPct: num(x.usedPct) };
    }).filter((m) => m.userId),
    ...(on ? { on: {
      ownerId: str(on.ownerId), name: str(on.name) || "Someone", planName: str(on.planName) || "plan",
      since: num(on.since), monthUsedPct: num(on.monthUsedPct), myUsedPct: num(on.myUsedPct),
    } } : {}),
    people: (Array.isArray(r.people) ? r.people : []).map((p) => {
      const x = (p ?? {}) as Record<string, unknown>;
      return { userId: str(x.userId), name: str(x.name) || "Someone", hasPlan: x.hasPlan === true, onMyPlan: x.onMyPlan === true };
    }).filter((p) => p.userId),
    asks: (Array.isArray(r.asks) ? r.asks : []).map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      const about = str(x.about).trim();
      return { id: str(x.id), askerId: str(x.askerId), name: str(x.name) || "Someone", ...(about ? { about } : {}), at: num(x.at) };
    }).filter((a) => a.id),
    ...(asked ? { asked: { id: str(asked.id), ownerId: str(asked.ownerId), name: str(asked.name) || "Someone", at: num(asked.at) } } : {}),
  };
}

/**
 * The share, for a screen's own `load`. Nothing is read while the switch is off, and a read that fails (the route is
 * not there, the account is held, Spaces is off) is simply nothing: the screen draws what it drew before.
 */
export async function loadShare(deps: Pick<BotsDeps, "api">, userId?: string | null): Promise<PlanShareView | undefined> {
  if (!planShareOn(userId)) return undefined;
  return deps.api<unknown>("GET", PLAN_SHARE_API).then(cleanShare).catch(() => undefined);
}

// ===================================================================== the words every screen says the same

/** Under Plan and billing's sharing card, and under the list on "Share with someone". */
export const SAME_MONTH_LINE = "They use the same month as you. Nothing else of yours is shared.";
/** Under the card when you are on someone else's plan: the honest thing about one pot. */
export const ONE_POT_LINE = "If the month runs out, everyone on it waits for the 1st together.";
/** Under the list of people you may share with. */
export const SPACES_ONLY_LINE = "Only people you share a space with.";
/** "Used 12% this month", or nothing used yet. */
export const usedThisMonth = (pct: number): string => (pct >= 1 ? `Used ${Math.round(pct)}% this month` : "Nothing yet");

/**
 * THE ORDER ON THE REFUSED SCREEN (bots.usage), the one thing the owner has not settled.
 *
 * true  — "Ask someone to share theirs" sits ABOVE "Get more with a plan" (what the spec asks for, and what ships).
 * false — buying sits first and asking is the quieter second.
 *
 * This is the whole decision: one line here flips it on the phone and in the window at once.
 */
export const ASK_ABOVE_BUY: boolean = true;

/** What the refused screen's new way out says. It opens the asking list; it never shows money. */
export const ASK_SOMEONE_LABEL = "Ask someone to share theirs";

// ===================================================================== the ask, as a thing that needs you

/** Plan asks come from X0 itself, not from one of the person's bots (live.ts nameOf("tailzu") is "X0"). */
export const PLAN_SHARE_BOT = "tailzu";

const answer = (askId: string, decision: "share" | "promise" | "decline", ok: ActionSpec): ActionSpec => ({
  kind: "callEndpoint", method: "PUT", path: answerAskPath(askId), body: { decision },
  onSuccess: ok,
  onError: { kind: "toast", message: "Couldn't send that. Try again.", tone: "error" },
});
const say = (message: string): ActionSpec => ({ kind: "sequence", actions: [{ kind: "toast", message }, { kind: "refresh" }] });

/**
 * The asks waiting on this person, as things that need them — the same card space invites and payment asks use
 * (kit needsCard). Two buttons, never three.
 *
 *   they have a plan → "Share my plan" · "Not now"
 *   they have none   → "See plans and share" · "Not now" (the first promises the share, then opens the plans screen,
 *                      which is the only screen in the app allowed to show a price)
 *
 * "Not now" is quiet: the asker is told only that, never a reason (spec §5.5).
 */
export function planAskNeeds(o: {
  asks: readonly PlanShareAsk[];
  /** I have a plan of my own, so I can say yes right now. */
  canShare: boolean;
  /** How much of my month is still there, 0-100. Only ever my own number. */
  monthLeftPct: number;
  botName: string;
  color: string;
}): NeedsItem[] {
  const left = Math.max(0, Math.min(100, Math.round(o.monthLeftPct)));
  return o.asks.map((a): NeedsItem => {
    const name = a.name || "Someone";
    const choices: Choice[] = o.canShare
      ? [
        { label: "Share my plan", kind: "primary", action: answer(a.id, "share", say(`${name} is on your plan`)) },
        { label: "Not now", kind: "secondary", action: answer(a.id, "decline", say("Left it")) },
      ]
      : [
        // The promise is written first, then the plans screen opens: the share is waiting the moment the payment lands.
        { label: "See plans and share", kind: "primary", action: answer(a.id, "promise", { kind: "navigate", screenId: SCREENS.plans }) },
        { label: "Not now", kind: "secondary", action: answer(a.id, "decline", say("Left it")) },
      ];
    return {
      id: `planshare:${a.id}`, bot: PLAN_SHARE_BOT, botName: o.botName, color: o.color,
      question: `${name} is asking for your plan`,
      detail: o.canShare
        ? (a.about
          ? `So ${name} can work on ${a.about}. They'd use the same month as you — ${left}% left.`
          : `${name} would use the same month as you — ${left}% of it is left.`)
        : `You are on Free. Getting a plan puts ${name} on it the moment it is paid, and you keep it.`,
      choices,
      at: a.at,
    };
  });
}

// ===================================================================== the notification

/** The push kind the server half sends when an ask arrives (push/defaults.ts owns the words and the sending). */
export const PLAN_SHARE_PUSH_KIND = "plan_share_ask";

/** A notification's button, the shape planKinds.ts uses (experience/appKnobs.ts spreads it into push.categories). */
interface PushButton { id: string; title: string; icon: string; foreground: boolean; destructive: boolean; auth: boolean; act: string }

/**
 * One category, exactly two actions (three is the cap), answered through the door every other button uses,
 * POST /v1/widgets/act, with the ask's id on the push's data.item. "Share" is the whole decision; "Not now" is quiet.
 */
export const PLAN_SHARE_CATEGORIES: ReadonlyArray<{ id: string; actions: readonly PushButton[] }> = [
  { id: "x0_plan_share", actions: [
    { id: "ps_share", title: "Share", icon: "person.2", foreground: false, destructive: false, auth: false, act: "share" },
    { id: "ps_not_now", title: "Not now", icon: "xmark", foreground: false, destructive: false, auth: false, act: "decline" },
  ] },
];
