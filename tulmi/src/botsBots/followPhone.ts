/**
 * FOLLOW-THROUGH'S REAL PHONE CALL, OVER PLIVO (CHANNEL_PHONE_CALLS, off by default; docs/follow-channels.md). A real call is an optional
 * loud step for a must-not-miss item (the ladder's `phone` rung, botsBots/planFollow.ts), only for an X0 user who turned it on themselves
 * ("X0 may call my phone if I miss something important", settings.notify.phoneCall) for their own number, proved theirs.
 *
 *   phoneCallsReady()     CHANNEL_PHONE_CALLS, every Plivo key, CONNECTOR_TOKEN_KEY (numbers are sealed and MACs made with it) and
 *                         PLAN_V2_FOLLOW. Not ready: no call goes, the routes answer 404, What pings you shows no switch
 *   PlivoPhone            the PhoneChannel the ladder plugs in (planFollowChannels.ts): ready, canCall, call, numberOf
 *     the number          view / setNumber / remove: the person types their own mobile number in the app (sealed, plan_phones) and the
 *                         screen shows a 4-digit code; they call X0's number once from that phone and type the code (inbound): only then
 *                         is it theirs (verified_ms), and only then does X0 ever call it. One call proves exactly the one account whose
 *                         code it typed, and a proved number is on one account only (a fresh proof moves it there). X0 never calls a
 *                         number to prove it (that would be calling someone who never said yes)
 *     the keypad          answer / input / hangup: the call says the reminder (lock-safe words, read again from the follow when it is
 *                         picked up), then 1 done, 2 later, 3 can't through the one reply door (planFollows().reply, via "call"), 9 stops
 *                         X0's calls to that number: kept by its keyed hash (plan_phone_stops), so adding the number again, on any
 *                         account, never lifts it; only a fresh proving call from that phone does
 *     signatures          every callback is Plivo's (X-Plivo-Signature-V3 over PUBLIC_ORIGIN + the path, constant time) and, for a call's
 *                         own callbacks, carries our MAC binding it to one step of one follow for one person (planReach.ts replyMac)
 *
 * Never in quiet hours (theirs, or 10 pm to 7 am when they set none), never to a number outside PLIVO_ALLOWED_PREFIXES, never twice for
 * one step (the ladder claims the step first), and it counts toward their daily limit (the ladder takes the caps). Nothing here logs a
 * number, a MAC or the words.
 */
import { getConfig } from "../config.js";
import { randomInt, timingSafeEqual } from "node:crypto";
import { applyPatch, DEFAULT_SETTINGS, type YouSettings, clock as clockWords } from "../you/settings.js";
import { youStore } from "../you/store.js";
import { clockAt, minuteOf } from "../calendar/words.js";
import {
  INBOUND, PHONE_CONSENT_V, afterKeyWords, againWords, first, hangupXml, keyAnswer, maskNumber, overWords, plivoNumber, prefixAllowed,
  promptWords, promptXml, quietFor, quietLine, sayXml, spacedNumber, v3Ok, type AfterKey, type Form, type KeyAnswer, type PhoneLang,
  type PromptIn, type Voices,
} from "./followPhoneWords.js";
import { planFollows, type PlanFollows } from "./planFollow.js";
import { setFollowChannels, type CanCall, type PhoneCall, type PhoneChannel, type PhoneOut } from "./planFollowChannels.js";
import {
  followRowOf, followStores, isDuplicate, phoneRowOf, type FollowRow, type PhoneRow, type PhoneStopTable, type PhoneTable,
} from "./planFollowStore.js";
import { firstName, forOthers, isOpenState, isUuid, whenWords } from "./planFollowWords.js";
import { e164Of, macOk, numberHash, openNumber, publicOrigin, reachReady, replyMac, sealNumber } from "./planReach.js";
import { followOn } from "./planSwitch.js";
import type { ActResult } from "../widgets/act.js";

