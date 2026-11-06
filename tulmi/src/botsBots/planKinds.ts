/**
 * PLAN EASE'S PUSH KINDS, IN ONE PLACE (docs/plan-ease.md "Push kinds"; design B10). Everything a kind needs is said once here, and the
 * rest of the server reads it from here:
 *
 *   push/defaults.ts       each kind's screen, category, channel, priority, expiry and words (planPushFlags, planPushLabels), and the
 *                          kind itself in EVENT_PUSH_KINDS
 *   you/push.ts verdict()  how "What pings you" treats it (planVerdictGroup): with Plan Ease's own switch, a person's word, or never a
 *                          sound. A kind left out of verdict() would fall to the Keylessbord branch and be dropped: here it cannot be
 *   push/engine.ts         push.<kind>.priority, push.<kind>.ttlMin and push.<kind>.interruptionLevel
 *   experience/appKnobs.ts the buttons (PLAN_CATEGORIES) and the Android channels (PLAN_CHANNELS) the phone registers from the bootstrap
 *
 * ADDING A KIND (a later step): add one entry to its own list below (STAGE_3 bills, STAGE_4 waits, STAGE_5 family), its category and
 * channel if new, and the act it answers (planEase.ts PLAN_ACTS). Nothing else needs a line changed. Button ids are unique across every
 * category the phone knows (x0_reply's "reply", x0_task's "done", x0_yesno's "yes" / "no" are taken), and a category has 3 at most.
 *
 * Kept free of imports, as push/defaults.ts is, so the control plane can read it without a cycle.
 */

/**
 * How "What pings you" treats a kind: Plan Ease's own (off with its switch, silent in quiet hours), a person's word, never a sound, or
 * "quiet": a person's word that never makes a sound (who took a family ask, the one nudge), which Plan Ease's switch doesn't stop.
 */
export type PlanVerdictGroup = "plan" | "people" | "silent" | "quiet";

export interface PlanPushKind {
  kind: string;
  /** The design step it came with (docs/plan-ease.md). */
  step: number;
  /** The screen a tap opens. */
  screenId: string;
  /** Its buttons (one of PLAN_CATEGORIES or a category already in the bootstrap), or "" for none. */
  category: string;
  /** The Android channel (PLAN_CHANNELS). */
  channel: string;
  priority: "normal" | "high";
  /** Minutes a phone that is off may still be given it; past that it is dropped (the moment has gone). */
  ttlMin: number;
  /**
   * iOS: "passive" waits quietly in the list with no sound and no lighting up. "time-sensitive" breaks through Focus (a leave-by, a bill
   * due today, design B13); the engine sends it only to a phone whose binary has the entitlement (its token's caps), else Apple's own.
   */
  interruptionLevel?: "passive" | "active" | "time-sensitive";
  verdict: PlanVerdictGroup;
  /** Its words: {title} and {body} are filled by the sender, already lock-safe (planSafe.ts). */
  title: string;
  body: string;
}

// ------------------------------------------------------------------ steps 0 and 1 (this foundation)

const STAGE_0_1: readonly PlanPushKind[] = [
  { kind: "plan_event", step: 0, screenId: "bots.plan", category: "", channel: "plan_reminders", priority: "high", ttlMin: 30, verdict: "plan", title: "{title}", body: "{body}" },
  { kind: "plan_leave", step: 0, screenId: "bots.plan.go", category: "x0_leave", channel: "plan_reminders", priority: "high", ttlMin: 20, interruptionLevel: "time-sensitive", verdict: "plan", title: "{title}", body: "{body}" },
  { kind: "plan_todo", step: 0, screenId: "bots.plan", category: "x0_todo", channel: "plan_reminders", priority: "normal", ttlMin: 12 * 60, verdict: "plan", title: "{title}", body: "{body}" },
  // Two or more reminders within 10 minutes, as one push with no buttons: a tap opens the Plan page.
  { kind: "plan_many", step: 0, screenId: "bots.plan", category: "", channel: "plan_reminders", priority: "high", ttlMin: 30, verdict: "plan", title: "{title}", body: "{body}" },
  { kind: "plan_evening", step: 1, screenId: "bots.plan", category: "", channel: "plan_notes", priority: "normal", ttlMin: 12 * 60, verdict: "plan", title: "{title}", body: "{body}" },
  { kind: "plan_morning", step: 1, screenId: "bots.plan", category: "", channel: "plan_notes", priority: "normal", ttlMin: 4 * 60, interruptionLevel: "passive", verdict: "silent", title: "{title}", body: "{body}" },
];

// ------------------------------------------------------------------ the steps to come plug in here

/**
 * Step 3 (bills, planDue.ts): a bill on its day at 10 am, and once more at 6 pm if it isn't paid. Its screen is the hand-off one, so
 * Pay opens the pay link (a button can't open another app by itself); a tap just to look opens the Plan (the `button` param tells them
 * apart: PushButton), and with no pay link it is x0_paid, and the screen opens the Plan.
 */
