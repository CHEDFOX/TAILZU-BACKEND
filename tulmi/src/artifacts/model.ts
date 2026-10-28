/**
 * THE ONE WAY THE ARTIFACT CORE ASKS A MODEL: A TIER, A CAP, A CHECK ON THE ANSWER, AND ONE CLIMB.
 *
 * Every model call the artifact core makes (an element edit, a fix, an edit by instruction, a component's
 * making, an artifact's `ask`) goes through `ArtifactModel.run`, so the rules about money and failure are
 * written once, on top of the brain's gateway (code/brain/gateway.ts, which owns the models, the ladder
 * inside a tier, the retry, the privacy and the ledger):
 *
 *   TIER     the caller names where to start: cheap for a small edit or a fix, code for making something,
 *            strong for something the classifier calls complex
 *   CLIMB    when the tier fails (every model on its ladder is down) or its answer does not pass the
 *            caller's check (an element that does not parse, an edit that does not apply), the SAME request
 *            is made once on the next tier up (cheap -> code -> strong), with the reason added so the
 *            stronger model does not repeat the mistake. Once: a second failure is the caller's to report,
 *            because a loop of ever stronger models is how a small edit becomes a large bill
 *   SIZE     `maxTokens` is the floor the caller always allowed; `wantTokens` is what this artifact would need (a rewrite is the whole text again), and the call
 *            is given the larger of the two that the call's cap can pay for, worst case, at the tier's prices (`affordableTokens`): an edit of a big artifact
 *            is not cut off at a size picked for a small one, and a call that is allowed is still never refused for its own size
 *   CUT OFF  an answer that stops because it ran out of maxTokens (finish "length") is not thrown away and asked for again, shorter, from nothing: the model is
 *            given what it wrote and asked to go on from exactly where it stopped, ONCE, and the two halves are one answer. Only an answer that is still cut off
 *            after that (or a continuation the budget cannot pay for) is a failure of the attempt, and goes to the next tier like any answer that does not pass
 *   CAP      each call is held to `capPaise` (the gateway refuses a call whose worst case would pass it),
 *            and to what is left of the person's day (limits.ts SpendMeter). What was spent is added to the
 *            meter, failed attempts included: a call that was billed and thrown away cost what it cost
 *   CACHE    the prompt is laid out stable-first: the role's block (principles/roles.ts compose: the
 *            principles, who the model is, the output contract), then the project's kit, then the
 *            artifact, then the instruction last, so a provider that caches a prompt's prefix hits it on
 *            the next edit of the same thing
 *
 * It never logs or keeps what was sent or received. Every dependency is injectable.
 */
import { BudgetExceeded, callModel, type GatewayDeps } from "../code/brain/gateway.js";
import { inRequestSpend } from "../code/brain/spend.js";
import { DEFAULT_USD_INR, charsOf, worstCasePaise } from "../code/brain/money.js";
import { getConfig } from "../config.js";
import { tierSettings, type ModelTier, type TierSettings } from "../code/brain/tiers.js";
import { compose, type RoleId } from "../principles/index.js";
import type { ChatMessage } from "../code/brain/types.js";
import type { CallFn } from "../code/work/model.js";
import type { SpendMeter } from "./limits.js";
import { CAP_PAISE, ArtifactError } from "./types.js";

/** The tier above this one, once. Review, vision and indic are not on the ladder and do not climb. */
export function tierAbove(tier: ModelTier): ModelTier | null {
  return tier === "tiny" ? "cheap" : tier === "cheap" ? "code" : tier === "code" ? "strong" : null;
}

export interface RunRequest<T> {
  userId: string;
  tier: ModelTier;
  /** A word for the log and the ledger, never any content: "artifact.element". */
  purpose: string;
  /** Who the model is for this kind of call: the stable instructions (principles/roles.ts). */
  role: RoleId;
  /** The project's compact kit, or "". Stable across calls for a project. */
  kit?: string;
  /** The artifact, or the part of it the model is shown. */
  artifact: string;
  /** What to do, last: it is the part that changes. */
  instruction: string;
  /** A picture to send along (the vision tier's call); a data URL. */
  image?: string;
  maxTokens: number;
  /** What the answer may need to write, sized from the artifact; used as far as the cap allows, never below `maxTokens`. */
  wantTokens?: number;
  /** The most one call may cost in the worst case, in paise. */
  capPaise: number;
  /** Reads the answer: its value, or why it cannot be used (which is told to the next tier). */
  accept: (text: string) => { ok: true; value: T } | { ok: false; reason: string };
  signal?: AbortSignal;
  /** Do not climb: the caller wants the first answer or none (the cheap `ask`). */
  noClimb?: boolean;
}