/** Plivo's callbacks (routes/bots/followChannels.ts). Their query is never logged (observability.ts logUrl). */
export const PLIVO = "/v1/channels/plivo";
/** The app's own routes for the person's number (the setup screen, bots.plan.phone). */
export const PHONE = "/v1/botsapp/bots/plan/phone";
/** The setup screen (screens/bots/followPhone.ts). */
export const PHONE_SCREEN = "bots.plan.phone";
const API = "https://api.plivo.com/v1/Account";
/** How long a typed number waits for its proving call. */
export const PROVE_MS = 30 * 60_000;
/** The code the setup screen shows and the proving call types: this many digits. */
export const CODE_DIGITS = 4;
const CONSENT_KEPT = 20;
const TIMEOUT_MS = 8_000;

type Log = { info(o: object, m: string): void; warn(o: object, m: string): void };
const SILENT: Log = { info: () => undefined, warn: () => undefined };

/** CHANNEL_PHONE_CALLS, every Plivo key, CONNECTOR_TOKEN_KEY and PLAN_V2_FOLLOW. */
export function phoneCallsReady(): boolean {
  try {
    const c = getConfig();
    return !!(c.CHANNEL_PHONE_CALLS && c.PLIVO_AUTH_ID && c.PLIVO_AUTH_TOKEN && plivoNumber(c.PLIVO_FROM_NUMBER ?? "")) && reachReady() && followOn();
  } catch { return false; }
}

/** One call's callbacks: which follow, which climb, whom, in which language, our MAC, and which try. */
export interface CallQuery { f: string; n: number; u: string; l: PhoneLang; t: string; try: number; again: boolean }

/** The callback's query as ours, or null (never a guess). */
export function callQueryOf(q: unknown): CallQuery | null {
  const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof o[k] === "string" ? (o[k] as string) : "");
  const f = s("f").toLowerCase(), u = s("u").toLowerCase(), n = Number(s("n")), t = s("t");
  if (!isUuid(f) || !isUuid(u) || !Number.isInteger(n) || n < 1 || n > 9999 || !/^[A-Za-z0-9_-]{16}$/.test(t)) return null;
  return { f, n, u, l: s("l") === "hi" ? "hi" : "en", t, try: s("try") === "2" ? 2 : 1, again: s("again") === "1" };
}

/** What the setup screen shows (GET /v1/botsapp/bots/plan/phone). */
export interface PhoneView {
  /** Real calls can go here at all (the provider set up). */
  ready: boolean;
  /** Their switch in What pings you. */
  on: boolean;
  state: "none" | "pending" | "verified" | "stopped";
  /** Their number as they see it ("+91 98••• ••210"); "" when there is none. */
  display: string;
  /** X0's number to call once from their phone, while a number waits for its proof. */
  callTo: { display: string; number: string } | null;
  /** The code to type on that call (only this account is proved by it), while the number waits. */
  code: string | null;
  until: number | null;
  /** When calls never come. */
  quiet: string;
}

export type SetOut = { ok: true; view: PhoneView } | { ok: false; code: "bad_number" | "abroad" | "off" | "no_number"; message: string };

export interface FollowPhoneDeps {
  phones?: PhoneTable;
  stops?: PhoneStopTable;
  follows?: () => PlanFollows;
  fetch?: typeof fetch;
  now?: () => number;
  settingsOf?: (userId: string) => Promise<YouSettings>;
  saveSettings?: (userId: string, s: YouSettings) => Promise<void>;
  /** The language a person's calls are in. English until X0 keeps a language for a person. */
  langOf?: (userId: string) => Promise<PhoneLang>;
  log?: Log;
}

const withConsent = (list: PhoneRow["consent"], how: string, at: number): PhoneRow["consent"] =>
  [...(Array.isArray(list) ? list : []), { v: PHONE_CONSENT_V, at, how }].slice(-CONSENT_KEPT);

const codeOk = (seal: string | null | undefined, typed: string): boolean => {
  const want = seal ? openNumber(seal) : null;
  if (!want || want.length !== typed.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(typed));
};

