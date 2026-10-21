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
import { PAGED, LANGS, DEFINITION, appLd, examplesFor, faqGroups, filmLd, homeFaq, homeFilms, plans } from "../src/seo/facts.js";
import { LANDING_PATHS, landings } from "../src/seo/landing.js";
// eslint-disable-next-line import/first
import { llmsFullTxt, llmsTxt, sitePages } from "../src/seo/machine.js";
// eslint-disable-next-line import/first
import { SITE_LAYOUT_REDESIGN, SITE_SHAPE, SITE_UI, PAYWALL_CONFIG, siteCopy } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { filmProblems, headHtml, langsLines, lineLang, siteCopyLines, syncHome, titleHtml } from "../src/seo/home.js";
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
    for (const path of ["/languages", "/faq", ...LANDING_PATHS(), ...PAGED.map((l) => `/languages/${l.slug}`)]) {
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

  it("one footer link in: the FAQ, and every language page two taps from it", async () => {
    // Every language has a page now (74 of them), so the FAQ links the list
    // and the best-known, and the list links every one.
    const faq = (await get("/faq")).body;
    const footer = faq.slice(faq.indexOf("<footer"));
    expect(footer).toContain('href="/faq"');
    expect(footer).not.toContain('href="/languages"');
    expect(faq).toContain('href="/languages"');
    const hub = (await get("/languages")).body;
    for (const l of PAGED) expect(hub).toContain(`href="/languages/${l.slug}"`);
    // And the search pages are a tap from it.
    for (const p of LANDING_PATHS()) expect(faq).toContain(`href="${p}"`);
  });

  it("the search pages answer their search: their words in the title, the heading and the questions", async () => {
    for (const p of landings()) {
      const body = (await get(p.path)).body;
      expect(body).toContain(`<title>${p.headTitle.replace(/&/g, "&amp;")}</title>`);
      expect(p.headTitle.length, p.path).toBeLessThanOrEqual(70);
      expect(graphOf(body).some((n: any) => n["@type"] === "FAQPage")).toBe(true);
      // Every example is a sentence the site already shows.
      for (const e of p.examples) {
        const real = SITE_UI.cases.some((c) => c.wrote === e.wrote) || SITE_UI.apps.fields.some((f) => f.text === e.wrote)
          || SITE_UI.llm.prompts.some((x) => x.wrote === e.wrote) || SITE_UI.dev.wrote === e.wrote;
        expect(real, e.wrote).toBe(true);
      }
    }
    expect((await get("/ai-keyboard")).body).toMatch(/AI keyboard/i);
    expect((await get("/voice-typing")).body).toMatch(/speech to text/i);
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
    // Every language has a page; the ones the site has sentences for show
    // them, and none shows a sentence the site does not.
    expect(PAGED).toHaveLength(LANGS.length);
    expect(PAGED.filter((l) => examplesFor(l).length > 0).length).toBeGreaterThan(30);
    for (const l of PAGED) {
      const ex = examplesFor(l);
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
    expect(SITE_SHAPE.meta.title).toMatch(/AI Keyboard/);
    // The count it states is the count there is.
    const stated = Number(SITE_SHAPE.meta.description.match(/any of (\d+) languages/)?.[1]);
    expect(stated).toBe(LANGS.filter((l) => l.slug !== "hinglish").length);
    expect(SITE_SHAPE.meta.title.length).toBeLessThanOrEqual(70);
    expect(homeFaq().map((q) => q.q)).toEqual(SITE_UI.faq.items.map((q) => q.q));
    expect(homeFaq().every((q) => !q.a.includes("{n}"))).toBe(true);
  });

  it("Windows is the Microsoft-certified build wherever the downloads are named", async () => {
    // The signed, self-updating copy: its direct download is what a link
    // gives, and the Store listing is what identifies the app.
    const dl = SITE_UI.stores.windowsInstaller, listing = SITE_UI.stores.windows;
    expect(dl).toMatch(/^https:\/\/get\.microsoft\.com\/installer\/download\/9[0-9A-Z]{11}\?/);
    expect(listing).toMatch(/^https:\/\/apps\.microsoft\.com\/detail\/9[0-9a-z]{11}$/);
    expect((await get("/llms.txt")).body).toContain(`[Windows (Microsoft-certified download)](${dl})`);
    expect((await get("/llms-full.txt")).body).toContain(`Windows: ${dl}`);
    const pricing = pricingHtml({ plans: PAYWALL_CONFIG.plans, freeWords: 0, earnMaxWords: 0, terms: "t", privacy: "p" });
    const app = graphOf(pricing).find((n: any) => n["@type"] === "SoftwareApplication");
    expect(app.downloadUrl).toContain(dl);
    for (const k of ["installUrl", "sameAs"]) expect(app[k], k).toContain(listing);
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

describe("nothing interpolated can break the markup", () => {
  it("keeps every '<' in structured data out of the HTML parser's sight", async () => {
    const { ldScript } = await import("../src/seo/head.js");
    const hostile = "</script><script>alert(1)</script><!--";
    const tag = ldScript([{ "@type": "Thing", name: hostile }]);
    const body = tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("</script>"));
    expect(body).not.toContain("<");
    expect(JSON.parse(body)["@graph"][0].name).toBe(hostile);
  });

  it("puts only URL-safe slugs and codes where they go unescaped", () => {
    for (const l of LANGS) {
      expect(l.slug, l.name).toMatch(/^[a-z0-9-]+$/);
      expect(l.code, l.name).toMatch(/^[A-Za-z0-9-]+$/);
    }
    for (const p of sitePages()) expect(p.path).toMatch(/^\/[a-z0-9/-]*$/);
  });
});

describe("the redesigned home page, as a crawler reads it", () => {
  // A page shaped like the redesign's: the six markers it always had, and
  // the four that came with it, holding whatever a builder left there.
  const page = (extra = true) => [
    "<!doctype html><html><head>",
    "<!-- SEO:HEAD — written by sync-site -->",
    "<title>by hand</title>",
    "<!-- /SEO:HEAD -->",
    "</head><body><main>",
    ...(extra ? [
      "  <div class=\"copy\">",
      "    <!-- SEO:hero -->",
      "    <h1 id=\"appsTitle\">by hand</h1>",
      "    <!-- /SEO:hero -->",
      "    <!-- SEO:line --><p>by hand</p><!-- /SEO:line -->",
      "  </div>",
      "  <nav id=\"langs\">",
      "    <!-- SEO:langs -->",
      "    <!-- /SEO:langs -->",
      "  </nav>",
    ] : []),
    "<div id=\"steps\"><!-- SEO:steps --><!-- /SEO:steps --></div>",
    "<p id=\"toneSaid\"><!-- SEO:toneSaid -->x<!-- /SEO:toneSaid --></p>",
    "<div id=\"toneGrid\"><!-- SEO:toneGrid --><!-- /SEO:toneGrid --></div>",
    "<div id=\"faq\"><!-- SEO:faq --><!-- /SEO:faq --></div>",
    "</main><script>",
    "  var C = {",
    ...(extra ? ["    // SEO:siteCopy — every SITE_UI key but faq", "    apps: { title: \"by hand\" },", "    // /SEO:siteCopy"] : []),
    "    // SEO:faqCopy — written by sync-site",
    "    // /SEO:faqCopy",
    "  };",
    "</script></body></html>",
  ].join("\n");
  const graph = (html: string) => graphOf(html.replace(/\\u003c/g, "<"));

  it("names Linux wherever the facts name the platforms", async () => {
    expect(DEFINITION).toContain("Windows, Mac and Linux");
    const app = appLd() as { operatingSystem: string; availableOnDevice: string; featureList: string[] };
    expect(app.operatingSystem).toBe("iOS, Android, Windows, macOS, Linux");
    expect(app.availableOnDevice).toContain("Linux");
    expect(app.featureList.some((f) => f.startsWith("Desktop app for Windows, Mac and Linux"))).toBe(true);
    expect(llmsTxt()).toContain("On Windows, Mac and Linux, tap Ctrl twice");
    expect(llmsTxt()).toContain("Windows, Mac and Linux apps");
    expect(llmsTxt()).toContain("- [Linux](https://tailzu.space/download)");
    expect(llmsFullTxt()).toContain("Linux: https://tailzu.space/download");
    expect(llmsFullTxt()).toContain("A desktop app for Windows, Mac and Linux");
  });

  it("describes each film the page plays as a VideoObject a search engine can show", () => {
    const films = homeFilms();
    // Typed vs said (#how) and the reel, in the page's order.
    expect(films.map((f) => f.id)).toEqual(["typed-vs-said", ...SITE_UI.films.items.map((f) => f.id)]);
    for (const f of films) {
      const v = filmLd(f) as Record<string, any>;
      expect(v["@type"]).toBe("VideoObject");
      expect(v.name.length, f.id).toBeGreaterThan(0);
      expect(v.description.length, f.id).toBeGreaterThan(0);
      expect(v.contentUrl).toMatch(/^https:\/\/tailzu\.space\/media\/[a-z0-9-]+\.mp4$/);
      expect(v.thumbnailUrl).toEqual([v.contentUrl.replace(/\.mp4$/, ".webp")]);
      expect(v.uploadDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.duration).toMatch(/^PT\d+(\.\d)?S$/);
      expect(v.publisher).toEqual({ "@id": "https://tailzu.space/#org" });
    }
    // The reel's words are the page's: one source for both.
    for (const it of SITE_UI.films.items) expect(films.find((f) => f.id === it.id)?.line).toBe(it.line);
    // Only a page that has the films says it has them.
    expect(graph(headHtml(true)).filter((n: any) => n["@type"] === "VideoObject")).toHaveLength(films.length);
    expect(graph(headHtml(false)).some((n: any) => n["@type"] === "VideoObject")).toBe(false);
  });

  it("holds each film's data to the file the site publishes", () => {
    const films = homeFilms();
    const cuts = Object.fromEntries(films.map((f) => [f.id, { file: `${f.file}.mp4`, dur: f.seconds }]));
    const all = () => true;
    expect(filmProblems({ media: cuts }, all)).toEqual([]);
    // No manifest: only the files are checked.
    expect(filmProblems(null, all)).toEqual([]);
    // A missing poster, a cut the manifest lacks, a re-cut of another length.
    const [a, b, c] = films;
    expect(filmProblems(null, (f) => f !== `${a!.file}.webp`)).toEqual([`media/${a!.file}.webp is missing`]);
    const { [b!.id]: _gone, ...fewer } = cuts;
    expect(filmProblems({ media: fewer }, all)).toEqual([`media/manifest.json has no ${b!.file}.mp4`]);
    const longer = { ...cuts, [c!.id]: { file: `${c!.file}.mp4`, dur: c!.seconds + 1 } };
    expect(filmProblems({ media: longer }, all)).toHaveLength(1);
    expect(filmProblems({ media: longer }, all)[0]).toMatch(new RegExp(`^${c!.id}: `));
  });

  it("links every language page from the home page, in the list's order", () => {
    const links = langsLines();
    const slugs = links.map((l) => /href="\/languages\/([a-z0-9-]+)"/.exec(l)?.[1]);
    expect(slugs).toEqual(LANGS.map((l) => l.slug));
    expect(links).toHaveLength(75);
    for (const [i, l] of LANGS.entries()) {
      expect(links[i]).toContain(`lang="${l.code}"`);
      expect(links[i]).toContain(`<span class="ln">${l.native}</span>`);
    }
    expect(links[0]).toBe('<a class="lang" href="/languages/hindi" lang="hi"><span class="ln">हिन्दी</span> <span class="le" lang="en">Hindi</span></a>');
  });

  it("describes the link card by the line it shows", async () => {
    // og.png (both the card before the redesign and its own) draws the
    // hero's first line said and written; its alt quotes that pair, so a
    // new first line means a new card and a new alt, together.
    const { OG_IMAGE } = await import("../src/seo/head.js");
    expect(OG_IMAGE.alt).toContain(`“${SITE_UI.lines[0].said}”`);
    expect(OG_IMAGE.alt).toContain(`“${SITE_UI.lines[0].wrote}”`);
    expect(headHtml(true)).toContain(`<meta property="og:image:alt" content="${OG_IMAGE.alt}">`);
  });

  it("writes the h1 as the page builds it", () => {
    expect(titleHtml("Talk instead of type.", "Talk")).toBe('<em>Talk</em> instead of <span class="kw">type</span>.');
    expect(titleHtml("Talk instead of type.")).toBe('Talk instead of <span class="kw">type</span>.');
    expect(titleHtml("A <b> & type?", "")).toBe('A &lt;b&gt; &amp; <span class="kw">type</span>?');
    expect(titleHtml("Talk.", "Talk.")).toBe("<em>Talk.</em>");
    expect(lineLang(SITE_UI.lines[0].said)).toBe("en");
    expect(lineLang(SITE_UI.lines[1].said)).toBe("hi");
    expect(lineLang(SITE_UI.lines[4].said)).toBe("ta");
  });

  it("fills every marker of the redesigned page, and a second run changes nothing", () => {
    const { html, redesigned } = syncHome(page());
    expect(redesigned).toBe(true);
    expect(html).not.toContain("by hand");
    expect(html).toContain(`    <!-- SEO:hero -->\n    <p class="kind" id="appsKind">${SITE_UI.apps.kind}</p>\n    <h1 id="appsTitle"><em>Talk</em> instead of <span class="kw">type</span>.</h1>\n`);
    expect(html).toContain(`<p class="said" id="lineSaid" lang="en">${SITE_UI.lines[0].said}</p>`);
    expect(html).toContain(`<p class="note" id="lineNote">${SITE_UI.lines[0].note}</p>`);
    expect(html.match(/<a class="lang" /g)).toHaveLength(75);
    expect(html).toContain("    <!-- /SEO:langs -->");
    expect(syncHome(html).html).toBe(html);
    // The script's fallback is the server's copy, every key of it, and
    // nothing in it can end the script it sits in.
    const at = html.indexOf("<script>") + 8;
    const script = html.slice(at, html.indexOf("</script>", at));
    expect(script).not.toMatch(/<\/script|<!--/i);
    // eslint-disable-next-line no-new-func
    const C = new Function(`${script}; return C;`)();
    expect(C).toEqual(JSON.parse(JSON.stringify(siteCopy())));
    expect(siteCopyLines()).toHaveLength(Object.keys(siteCopy()).length - 1);
    // Its films are in its head.
    expect(graph(html).filter((n: any) => n["@type"] === "VideoObject")).toHaveLength(homeFilms().length);
  });

  it("fills the page from before the redesign exactly as it always did", () => {
    const { html, redesigned } = syncHome(page(false));
    expect(redesigned).toBe(false);
    expect(html).toContain('<div class="step"><p class="n">01</p><h3>You talk.</h3></div>');
    expect(html).not.toContain("appsKind");
    expect(html).not.toContain("SEO:siteCopy");
    expect(graph(html).some((n: any) => n["@type"] === "VideoObject")).toBe(false);
    expect(syncHome(html).html).toBe(html);
  });

  it("stops at a page that has only some of the redesign's markers", () => {
    expect(() => syncHome(page().replace("<!-- SEO:langs -->", ""))).toThrow(/marker not found: <!-- SEO:langs -->/);
    expect(() => syncHome(page().replace(/ *\/\/ SEO:siteCopy[^\n]*\n/, ""))).toThrow(/SEO:siteCopy/);
  });

  it("says nothing about Ask where crawlers read until it ships", async () => {
    const claims = [SITE_UI.ask.title, SITE_UI.ask.lede, SITE_UI.ask.soon];
    for (const surface of [headHtml(true), llmsTxt(), llmsFullTxt(), JSON.stringify(faqGroups()), JSON.stringify(homeFaq())]) {
      for (const claim of claims) expect(surface).not.toContain(claim);
    }
    // The static markup holds no Ask words; only the script's fallback does,
    // for the page to paint once the flag says so.
    const synced = syncHome(page()).html;
    expect(synced.slice(0, synced.indexOf("<script>"))).not.toContain(SITE_UI.ask.title);
  });

  it("has the redesign's order and grounds ready for when the page is live", () => {
    // Today's layout stays until the page that knows these bands is live.
    expect(SITE_SHAPE.layout.order).toContain("river");
    const L = SITE_LAYOUT_REDESIGN;
    expect(L.order).toEqual(["how", "river", "apps", "films", "tone", "desk", "llm", "dev", "ask", "questions", "free"]);
    expect(L.order).not.toContain("hero");
    expect(L.hidden).toEqual([]);
    expect(Object.keys(L.bands).sort()).toEqual([...L.order].sort());
    for (const b of Object.values(L.bands)) expect(["on-ink", "on-violet", "on-indigo", "on-cream"]).toContain(b);
    // The theme gained new names and changed none of the old ones.
    expect(SITE_SHAPE.theme).toMatchObject({
      "field-hi": "#241C52", "field-lo": "#0F0B24", beige: "#CFC7BB", "rose-deep": "#A62B4B",
      ink: "#0F0D0B", white: "#F3E2C6", amber: "#E8A23C", violet: "#1C1640", indigo: "#2A2878",
    });
    expect(SITE_SHAPE.theme.code).toMatch(/^ui-monospace/);
  });
});
