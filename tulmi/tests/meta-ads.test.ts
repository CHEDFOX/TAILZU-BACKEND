/**
 * What goes to Meta, and when (src/ads/meta.ts): identifiers hashed the way
 * Meta matches them, each milestone once and only for a new account, a phone
 * handed its events to log and a desktop's sent from here, the site's beacon
 * held to the events that mean something, and the pixel script empty until
 * there is a dataset.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.META_PIXEL_ID = "1234567890";
process.env.META_CAPI_TOKEN = "test-capi-token";

/** The account each request is from: set per test. */
const who = vi.hoisted(() => ({
  user: { id: "dev-user", email: "dev@flow.local" } as { id: string; email?: string; phone?: string; createdAt?: string },
}));
vi.mock("../src/auth/supabase.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: vi.fn(async () => who.user) };
});
vi.mock("../src/pipeline/cleanup.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/pipeline/cleanup.js")>();
  return { ...real, assist: vi.fn(async (input: string) => `Written: ${input}`) };
});

// eslint-disable-next-line import/first
import {
  dueMilestones, eventPayload, normalEmail, normalPhone, requestBody, siteEventsScript, userData,
  FRESH_WINDOW_MS, REGISTRATION_WINDOW_MS,
} from "../src/ads/meta.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { getConfig, resetConfigForTests } from "../src/config.js";
// eslint-disable-next-line import/first
import { siteShell } from "../src/routes/policies/shell.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3600_000;

describe("what identifies a person, as Meta wants it", () => {
  it("hashes the email and phone in Meta's normal form, and the account id", () => {
    const u = userData({ email: "  Priya@Example.COM ", phone: "+91 98765-43210", userId: "acc-1" }) as Record<string, string[]>;
    expect(u.em).toEqual([sha("priya@example.com")]);
    expect(u.ph).toEqual([sha("919876543210")]);
    expect(u.external_id).toEqual([sha("acc-1")]);
    // Nothing in the clear.
    expect(JSON.stringify(u)).not.toMatch(/priya|98765|acc-1/i);
  });
  it("keeps the address and browser as they are, and drops what is not the pixel's cookie", () => {
    const u = userData({ ip: "203.0.113.9", userAgent: "Mozilla/5.0", fbp: "fb.1.1712345678901.123456789", fbc: "<script>" });
    expect(u).toMatchObject({ client_ip_address: "203.0.113.9", client_user_agent: "Mozilla/5.0", fbp: "fb.1.1712345678901.123456789" });
    expect(u).not.toHaveProperty("fbc");
    expect(userData({ ip: "not-an-ip" })).not.toHaveProperty("client_ip_address");
  });
  it("leaves out what is not an email or a phone", () => {
    expect(normalEmail("nobody")).toBeUndefined();
    expect(normalPhone("12")).toBeUndefined();
    expect(normalPhone("0091 22 1234 5678")).toBe("912212345678");
  });
});

describe("the event and the request", () => {
  it("carries the name, id, source and when", () => {
    const p = eventPayload({ name: "Lead", id: "abc12345", source: "website", url: "https://tailzu.space/", user: {}, data: { content_name: "mac" } }, 1_700_000_000_000);
    expect(p).toMatchObject({ event_name: "Lead", event_id: "abc12345", action_source: "website", event_time: 1_700_000_000, event_source_url: "https://tailzu.space/", custom_data: { content_name: "mac" } });
  });
  it("puts the token in the body, and the test code only when there is one", () => {
    expect(requestBody([])).toMatchObject({ access_token: "test-capi-token" });
    expect(requestBody([])).not.toHaveProperty("test_event_code");
    process.env.META_TEST_EVENT_CODE = "TEST123";
    resetConfigForTests();
    expect(requestBody([])).toMatchObject({ test_event_code: "TEST123" });
    delete process.env.META_TEST_EVENT_CODE;
    resetConfigForTests();
  });
});

