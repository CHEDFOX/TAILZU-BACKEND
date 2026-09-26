/**
 * SMART NOTIFICATIONS — what the server would do with no rules at all.
 *
 * The engine never sends on a clock. Each person gets at most one push on a
 * day it has a reason to, at the hour they usually pick up their phone and
 * talk to it, and fewer when they stop answering. Every number and every word
 * here is a default: the control plane's "push" surface edits this object per
 * user (platform, language, named users, a percentage, a date window, an
 * experiment) before the planner reads it, and removing the rule restores it.
 *
 * Kept free of imports so the control plane can preview it without a cycle.
 */
export interface PushPayload {
  flags: Record<string, unknown>;
  labels: Record<string, string>;
}

export const PUSH_DEFAULTS: PushPayload = {
  flags: {
    // The switch, and a mode that plans and reports without sending.
    "push.smart.enabled": true,
    "push.smart.dryRun": false,
    // Which reason wins when several apply on the same day.
    "push.smart.priority": ["streak", "refill", "weekly", "winback", "lowWords"],

    // Caps. Never daily: one a day at most, three a week at most, and a day
    // between any two.
    "push.smart.maxPerDay": 1,
    "push.smart.maxPerWeek": 3,
    "push.smart.minGapHours": 20,

    // The rhythm: when this person dictates, learned from what they did.
    "push.smart.lookbackDays": 42,
    "push.smart.halfLifeDays": 14,
    // How much the hour of any day counts beside the same hour of the same
    // weekday. Weekday habits win once there is enough of them.
    "push.smart.dayBlend": 0.35,
    // Below this much history the rhythm is a guess, and the fallback hour
    // (in the person's own time) is used instead.
    "push.smart.minEvents": 5,
    "push.smart.minDays": 3,
    "push.smart.fallbackLocalHour": 19,
    // Land a little before the habitual hour, not in the middle of it.
    "push.smart.leadMin": 10,
    // A per-person offset so a thousand people with the same habit are not
    // all sent to in the same second.
    "push.smart.jitterMin": 8,
    // Never in the person's night, when their clock is known.
    "push.smart.quietStartHour": 22,
    "push.smart.quietEndHour": 8,

    // Leave people alone who were just here, and people who just arrived.
    "push.smart.recentUseHours": 6,
    "push.smart.minAccountHours": 24,
    // Fatigue: after this many pushes in a row that were neither opened nor
    // followed by a dictation within a day, stop for a while.
    "push.smart.ignoreLimit": 3,
    "push.smart.pauseDays": 14,

    // Engine timing.
    "push.smart.planTtlMin": 60,
    "push.smart.graceMin": 30,
    "push.smart.ttlMin": 180,
    "push.android.channelId": "default",

    // The reasons.
    "push.streak.enabled": true,
    "push.streak.minDays": 2,
    // No streak nudge in the last hour before the day turns over (UTC, the
    // day the streak is counted in).
    "push.streak.cutoffMin": 60,
    "push.streak.screenId": "stats",

    "push.refill.enabled": true,
    "push.refill.days": 3,
    "push.refill.screenId": "home",

    "push.weekly.enabled": true,
    "push.weekly.minWords": 200,
    "push.weekly.screenId": "stats",

    "push.winback.enabled": true,
    "push.winback.afterDays": 3,
    "push.winback.maxDays": 30,
    "push.winback.everyDays": 7,
    "push.winback.maxUnanswered": 3,
    "push.winback.screenId": "home",

    "push.lowWords.enabled": false,
    "push.lowWords.fraction": 0.1,
    "push.lowWords.screenId": "paywall",
  },
  labels: {
    "push.streak.title": "Keep your streak",
    "push.streak.body": "Day {n}. One dictation keeps it going.",
    "push.refill.title": "Your words are back",
    "push.refill.body": "A new month of words is ready.",
    "push.weekly.title": "Your week",
    "push.weekly.body": "{words} words written by voice this week.",
    "push.winback.title": "Say it, don't type it",
    "push.winback.body": "Tailzu writes it for you.",
    "push.lowWords.title": "{n} words left",
    "push.lowWords.body": "Enough for today. More any time.",
  },
};

/** Every reason the planner knows. */
export const PUSH_KINDS = ["streak", "refill", "weekly", "winback", "lowWords"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
