/**
 * ONE REQUEST'S MONEY: A CAP, WHAT IS SPENT, AND A MODEL DOOR THAT KEEPS EVERY CALL OF THE REQUEST INSIDE IT.
 *
 * The gateway (code/brain/gateway.ts) holds each call to its own `maxPaise` and refuses a call whose worst case would pass it. A bot's request is
 * several calls (the turns of its tool loop, a research run, the memory note), so this is the layer that makes the cap the REQUEST's: before every
 * call the cap left is what the gateway is told, and what a call cost comes off it. The daily budget is the same idea one level up (service.ts):
 * the request's cap is the smaller of the bot's per-request budget and what is left of its day.
 */
import { BudgetExceeded } from "../code/brain/gateway.js";
import type { CallFn } from "../code/work/model.js";

export class Meter {
  private used = 0;

  constructor(readonly cap: number) {}

  get spent(): number { return this.used; }
  left(): number { return Math.max(0, this.cap - this.used); }
  add(paise: number): void { if (paise > 0) this.used += paise; }

  /** `base`, with every call held to what this request has left and charged to it. */
  wrap(base: CallFn): CallFn {
    return (async (input, deps) => {
      const left = this.left();
      if (left <= 0) {
        throw new BudgetExceeded({ needPaise: 1, spentPaise: this.used, budgetPaise: this.cap, scope: "call", purpose: input.purpose });
      }
      const given = typeof input.budget === "object" ? Math.min(input.budget.maxPaise, left) : left;
      const r = await base({ ...input, budget: { maxPaise: given } }, deps);
      this.add(r.paise);
      return r;
    }) as CallFn;
  }
}