describe("milestones: once each, and only for a new account", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const made = (ago: number) => new Date(now - ago).toISOString();

  it("a phone account an hour old, keyboard on and dictating: all three", () => {
    expect(dueMilestones({ createdAt: made(HOUR), keyboardOn: true, wordsEver: 5, desktop: false, now }))
      .toEqual(["registration", "keyboard", "firstDictation"]);
  });
  it("a desktop has no keyboard milestone", () => {
    expect(dueMilestones({ createdAt: made(HOUR), keyboardOn: true, wordsEver: 5, desktop: true, now }))
      .toEqual(["registration", "firstDictation"]);
  });
  it("what was reported is not reported again", () => {
    expect(dueMilestones({
      createdAt: made(HOUR), keyboardOn: true, wordsEver: 5, desktop: false, now,
      reported: { registration: "x", keyboard: "x", firstDictation: "x" },
    })).toEqual([]);
  });
  it("a sign-up counts for two days, the rest for a week, and an old account never", () => {
    expect(dueMilestones({ createdAt: made(REGISTRATION_WINDOW_MS + HOUR), wordsEver: 1, desktop: false, now })).toEqual(["firstDictation"]);
    expect(dueMilestones({ createdAt: made(FRESH_WINDOW_MS + HOUR), keyboardOn: true, wordsEver: 1, desktop: false, now })).toEqual([]);
    expect(dueMilestones({ createdAt: undefined, wordsEver: 1, desktop: false, now })).toEqual([]);
  });
});

describe("the pixel script", () => {
  it("holds the dataset id, honours do-not-track and Europe, and is valid JavaScript", () => {
    const js = siteEventsScript();
    expect(js).toContain('"1234567890"');
    expect(js).toContain("globalPrivacyControl");
    expect(js).toContain("Europe");
    expect(() => new Function(js)).not.toThrow();
  });
  it("is empty without a dataset", () => {
    process.env.META_PIXEL_ID = "";
    resetConfigForTests();
    expect(siteEventsScript()).not.toContain("fbq");
    process.env.META_PIXEL_ID = "1234567890";
    resetConfigForTests();
    expect(getConfig().META_PIXEL_ID).toBe("1234567890");
  });
});

