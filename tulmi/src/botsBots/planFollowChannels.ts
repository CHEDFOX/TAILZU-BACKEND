/**
 * FOLLOW-THROUGH'S PHONE CHANNEL: THE SEAM (PLAN_V2_FOLLOW; CHANNEL_PHONE_CALLS, off by default). A real phone call is an optional loud
 * step for a must-not-miss item, for X0 users only: the person turns it on themselves in What pings you ("X0 may call my phone if I miss
 * something important", settings.notify.phoneCall, off by default) for their own number, proved theirs (plan_phones.verified_ms). The
 * provider (Plivo), the number's proof, the keypad (1 done, 2 later, 3 can't) and its callbacks are Backend B's
 * (botsBots/followPhone.ts); they plug in here with setFollowChannels. Until then there is none: the phone rung passes without a step.
 *
 * The ladder (planFollow.ts) asks, in order: the person's own switch (settings), `ready()`, `canCall()`, the day's caps (taken only
 * right before the call, given back when it did not leave), then `call()`. Never in quiet hours: `canCall` answers "quiet" inside the
 * person's own quiet hours (and the ladder adds 10 pm to 7 am for someone else's item when they set none). The words it hands over are
 * already lock-safe (planFollowWords.ts forOthers: no amount, no health title, since a call may be on speaker).
 *
 * What B calls back: planFollows().reply({ followId, by: person, answer, n, via: "call", ext }) for a key pressed,
 * planFollows().stepSeen(ext, "answered" | "no_answer" | "failed", at) when the call ends, and planFollows().stepExt(old, new) when the
 * provider's call id replaces its request id.
 */
import type { PersonKey } from "./planFollowWords.js";

/** One real phone call to one person for one step of one follow. */
export interface PhoneCall {
  followId: string;
  /** The climb it is for: the keypad's answer is about this n (an answer about an old n counts for nothing). */
  n: number;
  /** Who is called: an X0 user, on their own proved number (the channel finds it: plan_phones). */
  userId: string;
  person: PersonKey;
  /** The asker's first name when the item is someone else's ("Priya asked me to remind you"); "" for the person's own. */
  asker: string;
  /** forOthers(title): "" for a health-looking title (then the words say "your reminder"); never an amount. */
  what: string;
  /** whenWords(...): "9 pm", "today". */
  when: string;
  tz: number;
  now: number;
}
export type PhoneOut = { ok: true; ext: string } | { ok: false; why: string };
export type CanCall = "ok" | "no_number" | "stopped" | "quiet" | "abroad" | "off";

export interface PhoneChannel {
  /** CHANNEL_PHONE_CALLS on and every provider key set (and CONNECTOR_TOKEN_KEY): else no real call ever goes. */
  ready(): boolean;
  /** Whether this person can get a real call now: their proved number, not stopped, outside their quiet hours, an allowed prefix. */
  canCall(userId: string, now: number, tz: number): Promise<CanCall>;
  /** Place the call. `ok: false` with a why starting "http_4" or "refused" means it never left (the ladder gives its caps back). */
  call(m: PhoneCall): Promise<PhoneOut>;
  /**
   * The keyed hash of the number a call to this person would ring (never the number), or null: the ladder counts real calls per number
   * too ("n:<hash>", phoneDayMax a day), however many accounts it has been on.
   */
  numberKey?(userId: string): Promise<string | null>;
  /**
   * What What pings you shows beside the switch: the person's number as they see it ("+91 98••• ••210"), whether it is proved (or they
   * stopped calls by pressing 9 on one), and the screen that adds, proves or changes it (botsBots/followPhone.ts). Null: nothing to show.
   */
  numberOf?(userId: string): Promise<{ state: "none" | "pending" | "verified" | "stopped"; display: string; setup?: { screen: string; params?: Record<string, string> } } | null>;
}

export interface FollowChannels { phone: PhoneChannel | null }

export const NO_CHANNELS: FollowChannels = { phone: null };

let current: FollowChannels | null = null;
/** The channels plugged in; NO_CHANNELS until set. */
export function followChannels(): FollowChannels { return current ?? NO_CHANNELS; }
export function setFollowChannels(c: FollowChannels | null): void { current = c; }
/** A real phone call can go at all (the provider plugged in and ready). What pings you shows the switch only then. */
export const phoneReady = (): boolean => { try { return !!followChannels().phone?.ready(); } catch { return false; } };
