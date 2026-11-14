/**
 * THE INVITE SWEEPER: an invite and its mail do not outlive what they were for (docs: perms §3.3).
 *
 *   sweepInvites(o, now)   one pass: how many invite rows and outbox rows went
 *   startInviteSweeper(o)  that, once at the start and then every hour; returns the way to stop
 *
 * Two rows hold an address someone typed or picked:
 *
 *   `space_invites`  one invite for one address, good for seven days (INVITE_MS). It was deleted only when its whole space was,
 *                    so an expired invite's address sat there for ever. It now goes SEVEN DAYS AFTER IT EXPIRES — so a person
 *                    who was invited and never came has their address gone within fourteen days, which is what the policy and
 *                    `docs/store-privacy.md` say.
 *   `mail_outbox`    the invite mail, holding the address, the subject and the whole body. It has no foreign key to anyone and
 *                    nothing ever deleted it. A row that is SENT, FAILED or CANCELLED goes SEVEN DAYS AFTER IT WAS QUEUED,
 *                    and so does one still marked SENDING: the sender moves a row to `sending` and then to `sent` or
 *                    `failed` (mail.ts), so a crash in between leaves a row nothing will ever finish, holding an address
 *                    for ever. A real send does not take seven days, so by then the row is finished with either way.
 *
 * Why seven days and not at once: the thirty-a-day cap on invite mail counts the outbox by who sent it (`spaces.ts`
 * INVITES_A_DAY), and that read looks at the LAST 24 HOURS only, so nothing older than a day is needed for it to be right.
 * Seven days leaves a week for "did my invite go out?" and still keeps the promise.
 *
 * Rows are DELETED, never blanked: `mail_outbox.to_email` has a 3-254 character check (migration 0051), so a blank would be
 * refused by the database.
 *
 * A `queued` mail is never touched, however old. While the mailer is not configured, or Spaces is off, mail waits in the outbox
 * on purpose and still has to go out when it comes back. `sending` is not that: it is a row mid-send, and after a week it is
 * a row whose send died.
 *
 * Nothing here runs in a request's way, and nothing is logged but counts: never an address, a subject or a body.
 */
import type { MailRow } from "./mail.js";
import type { Table } from "./rows.js";
import { table } from "./rows.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import type { InviteRow } from "./spaces.js";

/** How long after an invite expires its row goes. */
export const INVITE_KEEP_MS = 7 * 24 * 3600_000;
/** How long after it was queued a finished outbox row goes. */
export const OUTBOX_KEEP_MS = 7 * 24 * 3600_000;
/** How often the sweeper looks. */
const SWEEP_EVERY_MS = 3600_000;
/** How many rows one pass takes, so a long-neglected table is cleared over several passes and never in one huge delete. */
const BATCH = 500;
/**
 * A mail nothing more will be done to. `sending` is on the list for the row whose send died mid-way: the sender writes
 * `sending` and then `sent` or `failed` in the next breath (mail.ts), so a week later it is finished with whatever happened.
 * Only `queued` is left alone, however old: that one is still waiting to go out.
 */
const DONE: Array<MailRow["status"]> = ["sent", "failed", "cancelled", "sending"];

export interface InviteSweeperTables {
  invites?: Table<InviteRow>;
  outbox?: PagedTable<MailRow>;
}

export interface SweepCounts { invites: number; mails: number }

/** One pass. Returns how many of each went. */
export async function sweepInvites(t: InviteSweeperTables, now: number): Promise<SweepCounts> {
  const invites = t.invites ?? table<InviteRow>("space_invites");
  const outbox = t.outbox ?? spaceTable<MailRow>("mail_outbox");
  const out: SweepCounts = { invites: 0, mails: 0 };

  // Expired long enough ago. The tables match on equal columns only, so the old ones are read and then removed by key.
  const old = (await invites.select({}, { order: "expires_ms", limit: BATCH * 2 }))
    .filter((i) => Number(i.expires_ms) > 0 && Number(i.expires_ms) <= now - INVITE_KEEP_MS).slice(0, BATCH);
  for (const i of old) out.invites += await invites.remove({ code: i.code });

  for (const status of DONE) {
    const rows = (await outbox.select({ status }, { order: "created_ms", limit: BATCH }))
      .filter((r) => Number(r.created_ms) <= now - OUTBOX_KEEP_MS);
    for (const r of rows) out.mails += await outbox.remove({ id: r.id });
  }
  return out;
}

/** A pass at once, then one every `everyMs`, never two at the same time. Returns the way to stop. */
export function startInviteSweeper(o: InviteSweeperTables & {
  everyMs?: number;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const n = await sweepInvites(o, (o.now ?? Date.now)());
      if (n.invites || n.mails) o.log?.info(n, "invites and their mail swept");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "invite sweep failed");
    } finally {
      busy = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}

/**
 * EVERYTHING THIS PERSON'S INVITES HOLD, AT ACCOUNT DELETION (routes/account/account.ts eraseAccount).
 *
 * `space_invites` cascades from the SPACE, not from the person, and `mail_outbox` has no foreign key to anyone at all, so
 * neither goes when the account does. The addresses in them are other people's, kept only because this person typed or picked
 * them, so they go with this person: every invite they created, and every outbox row sent for them, whatever its status.
 *
 * Returns how many of each went. Never logs an address.
 */
export async function forgetInvitesOf(userId: string, t: InviteSweeperTables = {}): Promise<SweepCounts> {
  const invites = t.invites ?? table<InviteRow>("space_invites");
  const outbox = t.outbox ?? spaceTable<MailRow>("mail_outbox");
  return {
    invites: await invites.remove({ created_by: userId }),
    mails: await outbox.remove({ sent_by: userId }),
  };
}