describe("through the server", () => {
  let app: FastifyInstance;
  const sent = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  const events = () => sent.mock.calls
    .filter(([url]) => String(url).startsWith("https://graph.facebook.com/"))
    .flatMap(([, init]) => (JSON.parse(String(init?.body)) as { data: Array<Record<string, unknown>> }).data);

  beforeAll(async () => {
    vi.stubGlobal("fetch", sent);
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });
  beforeEach(() => sent.mockClear());

  it("serves the pixel script", async () => {
    const res = await app.inject({ method: "GET", url: "/site-events.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.body).toContain("fbevents.js");
  });

  it("copies a download click to Meta under the pixel's id, and nothing else", async () => {
    const ok = await app.inject({
      method: "POST", url: "/v1/site/event",
      headers: { "x-vercel-forwarded-for": "198.51.100.7", "user-agent": "Mozilla/5.0 Test", cookie: "_fbp=fb.1.1712345678901.42" },
      payload: { name: "Lead", id: "evt-123456", kind: "mac", url: "https://tailzu.space/download" },
    });
    expect(ok.statusCode).toBe(204);
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toMatchObject({
      event_name: "Lead", event_id: "evt-123456", action_source: "website",
      user_data: { client_ip_address: "198.51.100.7", client_user_agent: "Mozilla/5.0 Test", fbp: "fb.1.1712345678901.42" },
    });

    sent.mockClear();
    for (const payload of [{ name: "Purchase", id: "evt-123456", kind: "mac" }, { name: "Lead", id: "x", kind: "mac" }, { name: "Lead", id: "evt-123456", kind: "toaster" }]) {
      expect((await app.inject({ method: "POST", url: "/v1/site/event", payload })).statusCode).toBe(204);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(events()).toHaveLength(0);
  });

  it("hands a new phone account its milestones once, to log through the SDK", async () => {
    who.user = { id: "phone-new", email: "new@example.com", createdAt: new Date(Date.now() - HOUR).toISOString() };
    const boot = () => app.inject({
      method: "POST", url: "/v1/app/bootstrap",
      payload: { capabilities: { platform: "android", device: { keyboardEnabled: true } } },
    });
    const first = (await boot()).json() as { metaEvents?: Array<{ name: string }> };
    expect(first.metaEvents?.map((e) => e.name)).toEqual(["fb_mobile_complete_registration", "fb_mobile_tutorial_completion"]);
    const again = (await boot()).json() as { metaEvents?: unknown };
    expect(again.metaEvents).toBeUndefined();
    // A phone's milestones are the SDK's to send, never the server's.
    expect(events()).toHaveLength(0);
  });

  it("an old account is handed nothing", async () => {
    who.user = { id: "phone-old", email: "old@example.com", createdAt: "2025-01-01T00:00:00Z" };
    const res = (await app.inject({
      method: "POST", url: "/v1/app/bootstrap",
      payload: { capabilities: { platform: "ios", device: { keyboardReady: true } } },
    })).json() as { metaEvents?: unknown };
    expect(res.metaEvents).toBeUndefined();
  });

  it("a desktop account's sign-up and first dictation go from the server, once", async () => {
    who.user = { id: "desk-new", email: "desk@example.com", createdAt: new Date(Date.now() - HOUR).toISOString() };
    const ua = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Electron/38.0.0 Safari/537.36";
    const boot = await app.inject({
      method: "POST", url: "/v1/app/bootstrap", headers: { "user-agent": ua },
      payload: { capabilities: { platform: "ios", device: { formFactor: "desktop" } } },
    });
    expect((boot.json() as { metaEvents?: unknown }).metaEvents).toBeUndefined();
    await vi.waitFor(() => expect(events().map((e) => e.event_name)).toEqual(["CompleteRegistration"]));

    sent.mockClear();
    const dictate = () => app.inject({ method: "POST", url: "/v1/refine", headers: { "user-agent": ua }, payload: { text: "hello there" } });
    expect((await dictate()).statusCode).toBe(200);
    await vi.waitFor(() => expect(events().map((e) => e.event_name)).toEqual(["FirstDictation"]));
    const [ev] = events();
    expect(ev).toMatchObject({ event_id: "firstDictation:desk-new", action_source: "website", user_data: { em: [sha("desk@example.com")], client_user_agent: ua } });
    // Not a word of the dictation goes.
    expect(JSON.stringify(ev)).not.toContain("hello");

    sent.mockClear();
    expect((await dictate()).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(events()).toHaveLength(0);
  });

  it("a client cannot reset what has been reported", async () => {
    who.user = { id: "desk-new", email: "desk@example.com", createdAt: new Date(Date.now() - HOUR).toISOString() };
    const put = await app.inject({ method: "PUT", url: "/v1/personality", payload: { adsReported: {} } });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { personality: { adsReported?: Record<string, string> } }).personality.adsReported)
      .toMatchObject({ registration: expect.any(String), firstDictation: expect.any(String) });
  });

  it("the pages the server renders load the pixel, the pay page does not, and the policy says so", async () => {
    expect((await app.inject({ method: "GET", url: "/download" })).body).toContain('src="/site-events.js"');
    expect(siteShell({ title: "Subscribe", main: "", pixel: false })).not.toContain("site-events.js");
    expect((await app.inject({ method: "GET", url: "/privacy" })).body).toContain("Meta Platforms");
  });

  it("the same pages carry Google Tag Manager, high in the head and first in the body; the pay page does not", async () => {
    const page = (await app.inject({ method: "GET", url: "/download" })).body;
    const head = page.indexOf("<!-- Google Tag Manager -->"), body = page.indexOf("<!-- Google Tag Manager (noscript) -->");
    expect(head).toBeGreaterThan(page.indexOf('<meta charset="utf-8">'));
    expect(head).toBeLessThan(page.indexOf("<title>"));
    expect(page).toContain("'dataLayer','GTM-KH975V6M'");
    expect(body).toBe(page.indexOf("<body>") + "<body>\n".length);
    expect(page).toContain("https://www.googletagmanager.com/ns.html?id=GTM-KH975V6M");
    expect(siteShell({ title: "Subscribe", main: "", pixel: false })).not.toContain("googletagmanager");
  });
});
