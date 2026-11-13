/**
 * THE REALTIME CALL'S LIVE SESSION (planCallLiveWords.ts has its words and numbers; planCall.ts is the call itself; the routes are
 * routes/bots/planCalls.ts; docs/plan-ease.md "Calls").
 *
 * The phone's audio goes straight to OpenAI over WebRTC. This holds the server's own socket on the same call (the sideband), and
 * everything that matters happens here:
 *
 *   prepare(user, id)          the session is built while the phone is still getting its microphone, and kept two minutes
 *   start(user, id, sdp, …)    the SDP exchange, the sideband, and the row's marks. Nothing reaches OpenAI before the route's checks
 *   ready(user, id)            the phone is connected: the bot speaks the opening, in English, starting with a mild "Hello"
 *   stop(id, why)              the live part ends (the call itself may stay answered and carry on turn by turn)
 *   fellBack(userId, id)       the turn call is taking over: the live part closes first, so its cost total cannot erase the turn's
 *   stopFor(userId)            every live call of this person ends NOW: they took their AI permission back
 *   sweepOrphans()             at boot: rows another process left marked live are hung up
 *
 * WHAT IS NOT HERE: ANY MONEY LIMIT. A call is never refused, shortened or stopped for cost, and nothing is charged to Plan Ease's day
 * budget, the person's spend gate or their plan quota. Each response's cost is PRICED AND RECORDED on the call's row, for the owner to
 * read. The only limits are technical: one reply's length, a tool loop, the idle end, and a hard maximum length against a stuck
 * session. The AI permission is the one thing that can stop a call outright, and it stops it at once.
 *
 * The OpenAI link sits behind `RtLink` (realtime/openaiCalls.ts), so a relay could take the sideband's place later without touching
 * the tools, the cost record or the transcript. Logs hold counts only: never a key, an SDP, a transcript or the judge's words.
 */
import type { AuthedUser } from "../auth/supabase.js";
import type { Bots } from "../bots/index.js";
import { scrub } from "../bots/run.js";
import type { ToolKit } from "../bots/tools.js";
import { getConfig } from "../config.js";
import { getPersonality } from "../personality/store.js";
import { getPrefs, readSpeed } from "../keybot/prefs.js";
import { aiAllowedFor } from "../privacy/aiGate.js";
import { attachSideband, createCall, hangup, type RtLink } from "../realtime/openaiCalls.js";
import { realtimeVoice } from "../realtime/voices.js";
import { inCostTally, takeCostUsd } from "../usage/cost.js";
import { asPerson } from "../privacy/aiGate.js";
import type { BotChat } from "./chat.js";
import type { PlanEase } from "./planEase.js";
import { planEase } from "./planEase.js";
import { planCalls, type CallRow, type PlanCalls } from "./planCall.js";
import { spokenOf } from "./planCallWords.js";
import { parseItem } from "../widgets/items.js";
import {
  GOODBYE_LEAD_SEC, IDLE_MS, LIVE_MAX, READY_MS, TOOLS_IN_A_ROW, autoTurnsOff, autoTurnsOn, callInstructions, callTools,
  goodbyeDirective, keywordsOf, lockedMatches, lockedOf, maxSecOf, offeredNames, openingDirective, pricesOf, resumeDirective,
  sttUsdOfSeconds, turnsEchoed, usdOfUsage, VOICE_TOOLS, sessionConfig, type GoodbyeKind, type Locked, type RealtimeTool,
  type RealtimeUsage,
} from "./planCallLiveWords.js";

type Log = { info(o: object, m: string): void; warn(o: object, m: string): void };
const QUIET: Log = { info: () => undefined, warn: () => undefined };

/** The Plan Ease bot a call speaks as. */
const SLUG = "plan";
/** How long a prepared session is kept before it is thrown away (one server's memory). */
const PREPARE_KEEP_MS = 2 * 60_000;
/** One tool may take this long. */
const TOOL_MS = 8_000;
/** Output audio is one token per 50 ms; a goodbye's audio is given this long to play before the hangup. */
const HANGUP_MAX_MS = 8_000;

/** Why the live part ended, as the row and the log say it. */
export type LiveWhy = "done" | "hung_up" | "timeout" | "max_len" | "idle" | "consent" | "tampered" | "dropped";

/** Everything built before the phone's offer arrives, so the offer is answered at once. */
interface Prepared {
  at: number;
  work: Promise<{ session: Record<string, unknown>; locked: Locked; tools: RealtimeTool[]; kit: ToolKit; runId: string } | null>;
}

