/**
 * DELETE YOUR ACCOUNT ON THE WEB (Google Play's deletion link: routes/accountDeletion.ts, policies/deleteAccount.ts):
 *
 *   - /delete-account is a page of its own: the steps, the seven days, what is deleted and what is kept; it runs only its own script
 *     (by nonce), talks only to its own origin, and loads no pixel or tag manager
 *   - signing in there is the app's email code: a code is asked for without saying whether an account uses the address, and never
 *     makes one; a right code gives the page a session, a wrong one doesn't
 *   - with that session the page uses the app's own Delete account: the date set seven days out, and Keep my account
 *   - the privacy policy and the terms link to it
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

// A session the page got from a right code is "web-<id>"; anything else is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const t = h?.replace(/^Bearer\s+/i, "").trim() ?? ""; return t.startsWith("web-") ? { id: t.slice(4), token: t } : null; } };
});

const { MemoryDeletionStore, GRACE_MS } = await import("../src/you/deletion.js");
const { registerAccountDeletionRoutes } = await import("../src/routes/accountDeletion.js");
const { PRIVACY_POLICY_HTML } = await import("../src/routes/policies/privacy.js");
const { TERMS_HTML } = await import("../src/routes/policies/terms.js");

const NOW = Date.UTC(2026, 9, 29, 6, 0);
const ACCOUNTS: Record<string, string> = { "meera@example.in": "u-meera" };

function served(o: { otp?: "none" | "throws"; captchaKey?: string } = {}) {
  const app = Fastify();
  const store = new MemoryDeletionStore();
  const sent: Array<{ email: string; captcha?: string }> = [];
  const otp = o.otp === "none" ? null : {
    async send(email: string, captcha?: string) {
      sent.push({ email, ...(captcha ? { captcha } : {}) });
      if (o.otp === "throws" || !ACCOUNTS[email]) throw Object.assign(new Error("Signups not allowed for otp"), { name: "AuthApiError", status: 422 });
    },
    async verify(email: string, code: string) { return ACCOUNTS[email] && code === "123456" ? { token: `web-${ACCOUNTS[email]}`, expiresIn: 3600 } : null; },
  };
  registerAccountDeletionRoutes(app, {
    rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, erase: async () => true, store, now: () => NOW, sweepEveryMs: null,
    leave: async () => undefined, otp, captchaKey: o.captchaKey ?? "",
  });
  return { app, store, sent };
}
const post = (app: ReturnType<typeof Fastify>, url: string, payload: object, token?: string) =>
  app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("the page", () => {
  it("says how, the seven days, what goes and what stays, and runs only its own script", async () => {
    const { app } = served();
    const r = await app.inject({ method: "GET", url: "/delete-account" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    const csp = String(r.headers["content-security-policy"]);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(r.body).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(r.body).not.toContain("site-events.js");
    expect(r.body).not.toContain("googletagmanager");
    expect(r.body).toContain(`<meta name="robots" content="noindex, follow">`);
    for (const words of ["Delete your X0 Bot account", "How it works", "What is deleted", "What is kept", "7 days", "Keep my account", "Email me a code", "privacy@x0bot.com", "/privacy"]) {
      expect(r.body).toContain(words);
    }
    expect(r.body).toContain("/v1/account/deletion/web/code");
    expect(r.body).toContain("/v1/account/deletion/web/verify");
    // Two loads, two nonces.
    const again = await app.inject({ method: "GET", url: "/delete-account" });
    expect(/'nonce-([^']+)'/.exec(String(again.headers["content-security-policy"]))?.[1]).not.toBe(nonce);
  });

  it("allows Cloudflare's check only when a site key is set", async () => {
    const { app } = served({ captchaKey: "0x4AAAAAAA-test" });
    const r = await app.inject({ method: "GET", url: "/delete-account" });
    expect(String(r.headers["content-security-policy"])).toContain("https://challenges.cloudflare.com");
    expect(r.body).toContain(`data-sitekey="0x4AAAAAAA-test"`);
  });

  it("is linked from the privacy policy and the terms", () => {
    expect(PRIVACY_POLICY_HTML).toContain(`href="https://x0bot.com/delete-account"`);
    expect(TERMS_HTML).toContain(`href="https://x0bot.com/delete-account"`);
  });
});

describe("signing in by a mailed code", () => {
  it("answers the same whether or not an account uses the address, and never makes one", async () => {
    const { app, sent } = served();
    for (const email of ["meera@example.in", "nobody@example.in"]) {
      const r = await post(app, "/v1/account/deletion/web/code", { email: ` ${email.toUpperCase()} ` });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ sent: true });
    }
    expect(sent.map((s) => s.email)).toEqual(["meera@example.in", "nobody@example.in"]);
    expect((await post(app, "/v1/account/deletion/web/code", { email: "not an email" })).statusCode).toBe(400);
    expect((await post(app, "/v1/account/deletion/web/code", { email: "meera@example.in", captcha: "tok" })).statusCode).toBe(200);
    expect(sent.at(-1)).toEqual({ email: "meera@example.in", captcha: "tok" });
  });

  it("gives a session for the right code only", async () => {
    const { app } = served();
    const wrong = await post(app, "/v1/account/deletion/web/verify", { email: "meera@example.in", code: "999999" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe("invalid_code");
    expect((await post(app, "/v1/account/deletion/web/verify", { email: "meera@example.in", code: "12" })).statusCode).toBe(400);
    const right = await post(app, "/v1/account/deletion/web/verify", { email: "meera@example.in", code: "123 456" });
    expect(right.statusCode).toBe(200);
    expect(right.json()).toEqual({ token: "web-u-meera", expiresIn: 3600 });
    expect(right.headers["cache-control"]).toBe("no-store");
  });

  it("says plainly when this server can't sign anyone in", async () => {
    const { app } = served({ otp: "none" });
    expect((await post(app, "/v1/account/deletion/web/code", { email: "meera@example.in" })).statusCode).toBe(503);
    expect((await post(app, "/v1/account/deletion/web/verify", { email: "meera@example.in", code: "123456" })).statusCode).toBe(503);
  });
});

describe("deleting from the page", () => {
  it("sets the date seven days out with the app's own Delete account, and Keep my account takes it back", async () => {
    const { app, store } = served();
    const token = (await post(app, "/v1/account/deletion/web/verify", { email: "meera@example.in", code: "123456" })).json().token as string;
    const before = await app.inject({ method: "GET", url: "/v1/account/deletion", headers: { authorization: `Bearer ${token}` } });
    expect(before.json()).toMatchObject({ scheduled: null, graceDays: 7, deleteAtIfNow: NOW + GRACE_MS });
    const asked = await post(app, "/v1/account/deletion", {}, token);
    expect(asked.statusCode).toBe(202);
    expect(asked.json().scheduled).toEqual({ requestedAt: NOW, deleteAt: NOW + GRACE_MS });
    expect(await store.get("u-meera")).toEqual({ requestedAt: NOW, deleteAt: NOW + GRACE_MS });
    const kept = await app.inject({ method: "DELETE", url: "/v1/account/deletion", headers: { authorization: `Bearer ${token}` } });
    expect(kept.json()).toEqual({ ok: true, kept: true });
    expect(await store.get("u-meera")).toBeNull();
    // Without a session, nothing.
    expect((await post(app, "/v1/account/deletion", {})).statusCode).toBe(401);
  });
});