const STAGE_3: readonly PlanPushKind[] = [
  { kind: "plan_due", step: 3, screenId: "bots.plan.go", category: "x0_due", channel: "plan_reminders", priority: "high", ttlMin: 8 * 60, interruptionLevel: "time-sensitive", verdict: "plan", title: "{title}", body: "{body}" },
];
/**
 * Step 4 (waiting on, planWaits.ts). "Still waiting on Rahul" [Send] [Sorted] and "Did the plumber come?" [Yes] [No]: their screen is
 * the hand-off one, which opens WhatsApp only for the button that says so (Send, or No: "Hi, are you coming today?"), told apart from a
 * tap by the `button` param (PushButton). A tap just to look opens the Plan, where the card is: it never sends anything by itself.
 */
const STAGE_4: readonly PlanPushKind[] = [
  { kind: "plan_wait", step: 4, screenId: "bots.plan.send", category: "x0_wait", channel: "plan_reminders", priority: "normal", ttlMin: 12 * 60, verdict: "plan", title: "{title}", body: "{body}" },
  { kind: "plan_came", step: 4, screenId: "bots.plan.send", category: "x0_came", channel: "plan_reminders", priority: "normal", ttlMin: 8 * 60, verdict: "plan", title: "{title}", body: "{body}" },
];
/**
 * Step 5 (family, planAsks.ts): a person's word, so Plan Ease's switch doesn't stop them; Spaces' does (every space_* kind). The ask
 * and its "nobody took it" with [I'll do it] ("Who's in?" sends x0_in instead), the one nudge and who took it without a sound, and a
 * turn the evening before with [Can't do it].
 */
const STAGE_5: readonly PlanPushKind[] = [
  { kind: "space_ask", step: 5, screenId: "bots.plan", category: "x0_claim", channel: "family", priority: "high", ttlMin: 24 * 60, verdict: "people", title: "{title}", body: "{body}" },
  { kind: "space_ask_nudge", step: 5, screenId: "bots.plan", category: "x0_claim", channel: "family", priority: "normal", ttlMin: 12 * 60, verdict: "quiet", title: "{title}", body: "{body}" },
  { kind: "space_ask_none", step: 5, screenId: "bots.plan", category: "x0_claim", channel: "family", priority: "high", ttlMin: 12 * 60, verdict: "people", title: "{title}", body: "{body}" },
  { kind: "space_ask_taken", step: 5, screenId: "bots.plan", category: "", channel: "family", priority: "normal", ttlMin: 2 * 60, verdict: "quiet", title: "{title}", body: "{body}" },
  { kind: "space_turn", step: 5, screenId: "bots.plan", category: "x0_turn", channel: "family", priority: "normal", ttlMin: 24 * 60, verdict: "people", title: "{title}", body: "{body}" },
];
/**
 * Steps 2 and 3: a clash the work calendar's new read found (x0_move for the person's own movable thing; none for a booked one), and a
 * capture read after they left the share screen (x0_capture). The category goes with each push (engine.notify({ category })).
 */
const STAGE_2: readonly PlanPushKind[] = [
  { kind: "plan_decide", step: 2, screenId: "bots.plan", category: "", channel: "plan_notes", priority: "normal", ttlMin: 6 * 60, verdict: "plan", title: "{title}", body: "{body}" },
];

export const PLAN_PUSH_KINDS: readonly PlanPushKind[] = [...STAGE_0_1, ...STAGE_2, ...STAGE_3, ...STAGE_4, ...STAGE_5];

/** The kinds' names, typed, for push/defaults.ts EVENT_PUSH_KINDS. A new kind is added here too. */
export const PLAN_KIND_IDS = ["plan_event", "plan_leave", "plan_todo", "plan_many", "plan_evening", "plan_morning", "plan_decide", "plan_due",
  "plan_wait", "plan_came", "space_ask", "space_ask_nudge", "space_ask_none", "space_ask_taken", "space_turn"] as const;
export type PlanKindId = (typeof PLAN_KIND_IDS)[number];

export const planKind = (kind: string): PlanPushKind | undefined => PLAN_PUSH_KINDS.find((k) => k.kind === kind);

/** How verdict() treats a kind of Plan Ease's, or null for a kind that isn't one. */
export const planVerdictGroup = (kind: string): PlanVerdictGroup | null => planKind(kind)?.verdict ?? null;

// ------------------------------------------------------------------ the buttons

