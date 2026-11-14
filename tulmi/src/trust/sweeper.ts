/**
 * THE 30 DAYS, KEPT (docs/trust.md §storage; the privacy policy says 30 days, so something has to make it true).
 *
 * Every six hours, across everyone and whether or not anybody opens the app:
 *   trust_net_seen       rows for days older than 30 days
 *   trust_device_seen    install rows last seen over 30 days ago
 *   trust_tombstones     tombstones older than 30 days (so a deleted account's email hash really does go)
 *   trust_attest_keys    keys unused for 30 days
 *   trust_scores         Apple's and Google's answers, dropped 30 days after each was given (the row itself lives as long
 *                        as the account, and is worked out again on every launch)
 *   device_links         the address and user agent on a USED sign-in row, blanked 30 days after it was used; the row itself
 *                        stays, because it is the record of which computer was signed in (auth/deviceLink.ts, 8.3 fix 2)
 *
 * IT RUNS WHATEVER THE MODE IS (docs/trust.md §storage). The sweeper only ever DELETES, so it is started even with
 * TRUST=off: the shadow period's rows, and everything a kill switch leaves behind, still have to go at 30 days. Only the
 * list downloads are behind the mode, because those are the only part that collects anything.
 *
 * Nothing here is in a request's way, and a pass that fails waits for the next one.
 */
import { blankOldDeviceLinks } from "../auth/deviceLink.js";
import { TRUST_KEEP_DAYS, ATTEST_KEEP_DAYS } from "./defaults.js";
import { dayKeyBefore } from "./signals.js";
import { trustStore, type TrustStore } from "./store.js";

/** How often the sweeper looks. A row is a few hours late at worst, which the 30 days already allow for. */
const SWEEP_EVERY_MS = 6 * 3600_000;

export interface Swept {
  net: number;
  device: number;
  tombstones: number;
  attest: number;
  /** Score rows an answer from Apple or Google was taken off. */
  verdicts: number;
  /** Sign-in rows whose address and user agent were blanked. */
  links: number;
}

/** One pass. Returns how many rows went, per table. */
export async function sweepTrust(now: number, store: TrustStore = trustStore()): Promise<Swept> {
  const before = now - TRUST_KEEP_DAYS * 86_400_000;
  const counts = await store.sweep({
    beforeDay: dayKeyBefore(now, TRUST_KEEP_DAYS),
    before,
    attestBefore: now - ATTEST_KEEP_DAYS * 86_400_000,
  });
  const verdicts = await store.sweepVerdicts(before).catch(() => 0);
  const links = await blankOldDeviceLinks(before).catch(() => 0);
  return { ...counts, verdicts, links };
}

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/** A pass at once, then one every `everyMs`, never two at the same time. Returns the way to stop. */
export function startTrustSweeper(o: {
  store?: TrustStore;
  everyMs?: number;
  now?: () => number;
  log?: Log;
} = {}): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const swept = await sweepTrust((o.now ?? Date.now)(), o.store ?? trustStore());
      const any = swept.net || swept.device || swept.tombstones || swept.attest || swept.verdicts || swept.links;
      if (any) o.log?.info(swept, "trust: rows older than 30 days deleted");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "trust: the sweep failed");
    } finally {
      busy = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}