export interface Ran<T> {
  value: T;
  paise: number;
  tier: ModelTier;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Characters sent in the call that answered: how much of the artifact the model was shown. */
  sentChars: number;
  climbed: boolean;
  /** The answer was cut off at maxTokens and finished by one continuation. */
  continued?: boolean;
}

/** What the model is told when its answer ran out of room, before the continuation. */
const CONTINUE = "Your answer was cut off because it reached the length limit. Continue it from exactly the character where it stopped: do not repeat anything you already wrote, do not start again, and add no preface, no code fence and no commentary. Finish it.";

export interface ArtifactModelOptions {
  call?: CallFn;
  gateway?: GatewayDeps;
  /** The person's day. Absent: no daily cap (a test, or a server that meters elsewhere). */
  meter?: SpendMeter;
}

/**
 * The most a call can be allowed to write on a tier and still have its worst case (all of the input, and all of that many tokens written) within `capPaise`.
 * The same arithmetic as the gateway's guard (brain/gateway.ts, brain/money.ts), so what this allows the gateway accepts.
 */
export function affordableTokens(prices: Pick<TierSettings, "usdPerMIn" | "usdPerMOut">, capPaise: number, inputChars: number, fx: number): number {
  if (!(capPaise > 0) || !(prices.usdPerMOut > 0)) return prices.usdPerMOut > 0 ? 0 : Number.MAX_SAFE_INTEGER;
  const usd = capPaise / 100 / fx;
  const left = usd - (Math.ceil(inputChars / 3.5) * prices.usdPerMIn) / 1e6;
  let n = left > 0 ? Math.floor((left * 1e6) / prices.usdPerMOut) : 0;
  // The gateway rounds up to whole paise; a token of floating-point dust either way is walked off.
  while (n > 0 && worstCasePaise({ chars: inputChars, maxTokens: n, usdPerMIn: prices.usdPerMIn, usdPerMOut: prices.usdPerMOut }, fx) > capPaise) n -= 1;
  return n;
}

export class ArtifactModel {
  private readonly call: CallFn;
  constructor(private readonly o: ArtifactModelOptions = {}) {
    this.call = o.call ?? (callModel as CallFn);
  }

  /** The messages of a call, stable first. */
  static messages(r: Pick<RunRequest<unknown>, "role" | "kit" | "artifact" | "instruction" | "image">, again?: string): ChatMessage[] {
    const text = [r.kit?.trim() ? `PROJECT STYLE\n${r.kit.trim()}` : "", r.artifact, again ? `${r.instruction}\n\n${again}` : r.instruction].filter(Boolean).join("\n\n");
    return compose(r.role, [
      { role: "user" as const, content: r.image ? [{ type: "text" as const, text }, { type: "image_url" as const, image_url: { url: r.image } }] : text },
    ]);
  }

  /** One run, its tries and its continuation: rounded up to the paise once over all of them, and with the rest of the request when it is part of one (brain/spend.ts). */
  run<T>(r: RunRequest<T>): Promise<Ran<T>> {
    return inRequestSpend(() => this.runRequest(r));
  }