export class PlivoPhone implements PhoneChannel {
  private readonly phones: PhoneTable;
  private readonly stops: PhoneStopTable;
  private readonly follows: () => PlanFollows;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly settingsOf: (userId: string) => Promise<YouSettings>;
  private readonly saveSettings: (userId: string, s: YouSettings) => Promise<void>;
  private readonly langOf: (userId: string) => Promise<PhoneLang>;
  private readonly log: Log;

  constructor(d: FollowPhoneDeps = {}) {
    this.phones = d.phones ?? followStores().phones;
    this.stops = d.stops ?? followStores().phoneStops;
    this.follows = d.follows ?? (() => planFollows());
    this.fetch = d.fetch ?? ((...a) => fetch(...a));
    this.now = d.now ?? Date.now;
    this.settingsOf = d.settingsOf ?? (async (u) => youStore().getSettings(u).catch(() => structuredClone(DEFAULT_SETTINGS)));
    this.saveSettings = d.saveSettings ?? (async (u, s) => { await youStore().putSettings(u, s, this.now()); });
    this.langOf = d.langOf ?? (async () => "en");
    this.log = d.log ?? SILENT;
  }

  ready(): boolean { return phoneCallsReady(); }

  private voices(): Voices {
    try { const c = getConfig(); return { en: c.PLIVO_VOICE_EN, hi: c.PLIVO_VOICE_HI }; } catch { return { en: "Polly.Raveena", hi: "Polly.Aditi" }; }
  }
  private prefixes(): string { try { return getConfig().PLIVO_ALLOWED_PREFIXES; } catch { return "+91"; } }
  private fromNumber(): string | null { try { return plivoNumber(getConfig().PLIVO_FROM_NUMBER ?? ""); } catch { return null; } }

  // ------------------------------------------------------------------ the person's number (plan_phones)

  private async rowOf(userId: string): Promise<PhoneRow | null> {
    const r = (await this.phones.select({ user_id: userId }, { limit: 1 }))[0];
    return r ? phoneRowOf(r) : null;
  }

  /** The number X0 may call: proved theirs (its keyed hash is the one the proving call matched), not stopped. */
  private callable(r: PhoneRow | null): string | null {
    if (!r || !r.seal || !r.hash || r.verified_ms === null || r.stopped_ms !== null) return null;
    const n = openNumber(r.seal);
    if (!n) return null;
    try { return numberHash(n) === r.hash ? n : null; } catch { return null; }
  }

  /** The number's owner pressed 9 (plan_phone_stops). A read that fails counts as stopped: no call is ever placed on a guess. */
  private async stoppedHash(hash: string | null): Promise<boolean> {
    if (!hash) return false;
    return (await this.stops.select({ hash }, { limit: 1 }).catch(() => [{ hash, stopped_ms: 0 }])).length > 0;
  }

  private stateOfRow(r: PhoneRow | null, now: number, stopListed: boolean): PhoneView["state"] {
    if (!r || !r.seal) return "none";
    if (r.stopped_ms !== null) return "stopped";
    if (r.verified_ms !== null && r.hash) return stopListed ? "stopped" : "verified";
    if (r.pending_hash && r.pending_until_ms !== null && r.pending_until_ms > now) return "pending";
    return "none";
  }

  async view(userId: string): Promise<PhoneView> {
    const now = this.now();
    const [r, s] = await Promise.all([this.rowOf(userId).catch(() => null), this.settingsOf(userId)]);
    const state = this.stateOfRow(r, now, await this.stoppedHash(r?.hash ?? null));
    const num = r?.seal && state !== "none" ? openNumber(r.seal) : null;
    const from = this.fromNumber();
    return {
      ready: this.ready(), on: s.notify.phoneCall === true, state, display: num ? maskNumber(num) : "",
      callTo: state === "pending" && from ? { display: spacedNumber(from), number: from } : null,
      code: state === "pending" && r?.pending_code ? openNumber(r.pending_code) : null,
      until: state === "pending" ? r?.pending_until_ms ?? null : null,
      quiet: quietLine(s.notify, (m) => clockWords(m, true)),
    };
  }

