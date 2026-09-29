import { describe, expect, it } from "vitest";
import Fastify from "fastify";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { registerSeoRoutes } from "../src/routes/seo.js";
// eslint-disable-next-line import/first
import { PAGED, LANGS, examplesFor, faqGroups, homeFaq, plans } from "../src/seo/facts.js";
// eslint-disable-next-line import/first
import { sitePages } from "../src/seo/machine.js";
// eslint-disable-next-line import/first
import { SITE_SHAPE, SITE_UI, PAYWALL_CONFIG } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { pricingHtml } from "../src/routes/policies/pricing.js";
// eslint-disable-next-line import/first
import { PRIVACY_POLICY_HTML } from "../src/routes/policies/privacy.js";
// eslint-disable-next-line import/first
import { TERMS_HTML } from "../src/routes/policies/terms.js";
// eslint-disable-next-line import/first
import { DOWNLOAD_PAGE_HTML } from "../src/routes/download.js";

// Search and answer engines judge a page on its head and its structured
// data, and quote single answers. These hold every page to one origin, one
// entity and facts that match what the page shows.

const app = Fastify();
registerSeoRoutes(app);
const get = async (url: string) => app.inject({ method: "GET", url });

const graphOf = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .flatMap((m) => JSON.parse(m[1])["@graph"] ?? []);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("every page a search engine can reach", () => {
  it("is in the sitemap, served, and canonical at tailzu.space", async () => {
    const res = await get("/sitemap.xml");
    expect(res.headers["content-type"]).toMatch(/xml/);
    for (const p of sitePages()) expect(res.body).toContain(`<loc>https://tailzu.space${p.path === "/" ? "/" : p.path}</loc>`);
    for (const path of ["/languages", "/faq", ...PAGED.map((l) => `/languages/${l.slug}`)]) {
      const page = await get(path);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(`<link rel="canonical" href="https://tailzu.space${path}">`);
      expect(page.body).toMatch(/<meta name="description" content="[^"]{50,170}">/);
      expect(page.body).toContain('property="og:image" content="https://tailzu.space/og.png"');
      expect(graphOf(page.body).length).toBeGreaterThan(1);   // parses, and says something
    }
  });

  it("the old policy and download pages carry the same head", () => {
    for (const [html, path] of [[PRIVACY_POLICY_HTML, "/privacy"], [TERMS_HTML, "/terms"], [DOWNLOAD_PAGE_HTML, "/download"]] as const) {
      expect(html).toContain(`<link rel="canonical" href="https://tailzu.space${path}">`);
      expect(graphOf(html).some((n: any) => n["@type"] === "BreadcrumbList")).toBe(true);
    }
  });

  it("one footer link in: the FAQ, and every language page is a tap from it", async () => {
    const faq = (await get("/faq")).body;
    const footer = faq.slice(faq.indexOf("<footer"));
    expect(footer).toContain('href="/faq"');
    expect(footer).not.toContain('href="/languages"');
    expect(faq).toContain('href="/languages"');
    for (const l of PAGED) expect(faq).toContain(`href="/languages/${l.slug}"`);
  });

  it("a language nobody wrote a page for goes to the list, not a 404", async () => {
    const res = await get("/languages/klingon");
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe("/languages");
  });
});

describe("what the pages claim is what the product says", () => {
  it("FAQ data matches the visible answers, word for word", async () => {
    const page = await get("/faq");
    const faq = graphOf(page.body).find((n: any) => n["@type"] === "FAQPage");
    const all = faqGroups().flatMap((g) => g.items);
    expect(faq.mainEntity).toHaveLength(all.length);
    const shown = text(page.body);
    for (const q of faq.mainEntity) {
      expect(shown).toContain(q.name);
      expect(shown).toContain(q.acceptedAnswer.text);
    }
  });

  it("every language page shows the site's own sentences for it, and only real ones", async () => {
    for (const l of PAGED) {
      const ex = examplesFor(l);
      expect(ex.length, l.name).toBeGreaterThan(0);
      const body = text((await get(`/languages/${l.slug}`)).body);
      for (const e of ex) {
        expect(body).toContain(e.wrote);
        const real = SITE_UI.cases.some((c) => c.wrote === e.wrote) || SITE_UI.apps.fields.some((f) => f.text === e.wrote);
        expect(real, e.wrote).toBe(true);
      }
    }
    // India's 22 scheduled languages, and Hinglish beside them.
    expect(LANGS.filter((l) => l.india && l.slug !== "hinglish")).toHaveLength(22);
  });

  it("prices come from the paywall and the allowance from the server", async () => {
    const p = plans();
    const llms = (await get("/llms.txt")).body;
    for (const plan of PAYWALL_CONFIG.plans.filter((x) => x.price)) expect(llms).toContain(plan.price!);
    expect(llms).toContain(`${p.freeWords.toLocaleString("en-US")} words a month`);
    const pricing = pricingHtml({ plans: PAYWALL_CONFIG.plans, freeWords: p.freeWords, earnMaxWords: p.earnWords, terms: "t", privacy: "p" });
    const app = graphOf(pricing).find((n: any) => n["@type"] === "SoftwareApplication");
    const want = ["0.00", ...PAYWALL_CONFIG.plans.filter((x) => x.price && !x.free).map((x) => Number(x.price!.replace(/[^0-9.]/g, "")).toFixed(2))];
    expect(app.offers.map((o: any) => Number(o.price).toFixed(2)).sort()).toEqual(want.sort());
    expect(app.aggregateRating).toBeUndefined();   // never a rating nobody gave
  });

  it("the home page's title is a search title, and its questions are the page's own", () => {
    expect(SITE_SHAPE.meta.title).toMatch(/Hindi/);
    expect(SITE_SHAPE.meta.title.length).toBeLessThanOrEqual(70);
    expect(homeFaq().map((q) => q.q)).toEqual(SITE_UI.faq.items.map((q) => q.q));
    expect(homeFaq().every((q) => !q.a.includes("{n}"))).toBe(true);
  });

  it("llms-full.txt carries every question and the privacy lines", async () => {
    const full = (await get("/llms-full.txt")).body;
    for (const g of faqGroups()) for (const it of g.items) expect(full).toContain(it.q);
    expect(full).toMatch(/deleted right after/);
  });

  it("the API host never ranks for what it proxies", async () => {
    const r = (await get("/robots.txt")).body;
    expect(r).toMatch(/^Disallow: \/$/m);
    expect(r).toMatch(/^Allow: \/\.well-known\/$/m);
  });
});
