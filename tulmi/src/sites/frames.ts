/**
 * WHEN TO SEND A FRAME, AND WHEN THE PANEL IS OVER (docs/sites.md §panel).
 *
 * NOTHING HERE RUNS ON A CLOCK, and that is the whole design. A panel that sent a picture every 300 ms would spend
 * most of a sign-in sending the same still page to a phone on a paid connection, and would still feel slow in the one
 * second that matters — the moment after a tap, when the page is actually moving.
 *
 * So frames are PUSHED by the page (Chrome's screencast fires only when something changed) and this decides, per
 * frame, whether it is worth the bytes:
 *
 *   - a still page costs nothing, because Chrome sends nothing
 *   - a page that will not settle (a spinner, an advert) is capped, so it cannot flood a phone
 *   - the moment after a tap the cap lifts, because that is when a person is waiting to see what they did
 *   - when frames outrun the cap, the NEWEST is kept and the rest dropped: an old frame is not worth sending late,
 *     it is worth not sending at all
 *
 * And the panel ENDS ON A SIGNAL, never on a countdown: they are signed in, or they said they are, or they left. The
 * two clocks below are safety nets for a person who walked away mid-sign-in, not the mechanism.
 */

/** The most frames a second while the page is just sitting there changing (a spinner, a carousel). */
export const QUIET_FPS = 4;
/** The most frames a second just after they touched something: they are watching for the result. */
export const BUSY_FPS = 12;
/** How long a tap counts as "they are watching". */
export const BUSY_MS = 1_200;
/** Nothing from them AND nothing from the page for this long: they put the phone down. */
export const IDLE_END_MS = 90_000;
/** However it is going, a panel does not stay open past this. Something is wrong by now. */
export const HARD_END_MS = 5 * 60_000;

/**
 * The gate: `frame()` says whether to send this one. Pure, so the whole of the behaviour above is testable without a
 * browser, a socket or a phone.
 */
export class FrameGate {
  /** Whether anything has gone yet, kept apart from WHEN: a clock reading zero is a real time, and treating it as
   *  "never sent" made every frame look like the first one. */
  private started = false;
  private lastSent = 0;
  private lastTouch = -Infinity;

  constructor(private readonly o: { quietFps?: number; busyFps?: number; busyMs?: number } = {}) {}

  private gapFor(now: number): number {
    const busy = now - this.lastTouch < (this.o.busyMs ?? BUSY_MS);
    return 1000 / (busy ? this.o.busyFps ?? BUSY_FPS : this.o.quietFps ?? QUIET_FPS);
  }

  /** They tapped, typed or scrolled: the next second is worth more frames. */
  touched(now: number): void {
    this.lastTouch = now;
  }

  /** Send this frame? The first one always goes: a panel that opens to nothing looks broken. */
  frame(now: number): boolean {
    if (!this.started || now - this.lastSent >= this.gapFor(now)) {
      this.started = true;
      this.lastSent = now;
      return true;
    }
    return false;
  }

  /** For the log: how long since anything was sent. */
  since(now: number): number {
    return this.started ? now - this.lastSent : 0;
  }
}

export type PanelEnd = "signed_in" | "said_done" | "cancelled" | "left" | "too_long";

/**
 * WHY A PANEL IS OVER, asked on every frame and every touch. The signals come first and the clocks last, so a panel
 * that is working closes the moment it has worked rather than when a timer says so.
 */
export class PanelLife {
  private lastAnything: number;

  constructor(private readonly openedAt: number, o: { idleMs?: number; hardMs?: number } = {}) {
    this.lastAnything = openedAt;
    this.idleMs = o.idleMs ?? IDLE_END_MS;
    this.hardMs = o.hardMs ?? HARD_END_MS;
  }

  private readonly idleMs: number;
  private readonly hardMs: number;

  /** Anything at all happened: a frame from the page, or a touch from them. */
  alive(now: number): void {
    this.lastAnything = now;
  }

  /**
   * Over? `signedIn` is the real answer and is checked first: the page stopped looking like a sign-in page, so they
   * are in and there is nothing left to watch.
   */
  over(now: number, signedIn: boolean): PanelEnd | null {
    if (signedIn) return "signed_in";
    if (now - this.openedAt >= this.hardMs) return "too_long";
    if (now - this.lastAnything >= this.idleMs) return "left";
    return null;
  }
}

/** What the person is told when it ends by itself. */
export const END_WORDS: Record<PanelEnd, string> = {
  signed_in: "You're in.",
  said_done: "You're in.",
  cancelled: "Stopped.",
  left: "I closed that — nothing happened for a while.",
  too_long: "I closed that. Try again when you have a minute.",
};
