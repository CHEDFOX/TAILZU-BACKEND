/**
 * THE THING THAT MAKES A CARD GO BY ITSELF (docs/sites.md). One pass every minute: the open things whose turn has come,
 * looked at one at a time.
 *
 * ONE AT A TIME ON PURPOSE. The browser takes three pages at once and a fourth waits, and those places belong to the
 * people who are looking at a screen right now. A background sweep that filled all three would make the app feel broken
 * to somebody waiting on a page, to find out a minute sooner where a parcel is.
 *
 * SMALL BITES. At most `most` in a pass, so a thousand open things become a steady trickle rather than a stampede at
 * every restart — and the floor each watch keeps for itself (`CLOUD_BROWSER_EVERY_MIN`) means nothing is looked at
 * sooner for having waited.
 *
 * Never throws, and never lets one bad watch stop the others: a pass that dies takes the next pass with it.
 */
import { cloudBrowserOn } from "./gate.js";
import type { Sites } from "./service.js";

/** How often a pass runs. The work is decided by each watch's own `nextAt`, not by this. */
const TICK_MS = 60_000;
/** How many things one pass will look at. */
const MOST_A_PASS = 5;

export interface ClockOpts {
  sites: Sites;
  everyMs?: number;
  most?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** One pass. Exported so a test can run it without a timer. Returns how many were looked at. */
export async function sitesPass(o: ClockOpts): Promise<number> {
  if (!cloudBrowserOn()) return 0;
  const most = o.most ?? MOST_A_PASS;
  const due = await o.sites.dueNow(most).catch(() => []);
  let done = 0;
  for (const w of due) {
    try {
      const { outcome } = await o.sites.checkOne(w);
      if (outcome !== "skipped") done += 1;
    } catch (err) {
      // checkOne is written not to throw; if it ever does, the others still get their turn.
      o.log?.warn({ error: (err as Error)?.name, site: w.site }, "sites: a look failed");
    }
  }
  return done;
}

/** Start the clock. Returns the stop. */
export function startSitesClock(o: ClockOpts): () => void {
  let busy = false;
  const run = async (): Promise<void> => {
    // A pass that is still going keeps its place: passes never overlap, so the browser is never asked for more
    // than one background page at a time however slow a site is.
    if (busy) return;
    busy = true;
    try {
      const n = await sitesPass(o);
      if (n) o.log?.info({ looked: n }, "sites: looked at what was due");
    } finally {
      busy = false;
    }
  };
  const every = setInterval(() => { void run(); }, o.everyMs ?? TICK_MS);
  every.unref?.();
  return () => clearInterval(every);
}
