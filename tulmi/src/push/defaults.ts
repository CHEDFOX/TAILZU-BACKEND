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
    "push.refill.screenId": "stats",

    "push.weekly.enabled": true,
    "push.weekly.minWords": 200,
    "push.weekly.screenId": "stats",

    "push.winback.enabled": true,
    "push.winback.afterDays": 3,
    "push.winback.maxDays": 30,
    "push.winback.everyDays": 7,
    "push.winback.maxUnanswered": 3,
    "push.winback.screenId": "personality",

    // Event pushes: sent when something happens, never planned (see
    // PushEngine.notify). They skip the daily and weekly caps, the quiet
    // hours and the fatigue count, because a person is waiting on them.
    "push.approval.enabled": true,
    // The confirm sheet (experience/assistant.ts); the push carries data.taskId.
    "push.approval.screenId": "assistant_approve",

    // The Code bot's jobs (src/code/jobs, docs/code-router.md): paid compute needs a yes, a job is
    // waiting for a computer, its changes need a yes to be committed, it moved to another place, it
    // finished, it stopped, and (the agent loop, docs/code-agent.md) it needs the person: a question,
    // a plan to approve, an OK, more budget. The push carries data.jobId. The Code screen is the phone's to come, so
    // they open home until the control plane points them at it (push.code_*.screenId).
    "push.code_compute_ask.enabled": true,
    "push.code_compute_ask.screenId": "home",
    "push.code_compute_paused.enabled": true,
    "push.code_compute_paused.screenId": "home",
    "push.code_commit_ask.enabled": true,
    "push.code_commit_ask.screenId": "home",
    "push.code_job_moved.enabled": true,
    "push.code_job_moved.screenId": "home",
    "push.code_job_done.enabled": true,
    "push.code_job_done.screenId": "home",
    "push.code_job_failed.enabled": true,
    "push.code_job_failed.screenId": "home",
    "push.code_needs_you.enabled": true,
    "push.code_needs_you.screenId": "home",
    "push.code_minutes_low.enabled": true,
    "push.code_minutes_low.screenId": "home",

    // The Bots app's daily summary (src/you/push.ts): sent only to a person who turned it on, at the hour they chose, on a day something happened.
    "push.bots_summary.enabled": true,
    "push.bots_summary.screenId": "bots.activity",

    // Spaces (src/botsBots/spaceTasks.ts, threads.ts): someone in a space gave you a task, put something on your day, or messaged you.
    // A message push never carries the words; a muted chat sends none. The push carries data.spaceId / data.threadId.
    "push.space_task.enabled": true,
    "push.space_task.screenId": "bots.space.tasks",
    "push.space_plan.enabled": true,
    "push.space_plan.screenId": "bots.space.tasks",
    "push.space_message.enabled": true,
    "push.space_message.screenId": "bots.chats",

    // A reminder the person set on their own calendar or a to-do (src/calendar): the Plan, on that day (data.day).
    "push.plan_reminder.enabled": true,
    "push.plan_reminder.screenId": "bots.plan",

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
    "push.approval.title": "Waiting for your OK",
    "push.approval.body": "Tailzu needs a yes from you to carry on in {app}.",
    "push.code_compute_ask.title": "Paid compute needs your OK",
    "push.code_compute_ask.body": "“{task}” has no free computer to run on. Paid compute would cost about {cost}.",
    "push.code_compute_paused.title": "Waiting for a computer",
    "push.code_compute_paused.body": "“{task}” will carry on by itself when one of your computers is online.",
    "push.code_commit_ask.title": "Changes waiting for your OK",
    "push.code_commit_ask.body": "“{task}” has changes ready and needs your OK to commit them.",
    "push.code_job_moved.title": "Moved to another computer",
    "push.code_job_moved.body": "“{task}” is carrying on {where}.",
    "push.code_job_done.title": "Done",
    "push.code_job_done.body": "“{task}” is finished.",
    "push.code_job_failed.title": "Couldn't finish",
    "push.code_job_failed.body": "“{task}” stopped. {reason}",
    "push.code_needs_you.title": "Tailzu needs you",
    "push.code_needs_you.body": "“{task}”: {reason}",
    "push.code_minutes_low.title": "GitHub minutes running low",
    "push.code_minutes_low.body": "{reason} Past 95% Tailzu uses your own computer instead, or waits.",
    "push.bots_summary.title": "Today, {time}",
    "push.bots_summary.body": "{line}",
    "push.space_task.title": "{name} gave you a task",
    "push.space_task.body": "{title}{due}",
    "push.space_plan.title": "{name} planned something for you",
    "push.space_plan.body": "{title}{due}",
    "push.space_message.title": "{chat}",
    "push.space_message.body": "{name} sent a message",
    "push.plan_reminder.title": "{title}",
    "push.plan_reminder.body": "{when}",
    "push.lowWords.title": "{n} words left",
    "push.lowWords.body": "Enough for today. More any time.",
  },
};

/** Every reason the planner knows. */
export const PUSH_KINDS = ["streak", "refill", "weekly", "winback", "lowWords"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** Reasons that are sent when something happens, not planned by the engine. */
export const EVENT_PUSH_KINDS = [
  "approval",
  "code_compute_ask", "code_compute_paused", "code_commit_ask", "code_job_moved", "code_job_done", "code_job_failed", "code_needs_you", "code_minutes_low",
  "bots_summary",
  "space_task", "space_plan", "space_message",
  "plan_reminder",
] as const;
export type EventPushKind = (typeof EVENT_PUSH_KINDS)[number];