  /** What What pings you shows beside the switch (planFollowChannels.ts). */
  async numberOf(userId: string): Promise<{ state: "none" | "pending" | "verified" | "stopped"; display: string; setup: { screen: string } }> {
    const v = await this.view(userId);
    return { state: v.state, display: v.display, setup: { screen: PHONE_SCREEN } };
  }

  /**
   * Their own mobile number, typed in the app: kept sealed and waiting for its proof (they call X0's number once from it and type the code
   * the screen shows). The same number already proved stays as it is; any other number (or one they stopped) waits for its proof again:
   * until then, no call. A number whose owner pressed 9 stays stopped (plan_phone_stops) until that proving call.
   */
  async setNumber(userId: string, raw: unknown): Promise<SetOut> {
    if (!this.ready()) return { ok: false, code: "off", message: "Phone calls aren't switched on here." };
    const e = e164Of(raw);
    if (!e) return { ok: false, code: "bad_number", message: "That number doesn't look right." };
    const prefixes = this.prefixes();
    if (!prefixAllowed(e, prefixes)) return { ok: false, code: "abroad", message: `X0 can only call numbers starting ${prefixes.split(",").map((p) => p.trim()).filter(Boolean).join(" or ")} for now.` };
    const now = this.now();
    const h = numberHash(e);
    const r = await this.rowOf(userId);
    if (r && r.hash === h && r.verified_ms !== null && r.stopped_ms === null && this.callable(r) && !(await this.stoppedHash(h))) return { ok: true, view: await this.view(userId) };
    // A code no other account waiting on this number has, so one call can only ever prove one account.
    const taken = new Set((await this.phones.byPendingHash(h, now, 20).catch(() => [])).map(phoneRowOf).filter((x) => x.user_id !== userId).map((x) => (x.pending_code ? openNumber(x.pending_code) : null)));
    let code = "";
    for (let i = 0; i < 20 && (!code || taken.has(code)); i += 1) code = String(randomInt(10 ** (CODE_DIGITS - 1), 10 ** CODE_DIGITS));
    const patch: Partial<PhoneRow> = {
      seal: sealNumber(e), hash: null, verified_ms: null, pending_hash: h, pending_until_ms: now + PROVE_MS, pending_code: sealNumber(code), stopped_ms: null,
      consent: withConsent(r?.consent ?? [], "number_added", now), updated_ms: now,
    };
    if (r) await this.phones.update({ user_id: userId }, patch);
    else {
      try { await this.phones.insert({ user_id: userId, created_ms: now, ...patch } as PhoneRow); } catch (err) {
        if (!isDuplicate(err)) throw err;
        await this.phones.update({ user_id: userId }, patch);
      }
    }
    return { ok: true, view: await this.view(userId) };
  }

  /** The number they already gave, proved again (after they stopped calls, or the proof ran out). */
  async again(userId: string): Promise<SetOut> {
    const r = await this.rowOf(userId);
    const n = r?.seal ? openNumber(r.seal) : null;
    if (!n) return { ok: false, code: "no_number", message: "Add your number first." };
    return this.setNumber(userId, n);
  }

  /** Takes their number away (what they agreed and when is kept), and their switch goes off: no number, no calls. */
  async remove(userId: string): Promise<PhoneView> {
    const now = this.now();
    const r = await this.rowOf(userId);
    if (r) {
      await this.phones.update({ user_id: userId }, {
        seal: null, hash: null, verified_ms: null, pending_hash: null, pending_until_ms: null, pending_code: null,
        consent: withConsent(r.consent, "number_removed", now), updated_ms: now,
      });
    }
    await this.setSwitch(userId, false);
    return this.view(userId);
  }