/** One live call on this process. */
interface Live {
  user: AuthedUser;
  id: string;
  callId: string;
  link: RtLink;
  kit: ToolKit;
  runId: string;
  offered: Set<string>;
  locked: Locked;
  seedSource: CallRow["seed"]["source"];
  item: string;
  startedAt: number;
  usedSec: number;
  maxSec: number;
  /** What this call has cost so far, in US dollars. A RECORD, NEVER A CAP. */
  cost: number;
  responses: number;
  tools: string[];
  /** Tool calls in a row with no speech between: a model stuck in a loop must not keep changing the Plan. */
  inARow: number;
  opened: boolean;
  spoke: boolean;
  answerAfterOpening: boolean;
  activeResponse: boolean;
  /** Server responses wait for the active one (one response at a time). */
  queued: Array<() => void>;
  ending: boolean;
  endCall: boolean;
  speechStartMs: number | null;
  /** How long the last committed stretch of speech was, in seconds: the transcription's own cost when its usage does not say. */
  speechSec: number;
  /** Session updates we asked for and have not seen echoed yet: an echo beyond them is noted in the log, nothing more. */
  updatesAsked: number;
  /** How many echoes nobody asked for this call has seen. Counted on the call's own `[calls] live` line; never on the row. */
  unasked: number;
  /** The turn taking we have sent and not yet seen echoed, oldest first: anything else echoed back is the client's (tampering). */
  turnsSent: Array<Record<string, unknown>>;
  idleArmed: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  firstAudioMs: number | null;
  readyMs: number | null;
}

export interface PlanCallLiveDeps {
  calls?: PlanCalls;
  bots?: () => Bots | null;
  chat?: () => BotChat | null;
  ease?: () => PlanEase | null;
  consent?: (userId: string) => Promise<boolean>;
  now?: () => number;
  /** How long after OpenAI's own nudge the goodbye comes (the idle end). Tests shorten it; nothing else sets it. */
  idleMs?: number;
  log?: Log;
}

/** What `start` answers: the SDP for the phone, or the route's own refusal. */
export type LiveStart = { sdp: string; maxSec: number } | { status: number; code: string; message: string };