/** A notification button, as the phone registers it (F:src/notifications/categoriesCore.ts). */
export interface PlanButton {
  id: string; title: string; icon?: string;
  foreground: boolean; destructive: boolean; auth: boolean;
  /** POST /v1/widgets/act with this action on the push's data.item. */
  act?: string;
  /** Open the push's screen (a hand-off to Maps, WhatsApp or UPI happens there: a button cannot open another app by itself). */
  open?: true;
}
export interface PlanCategory { id: string; actions: PlanButton[] }

export const PLAN_CATEGORIES: readonly PlanCategory[] = [
  { id: "x0_todo", actions: [
    { id: "p_done", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" },
    { id: "p_later", title: "Later", icon: "clock", foreground: false, destructive: false, auth: false, act: "later" },
  ] },
  // A to-do's last reminder, after Later three times: Done only (it then stays quietly in the app).
  { id: "x0_todo_last", actions: [
    { id: "p_done_last", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" },
  ] },
  { id: "x0_leave", actions: [
    { id: "p_map", title: "Open map", icon: "map", foreground: true, destructive: false, auth: false, open: true },
  ] },
  { id: "x0_move", actions: [
    { id: "p_move", title: "Move it", icon: "calendar", foreground: false, destructive: false, auth: false, act: "move" },
    { id: "p_keep", title: "Keep", icon: "xmark", foreground: false, destructive: false, auth: false, act: "keep" },
  ] },
  // Step 3: a bill with a safe pay link (Pay opens it, through the hand-off screen), and one without (Paid only, never a Pay to nowhere).
  { id: "x0_due", actions: [
    { id: "p_pay", title: "Pay", icon: "creditcard", foreground: true, destructive: false, auth: false, open: true },
    { id: "p_paid", title: "Paid", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "paid" },
  ] },
  // Step 4: a wait's check-back (Send opens the hand-off screen; Sorted closes it), and a visit's (No opens the Plan's card).
  { id: "x0_wait", actions: [
    { id: "p_send", title: "Send", icon: "paperplane", foreground: true, destructive: false, auth: false, open: true },
    { id: "p_sorted", title: "Sorted", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "sorted" },
  ] },
  { id: "x0_came", actions: [
    { id: "p_came", title: "Yes", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "came" },
    { id: "p_notcame", title: "No", icon: "xmark", foreground: true, destructive: false, auth: false, open: true },
  ] },
  // Step 5: a family ask (the first tap wins), turns with no names yet, and a turn that can be passed on.
  { id: "x0_claim", actions: [
    { id: "p_take", title: "I'll do it", icon: "hand.raised", foreground: false, destructive: false, auth: false, act: "take" },
  ] },
  { id: "x0_in", actions: [
    { id: "p_in", title: "I'm in", icon: "hand.raised", foreground: false, destructive: false, auth: false, act: "in" },
  ] },
  { id: "x0_turn", actions: [
    { id: "p_cant", title: "Can't do it", icon: "xmark", foreground: false, destructive: false, auth: false, act: "cant" },
  ] },
  { id: "x0_paid", actions: [
    { id: "p_paid2", title: "Paid", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "paid" },
  ] },
  // Step 3: what was read from a share after they left it. In a push "Add all" adds the sure ones, the only ones the push names.
  { id: "x0_capture", actions: [
    { id: "p_addall", title: "Add all", icon: "plus", foreground: false, destructive: false, auth: false, act: "addall" },
    { id: "p_look", title: "Look", icon: "eye", foreground: true, destructive: false, auth: false, open: true },
  ] },
];

// ------------------------------------------------------------------ the Android channels

/** Made by the phone at its next push registration. Importance can't change once made, so each is right the first time. */
export interface PlanChannel { id: string; name: string; description: string; importance: "default" | "high" }

export const PLAN_CHANNELS: readonly PlanChannel[] = [
  { id: "plan_notes", name: "Day notes", description: "The evening note about tomorrow, and the morning note when the day changed.", importance: "default" },
  { id: "plan_reminders", name: "Reminders", description: "When it's time: leave, start, or do a to-do.", importance: "high" },
  { id: "family", name: "Family asks", description: "Who's doing what: asks from your family, and your turn.", importance: "default" },
];

// ------------------------------------------------------------------ what push/defaults.ts spreads in

export function planPushFlags(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PLAN_PUSH_KINDS) {
    out[`push.${k.kind}.enabled`] = true;
    out[`push.${k.kind}.screenId`] = k.screenId;
    out[`push.${k.kind}.category`] = k.category;
    out[`push.${k.kind}.channelId`] = k.channel;
    out[`push.${k.kind}.priority`] = k.priority;
    out[`push.${k.kind}.ttlMin`] = k.ttlMin;
    if (k.interruptionLevel) out[`push.${k.kind}.interruptionLevel`] = k.interruptionLevel;
  }
  return out;
}

export function planPushLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PLAN_PUSH_KINDS) { out[`push.${k.kind}.title`] = k.title; out[`push.${k.kind}.body`] = k.body; }
  return out;
}
