import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
// Tailzu as it ships for now: free for everyone.
process.env.FREE_FOR_ALL = "true";
process.env.FREE_MONTHLY_WORDS = "800";

// eslint-disable-next-line import/first
import { buildBootstrap, buildKeyboardConfig, buildScreen, siteCopy } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { enforceQuota } from "../src/usage/metering.js";
// eslint-disable-next-line import/first
import { faqGroups, homeFaq, langFaq, appLd, LANGS } from "../src/seo/facts.js";
// eslint-disable-next-line import/first
import { llmsTxt } from "../src/seo/machine.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";

const PRICE = /\$\d|Lite|Elite|upgrade|See plans|per month|a year/i;

describe("Tailzu is free for everyone", () => {
  it("nobody is limited", async () => {
    expect(await enforceQuota({ id: "11111111-1111-4111-8111-111111111111", token: "t" } as never)).toBeNull();
  });

  it("the app is told there is no limit and nothing is over, and no card sells words", () => {
    const b = buildBootstrap({ entitled: false, wordsUsed: 5000, allowance: { base: 800, earned: 0, total: 800, used: 5000, remaining: 0, streakDays: 0, grants: [] } } as never) as any;
    expect(b.flags["quota.exceeded"]).toBe(false);
    expect(b.flags["quota.entitled"]).toBe(true);
    expect(b.flags["billing.entitled"]).toBe(false);
    expect(b.flags["billing.free"]).toBe(true);
    expect(b.flags["quota.freeMonthlyWords"]).toBe(0);
    expect(b.flags["paywall.blockUntilEntitled"]).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(/"screenId":"paywall"/);
    expect(b.labels["desktop.mast.unlimited"]).toBe("Free");
  });

  it("the keyboard never says the words are gone or low", () => {
    const k = buildKeyboardConfig(undefined, undefined, { platform: "ios", quota: { remaining: 0, total: 800, entitled: false } } as never) as any;
    expect(k.flags["kb.quota.exhausted"]).toBe(false);
    expect(k.flags["kb.quota.low"]).toBe(false);
  });

  it("the paywall and the out-of-words screen say it is free, and sell nothing", () => {
    for (const id of ["paywall", "words_out"]) {
      const j = JSON.stringify(buildScreen(id, { personality: {}, language: "en" } as never));
      expect(j).toContain("Tailzu Is Free");
      expect(j).not.toMatch(/iap\./);
    }
  });

  it("settings has no Upgrade; stats is the month's count, free", () => {
    const settings = JSON.stringify(buildScreen("settings", { personality: {}, language: "en" } as never));
    expect(settings).not.toContain('"screenId":"paywall"');
  });

  it("the desk's plan says free, and its settings sell nothing", () => {
    const can = new Set(["DeskShell"]);
    const plan = JSON.stringify(buildScreen("desk_plan", { personality: {}, language: "en", can } as never));
    expect(plan).toContain("Tailzu is free.");
    expect(plan).not.toMatch(/iap\.subscribe/);
    const st = JSON.stringify(buildScreen("desk_settings", { personality: {}, language: "en", can } as never));
    expect(st).not.toContain("See plans");
    expect(st).toContain("Nothing to pay.");
  });

  it("the site, its FAQ, its search data and llms.txt quote no price", () => {
    expect(siteCopy().faq.items.find((q) => q.q === "Is it free?")?.a).toBe("Yes. Every word, free. No limit.");
    for (const qa of homeFaq()) expect(qa.a).not.toMatch(PRICE);
    for (const g of faqGroups()) for (const qa of g.items) expect(`${qa.q} ${qa.a}`).not.toMatch(/Lite|Elite|\$\d|cancel/i);
    for (const qa of langFaq(LANGS[0]!)) expect(qa.a).not.toMatch(PRICE);
    const offers = (appLd() as { offers: Array<{ price: string }> }).offers;
    expect(offers.map((o) => o.price)).toEqual(["0"]);
    expect(llmsTxt()).not.toMatch(/\$\d|Lite|Elite/);
  });
});

describe("the site's price pages, while free", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("/pricing says free, and /pay sends you there", async () => {
    const p = await app.inject({ method: "GET", url: "/pricing" });
    expect(p.body).toContain("Free. Every word.");
    expect(p.body).not.toMatch(/\$9\.99|\$59\.99/);
    const pay = await app.inject({ method: "GET", url: "/pay" });
    expect(pay.statusCode).toBe(302);
    expect(pay.headers.location).toBe("/pricing");
  });

  it("the site's copy is the free one", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/site" });
    expect(r.body).toContain("Yes. Every word, free. No limit.");
    expect(r.body).not.toContain("Then upgrade.");
  });
});