export class PlanCallLive {
  private readonly calls: PlanCalls;
  private bots: () => Bots | null;
  private chat: () => BotChat | null;
  private readonly ease: () => PlanEase | null;
  private readonly consent: (userId: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly idleMs: number;
  private log: Log;
  private readonly prepared = new Map<string, Prepared>();
  private readonly live = new Map<string, Live>();
  /** One live call per person. */
  private readonly byUser = new Map<string, string>();
  /**
   * The slots a start has claimed but not yet filled: the call's id and `u:<person>`. Claimed with no await in between, so two
   * requests that arrive together cannot both reach OpenAI and leave one session nobody can end.
   */
  private readonly starting = new Set<string>();

  constructor(d: PlanCallLiveDeps = {}) {
    this.calls = d.calls ?? planCalls();
    this.bots = d.bots ?? (() => null);
    this.chat = d.chat ?? (() => null);
    this.ease = d.ease ?? (() => planEase());
    this.consent = d.consent ?? aiAllowedFor;
    this.now = d.now ?? (() => Date.now());
    this.idleMs = d.idleMs ?? IDLE_MS;
    this.log = d.log ?? QUIET;
  }

  wire(o: { bots?: () => Bots | null; chat?: () => BotChat | null; log?: Log }): void {
    if (o.bots) this.bots = o.bots;
    if (o.chat) this.chat = o.chat;
    if (o.log) this.log = o.log;
  }

  /** Whether this call is live on this process right now. */
  isLive(id: string): boolean { return this.live.has(id); }
  /** How many live calls this process holds (capacity, never a limit on a person). */
  count(): number { return this.live.size; }
  /** Whether this person already has one. */
  hasFor(userId: string): boolean { return this.byUser.has(userId) || this.starting.has(`u:${userId}`); }

  /** Whether this call, or this person, is live or in the middle of starting: the route's own refusal, and start's claim. */
  busy(userId: string, id: string): boolean {
    return this.live.has(id) || this.starting.has(id) || this.hasFor(userId);
  }

  /** Whether this Live is still the one this process holds: a Live another start replaced must touch nothing of theirs. */
  private mine(l: Live): boolean { return this.live.get(l.id) === l; }

  // ------------------------------------------------------------------ getting ready

  /**
   * The session, built while the phone is still asking for its microphone, and kept two minutes. Nothing is sent to OpenAI here: it
   * only reads the bot's own voice, memory and tools, so the phone's offer can be answered in one round trip.
   */
  prepare(user: AuthedUser, id: string): void {
    const now = this.now();
    for (const [k, v] of this.prepared) if (now - v.at > PREPARE_KEEP_MS) this.prepared.delete(k);
    if (this.prepared.has(id)) return;
    this.prepared.set(id, { at: now, work: this.build(user, id).catch(() => null) });
  }

  /** The instructions, the voice and the tools of one call. Null when the bot, the call or the permission is not there. */
  private async build(user: AuthedUser, id: string): Promise<{ session: Record<string, unknown>; locked: Locked; tools: RealtimeTool[]; kit: ToolKit; runId: string } | null> {
    const cfg = getConfig();
    const bots = this.bots();
    const row = await this.calls.get(user.id, id);
    if (!bots || !row) return null;
    const kit = await bots.voiceKit(user.id, SLUG, { allow: (n) => VOICE_TOOLS.has(n), tzOffsetMinutes: row.tz_min });
    if (!kit) return null;
    const [personality, prefs] = await Promise.all([
      getPersonality(user).catch(() => null),
      getPrefs(user).catch(() => null),
    ]);
    const tools = callTools(row.seed, kit.kit.defs);
    // The judge's one-line reason, read once here: it tells the bot why this call matters, in its own words.
    const facts = await this.calls.facts(user.id, row);
    const instructions = callInstructions({ name: row.name, system: kit.system, facts, context: kit.context });
    const i = {
      model: cfg.OPENAI_REALTIME_MODEL, effort: cfg.OPENAI_REALTIME_EFFORT, instructions,
      voice: realtimeVoice(personality?.ttsVoice), speed: prefs ? readSpeed(prefs) : 1, tools,
      // What the transcription is told to listen for: the bot's own name and the item's own words, as they are written. For a
      // followed item, the first name of whoever asked: it is a real name and likely to be said out loud.
      keywords: keywordsOf([
        row.name, row.seed.title,
        "place" in row.seed ? row.seed.place : "", "payee" in row.seed ? row.seed.payee : "",
        row.seed.source === "follow" ? row.seed.asker : "",
      ]),
    };
    return { session: sessionConfig(i), locked: lockedOf(i), tools, kit: kit.kit, runId: kit.runId };
  }

  // ------------------------------------------------------------------ starting

  /**
   * The SDP exchange and the sideband. The route has already asked every check (§3.4), none of which looks at money. On any failure
   * the call is hung up at OpenAI if it got that far, the row is left answered, and the phone falls back to the turn call by itself.
   */
  async start(user: AuthedUser, id: string, sdp: string, o: { resume?: boolean } = {}): Promise<LiveStart> {
    // The slot is claimed here, before the first await: the route's own check ran before it read the row, so two requests that
    // arrived together both passed it. Without this claim the second would create a session of its own that no idle end, no hard
    // length, no End call and no withdrawn permission could reach.
    if (this.busy(user.id, id)) return { status: 409, code: "rt_live", message: "A live call is already on." };
    this.starting.add(id);
    this.starting.add(`u:${user.id}`);
    try {
      return await this.startClaimed(user, id, sdp, o);
    } finally {
      this.starting.delete(id);
      this.starting.delete(`u:${user.id}`);
    }
  }

  private async startClaimed(user: AuthedUser, id: string, sdp: string, o: { resume?: boolean }): Promise<LiveStart> {
    const cfg = getConfig();
    const row = await this.calls.get(user.id, id);
    if (!row) return { status: 404, code: "not_found", message: "That call isn't there any more." };
    const maxSec = maxSecOf(row.rt_sec, cfg.PLAN_CALL_RT_MAX_SEC);
    const hold = this.prepared.get(id);
    this.prepared.delete(id);
    const built = (hold ? await hold.work : null) ?? await this.build(user, id).catch(() => null);
    if (!built) return { status: 404, code: "bots_off", message: "Bots are not switched on." };
    const t0 = this.now();
    let callId = "";
    try {
      const made = await createCall({ sdp, session: built.session, userId: user.id });
      callId = made.callId;
      const link = await attachSideband(callId);
      const l: Live = {
        user, id, callId, link, kit: built.kit, runId: built.runId, offered: offeredNames(built.tools), locked: built.locked,
        seedSource: row.seed.source, item: row.item, startedAt: this.now(), usedSec: row.rt_sec, maxSec, cost: row.cost_usd,
        responses: 0, tools: [], inARow: 0, opened: false, spoke: false, answerAfterOpening: false, activeResponse: false,
        queued: [], ending: false, endCall: false, speechStartMs: null, speechSec: 0, updatesAsked: 0, unasked: 0,
        // The session was created with automatic replies off, so that is the turn taking it echoes back first.
        turnsSent: [autoTurnsOff()], idleArmed: false, timers: new Set(),
        firstAudioMs: null, readyMs: null,
      };
      this.live.set(id, l);
      this.byUser.set(user.id, id);
      link.onEvent((e) => { void this.onEvent(l, e).catch(() => undefined); });
      link.onClosed(() => { if (!l.ending) void this.toTurnCall(l, "dropped").catch(() => undefined); });
      await this.calls.markRt(user.id, id, { rt_call: callId, rt_state: "starting" });
      // The phone must connect and say ready; if it does not, the live part never happened and the call stays a turn call.
      this.after(l, READY_MS, () => { if (!l.readyMs) void this.toTurnCall(l, "dropped").catch(() => undefined); });
      this.log.info({ call: id.slice(0, 8), model: cfg.OPENAI_REALTIME_MODEL, ms: { live: this.now() - t0 }, resume: o.resume === true }, "[calls] live start");
      // Whatever the phone sends first, the opening is ours: ready() asks for it.
      if (o.resume) l.answerAfterOpening = false;
      l.opened = o.resume === true ? false : l.opened;
      (l as Live & { resume?: boolean }).resume = o.resume === true;
      return { sdp: made.answerSdp, maxSec };
    } catch (err) {
      if (callId) await hangup(callId).catch(() => false);
      this.log.warn({ call: id.slice(0, 8), err: (err as Error)?.message }, "[calls] live failed");
      return { status: 502, code: "rt_failed", message: "Couldn't start the live call." };
    }
  }

  /**
   * The phone is connected: the bot speaks first. Idempotent — a second `ready` sends nothing, so a retry never makes two openings.
   * The session started with automatic replies off, so a "Hello?" as the call connected got no reply of its own; after the opening's
   * `response.done` the turns go on and anything said during the opening is answered then.
   */
  async ready(user: AuthedUser, id: string): Promise<{ ok: true }> {
    const l = this.live.get(id);
    if (!l || l.readyMs || l.user.id !== user.id) return { ok: true };
    l.readyMs = this.now();
    await this.calls.markRt(user.id, id, { rt_state: "live" });
    const row = await this.calls.get(user.id, id).catch(() => null);
    const resume = (l as Live & { resume?: boolean }).resume === true;
    this.say(l, resume ? resumeDirective() : openingDirective(row?.opening ?? ""), { kind: "opening", maxTokens: 300 });
    this.armHard(l);
    return { ok: true };
  }

  // ------------------------------------------------------------------ the sideband

  private async onEvent(l: Live, e: Record<string, unknown>): Promise<void> {
    const t = String(e.type ?? "");
    switch (t) {
      case "session.created":
      case "session.updated": {
        // Anything we did not ask for — other instructions, other tools, tracing switched on — is tampering, and the call ends.
        const session = (e.session ?? {}) as Record<string, unknown>;
        let why = lockedMatches(session, l.locked) ? "" : "locked";
        if (t === "session.updated") {
          // Turn taking is ours: a client's own `session.update` on the data channel, switching the idle end off or taking the
          // turns away from us, is the tampering that matters, and the echo is what shows it. An echo of settings we never sent
          // is tampering; one beyond the number we asked for, with our own settings in it, is only worth a line in the log.
          if (l.updatesAsked > 0) l.updatesAsked -= 1;
          else {
            // Counted as well as logged, so the call's own end line carries the total and nobody has to hunt for warn lines.
            l.unasked += 1;
            this.log.warn({ call: l.id.slice(0, 8) }, "[calls] unasked session.updated");
          }
          const k = turnsEchoed(session, l.turnsSent);
          if (k === -1) why = why || "turns";
          else if (k !== null && k > 0) l.turnsSent.splice(0, k);
        }
        if (why) {
          this.log.warn({ call: l.id.slice(0, 8), why }, "[calls] tampered");
          await this.finish(l, "done", "tampered");
        }
        return;
      }
      case "input_audio_buffer.speech_started": {
        l.inARow = 0;
        // The nudge turned OpenAI's own silence timer off so it would not fire twice. The person spoke, so the idle end is armed
        // again: without this a later silence would run all the way to the hard length.
        if (l.idleArmed && !l.ending) {
          l.idleArmed = false;
          this.turns(l, autoTurnsOn());
        }
        l.speechStartMs = Number(e.audio_start_ms) || 0;
        return;
      }
      case "input_audio_buffer.speech_stopped": {
        // Only how long they spoke, kept for the transcription below. Charging it here as well counted every spoken turn twice.
        if (l.speechStartMs !== null) l.speechSec = Math.max(0, (Number(e.audio_end_ms) || 0) - l.speechStartMs) / 1000;
        return;
      }
      case "input_audio_buffer.committed": {
        // The sideband is a socket, which the fetch guard does not see: the permission is asked again on every turn.
        if (!(await this.consent(l.user.id).catch(() => true))) {
          l.link.send({ type: "response.cancel" });
          await this.finish(l, "consent", "consent");
          return;
        }
        if (!l.opened) l.answerAfterOpening = true;
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const said = spokenOf(String(e.transcript ?? "")).trim();
        if (said) await this.chat()?.noteTurn(l.user.id, SLUG, "me", scrub(said).text).catch(() => undefined);
        // The transcription's cost, counted once: its own seconds when the usage carries them, else how long they spoke.
        const seconds = Number((e.usage as { seconds?: unknown } | null)?.seconds);
        const sec = Number.isFinite(seconds) ? seconds : l.speechSec;
        l.speechSec = 0;
        await this.addCost(l, sttUsdOfSeconds(sec));
        return;
      }
      case "output_audio_buffer.started": {
        if (l.firstAudioMs === null) l.firstAudioMs = this.now() - l.startedAt;
        return;
      }
      case "response.output_audio_transcript.done": {
        (l as Live & { lastText?: string }).lastText = String(e.transcript ?? "");
        return;
      }
      case "response.done": return this.onResponseDone(l, e);
      case "input_audio_buffer.timeout_triggered": return this.onIdleNudge(l);
      case "error": {
        this.log.warn({ call: l.id.slice(0, 8), code: String((e.error as { code?: unknown } | null)?.code ?? "error") }, "[calls] live error");
        return;
      }
      default: return;
    }
  }

  private async onResponseDone(l: Live, e: Record<string, unknown>): Promise<void> {
    const r = (e.response && typeof e.response === "object" ? e.response : {}) as Record<string, unknown>;
    // Everything this response IS, read before anything is awaited: the next response's events are already on their way, and its
    // own spoken words must not be taken for this one's.
    l.activeResponse = false;
    l.responses += 1;
    const kind = String((r.metadata as { kind?: unknown } | null)?.kind ?? "");
    const output = Array.isArray(r.output) ? (r.output as Array<Record<string, unknown>>) : [];
    const funcs = output.filter((x) => String(x.type ?? "") === "function_call");
    const text = String((l as Live & { lastText?: string }).lastText ?? "").trim();
    (l as Live & { lastText?: string }).lastText = "";
    // What this response cost, priced and recorded. No cap: nothing here can refuse, shorten or stop the call for money.
    const priced = usdOfUsage((r.usage ?? null) as RealtimeUsage | null, getConfig().OPENAI_REALTIME_MODEL, pricesOf(getConfig().OPENAI_REALTIME_PRICES));
    if (priced.odd) this.log.warn({ call: l.id.slice(0, 8) }, "[calls] usage_shape");
    await this.addCost(l, priced.usd);
    // Whatever the bot said in this response goes on the record FIRST: a goodbye, or the few words said alongside a tool call
    // ("One moment"), is part of the call too, and the branches below may end the call and never come back here.
    if (text && kind !== "opening") {
      l.spoke = true;
      // The bot's words: on the call row (the 5-minute sweep stays away) and in the Plan Ease chat, as a typed chat shows them.
      await this.calls.said(l.user.id, l.id, spokenOf(text), { rt: true }).catch(() => 0);
      await this.chat()?.noteTurn(l.user.id, SLUG, "bot", scrub(text).text).catch(() => undefined);
    }
    if (funcs.length) {
      await this.runTools(l, funcs);
      // end_call on its own, in the very response that said the goodbye: nothing more is asked for, the audio plays out and the
      // call ends. A model that called end_call before saying goodbye still gets its one turn to say it.
      if (l.endCall && text && funcs.every((f) => String(f.name ?? "") === "end_call")) return this.afterGoodbye(l, "done", r);
      this.say(l, "", { kind: "reply" });
      return this.drain(l);
    }

    if (kind === "opening") {
      l.opened = true;
      // From here OpenAI takes the turns itself and barge-in cuts a reply off; silence nudges once (the idle end).
      this.turns(l, autoTurnsOn());
      if (l.answerAfterOpening) { l.answerAfterOpening = false; this.say(l, "", { kind: "reply" }); }
    } else if (kind === "goodbye") {
      return this.afterGoodbye(l, (l as Live & { goodbyeWhy?: LiveWhy }).goodbyeWhy ?? "done", r);
    }

    // Ended somewhere else (End call, the sweep): nothing more should be heard.
    const row = await this.calls.get(l.user.id, l.id).catch(() => null);
    if (!row || row.state !== "answered") return this.finish(l, "hung_up", "hung_up");
    if (!(await this.consent(l.user.id).catch(() => true))) return this.finish(l, "consent", "consent");
    // The hard length: technical safety against a stuck session, never a money cap.
    if (this.elapsed(l) >= l.maxSec - GOODBYE_LEAD_SEC) return this.goodbye(l, "max_len", "max_len");
    if (l.endCall) return this.afterGoodbye(l, "done", r);
    return this.drain(l);
  }

  /** OpenAI's own nudge on silence is the one nudge; after it, a short wait and the bot says goodbye. */
  private onIdleNudge(l: Live): void {
    if (l.idleArmed || l.ending) return;
    l.idleArmed = true;
    this.turns(l, { ...autoTurnsOn(), idle_timeout_ms: null });
    this.after(l, this.idleMs, () => { if (l.idleArmed && !l.ending) void this.goodbye(l, "idle", "idle").catch(() => undefined); });
  }

  // ------------------------------------------------------------------ tools

  private async runTools(l: Live, funcs: Array<Record<string, unknown>>): Promise<void> {
    for (const f of funcs) {
      const name = String(f.name ?? "");
      const callId = String(f.call_id ?? f.id ?? "");
      l.inARow += 1;
      let out: { ok: boolean; result?: string; error?: string };
      if (l.inARow > TOOLS_IN_A_ROW) out = { ok: false, error: "limit" };
      else if (!l.offered.has(name)) out = { ok: false, error: "unknown_tool" };
      else out = await this.runOne(l, name, String(f.arguments ?? "{}"));
      if (callId) {
        l.link.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(out) } });
      }
      if (out.ok) l.tools.push(name);
    }
  }

  /** One tool, as the person, in its own cost tally, with eight seconds to answer. What it cost is recorded on the call. */
  private async runOne(l: Live, name: string, args: string): Promise<{ ok: boolean; result?: string; error?: string }> {
    const run = async (): Promise<{ ok: boolean; result?: string; error?: string }> => {
      if (name === "end_call") { l.endCall = true; return { ok: true, result: "The call will end after you have said goodbye." }; }
      const act = ACTIONS[name];
      if (act) {
        const ease = this.ease();
        const item = parseItem(l.item);
        if (!ease || !item) return { ok: false, error: "failed" };
        const r = await ease.act(l.user.id, item, act);
        if (r.status !== 200) return { ok: false, error: String(r.body.code ?? "failed") };
        await this.calls.noteActed(l.user.id, l.id, act).catch(() => undefined);
        return { ok: true, result: String(r.body.state ?? "done") };
      }
      const r = await l.kit.run({ id: `rt:${name}`, name, arguments: args });
      return r.ok ? { ok: true, result: r.content.slice(0, 2000) } : { ok: false, error: r.content.slice(0, 300) };
    };
    const timer = new Promise<{ ok: boolean; error: string }>((res) => {
      const t = setTimeout(() => res({ ok: false, error: "slow" }), TOOL_MS);
      t.unref?.();
    });
    try {
      return await asPerson(l.user.id, () => inCostTally(async () => {
        const r = await Promise.race([run(), timer]);
        await this.addCost(l, takeCostUsd());
        return r;
      }));
    } catch { return { ok: false, error: "failed" }; }
  }

  // ------------------------------------------------------------------ speaking

  /**
   * A response we ask for. Openings, goodbyes and resume lines go in as a `system` conversation item and a plain `response.create`:
   * response-level instructions or tools would REPLACE the session's for that response, dropping every call rule and re-billing the
   * whole conversation uncached. One response at a time, so a server response waits for the active one.
   */
  private say(l: Live, directive: string, o: { kind: "opening" | "goodbye" | "reply"; maxTokens?: number }): void {
    const go = () => {
      if (l.activeResponse) { l.queued.push(go); return; }
      l.activeResponse = true;
      if (directive) {
        l.link.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: directive }] } });
      }
      const res: Record<string, unknown> = { metadata: { kind: o.kind } };
      if (o.kind !== "reply") { res.tool_choice = "none"; res.max_output_tokens = o.maxTokens ?? 150; }
      l.link.send({ type: "response.create", response: res });
    };
    go();
  }

  private drain(l: Live): void {
    const next = l.queued.shift();
    if (next) next();
  }

  /** The bot says one short goodbye, then the call ends. Neither kind is about money. */
  private async goodbye(l: Live, kind: GoodbyeKind, why: LiveWhy): Promise<void> {
    if (l.ending) return;
    l.ending = true;
    (l as Live & { goodbyeWhy?: LiveWhy }).goodbyeWhy = why;
    // Nothing of the model's own may start alongside the goodbye.
    this.turns(l, { ...autoTurnsOn(), create_response: false, interrupt_response: false, idle_timeout_ms: null });
    l.activeResponse = false;
    l.queued.length = 0;
    this.say(l, goodbyeDirective(kind), { kind: "goodbye", maxTokens: 150 });
  }

  /** The goodbye has been said: let its audio play, then hang up. */
  private async afterGoodbye(l: Live, why: LiveWhy, r: Record<string, unknown>): Promise<void> {
    const audio = Number((r.usage as { output_token_details?: { audio_tokens?: unknown } } | null)?.output_token_details?.audio_tokens);
    const wait = Math.min(HANGUP_MAX_MS, (Number.isFinite(audio) ? audio / 20 * 1000 : 0) + 700);
    await new Promise<void>((res) => { const t = setTimeout(res, wait); t.unref?.(); });
    await this.finish(l, why === "tampered" || why === "dropped" ? "done" : why, why);
  }

  // ------------------------------------------------------------------ ending

  /** The live part ends and the call with it: hang up, close, write the record, end the call. */
  private async finish(l: Live, end: NonNullable<CallRow["why"]>, why: LiveWhy): Promise<void> {
    if (!this.mine(l)) return;
    l.ending = true;
    await this.close(l, "ended", why);
    await this.calls.end(l.user.id, l.id, end).catch(() => null);
  }

  /** The live part ends, the call stays answered and carries on turn by turn (and never goes live again). */
  private async toTurnCall(l: Live, why: LiveWhy): Promise<void> {
    if (!this.mine(l)) return;
    l.ending = true;
    await this.close(l, "fell_back", why);
  }

  private async close(l: Live, state: NonNullable<CallRow["rt_state"]>, why: LiveWhy): Promise<void> {
    // Only ever this Live's own entries: a Live that is no longer the one we hold still hangs its own session up, but it must not
    // delete another's.
    if (this.mine(l)) this.live.delete(l.id);
    if (this.byUser.get(l.user.id) === l.id && !this.live.has(l.id)) this.byUser.delete(l.user.id);
    for (const t of l.timers) clearTimeout(t);
    l.timers.clear();
    // A backstop for a hangup that does not close the media: nothing more is generated or billed.
    this.turns(l, { ...autoTurnsOn(), create_response: false, interrupt_response: false, idle_timeout_ms: null });
    l.link.send({ type: "response.cancel" });
    await hangup(l.callId).catch(() => false);
    l.link.close();
    const sec = l.usedSec + this.elapsed(l);
    await this.calls.markRt(l.user.id, l.id, { rt_state: state, rt_sec: sec }).catch(() => undefined);
    await this.calls.addCost(l.user.id, l.id, l.cost).catch(() => undefined);
    await l.kit.settled().catch(() => undefined);
    await this.bots()?.ports.connectors?.settle(l.user.id, l.runId, "done").catch(() => undefined);
    // Counts only: never a key, an SDP, a transcript or the judge's words. `paise` is for reading, not for charging.
    const paise = Math.ceil(l.cost * getConfig().CODE_USD_INR * 100);
    this.log.info({
      call: l.id.slice(0, 8), model: getConfig().OPENAI_REALTIME_MODEL, sec, responses: l.responses, tools: l.tools,
      usd: Number(l.cost.toFixed(6)), paise, judged: l.seedSource === "item", why, unasked: l.unasked,
      ...(state === "fell_back" ? { fell_back: why } : {}),
      ms: { ready: l.readyMs === null ? null : l.readyMs - l.startedAt, firstAudio: l.firstAudioMs },
    }, "[calls] live");
  }

  /** The route's `live/stop`, and End call: the live part goes, the call stays as it is. */
  async stop(id: string, why: string): Promise<void> {
    const l = this.live.get(id);
    if (!l) return;
    l.ending = true;
    const keep: LiveWhy = why === "timeout" ? "timeout" : "hung_up";
    await this.close(l, why === "stopped" ? "stopped" : "ended", keep);
  }

  /** The route's `live/stop`: the person left the app, or a cellular call came in. The call stays answered and can resume. */
  async park(userId: string, id: string): Promise<void> {
    const l = this.live.get(id);
    if (!l || l.user.id !== userId) return;
    l.ending = true;
    await this.close(l, "stopped", "hung_up");
  }

  /**
   * THE TURN CALL IS TAKING OVER (the routes' `say` and `voice`): the live part closes here first, so its own total is written before
   * the turn adds to it, and its idle and length timers can no longer reach a call the person is already talking to turn by turn.
   * The call stays answered. Nothing happens for a call that is not this person's, or not live on this process.
   */
  async fellBack(userId: string, id: string): Promise<void> {
    const l = this.live.get(id);
    if (!l || l.user.id !== userId) return;
    await this.toTurnCall(l, "dropped");
  }

  /**
   * THE PERSON TOOK THEIR AI PERMISSION BACK (planCallSeam.ts onAiConsentOff). Audio streams to OpenAI between turns, so the call ends
   * at once, with no goodbye.
   */
  async stopFor(userId: string): Promise<void> {
    const id = this.byUser.get(userId);
    if (!id) return;
    const l = this.live.get(id);
    if (!l) { this.byUser.delete(userId); return; }
    l.ending = true;
    l.link.send({ type: "response.cancel" });
    await this.finish(l, "consent", "consent");
  }

  /** At boot: every row another process left marked starting or live is hung up, so OpenAI is not left talking to nobody. */
  async sweepOrphans(): Promise<void> {
    const rows = await this.calls.liveRows(200);
    for (const r of rows) {
      if (this.live.has(r.id)) continue;
      if (r.rt_call) await hangup(r.rt_call).catch(() => false);
      await this.calls.markRt(r.user_id, r.id, { rt_state: "fell_back" }).catch(() => undefined);
    }
    if (rows.length) this.log.info({ calls: rows.length }, "[calls] live orphans");
  }

  // ------------------------------------------------------------------ small things

  private elapsed(l: Live): number {
    return Math.max(0, Math.round((this.now() - (l.readyMs ?? l.startedAt)) / 1000));
  }

  /** The hard maximum length: at the lead the bot says goodbye, and at the length it is hung up whatever happens. */
  private armHard(l: Live): void {
    const lead = Math.max(1, l.maxSec - GOODBYE_LEAD_SEC) * 1000;
    this.after(l, lead, () => { if (!l.ending) void this.goodbye(l, "max_len", "max_len").catch(() => undefined); });
    this.after(l, Math.max(2, l.maxSec) * 1000, () => { if (this.mine(l)) void this.finish(l, "max_len", "max_len").catch(() => undefined); });
  }

  /** The only place turn taking is changed: it keeps what was sent, so the echo can be told from a client's own update. */
  private turns(l: Live, turn_detection: Record<string, unknown>): void {
    l.updatesAsked += 1;
    l.turnsSent.push({ ...turn_detection });
    l.link.send({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection } } } });
  }

  private after(l: Live, ms: number, fn: () => void): void {
    const t = setTimeout(() => { l.timers.delete(t); fn(); }, ms);
    t.unref?.();
    l.timers.add(t);
  }

  /** What the call has cost so far, kept in memory (the source) and written to the row. NEVER A CAP. */
  private async addCost(l: Live, usd: number): Promise<void> {
    if (!(usd > 0)) return;
    l.cost += usd;
    await this.calls.addCost(l.user.id, l.id, l.cost).catch(() => undefined);
  }
}

/** The call's own actions, said out loud instead of tapped: each is one of Plan Ease's own buttons (planEase.ts PLAN_ACTS). */
const ACTIONS: Readonly<Record<string, string>> = {
  mark_paid: "paid", remind_later: "later", item_done: "done",
  follow_done: "done", follow_later: "later", follow_cant: "cant",
};

/** The capacity of one process. Past it a call simply stays a turn call; it is not a limit on anybody. */
export { LIVE_MAX };

let shared: PlanCallLive | null = null;
/** The server's. */
export function planCallLive(): PlanCallLive { return (shared ??= new PlanCallLive()); }
/** Tests: one of their own (null: a fresh one next time). */
export function setPlanCallLive(p: PlanCallLive | null): void { shared = p; }