  private async setSwitch(userId: string, on: boolean): Promise<void> {
    try {
      const s = await this.settingsOf(userId);
      if (s.notify.phoneCall === on) return;
      const p = applyPatch(s, { notify: { phoneCall: on } });
      if (p.ok) await this.saveSettings(userId, p.settings);
    } catch (err) { this.log.warn({ err: (err as Error)?.name }, "[phone] switch not saved"); }
  }

  /**
   * 9: no more calls to that number. Kept by its keyed hash (plan_phone_stops), so it holds for any account that adds the number later,
   * and adding it again never lifts it: only a fresh proving call from that phone does. The account that has it is stopped too (its switch
   * goes off). False when the stop could not be kept.
   */
  private async stopNumber(hash: string, now: number): Promise<boolean> {
    let kept = true;
    await this.stops.upsert({ hash, stopped_ms: now }, ["hash"]).catch((err) => { kept = false; this.log.warn({ err: (err as Error)?.name }, "[phone] stop not kept"); });
    for (const r of (await this.phones.byHash(hash, 20).catch(() => [])).map(phoneRowOf)) {
      if (r.stopped_ms === null) await this.phones.update({ user_id: r.user_id }, { stopped_ms: now, consent: withConsent(r.consent, "pressed_9", now), updated_ms: now }).catch(() => 0);
      await this.setSwitch(r.user_id, false);
    }
    return kept;
  }

  // ------------------------------------------------------------------ the channel (what the ladder asks)

  async canCall(userId: string, now: number, tz: number): Promise<CanCall> {
    if (!this.ready()) return "off";
    const s = await this.settingsOf(userId);
    if (!s.notify.phoneCall || s.notify.botsOff.includes("plan")) return "off";
    const r = await this.rowOf(userId);
    if (r && r.stopped_ms !== null) return "stopped";
    const n = this.callable(r);
    if (!n) return "no_number";
    if (await this.stoppedHash(r!.hash)) return "stopped";
    if (!prefixAllowed(n, this.prefixes())) return "abroad";
    if (quietFor(s.notify, minuteOf(now, tz))) return "quiet";
    return "ok";
  }

  private query(c: Pick<CallQuery, "f" | "n" | "u" | "l" | "t">, extra: { try?: 2; again?: 1 } = {}): string {
    return `f=${c.f}&n=${c.n}&u=${c.u}&l=${c.l}&t=${c.t}${extra.try ? "&try=2" : ""}${extra.again ? "&again=1" : ""}`;
  }
  private url(path: "answer" | "input" | "hangup", c: Pick<CallQuery, "f" | "n" | "u" | "l" | "t">, extra: { try?: 2; again?: 1 } = {}): string {
    return `${publicOrigin()}${PLIVO}/${path}?${this.query(c, extra)}`;
  }

