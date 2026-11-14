/**
 * ABUSE AND FRAUD PREVENTION, AS THE SERVER WOULD DO IT WITH NO RULES AT ALL (docs/trust.md).
 *
 * Every weight, threshold, action switch and list address is here, and the control plane's "trust" surface edits this object
 * live (per platform, app version, named users, a percentage, a date window) before a request reads it; taking the rule away
 * restores these values exactly. So turning an action on, moving a threshold or trying a weight is a console change, never a
 * deploy. Kept free of imports, like the widgets' and the push engine's defaults, so the console can preview it.
 *
 * WHAT THIS IS NOT. It never builds an identity. A network is described by its KIND and by COUNTS; a count only ever feeds the
 * score of the account being looked at. Nothing here reads anything about the phone's own network, its keyboards, its boot
 * time, its locale or its screen (Apple names "the user's network connection" among its fingerprinting examples), and nothing
 * here reaches ads, analytics or Meta.
 */

/** A reason code. Each is a short word that goes in the score's `reasons`, in a log line and in the admin view. */
export type TrustReason =
  // The network a request came from.
  | "tor" | "hosting" | "vpn"
  // How many accounts were made on one network key: the 3rd in 24 hours, the 5th or more.
  | "net3" | "net5"
  // The email: a disposable domain, or a match with a deleted account's tombstone.
  | "disposable" | "tombstone"
  // The request's own shape: a script-shaped user agent, or claims that do not fit each other.
  | "script" | "mismatch"
  // The install id (8.4), while its flag is on: 3 or more accounts on one install in 30 days, 5 or more.
  | "install3" | "install5"
  // The same session seen from a data centre and a home or mobile network within the hour, or from four or more networks.
  | "sessionMoved"
  // What Apple and Google answered (8.9.1). "Claimed and failed" is the strong one; a missing answer is never a penalty.
  | "dcBit0" | "dcBit1" | "attestKeys" | "attestFailed" | "integrityUnrecognised" | "noDeviceIntegrity"
  // The three that take the score DOWN.
  | "signedInWithApple" | "settledAccount" | "attestPassed";

export interface TrustPayload {
  /** Added up, in order, into one score. A weight of 0 turns a signal off without taking its code away. */
  weights: Record<TrustReason, number>;
  /** An account younger than `hours` has its score multiplied by `times` (free-plan abuse is a new account's game). */
  newAccount: { hours: number; times: number };
  /** What each score reaches. Below `log` nothing is written but the row that was already written. */
  thresholds: { log: number; slow: number; hold: number; ask: number };
  /**
   * Each action's own switch, all false here: the code deploys dark and the owner turns one on from the console after reading
   * the shadow data. `ask` has no screen yet (spec 15 Q5), so it stays off in 8.9.1 whatever the threshold says.
   */
  actions: { slow: boolean; hold: boolean; ask: boolean };
  /** Who the hold may ever touch: accounts younger than this, with no payment, and nobody else (spec 15 Q4). */
  hold: { maxAccountDays: number; minutes: number };
  /** How long a slowed account's requests keep the free plan's single slot and the lower rate limit. */
  slow: { minutes: number };
  /**
   * The public lists the server downloads itself, to TRUST_LISTS_DIR. Plain GETs; nothing about a person leaves. A list that
   * cannot be fetched keeps its last good copy, and no list at all means the kind reads "unknown" and scores nothing.
   */
  lists: {
    refreshHours: number;
    asn: string;
    tor: string;
    relay: string;
    hosting: string[];
  };
  /** The share of asks that carry each attestation step, so it can be ramped from 0 (dark) upward. */
  attest: { percent: number };
  integrity: { percent: number };
  /** Whether the phone is asked to send the install id it made at first launch (8.4). Off until App Privacy lists Device ID. */
  installId: boolean;
}

export const TRUST_DEFAULTS: TrustPayload = {
  weights: {
    tor: 40,
    hosting: 25,
    vpn: 15,
    net3: 10,
    net5: 25,
    disposable: 30,
    tombstone: 40,
    script: 20,
    mismatch: 20,
    install3: 25,
    install5: 40,
    sessionMoved: 25,
    dcBit0: 30,
    dcBit1: 60,
    attestKeys: 20,
    attestFailed: 40,
    integrityUnrecognised: 30,
    noDeviceIntegrity: 15,
    signedInWithApple: -10,
    settledAccount: -20,
    attestPassed: -15,
  },
  newAccount: { hours: 24, times: 1.5 },
  thresholds: { log: 30, slow: 50, hold: 70, ask: 85 },
  actions: { slow: false, hold: false, ask: false },
  hold: { maxAccountDays: 7, minutes: 60 },
  slow: { minutes: 60 },
  lists: {
    refreshHours: 24,
    asn: "https://iptoasn.com/data/ip2asn-combined.tsv.gz",
    tor: "https://check.torproject.org/torbulkexitlist",
    relay: "https://mask-api.icloud.com/egress-ip-ranges.csv",
    hosting: [
      "https://ip-ranges.amazonaws.com/ip-ranges.json",
      "https://www.gstatic.com/ipranges/cloud.json",
      "https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json",
      "https://www.cloudflare.com/ips-v4",
      "https://www.cloudflare.com/ips-v6",
    ],
  },
  attest: { percent: 0 },
  integrity: { percent: 0 },
  installId: false,
};

/** How long a row of any kind is kept. The policy says 30 days, so one number says it for every table and the sweeper. */
export const TRUST_KEEP_DAYS = 30;
/** How long an App Attest key is kept after its last use (it is the only row that outlives the 30 days while in use). */
export const ATTEST_KEEP_DAYS = 30;
/** Apple keeps DeviceCheck's bits on the device for ever. We stop counting bit0 after this long (docs/trust.md, policy 11.4). */
export const DEVICE_BIT_MONTHS = 12;
