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
 *   CAP      each call is held to `capPaise` (the gateway refuses a call whose worst case would pass it),
 *            and to what is left of the person's day (limits.ts SpendMeter). What was spent is added to the
 *            meter, failed attempts included: a call that was billed and thrown away cost what it cost
 *   CACHE    the prompt is laid out stable-first: the system prompt, then the project's kit, then the
 *            artifact, then the instruction last, so a provider that caches a prompt's prefix hits it on
 *            the next edit of the same thing
 *
 * It never logs or keeps what was sent or received. Every dependency is injectable.
 */
import { BudgetExceeded, callModel, type GatewayDeps } from "../code/brain/gateway.js";
import { charsOf } from "../code/brain/money.js";
import { tierSettings, type ModelTier } from "../code/brain/tiers.js";
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
  /** The stable instructions for this kind of call. */
  system: string;
  /** The project's compact kit, or "". Stable across calls for a project. */
  kit?: string;
  /** The artifact, or the part of it the model is shown. */
  artifact: string;
  /** What to do, last: it is the part that changes. */
  instruction: string;
  /** A picture to send along (the vision tier's call); a data URL. */
  image?: string;
  maxTokens: number;
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
}

export interface ArtifactModelOptions {
  call?: CallFn;
  gateway?: GatewayDeps;
  /** The person's day. Absent: no daily cap (a test, or a server that meters elsewhere). */
  meter?: SpendMeter;
}

export class ArtifactModel {
  private readonly call: CallFn;
  constructor(private readonly o: ArtifactModelOptions = {}) {
    this.call = o.call ?? (callModel as CallFn);
  }

  /** The messages of a call, stable first. */
  static messages(r: Pick<RunRequest<unknown>, "system" | "kit" | "artifact" | "instruction" | "image">, again?: string): ChatMessage[] {
    const text = [r.kit?.trim() ? `PROJECT STYLE\n${r.kit.trim()}` : "", r.artifact, again ? `${r.instruction}\n\n${again}` : r.instruction].filter(Boolean).join("\n\n");
    return [
      { role: "system", content: r.system },
      { role: "user", content: r.image ? [{ type: "text", text }, { type: "image_url", image_url: { url: r.image } }] : text },
    ];
  }

  async run<T>(r: RunRequest<T>): Promise<Ran<T>> {
    const meter = this.o.meter;
    let paise = 0;
    let again: string | undefined;
    let lastReason = "";
    let down = false;
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
      // A climb may write more, and costs what its tier costs: the stronger tier's own limit and cap, not the cheap one's.
      const maxTokens = n === 0 ? r.maxTokens : Math.min(tierSettings(tier).maxTokens, r.maxTokens * 2);
      const cap = n === 0 ? r.capPaise : Math.max(r.capPaise, CAP_PAISE[tier as keyof typeof CAP_PAISE] ?? r.capPaise);
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
      if (res.truncated) {
        lastReason = "the answer was cut off before it ended";
        again = "Your last answer was cut off before it ended. Answer again, shorter, and finish it.";
        continue;
      }
      const checked = r.accept(res.text);
      if (checked.ok) {
        return { value: checked.value, paise, tier, model: res.model, promptTokens: totalIn, completionTokens: totalOut, sentChars: charsOf(messages), climbed: n > 0 };
      }
      lastReason = checked.reason;
      again = `A first attempt was not usable: ${checked.reason}. Do it again, carefully, and answer in exactly the form asked.`;
    }
    // What was spent on attempts that came to nothing is still spent: the caller adds `detail.paise` to the artifact.
    if (down) throw new ArtifactError("model_down", "No model could be reached just now. Nothing was changed; try again in a little while.", { paise });
    throw new ArtifactError("edit_failed", `The change could not be made: ${lastReason}. Nothing was changed.`, { paise });
  }
}
