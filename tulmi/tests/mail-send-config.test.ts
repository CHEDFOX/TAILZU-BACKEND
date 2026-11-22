/**
 * THE APP'S OWN OUTGOING MAIL IS SAID AT START WHEN IT CANNOT SEND (src/config.ts, src/botsBots/mail.ts).
 *
 * Without MAIL_API_KEY nothing fails anywhere a person can see. A space invite, a safety report or a reported answer
 * is filed correctly, the app says it sent, the row waits in the outbox, and the first anyone knows is wondering why
 * nobody has ever reported anything. Every other half-set setting in config.ts is said at boot; this one was not.
 *
 * It is a SENDING key on the mail server, and it is not the mail bot's MAIL_WORKER_SECRET — that one only reads a
 * business's mailbox. Being connected for receiving says nothing about being able to send, which is exactly the
 * confusion the warning spells out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { getConfig, resetConfigForTests, ENV_KEYS } = await import("../src/config.js");
const { mailerFromEnv } = await import("../src/botsBots/mail.js");

const KEYS = ["MAIL_API_KEY", "MAIL_API_URL", "MAIL_FROM", "MAIL_WORKER_URL", "MAIL_WORKER_SECRET", "BOTS"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; resetConfigForTests(); vi.restoreAllMocks(); });
const set = (o: Record<string, string>) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, o); resetConfigForTests(); };
const said = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);
const lines = (w: ReturnType<typeof said>) => w.mock.calls.map((c) => String(c[0])).join("\n");

describe("the app's outgoing mail", () => {
  it("says at start that it cannot send, and which key it means", () => {
    const warn = said();
    set({ BOTS: "true" });
    getConfig();
    const out = lines(warn);
    expect(out).toMatch(/MAIL_API_KEY is not set/);
    // It names what silently stops, so the line is useful on its own.
    expect(out).toMatch(/wait in the outbox/);
    // And it heads off the confusion that caused this: the receiving secret is a different credential.
    expect(out).toMatch(/not the mail bot's MAIL_WORKER_SECRET/);
    // With no key there is no mailer, which is what the warning is about.
    expect(mailerFromEnv().configured).toBe(false);
  });

  it("says nothing once the key is there, and the mailer is real", () => {
    const warn = said();
    set({ BOTS: "true", MAIL_API_KEY: "postal-key" });
    getConfig();
    expect(lines(warn)).not.toMatch(/MAIL_API_KEY/);
    expect(mailerFromEnv().configured).toBe(true);
  });

  it("is not satisfied by the mail bot being connected: receiving is not sending", () => {
    const warn = said();
    set({ BOTS: "true", MAIL_WORKER_URL: "http://mail-worker:5300", MAIL_WORKER_SECRET: "x".repeat(40) });
    getConfig();
    expect(lines(warn)).toMatch(/MAIL_API_KEY is not set/);
    expect(mailerFromEnv().configured).toBe(false);
  });

  it("says nothing at all on a server with no bots, where no mail is ever queued", () => {
    const warn = said();
    set({});
    getConfig();
    expect(lines(warn)).not.toMatch(/MAIL_API_KEY/);
  });

  it("goes to the mail server the settings already name, from the app's own address", () => {
    set({ BOTS: "true", MAIL_API_KEY: "postal-key" });
    // The defaults are the live ones: nothing has to be set for the address to be right.
    expect(getConfig()).toMatchObject({ MAIL_API_URL: "https://postal.mail.xooteq.online", MAIL_FROM: "X0 Bot <noreply@x0bot.com>" });
    for (const k of KEYS) expect(ENV_KEYS, k).toContain(k);
  });
});
