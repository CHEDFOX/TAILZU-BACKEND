/**
 * A HARD SPEND CAP FOR A WHOLE RUN. Money is counted in paise, the unit the product's budgets use; the command line speaks rupees.
 *
 * `reserve(wanted)` is asked before every job: it grants what is left, up to `wanted`, and a job's own budget is capped to the grant, so a single job can
 * never take the run past the cap (the gateway refuses a call the job's budget cannot cover). `settle` adds what was really spent. Once the cap is
 * reached `exhausted` is true and the runner stops starting work, finishes what is running and writes what it has: a clean stop, never a crash.
 */
export class SpendCap {
  private spent = 0;
  private reserved = 0;
  readonly events: Array<{ at: number; what: string; paise: number }> = [];

  constructor(readonly capPaise: number) {}

  get spentPaise(): number { return this.spent; }
  get leftPaise(): number { return Math.max(0, this.capPaise - this.spent - this.reserved); }
  get exhausted(): boolean { return this.capPaise > 0 && this.spent + this.reserved >= this.capPaise; }

  /** The paise a job may be given: at most `wanted`, at most what is left. Zero means "do not start". */
  reserve(wanted: number): number {
    if (!Number.isFinite(this.capPaise) || this.capPaise <= 0) return wanted;
    const grant = Math.min(wanted, this.leftPaise);
    this.reserved += grant;
    return grant;
  }
  settle(granted: number, spentPaise: number, what: string): void {
    this.reserved = Math.max(0, this.reserved - granted);
    this.spent += Math.max(0, spentPaise);
    this.events.push({ at: Date.now(), what, paise: spentPaise });
  }
  /** Money spent outside a job (the judge, a probe). */
  charge(paise: number, what: string): void {
    this.spent += Math.max(0, paise);
    this.events.push({ at: Date.now(), what, paise });
  }
}

/** An unlimited cap, for runs that cost nothing (oracle and fake). */
export const noCap = (): SpendCap => new SpendCap(0);

export const inrToPaise = (inr: number): number => Math.round(inr * 100);
export const paiseToInr = (paise: number): number => Math.round(paise) / 100;
