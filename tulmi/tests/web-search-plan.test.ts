/**
 * THE SEARCH PLANNER (src/web/search/plan.ts) and the lists it reads (catalog.ts).
 *
 * What these hold down:
 *   - the rules, one table per intent: an error is quoted with its paths and
 *     numbers taken out, a package is found in "npm X", "X package", "install X",
 *     "X vs Y" and "best library for" are comparisons, "latest" and "changelog"
 *     are version news, an API name with a framework names that framework's docs
 *     host, "how do I" is a how-to, the rest is general;
 *   - the confidence: a rival of another kind takes some away, two that agree
 *     are merged, and the stack trace in "No module named 'requests'" is not a
 *     package question;
 *   - the queries are scrubbed: tokens, keys, JWTs, addresses' query strings and
 *     e-mail addresses never reach a plan, whoever wrote the query, and there are
 *     never more than three;
 *   - the model: asked only under 0.7, with a tiny JSON schema, its plan wins,
 *     a model that fails, is over budget or answers off-schema costs only
 *     certainty;
 *   - the documentation map.
 */
import { describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { cleanErrorLine, cleanQuestion, findIdentifiers, planByRules, planSearch, scrubQuery, PLAN_CONFIDENCE_MIN } = await import("../src/web/search/plan.js");
const { stableBlock } = await import("../src/principles/index.js");
const { CONTENT_FARMS, DOCS, docsFor, docsMatch, findDocsInText, isContentFarm, isIndexableHost, nameOf } = await import("../src/web/search/catalog.js");
type AskFn = import("../src/web/search/types.js").AskFn;
type PlanCtx = import("../src/web/search/types.js").PlanCtx;

// ------------------------------------------------------------------ the rules

interface Case {
  q: string;
  ctx?: PlanCtx;
  intent: string;
  /** Strings the first query must contain. */
  first?: string[];
  sources?: string[];
  site?: string;
  freshness?: string;
}

const REACT_TRACE = `TypeError: Cannot read properties of undefined (reading 'map')
    at App (/home/me/proj/src/App.tsx:12:5)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:16305:18)
    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:20074:13)`;

const PY_TRACE = `Traceback (most recent call last):
  File "/home/me/app.py", line 12, in <module>
    import requests
ModuleNotFoundError: No module named 'requests'`;

const RUST_ERR = `error[E0382]: borrow of moved value: \`v\`
 --> src/main.rs:5:20
  |
3 |     let v = vec![1];`;

const CASES: Case[] = [
  // error_fix
  { q: REACT_TRACE, intent: "error_fix", first: ["\"TypeError: Cannot read properties of undefined (reading 'map')\""], sources: ["github", "stackoverflow"] },
  { q: PY_TRACE, intent: "error_fix", first: ["\"ModuleNotFoundError: No module named 'requests'\""] },
  { q: RUST_ERR, intent: "error_fix", first: ["error[E0382]: borrow of moved value"] },
  { q: "src/index.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.", intent: "error_fix", first: ["TS2345"] },
  { q: "Why do I get 'TypeError: x.map is not a function' in my React app?", intent: "error_fix", first: ["\"TypeError: x.map is not a function\""] },
  { q: "npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree", intent: "error_fix" },
  { q: "error: port 3000 already in use EADDRINUSE :::3000", intent: "error_fix", first: ["EADDRINUSE"] },
  // package_lookup
  { q: "npm install zod", intent: "package_lookup", first: ["zod"], sources: ["npm", "github"] },
  { q: "pip install requests", intent: "package_lookup", first: ["requests"], sources: ["pypi", "github"] },
  { q: "what does the serde crate do", intent: "package_lookup", first: ["serde"], sources: ["crates"] },
  { q: "install left-pad", intent: "package_lookup", first: ["left-pad"] },
  { q: "cargo add tokio", intent: "package_lookup", first: ["tokio"], sources: ["crates"] },
  { q: "the @tanstack/react-query package", intent: "package_lookup", first: ["@tanstack/react-query"], sources: ["npm"] },
  { q: "is there a pypi package called httpx", intent: "package_lookup", first: ["httpx"], sources: ["pypi"] },
  // compare_libs
  { q: "zod vs yup", intent: "compare_libs", first: ["zod vs yup"], sources: ["hn", "github"], freshness: "year" },
  { q: "Prisma versus Drizzle for a small app", intent: "compare_libs", first: ["Prisma vs Drizzle"] },
  { q: "best library for pdf generation in node", intent: "compare_libs", first: ["pdf generation in node"], freshness: "year" },
  { q: "alternatives to moment", intent: "compare_libs", first: ["moment alternatives"] },
  // version_news
  { q: "what's the latest version of next.js", intent: "version_news", site: "nextjs.org/docs", freshness: "month", sources: ["github", "hn"] },
  { q: "release notes for vite v6", intent: "version_news", site: "vite.dev" },
  { q: "changelog for tailwind 4", intent: "version_news", site: "tailwindcss.com/docs", freshness: "year" },
  { q: "what's new in python 3.13", intent: "version_news", site: "docs.python.org" },
  // api_docs
  { q: "how to use useEffect cleanup in react", intent: "api_docs", first: ["react useEffect"], site: "react.dev", sources: ["mdn", "stackoverflow"] },
  { q: "fs.readFile options", ctx: { framework: "node" }, intent: "api_docs", first: ["fs.readFile"], site: "nodejs.org/api" },
  { q: "Array.prototype.map thisArg", ctx: { languages: ["typescript"] }, intent: "api_docs", first: ["Array.prototype.map"], site: "developer.mozilla.org" },
  { q: "how do I use satisfies in a type", ctx: { languages: ["typescript"] }, intent: "how_to", site: "typescriptlang.org" },
  { q: "what does os.path.join return", ctx: { languages: ["python"] }, intent: "api_docs", site: "docs.python.org" },
  { q: "`getServerSideProps` params", ctx: { framework: "next" }, intent: "api_docs", site: "nextjs.org/docs" },
  // how_to
  { q: "how do I center a div", intent: "how_to", first: ["center a div"], sources: ["stackoverflow"] },
  { q: "how to parse a CSV file in python", ctx: { languages: ["python"] }, intent: "how_to", first: ["parse a CSV file in python"] },
  { q: "how do I install node on ubuntu", intent: "how_to" },
];

describe("the rules", () => {
  for (const c of CASES) {
    it(`${c.intent}: ${c.q.split("\n")[0]!.slice(0, 70)}`, () => {
      const p = planByRules(c.q, c.ctx);
      expect(p.intent).toBe(c.intent);
      expect(p.confidence).toBeGreaterThanOrEqual(PLAN_CONFIDENCE_MIN);
      expect(p.queries.length).toBeGreaterThanOrEqual(1);
      expect(p.queries.length).toBeLessThanOrEqual(3);
      for (const part of c.first ?? []) expect(p.queries[0], part).toContain(part);
      for (const s of c.sources ?? []) expect(p.sources, s).toContain(s);
      if (c.site) expect(p.site, "site").toContain(c.site);
      if (c.freshness) expect(p.freshness).toBe(c.freshness);
    });
  }

  it("falls to general, unsure, for everything else", () => {
    for (const q of ["explain closures", "why is my app slow", "what is a monad"]) {
      const p = planByRules(q);
      expect(p.intent, q).toBe("general");
      expect(p.confidence, q).toBeLessThan(PLAN_CONFIDENCE_MIN);
      expect(p.queries[0]).toBe(q);
    }
  });

  it("never plans more than three queries, and every plan names a source", () => {
    for (const c of CASES) {
      const p = planByRules(c.q, c.ctx);
      expect(p.queries.length).toBeLessThanOrEqual(3);
      expect(p.sources.length).toBeGreaterThan(0);
    }
    expect(planByRules("").queries.length).toBe(1);
  });
});

describe("errors", () => {
  it("quote the line that names the error, without the asker's paths or numbers", () => {
    const p = planByRules(REACT_TRACE, { framework: "react" });
    expect(p.queries[0]).toBe("\"TypeError: Cannot read properties of undefined (reading 'map')\"");
    expect(p.queries[1]).toBe("TypeError: Cannot read properties of undefined (reading 'map') react");
    // the library the trace passed through is the third query
    expect(p.queries[2]).toContain("react-dom");
    for (const q of p.queries) expect(q).not.toMatch(/\/home\/me|App\.tsx|\d{2,}/);
  });

  it("take a Python error from the end of its traceback", () => {
    expect(planByRules(PY_TRACE).queries[0]).toBe("\"ModuleNotFoundError: No module named 'requests'\"");
  });

  it("keep a compiler's own code (TS2345) and take out the numbers beside it", () => {
    const clean = cleanErrorLine("error TS2345: Argument of type 'string' is not assignable at src/a.ts:12:5 on port 3000 0xdeadbeef");
    expect(clean).toContain("TS2345");
    expect(clean).not.toMatch(/src\/a\.ts|12:5|3000|deadbeef/);
    expect(cleanErrorLine("Error: ENOENT: no such file or directory, open 'C:\\Users\\me\\x.txt'")).not.toMatch(/Users|x\.txt/);
    expect(cleanErrorLine("Uncaught TypeError: x is not a function")).toBe("TypeError: x is not a function");
    expect(cleanErrorLine(`Failed 3 times in 4521ms at ${"a".repeat(30)}/b.js:1:2`)).not.toMatch(/\d/);
  });

  it("are not made into a package question by the word module, or a how-to by the question around them", () => {
    const p = planByRules(PY_TRACE);
    expect(p.intent).toBe("error_fix");
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
    expect(planByRules("how do I fix: TypeError: undefined is not a function").intent).toBe("error_fix");
  });

  it("add the project's framework to the second query", () => {
    expect(planByRules("ReferenceError: window is not defined", { framework: "next" }).queries[1]).toBe("ReferenceError: window is not defined next");
  });

  it("need a shape, not only a word: 'an error handling guide' is a guess, and a model decides", () => {
    expect(planByRules("write an error handling guide for express").confidence).toBeLessThan(PLAN_CONFIDENCE_MIN);
  });
});

describe("packages", () => {
  it("pick the registry from the words, then from the project, then try all three", () => {
    expect(planByRules("npm install zod").sources.slice(0, 1)).toEqual(["npm"]);
    expect(planByRules("pip install requests").sources.slice(0, 1)).toEqual(["pypi"]);
    expect(planByRules("install httpx", { languages: ["python"] }).sources).toEqual(["pypi", "github"]);
    expect(planByRules("install tokio", { languages: ["rust"] }).sources).toEqual(["crates", "github"]);
    expect(planByRules("install left-pad").sources).toEqual(["npm", "pypi", "crates", "github"]);
  });

  it("are not found in verbs or filler: npm run build, install it, a package for X", () => {
    expect(planByRules("npm run build fails").intent).not.toBe("package_lookup");
    expect(planByRules("which package should I use for dates").intent).not.toBe("package_lookup");
    expect(planByRules("how do I install it").intent).not.toBe("package_lookup");
  });

  it("lose a little to a how-to that names a package", () => {
    const p = planByRules("how do I use the zod package to validate forms");
    expect(p.intent).toBe("how_to");
  });
});

describe("comparisons and news", () => {
  it("take the two names around vs, and ask the places people argue about it, not the registries", () => {
    const p = planByRules("is zod vs yup still a thing?");
    expect(p.intent).toBe("compare_libs");
    expect(p.queries.slice(0, 2)).toEqual(["zod vs yup", "zod vs yup comparison"]);
    expect(p.sources).toEqual(["hn", "github"]);
    expect(planByRules("best library for pdf generation in node").sources).toEqual(["hn", "github"]);
  });

  it("name the project's docs for news about its framework", () => {
    const p = planByRules("what changed in the latest release", { framework: "react" });
    expect(p.intent).toBe("version_news");
    expect(p.site).toEqual(["react.dev"]);
  });

  it("weigh a bare 'v18' lightly, an error with a version in it not at all", () => {
    expect(planByRules("something about v18").confidence).toBeLessThan(PLAN_CONFIDENCE_MIN);
    expect(planByRules("TypeError: x is not a function (node v18.2.0)").intent).toBe("error_fix");
  });
});

describe("api names", () => {
  it("are found as dotted names, hooks, camelCase, backticks and calls, but not file names or brands", () => {
    expect(findIdentifiers("how does Promise.all differ from allSettled")).toEqual(["Promise.all", "allSettled"]);
    expect(findIdentifiers("what does useMemo do, and `foo_bar` and os.path.join() and len()")).toEqual(expect.arrayContaining(["useMemo", "foo_bar", "os.path.join", "len"]));
    expect(findIdentifiers("edit package.json and index.ts and example.com on my iPhone with JavaScript")).toEqual([]);
    expect(findIdentifiers("version 3.12.1")).toEqual([]);
    // the thing asked about before a parameter the question names
    expect(findIdentifiers("What does the thisArg parameter of Array.prototype.map do?")).toEqual(["Array.prototype.map", "thisArg"]);
    expect(planByRules("What does the thisArg parameter of Array.prototype.map do?").queries[0]).toBe("Array.prototype.map");
  });

  it("name the framework from the question first, then ctx.framework, then a dependency, then the language", () => {
    expect(planByRules("what does useState return in react", { framework: "vue" }).site).toEqual(["react.dev"]);
    expect(planByRules("what does useState return", { framework: "react" }).site).toEqual(["react.dev"]);
    expect(planByRules("what does useState return", { deps: ["lodash", "react"] }).site).toEqual(["react.dev"]);
    expect(planByRules("what does os.path.join return", { languages: ["python"] }).site).toEqual(["docs.python.org"]);
  });

  it("know a standard library or platform name without being told: Array.map is JavaScript's, os.path is Python's, fs is Node's", () => {
    const js = planByRules("What does the thisArg parameter of Array.prototype.map do?");
    expect(js.intent).toBe("api_docs");
    expect(js.confidence).toBeGreaterThanOrEqual(PLAN_CONFIDENCE_MIN);
    expect(js.site).toEqual(["developer.mozilla.org"]);
    expect(js.sources).toEqual(["mdn", "stackoverflow"]);
    expect(planByRules("JSON.parse reviver argument").site).toEqual(["developer.mozilla.org"]);
    expect(planByRules("how does document.querySelector treat commas").site).toEqual(["developer.mozilla.org"]);
    expect(planByRules("what does os.path.join do with an absolute second part").site).toEqual(["docs.python.org"]);
    expect(planByRules("what does itertools.groupby return").site).toEqual(["docs.python.org"]);
    expect(planByRules("fs.readFile options").site).toEqual(["nodejs.org/api", "nodejs.org/docs"]);
    // the name wins over the project's language, and a name both share goes to the project's
    expect(planByRules("what does os.path.join do", { languages: ["typescript"] }).site).toEqual(["docs.python.org"]);
    expect(planByRules("what does itertools.groupby return", { languages: ["typescript"] }).site).toEqual(["docs.python.org"]);
    expect(planByRules("what does os.cpus return").site).toEqual(["nodejs.org/api", "nodejs.org/docs"]);
    expect(planByRules("what does os.cpus return", { languages: ["python"] }).site).toEqual(["docs.python.org"]);
    // an explicit framework still comes first
    expect(planByRules("what does Array.map do", { framework: "react" }).site).toEqual(["react.dev"]);
  });

  it("fall to a lower confidence when there is a name and no framework to tie it to", () => {
    const p = planByRules("what does frobnicate() do");
    expect(p.confidence).toBeLessThan(PLAN_CONFIDENCE_MIN);
  });

  it("are merged with a how-to about them, not marked down for it", () => {
    const p = planByRules("how do I use useEffect cleanup in react");
    expect(p.intent).toBe("api_docs");
    expect(p.confidence).toBeGreaterThanOrEqual(0.85);
    expect(p.sources).toEqual(expect.arrayContaining(["mdn", "stackoverflow"]));
  });
});

describe("a rival of another kind", () => {
  it("takes confidence away when it is about as likely", () => {
    // 'latest' and 'compare' are both there
    const p = planByRules("compare the latest versions of express and fastify");
    expect(["compare_libs", "version_news"]).toContain(p.intent);
    expect(p.confidence).toBeLessThan(0.85);
  });
});

// ------------------------------------------------------------------ scrubbing

describe("scrubbing", () => {
  const SECRETS = [
    "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
    "sk-" + "proj_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "AKIA" + "ABCDEFGHIJKLMNOP",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    "xoxb-" + "1234567890-abcdefghij",
  ];

  it("removes keys, tokens, JWTs, bearer headers, key=value pairs, e-mail addresses and long opaque strings", () => {
    for (const s of SECRETS) expect(scrubQuery(`why does this fail ${s} when I call it`), s).toBe("why does this fail when I call it");
    expect(scrubQuery("curl -H 'Authorization: Bearer abcdef1234567890abcdef' x")).not.toContain("abcdef1234567890");
    expect(scrubQuery("fails with password=hunter2 and api_key: abc123")).toBe("fails with and");
    expect(scrubQuery("mail me at jane.doe+x@example.com about it")).toBe("mail me at about it");
    expect(scrubQuery(`token ${"9f8e7d6c5b4a39281706f5e4d3c2b1a0"} found`)).not.toContain("9f8e7d6c5b4a");
  });

  it("leaves identifiers, versions and ordinary long words alone", () => {
    for (const s of ["useSyncExternalStoreWithSelector", "getServerSidePropsWithSomethingElseVeryLongIndeed", "node 18.2.0 on ubuntu 22.04", "supercalifragilisticexpialidocious"]) {
      expect(scrubQuery(s)).toBe(s);
    }
  });

  it("keeps an address's host and path and drops its query, fragment and password", () => {
    expect(scrubQuery("see https://user:pw@example.com/docs/page?token=SECRET&x=1#frag please")).toBe("see example.com/docs/page please");
  });

  it("is applied to every query of every plan", () => {
    const p = planByRules(`npm ERR! code E401 with token=${SECRETS[0]} and Authorization: Bearer ${"a".repeat(40)}`);
    for (const q of p.queries) {
      for (const s of SECRETS) expect(q).not.toContain(s);
      expect(q).not.toMatch(/token=|Bearer/);
    }
    const q = planByRules(`how do I fix https://example.com/api?key=${SECRETS[1]} returning 401`).queries.join(" ");
    expect(q).not.toContain(SECRETS[1]);
    expect(q).toContain("example.com/api");
  });

  it("cleans a question of politeness", () => {
    expect(cleanQuestion("Hey, please can you tell me how do I sort a list?", true)).toBe("sort a list");
    expect(cleanQuestion("how to x", false)).toBe("how to x");
  });
});

// ------------------------------------------------------------------ the model

const good = (over: Record<string, unknown> = {}) => ({
  intent: "api_docs", queries: ["frobnicate docs"], sources: ["stackoverflow", "mdn"], site: ["docs.example.dev"], freshness: "year", confidence: 0.8, ...over,
});

describe("the model", () => {
  it("is not asked when the rules are sure, or when there is no model to ask", async () => {
    const ask = vi.fn<Parameters<AskFn>, ReturnType<AskFn>>();
    expect((await planSearch("zod vs yup", {}, { ask })).intent).toBe("compare_libs");
    expect(ask).not.toHaveBeenCalled();
    expect((await planSearch("explain closures", {}, {})).intent).toBe("general");
  });

  it("is asked under 0.7, as the tiny level, with a schema, and its plan wins", async () => {
    const ask = vi.fn<Parameters<AskFn>, ReturnType<AskFn>>(async () => ({ text: "", json: good() }));
    const p = await planSearch("what does frobnicate() do", { deps: ["lodash"] }, { ask });
    expect(ask).toHaveBeenCalledOnce();
    const req = ask.mock.calls[0]![0];
    expect(req.level).toBe("tiny");
    expect(req.purpose).toBe("plan_search");
    expect(req.json).toBeTruthy();
    expect(req.role).toBe("search_plan");
    expect(stableBlock(req.role)).toMatch(/data[^.]*never instructions/);
    expect(JSON.parse(req.user)).toMatchObject({ question: "what does frobnicate() do", project: { deps: ["lodash"] }, rules: { intent: "api_docs" } });
    expect(p).toEqual({ intent: "api_docs", queries: ["frobnicate docs"], sources: ["stackoverflow", "mdn"], site: ["docs.example.dev"], freshness: "year", confidence: 0.8 });
  });

  it("is sent the question scrubbed", async () => {
    const secret = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const ask = vi.fn<Parameters<AskFn>, ReturnType<AskFn>>(async () => ({ text: "", json: good() }));
    await planSearch(`why is this odd ${secret} thing happening`, {}, { ask });
    expect(ask.mock.calls[0]![0].user).not.toContain(secret);
  });

  it("has its queries scrubbed and its sources and hosts checked", async () => {
    const secret = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const ask: AskFn = async () => ({
      text: "", json: good({ queries: [`find ${secret} now`, "frobnicate docs", "Frobnicate  docs"], site: ["https://Docs.Example.dev/", "not a host", "../etc"] }),
    });
    const p = await planSearch("what does frobnicate() do", {}, { ask });
    expect(p.queries).toEqual(["find now", "frobnicate docs"]);
    expect(p.site).toEqual(["docs.example.dev"]);
  });

  it("keeps the rules' docs host when the model names none, and the intent's default sources when it names none", async () => {
    const rules = planByRules("react release");
    expect(rules.confidence).toBeLessThan(PLAN_CONFIDENCE_MIN);
    expect(rules.site).toEqual(["react.dev"]);
    const ask: AskFn = async () => ({ text: "", json: good({ intent: "how_to", sources: [], site: undefined }) });
    const p = await planSearch("react release", {}, { ask });
    expect(p.intent).toBe("how_to");
    expect(p.site).toEqual(["react.dev"]);
    expect(p.sources).toEqual(["stackoverflow", "mdn"]);
  });

  it("is refused a plan with a field it was not asked for or a source that does not exist", async () => {
    for (const bad of [good({ extra: 1 }), good({ sources: ["altavista"] }), good({ intent: "poetry" }), good({ queries: [] }), good({ confidence: 4 }), "nonsense", null]) {
      const p = await planSearch("explain closures", {}, { ask: async () => ({ text: "", json: bad }) });
      expect(p.intent, JSON.stringify(bad)).toBe("general");
      expect(p.confidence).toBeLessThan(PLAN_CONFIDENCE_MIN);
    }
  });

  it("costs only certainty when it throws, times out or is over budget", async () => {
    const budget = Object.assign(new Error("over"), { code: "budget_exceeded" });
    for (const err of [new Error("down"), budget, Object.assign(new Error("x"), { name: "ModelUnavailable" })]) {
      const p = await planSearch("explain closures", {}, { ask: async () => { throw err; } });
      expect(p.intent).toBe("general");
      expect(p.queries).toEqual(["explain closures"]);
    }
  });

  it("clamps the confidence it reports", async () => {
    const p = await planSearch("explain closures", {}, { ask: async () => ({ text: "", json: good({ confidence: 1 }) }) });
    expect(p.confidence).toBe(0.9);
  });
});

// ------------------------------------------------------------ the documentation map

describe("the official documentation map", () => {
  it("has about fifty sites, each with a name, a host and no duplicate alias", () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(40);
    const aliases = new Set<string>();
    for (const d of DOCS) {
      expect(d.id).toBeTruthy();
      expect(d.hosts.length).toBeGreaterThan(0);
      for (const h of d.hosts) expect(h, d.id).toMatch(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/[\w./-]+)?$/);
      for (const a of d.aliases) { expect(aliases.has(a), `${a} twice`).toBe(false); aliases.add(a); }
    }
  });

  it("names the hosts the brief lists", () => {
    const hosts = DOCS.flatMap((d) => d.hosts);
    for (const h of [
      "react.dev", "nextjs.org/docs", "docs.python.org", "developer.mozilla.org", "nodejs.org/api", "typescriptlang.org", "go.dev", "doc.rust-lang.org",
      "docs.djangoproject.com", "fastapi.tiangolo.com", "tailwindcss.com/docs", "supabase.com/docs", "vercel.com/docs", "prisma.io/docs", "docs.expo.dev",
      "docs.flutter.dev", "developer.android.com", "developer.apple.com",
    ]) expect(hosts, h).toContain(h);
  });

  it("finds a name in a text by its aliases only, and 'react-native' is not 'react'", () => {
    expect(findDocsInText("use next.js with tailwind and zod").map((d) => d.id)).toEqual(["next", "tailwind", "zod"]);
    expect(findDocsInText("my react-native app").map((d) => d.id)).toEqual(["react-native"]);
    expect(findDocsInText("go to the next node").map((d) => d.id)).toEqual([]);
    expect(docsFor("Next")?.id).toBe("next");
    expect(docsFor("@types/node")).toBeUndefined();
    expect(nameOf(docsFor("next")!)).toBe("next.js");
  });

  it("recognises an official page by its host and path prefix, and not a lookalike or a subdomain", () => {
    expect(docsMatch("https://react.dev/reference/react/useEffect")?.id).toBe("react");
    expect(docsMatch("https://www.react.dev/learn")?.id).toBe("react");
    expect(docsMatch("https://nextjs.org/docs/app/api")?.id).toBe("next");
    expect(docsMatch("https://nextjs.org/blog/next-15")).toBeUndefined();
    expect(docsMatch("https://nodejs.org/api/fs.html")?.id).toBe("node");
    expect(docsMatch("https://react.dev.evil.com/x")).toBeUndefined();
    expect(docsMatch("https://evilreact.dev/x")).toBeUndefined();
    expect(docsMatch("https://blog.react.dev/x")).toBeUndefined();
    expect(docsMatch("not a url")).toBeUndefined();
  });

  it("knows padding sites, and which hosts may be indexed", () => {
    expect(CONTENT_FARMS.length).toBeLessThan(25);
    expect(isContentFarm("https://www.geeksforgeeks.org/x")).toBe(true);
    expect(isContentFarm("https://x.tutorialspoint.com/y")).toBe(true);
    expect(isContentFarm("https://notgeeksforgeeks.org/y")).toBe(false);
    expect(isIndexableHost("https://react.dev/learn")).toBe(true);
    expect(isIndexableHost("https://docs.whatever.io/a")).toBe(true);
    expect(isIndexableHost("https://foo.readthedocs.io/en/latest/")).toBe(true);
    expect(isIndexableHost("https://developer.mozilla.org/en-US/docs/Web")).toBe(true);
    expect(isIndexableHost("https://my-private-notes.example.com/page")).toBe(false);
    expect(isIndexableHost("https://pastebin.com/abc")).toBe(false);
    expect(isIndexableHost("https://docs.google.com/document/d/1/edit")).toBe(false);
    expect(isIndexableHost("https://sub.notion.site/Plan")).toBe(false);
  });
});