  private async runRequest<T>(r: RunRequest<T>): Promise<Ran<T>> {
    const meter = this.o.meter;
    let paise = 0;
    let again: string | undefined;
    let lastReason = "";
    let down = false;
    // The continuation is logged and booked under the call's own purpose and a suffix (its ledger row says what it finished).
    const continuePurpose = r.purpose + ".continue";
    const tiers: ModelTier[] = [r.tier];
    const up = r.noClimb ? null : tierAbove(r.tier);
    if (up) tiers.push(up);
    let totalIn = 0;
    let totalOut = 0;

    for (const [n, tier] of tiers.entries()) {
      if (r.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (meter && meter.leftPaise(r.userId) <= 0) {
        throw new ArtifactError("limit_reached", "You have used what edits and fixes may cost in a day. They start again tomorrow.");
      }
      const left = meter ? meter.leftPaise(r.userId) : Infinity;
      const messages = ArtifactModel.messages(r, again);
      // A climb may write more, and costs what its tier costs: the stronger tier's own limit and cap, not the cheap one's. Never less than the first try was given:
      // a tier whose own limit is smaller than that (a run that holds every tier to short answers) must not climb to an even tighter cut.
      const cap = n === 0 ? r.capPaise : Math.max(r.capPaise, CAP_PAISE[tier as keyof typeof CAP_PAISE] ?? r.capPaise);
      const floor = n === 0 ? r.maxTokens : Math.max(r.maxTokens, Math.min(tierSettings(tier).maxTokens, r.maxTokens * 2));
      const prices = this.o.gateway?.tiers?.[tier] ?? tierSettings(tier);
      const fx = this.o.gateway?.fx ?? getConfig().CODE_USD_INR ?? DEFAULT_USD_INR;
      const maxTokens = r.wantTokens && r.wantTokens > floor ? Math.max(floor, Math.min(r.wantTokens, affordableTokens(prices, Math.min(cap, left), charsOf(messages), fx))) : floor;
      let res;
      try {
        res = await this.call({
          tier, messages, maxTokens, purpose: r.purpose, userId: r.userId, budget: { maxPaise: Math.min(cap, left) }, ...(r.signal ? { signal: r.signal } : {}),
        }, this.o.gateway);
      } catch (err) {
        if (err instanceof BudgetExceeded || (err as { code?: unknown } | null)?.code === "budget_exceeded") {
          throw new ArtifactError("limit_reached", "That is more than one edit may cost. Point at a smaller part of the artifact, or ask for less.", { needPaise: (err as BudgetExceeded).needPaise });
        }
        if ((err as { name?: unknown } | null)?.name === "AbortError") throw err;
        down = true;
        lastReason = "no model could be reached";
        continue;
      }
      paise += res.paise;
      meter?.add(r.userId, res.paise);
      totalIn += res.promptTokens;
      totalOut += res.completionTokens;
      down = false;
      let text = res.text;
      let cutOff = res.truncated;
      let continued = false;
      if (cutOff && text.trim()) {
        // ONE continuation, on the same model's tier: what it wrote is given back, and it goes on. A refusal on money, or a model that cannot be reached now,
        // leaves the answer cut off, which is handled as before.
        try {
          const more = await this.call({
            tier, messages: [...messages, { role: "assistant" as const, content: text }, { role: "user" as const, content: CONTINUE }], maxTokens, purpose: continuePurpose, userId: r.userId,
            budget: { maxPaise: Math.min(cap, left - res.paise) }, ...(r.signal ? { signal: r.signal } : {}),
          }, this.o.gateway);
          paise += more.paise;
          meter?.add(r.userId, more.paise);
          totalIn += more.promptTokens;
          totalOut += more.completionTokens;
          text += more.text;
          cutOff = more.truncated;
          continued = true;
        } catch (err) {
          if ((err as { name?: unknown } | null)?.name === "AbortError") throw err;
        }
      }
      if (cutOff) {
        lastReason = "the answer was cut off before it ended";
        again = "Your last answer was cut off before it ended. Answer again, shorter, and finish it.";
        continue;
      }
      const checked = r.accept(text);
      if (checked.ok) {
        return { value: checked.value, paise, tier, model: res.model, promptTokens: totalIn, completionTokens: totalOut, sentChars: charsOf(messages), climbed: n > 0, ...(continued ? { continued: true } : {}) };
      }
      lastReason = checked.reason;
      again = `A first attempt was not usable: ${checked.reason}. Do it again, carefully, and answer in exactly the form asked.`;
    }
    // What was spent on attempts that came to nothing is still spent: the caller adds `detail.paise` to the artifact.
    if (down) throw new ArtifactError("model_down", "No model could be reached just now. Nothing was changed; try again in a little while.", { paise });
    throw new ArtifactError("edit_failed", `The change could not be made: ${lastReason}. Nothing was changed.`, { paise });
  }
}
