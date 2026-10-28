/**
 * EMAIL: AN OUTBOX AND A MAILER. A space invite by email (and anything else that mails someone) is written to the outbox first; a
 * small job sends what is queued through the Mailer.
 *
 *   outbox.queue({ to, subject, text, html?, kind, ref })   -> the row; nothing is sent here
 *   outbox.sendDue(mailer)                                    sends what is due (none while the mailer is not configured), retrying with backoff
 *   startMailSender({ outbox, mailer })                       that, every minute; returns the way to stop
 *
 * THE PLUG-IN POINT for a provider is `Mailer` below. Today `mailerFromEnv()` gives `NOT_CONFIGURED`: it sends nothing, so mail stays
 * queued, and the screens say plainly that it will go out (and offer the link to send by hand meanwhile). To plug one in, write a
 * Mailer whose `send` calls the provider (its key from config, never logged) and return it from `mailerFromEnv()`; what is queued then
 * goes out on the next run, oldest first.
 *
 * Addresses and bodies are never logged. A failure keeps only a short reason (no address, no body).
 */
import { randomUUID } from "node:crypto";
import { spaceTable, type PagedTable } from "./spaceRows.js";

export interface MailMessage { to: string; subject: string; text: string; html?: string }

export interface Mailer {
  /** False while no provider is plugged in: nothing is sent, mail waits in the outbox. */
  readonly configured: boolean;
  /** Sends one message; throws on failure (the outbox retries). */
  send(m: MailMessage): Promise<void>;
}

/** No provider yet: sends nothing, so every mail waits in the outbox until one is plugged in. */
export const NOT_CONFIGURED: Mailer = {
  configured: false,
  async send() { throw new Error("mail is not configured"); },
};

/** The server's mailer. THE PLUG-IN POINT: return a real Mailer here once a provider is chosen. */
export function mailerFromEnv(): Mailer {
  return NOT_CONFIGURED;
}

export interface MailRow {
  [k: string]: unknown;
  id: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  kind: string;
  ref: string;
  status: "queued" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  last_error: string;
  created_ms: number;
  next_ms: number;
  sent_ms: number | null;
}

export const MAIL_TRIES = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A plain, lower-case address, or "" when it isn't one. */
export function cleanEmail(v: unknown): string {
  if (typeof v !== "string") return "";
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : "";
}

export class MailOutbox {
  constructor(private readonly rows: PagedTable<MailRow> = spaceTable<MailRow>("mail_outbox"), private readonly now: () => number = Date.now) {}

  async queue(m: MailMessage & { kind: string; ref?: string }): Promise<MailRow> {
    const to = cleanEmail(m.to);
    if (!to) throw new Error("not an email address");
    const at = this.now();
    return this.rows.insert({
      id: randomUUID(), to_email: to, subject: m.subject.slice(0, 200), body_text: m.text.slice(0, 20_000), body_html: m.html ? m.html.slice(0, 60_000) : null,
      kind: m.kind.slice(0, 40), ref: (m.ref ?? "").slice(0, 80), status: "queued", attempts: 0, last_error: "", created_ms: at, next_ms: at, sent_ms: null,
    });
  }

  /** Stop a queued mail (an invite taken back before it went). */
  async cancel(kind: string, ref: string): Promise<number> {
    return this.rows.update({ kind, ref, status: "queued" }, { status: "cancelled" });
  }

  async byRef(kind: string, ref: string): Promise<MailRow | null> {
    const [r] = await this.rows.select({ kind, ref }, { order: "created_ms", desc: true, limit: 1 });
    return r ?? null;
  }

  /** Sends what is due, oldest first, at most `max`. Nothing while the mailer is not configured. How many went. */
  async sendDue(mailer: Mailer, max = 20): Promise<number> {
    if (!mailer.configured) return 0;
    const at = this.now();
    const due = (await this.rows.select({ status: "queued" }, { order: "next_ms", limit: max * 3 })).filter((r) => Number(r.next_ms) <= at).slice(0, max);
    let sent = 0;
    for (const r of due) {
      // Claim it, so two runs never send one mail twice.
      if (!(await this.rows.update({ id: r.id, status: "queued" }, { status: "sending" }))) continue;
      try {
        await mailer.send({ to: r.to_email, subject: r.subject, text: r.body_text, ...(r.body_html ? { html: r.body_html } : {}) });
        await this.rows.update({ id: r.id }, { status: "sent", sent_ms: this.now(), attempts: Number(r.attempts) + 1, last_error: "" });
        sent += 1;
      } catch (err) {
        const tries = Number(r.attempts) + 1;
        const reason = String((err as Error)?.name ?? "Error").slice(0, 60);
        await this.rows.update({ id: r.id }, tries >= MAIL_TRIES
          ? { status: "failed", attempts: tries, last_error: reason }
          : { status: "queued", attempts: tries, last_error: reason, next_ms: this.now() + BACKOFF_MS[Math.min(tries - 1, BACKOFF_MS.length - 1)]! });
      }
    }
    return sent;
  }
}

/** Sends the outbox every `everyMs` (a minute). Never in a request's way; a failed run waits for the next. Returns the way to stop. */
export function startMailSender(o: { outbox: MailOutbox; mailer: Mailer; everyMs?: number; log?: { warn(o: object, m: string): void } }): () => void {
  if (!o.mailer.configured) return () => undefined;
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    o.outbox.sendDue(o.mailer).catch((err) => o.log?.warn({ error: (err as Error)?.name }, "mail: a run failed")).finally(() => { busy = false; });
  }, o.everyMs ?? 60_000);
  t.unref?.();
  return () => clearInterval(t);
}