  /** One real call. `refused…` and `http_4xx` never left (the ladder gives its caps back); a timeout may have. */
  async call(m: PhoneCall): Promise<PhoneOut> {
    if (!this.ready()) return { ok: false, why: "refused_off" };
    const row = await this.rowOf(m.userId).catch(() => null);
    const to = this.callable(row);
    if (!to) return { ok: false, why: "refused_no_number" };
    if (await this.stoppedHash(row!.hash)) return { ok: false, why: "refused_stopped" };
    if (!prefixAllowed(to, this.prefixes())) return { ok: false, why: "refused_abroad" };
    const from = this.fromNumber();
    if (!from) return { ok: false, why: "refused_off" };
    const c = getConfig();
    const id = c.PLIVO_AUTH_ID ?? "", token = c.PLIVO_AUTH_TOKEN ?? "";
    const q = { f: m.followId, n: m.n, u: m.userId, l: await this.langOf(m.userId).catch(() => "en" as const), t: replyMac(m.followId, m.n, `u:${m.userId}`) };
    const body = {
      from: from.slice(1), to: to.slice(1),
      answer_url: this.url("answer", q), answer_method: "POST",
      hangup_url: this.url("hangup", q), hangup_method: "POST",
      ring_timeout: 30, time_limit: 120, machine_detection: "hangup",
    };
    try {
      const res = await this.fetch(`${API}/${encodeURIComponent(id)}/Call/`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${id}:${token}`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) { this.log.warn({ status: res.status }, "[phone] call refused"); return { ok: false, why: `http_${res.status}` }; }
      const j = (await res.json().catch(() => null)) as { request_uuid?: unknown } | null;
      const ext = typeof j?.request_uuid === "string" ? j.request_uuid : Array.isArray(j?.request_uuid) && typeof j.request_uuid[0] === "string" ? j.request_uuid[0] : null;
      return ext ? { ok: true, ext: ext.slice(0, 80) } : { ok: false, why: "no_id" };
    } catch (err) {
      const name = (err as Error)?.name ?? "";
      return { ok: false, why: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
  }

  /** The keyed hash of the number a call would ring (never the number): the ladder's per-number cap ("n:<hash>"). */
  async numberKey(userId: string): Promise<string | null> {
    const r = await this.rowOf(userId).catch(() => null);
    return this.callable(r) ? r!.hash : null;
  }

  // ------------------------------------------------------------------ a call's callbacks

  /** Our MAC on the callback: this follow, this climb, this person. */
  macOk(c: CallQuery): boolean { return macOk(c.f, c.n, `u:${c.u}`, c.t); }

  /** The step's later news: answered (a key was pressed) or no answer; never back down (planFollows().stepSeen). */
  private async seen(c: CallQuery, form: Form, state: "answered" | "no_answer", now: number): Promise<void> {
    const ids = [...new Set([first(form, "CallUUID"), first(form, "RequestUUID")].filter((x) => x && x.length <= 80))];
    for (const id of ids) await this.follows().stepSeen(id, state, now, `u:${c.u}`).catch(() => undefined);
  }

  private async rowFor(id: string): Promise<FollowRow | null> {
    const r = (await this.follows().stores.follows.select({ id }, { limit: 1 }).catch(() => []))[0];
    return r ? followRowOf(r) : null;
  }

  /**
   * What the call says, from the follow as it is now: null when it closed, moved on to someone else or another climb, or the person is no
   * longer in the asker's X0 people (then the call says only that it isn't open).
   */
  private async words(c: CallQuery, now: number): Promise<{ f: FollowRow; prompt: PromptIn } | null> {
    const f = await this.rowFor(c.f);
    if (!f || !isOpenState(f.state) || f.holder_key !== `u:${c.u}` || f.n !== c.n) return null;
    let asker = "";
    if (f.user_id !== c.u) {
      const follows = this.follows();
      // No longer in the asker's X0 people: the call says only that it isn't open. A read that failed is not that (the call already went).
      if ((await follows.stillIn(f.user_id, c.u)) === false) return null;
      asker = firstName((await follows.contactsOf(c.u)).get(f.user_id) ?? "Someone");
    }
    return { f, prompt: { asker, what: forOthers(f.title), when: whenWords({ dueMs: f.due_ms, day: f.day, tz: f.tz_min, now }), lang: c.l } };
  }

  /** Picked up: the reminder and its keys. The second try (no key the first time) hangs up and the step is "no answer". */
  async answer(c: CallQuery, form: Form): Promise<string> {
    const now = this.now(), voices = this.voices();
    const req = first(form, "RequestUUID"), call = first(form, "CallUUID");
    if (req && call && req !== call && call.length <= 80) await this.follows().stepExt(req, call).catch(() => undefined);
    if (c.try >= 2) { await this.seen(c, form, "no_answer", now); return hangupXml(); }
    const w = await this.words(c, now);
    if (!w) return sayXml(overWords(c.l), c.l, voices);
    return promptXml({ words: promptWords(w.prompt), action: this.url("input", c), redirect: this.url("answer", c, { try: 2 }), lang: c.l, voices });
  }

  /** A key: 1, 2 or 3 through the one reply door; 9 stops calls to this number; anything else asks once more. */
  async input(c: CallQuery, form: Form): Promise<string> {
    const now = this.now(), voices = this.voices(), lang = c.l;
    const key = keyAnswer(first(form, "Digits"));
    if (!key) {
      if (c.again) { await this.seen(c, form, "no_answer", now); return hangupXml(); }
      const w = await this.words(c, now);
      if (!w) return sayXml(overWords(lang), lang, voices);
      return promptXml({ words: againWords(w.prompt), action: this.url("input", c, { again: 1 }), redirect: this.url("answer", c, { try: 2 }), lang, voices });
    }
    await this.seen(c, form, "answered", now);
    if (key === "stop") {
      const r = await this.rowOf(c.u).catch(() => null);
      if (r?.hash) await this.stopNumber(r.hash, now);
      else await this.setSwitch(c.u, false);
      return sayXml(afterKeyWords({ k: "stop" }, lang), lang, voices);
    }
    const before = await this.words(c, now);
    const ext = first(form, "CallUUID") || first(form, "RequestUUID");
    const out = await this.follows().reply({
      followId: c.f, by: `u:${c.u}`, answer: key, n: c.n, via: "call", ...(ext ? { ext: ext.slice(0, 80) } : {}), ...(key === "later" ? { later: "default" as const } : {}),
    });
    return sayXml(afterKeyWords(await this.afterOf(c, key, out, before?.prompt.asker ?? ""), lang), lang, voices);
  }

  /** What to say after the door answered, from the follow as it is now. */
  private async afterOf(c: CallQuery, key: Exclude<KeyAnswer, "stop">, out: ActResult, asker: string): Promise<AfterKey> {
    if (out.status !== 200) return { k: "moved" };
    const state = String(out.body.state ?? "");
    const f = await this.rowFor(c.f);
    const nameOf = async (id: string): Promise<string> => {
      if (id === c.u) return "You";
      if (f && id === f.user_id) return firstName((await this.follows().contactsOf(c.u)).get(id) ?? "Someone");
      return firstName(f?.people.find((p) => p.id === id)?.name ?? "Someone");
    };
    switch (state) {
      case "done": return { k: "done", asker };
      case "later": return f ? { k: "later", clock: clockAt(f.base_ms, f.tz_min) } : { k: "moved" };
      case "kept": return { k: "last" };
      case "passed": {
        const h = f?.people[f.holder];
        return h ? { k: "passed", to: await nameOf(h.id) } : { k: "moved" };
      }
      case "nobody": return { k: "nobody", asker };
      case "dropped": return { k: "dropped" };
      case "already":
        if (f?.state === "done" && f.done_by) return { k: "already", who: await nameOf(f.done_by.id) };
        return key === "done" ? { k: "already", who: "" } : { k: "moved" };
      default: return { k: "moved" };
    }
  }

  /** The call ended: "no answer" unless a key was pressed (never back down). */
  async hangup(c: CallQuery, form: Form): Promise<void> {
    await this.seen(c, form, "no_answer", this.now());
  }

  // ------------------------------------------------------------------ someone calls X0's number (the proof that a number is theirs)

  async inbound(form: Form): Promise<string> {
    const voices = this.voices(), now = this.now();
    const from = plivoNumber(first(form, "From"));
    if (!from) return sayXml(INBOUND.unknown, "en", voices);
    const h = numberHash(from);
    const action = `${publicOrigin()}${PLIVO}/inbound/input`;
    if ((await this.phones.byPendingHash(h, now, 5)).length) return promptXml({ words: INBOUND.prove, action, lang: "en", voices, closing: INBOUND.bye, digits: CODE_DIGITS });
    const set = (await this.phones.byHash(h, 20)).map(phoneRowOf).filter((r) => r.verified_ms !== null && r.stopped_ms === null);
    if (set.length) return promptXml({ words: INBOUND.already, action, lang: "en", voices, closing: INBOUND.bye });
    return sayXml(INBOUND.unknown, "en", voices);
  }

  /**
   * The code from the setup screen proves the number for that one account only (the waiting rows are found by the number's keyed hash:
   * nothing is opened to look; then only the one whose code matches). The number leaves any other account that had it (one account per
   * number), and a stop on it is lifted (this is the fresh proving call from that phone). 9 stops calls to it.
   */
  async inboundInput(form: Form): Promise<string> {
    const voices = this.voices(), now = this.now();
    const from = plivoNumber(first(form, "From"));
    if (!from) return sayXml(INBOUND.unknown, "en", voices);
    const h = numberHash(from);
    const d = first(form, "Digits").trim();
    if (d === "9") return sayXml((await this.stopNumber(h, now)) ? INBOUND.stopped : INBOUND.bye, "en", voices);
    if (!new RegExp(`^\\d{${CODE_DIGITS}}$`).test(d)) return sayXml(INBOUND.bye, "en", voices);
    const waiting = (await this.phones.byPendingHash(h, now, 5)).map(phoneRowOf).filter((r) => {
      const n = r.seal ? openNumber(r.seal) : null;
      return !!n && numberHash(n) === h;
    });
    if (!waiting.length) return sayXml(INBOUND.late, "en", voices);
    const hits = waiting.filter((r) => codeOk(r.pending_code, d));
    if (hits.length !== 1) return sayXml(INBOUND.wrong, "en", voices);
    const hit = hits[0]!;
    // One account per number: whoever had it proved before loses it (their switch goes off) before this one takes it.
    for (const r of (await this.phones.byHash(h, 20)).map(phoneRowOf)) {
      if (r.user_id === hit.user_id) continue;
      await this.phones.update({ user_id: r.user_id, hash: h }, {
        seal: null, hash: null, verified_ms: null, consent: withConsent(r.consent, "proved_on_another_account", now), updated_ms: now,
      }).catch(() => 0);
      await this.setSwitch(r.user_id, false);
    }
    const won = await this.phones.update({ user_id: hit.user_id, pending_hash: h }, {
      hash: h, verified_ms: now, pending_hash: null, pending_until_ms: null, pending_code: null, stopped_ms: null,
      consent: withConsent(hit.consent, "inbound_call", now), updated_ms: now,
    }).catch(() => 0);
    if (!won) return sayXml(INBOUND.late, "en", voices);
    await this.stops.remove({ hash: h }).catch(() => 0);
    // Typing the code after hearing what it means is their yes: their switch goes on.
    await this.setSwitch(hit.user_id, true);
    return sayXml(INBOUND.proved, "en", voices);
  }
}

// ------------------------------------------------------------------ the shared one

let shared: PlivoPhone | null = null;
export function followPhone(): PlivoPhone { return (shared ??= new PlivoPhone()); }
export function setFollowPhone(p: PlivoPhone | null): void { shared = p; }

/** Plugs the phone channel into the ladder (routes/bots/followChannels.ts, at boot). */
export function plugFollowChannels(p: PlivoPhone = followPhone()): PlivoPhone {
  setFollowChannels({ phone: p });
  return p;
}

/** Plivo's signature on a callback, over PUBLIC_ORIGIN + the path and query it was sent to (never the proxy's host). */
export function plivoSigned(o: { url: string; body: Form; headers: Record<string, unknown> }): boolean {
  let token: string | undefined;
  try { token = getConfig().PLIVO_AUTH_TOKEN; } catch { return false; }
  const h = (k: string): unknown => o.headers[k];
  const full = `${publicOrigin()}${o.url}`;
  return v3Ok({ url: full, body: o.body, nonce: h("x-plivo-signature-v3-nonce"), signatures: h("x-plivo-signature-v3"), token })
    || v3Ok({ url: full, body: o.body, nonce: h("x-plivo-signature-v3-nonce"), signatures: h("x-plivo-signature-ma-v3"), token });
}
