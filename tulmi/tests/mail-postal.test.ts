/**
 * The server's own mail through Xooteq Mail's Postal (src/botsBots/mail.ts): one call per mail to its HTTP API, a refusal kept only as
 * Postal's code, and no mailer at all without the key, so mail waits in the outbox.
 */
import { describe, expect, it } from "vitest";
import { mailerFromEnv, MailOutbox, NOT_CONFIGURED, PostalMailer, type MailRow } from "../src/botsBots/mail.js";
import type { PagedTable } from "../src/botsBots/spaceRows.js";

function fakePostal(answer: { status: number; json: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(answer.json), { status: answer.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("mail through Postal", () => {
  it("posts each mail to Postal's send API with the server's key, from the configured sender", async () => {
    const p = fakePostal({ status: 200, json: { status: "success", data: { message_id: "m1" } } });
    const mailer = new PostalMailer({ url: "https://postal.mail.xooteq.online/", key: "k-123", from: "X0 Bot <noreply@x0bot.com>", fetch: p.f });
    await mailer.send({ to: "mom@example.com", subject: "Join Family", text: "Tap the link", html: "<p>Tap the link</p>" });
    expect(p.calls[0]!.url).toBe("https://postal.mail.xooteq.online/api/v1/send/message");
    expect(p.calls[0]!.headers["x-server-api-key"]).toBe("k-123");
    expect(p.calls[0]!.body).toEqual({ to: ["mom@example.com"], from: "X0 Bot <noreply@x0bot.com>", subject: "Join Family", plain_body: "Tap the link", html_body: "<p>Tap the link</p>" });
  });

  it("throws on a refusal with only Postal's code as the error's name: never the address or the body", async () => {
    const refused = new PostalMailer({ url: "https://p", key: "k", from: "a@x0bot.com", fetch: fakePostal({ status: 200, json: { status: "error", data: { code: "UnauthenticatedFromAddress", message: "mom@example.com" } } }).f });
    const err = await refused.send({ to: "mom@example.com", subject: "s", text: "secret words" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("Postal:UnauthenticatedFromAddress");
    expect(String((err as Error).message)).not.toMatch(/mom@|secret/);
    const down = new PostalMailer({ url: "https://p", key: "k", from: "a@x0bot.com", fetch: fakePostal({ status: 502, json: null }).f });
    expect(((await down.send({ to: "a@b.co", subject: "s", text: "t" }).catch((e: Error) => e)) as Error).name).toBe("Postal:HTTP502");
  });

  it("is the server's mailer only with a key; without one, nothing is sent and mail waits", () => {
    expect(mailerFromEnv({ MAIL_API_KEY: undefined, MAIL_API_URL: "https://p", MAIL_FROM: "a@x0bot.com" })).toBe(NOT_CONFIGURED);
    expect(mailerFromEnv({ MAIL_API_KEY: "  ", MAIL_API_URL: "https://p", MAIL_FROM: "a@x0bot.com" })).toBe(NOT_CONFIGURED);
    const m = mailerFromEnv({ MAIL_API_KEY: "k", MAIL_API_URL: "https://p", MAIL_FROM: "a@x0bot.com" });
    expect(m).toBeInstanceOf(PostalMailer);
    expect(m.configured).toBe(true);
  });

  it("sends what the outbox queued through Postal, and keeps a refusal's code for the retry", async () => {
    const rows: MailRow[] = [];
    const match = (r: MailRow, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => r[k] === v);
    const table = {
      async insert(r: MailRow) { rows.push({ ...r }); return r; },
      async update(w: Record<string, unknown>, patch: Partial<MailRow>) { let n = 0; for (const r of rows) if (match(r, w)) { Object.assign(r, patch); n += 1; } return n; },
      async select(w: Record<string, unknown>) { return rows.filter((r) => match(r, w)); },
    } as unknown as PagedTable<MailRow>;
    const outbox = new MailOutbox(table, () => 1_000);
    await outbox.queue({ to: "Mom@Example.com", subject: "Join Family", text: "Tap the link", kind: "invite", ref: "c1" });
    const ok = fakePostal({ status: 200, json: { status: "success", data: {} } });
    expect(await outbox.sendDue(new PostalMailer({ url: "https://p", key: "k", from: "a@x0bot.com", fetch: ok.f }))).toBe(1);
    expect(ok.calls[0]!.body.to).toEqual(["mom@example.com"]);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1 });

    await outbox.queue({ to: "dad@example.com", subject: "Join", text: "t", kind: "invite", ref: "c2" });
    const no = fakePostal({ status: 200, json: { status: "error", data: { code: "ServerSuspended" } } });
    expect(await outbox.sendDue(new PostalMailer({ url: "https://p", key: "k", from: "a@x0bot.com", fetch: no.f }))).toBe(0);
    expect(rows[1]).toMatchObject({ status: "queued", attempts: 1, last_error: "Postal:ServerSuspended" });
  });
});
