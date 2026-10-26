/**
 * THE LISTS WEB SEARCH GOES BY: WHOSE DOCUMENTATION IS OFFICIAL, WHICH SITES
 * ARE PADDING, HOW MUCH EACH SOURCE IS TRUSTED FOR EACH KIND OF QUESTION, AND
 * WHICH SITES TO CRAWL FOR OUR OWN INDEX.
 *
 * Plain data and small pure functions, no network. They live in code rather
 * than in the environment on purpose: changing one is a reviewed change with a
 * test beside it, not a setting someone can mistype on a server. The planner
 * reads the documentation map to name a `site`, the ranker reads it to know an
 * official page when it meets one, the index reads it to know which hosts may
 * be indexed at all, and the seed script reads SEED_SITES.
 */
import type { Intent, ResultSource } from "./types.js";

// --------------------------------------------------------------- official docs

export interface DocsEntry {
  /** The key: what ctx.framework and ctx.deps are matched against. */
  id: string;
  /** Other ways the name is written in a question ("next.js", "nextjs"). Lower case. */
  aliases: string[];
  /** Hosts, each optionally with a path prefix: "nextjs.org/docs". The first is the best to search. */
  hosts: string[];
  /** Questions about it are about the web platform too, so MDN is worth asking. */
  web?: boolean;
  /** Which registry its packages are in, when it has one. */
  registry?: "npm" | "pypi" | "crates";
}

/**
 * About fifty official documentation sites. An alias is only here if it is
 * hardly ever an ordinary word: "go" and "node" are not aliases (golang and
 * node.js are), they are reached through ctx.framework or ctx.languages.
 */
export const DOCS: readonly DocsEntry[] = [
  { id: "react", aliases: ["react", "reactjs", "react.js"], hosts: ["react.dev"], web: true, registry: "npm" },
  { id: "next", aliases: ["next.js", "nextjs"], hosts: ["nextjs.org/docs"], web: true, registry: "npm" },
  { id: "vue", aliases: ["vue", "vuejs", "vue.js"], hosts: ["vuejs.org"], web: true, registry: "npm" },
  { id: "nuxt", aliases: ["nuxt", "nuxtjs"], hosts: ["nuxt.com/docs"], web: true, registry: "npm" },
  { id: "svelte", aliases: ["svelte", "sveltekit"], hosts: ["svelte.dev/docs", "svelte.dev"], web: true, registry: "npm" },
  { id: "angular", aliases: ["angular"], hosts: ["angular.dev"], web: true, registry: "npm" },
  { id: "astro", aliases: ["astro"], hosts: ["docs.astro.build"], web: true, registry: "npm" },
  { id: "remix", aliases: ["remix"], hosts: ["remix.run/docs"], web: true, registry: "npm" },
  { id: "express", aliases: ["express", "expressjs"], hosts: ["expressjs.com"], registry: "npm" },
  { id: "fastify", aliases: ["fastify"], hosts: ["fastify.dev"], registry: "npm" },
  { id: "node", aliases: ["node.js", "nodejs"], hosts: ["nodejs.org/api", "nodejs.org/docs"], registry: "npm" },
  { id: "deno", aliases: ["deno"], hosts: ["docs.deno.com"], registry: "npm" },
  { id: "bun", aliases: ["bun"], hosts: ["bun.sh/docs"], registry: "npm" },
  { id: "typescript", aliases: ["typescript", "tsconfig"], hosts: ["typescriptlang.org"], registry: "npm" },
  { id: "javascript", aliases: ["javascript", "ecmascript", "dom", "css", "html", "webgl", "web api", "web apis", "service worker"], hosts: ["developer.mozilla.org"], web: true, registry: "npm" },
  { id: "vite", aliases: ["vite"], hosts: ["vite.dev", "vitejs.dev"], web: true, registry: "npm" },
  { id: "vitest", aliases: ["vitest"], hosts: ["vitest.dev"], registry: "npm" },
  { id: "jest", aliases: ["jest"], hosts: ["jestjs.io"], registry: "npm" },
  { id: "webpack", aliases: ["webpack"], hosts: ["webpack.js.org"], registry: "npm" },
  { id: "eslint", aliases: ["eslint"], hosts: ["eslint.org/docs"], registry: "npm" },
  { id: "tailwind", aliases: ["tailwind", "tailwindcss"], hosts: ["tailwindcss.com/docs"], web: true, registry: "npm" },
  { id: "zod", aliases: ["zod"], hosts: ["zod.dev"], registry: "npm" },
  { id: "trpc", aliases: ["trpc"], hosts: ["trpc.io/docs"], registry: "npm" },
  { id: "prisma", aliases: ["prisma"], hosts: ["prisma.io/docs"], registry: "npm" },
  { id: "drizzle", aliases: ["drizzle", "drizzle-orm"], hosts: ["orm.drizzle.team/docs"], registry: "npm" },
  { id: "supabase", aliases: ["supabase"], hosts: ["supabase.com/docs"], registry: "npm" },
  { id: "firebase", aliases: ["firebase", "firestore"], hosts: ["firebase.google.com/docs"], registry: "npm" },
  { id: "vercel", aliases: ["vercel"], hosts: ["vercel.com/docs"], registry: "npm" },
  { id: "stripe", aliases: ["stripe"], hosts: ["docs.stripe.com"], registry: "npm" },
  { id: "electron", aliases: ["electron"], hosts: ["electronjs.org/docs"], registry: "npm" },
  { id: "tauri", aliases: ["tauri"], hosts: ["tauri.app"], registry: "crates" },
  { id: "react-native", aliases: ["react-native", "react native"], hosts: ["reactnative.dev"], registry: "npm" },
  { id: "expo", aliases: ["expo"], hosts: ["docs.expo.dev"], registry: "npm" },
  { id: "flutter", aliases: ["flutter"], hosts: ["docs.flutter.dev", "api.flutter.dev"] },
  { id: "dart", aliases: ["dart"], hosts: ["dart.dev"] },
  { id: "android", aliases: ["android", "jetpack compose"], hosts: ["developer.android.com"] },
  { id: "kotlin", aliases: ["kotlin"], hosts: ["kotlinlang.org/docs"] },
  { id: "apple", aliases: ["swiftui", "uikit", "xcode", "ios", "macos", "appkit", "swift"], hosts: ["developer.apple.com"] },
  { id: "python", aliases: ["python", "python3", "stdlib"], hosts: ["docs.python.org"], registry: "pypi" },
  { id: "django", aliases: ["django"], hosts: ["docs.djangoproject.com"], registry: "pypi" },
  { id: "flask", aliases: ["flask"], hosts: ["flask.palletsprojects.com"], registry: "pypi" },
  { id: "fastapi", aliases: ["fastapi"], hosts: ["fastapi.tiangolo.com"], registry: "pypi" },
  { id: "pydantic", aliases: ["pydantic"], hosts: ["docs.pydantic.dev"], registry: "pypi" },
  { id: "sqlalchemy", aliases: ["sqlalchemy"], hosts: ["docs.sqlalchemy.org"], registry: "pypi" },
  { id: "numpy", aliases: ["numpy"], hosts: ["numpy.org/doc"], registry: "pypi" },
  { id: "pandas", aliases: ["pandas"], hosts: ["pandas.pydata.org/docs"], registry: "pypi" },
  { id: "pytorch", aliases: ["pytorch", "torch"], hosts: ["pytorch.org/docs"], registry: "pypi" },
  { id: "tensorflow", aliases: ["tensorflow", "keras"], hosts: ["tensorflow.org/api_docs", "keras.io"], registry: "pypi" },
  { id: "go", aliases: ["golang"], hosts: ["go.dev", "pkg.go.dev"] },
  { id: "rust", aliases: ["rust", "cargo"], hosts: ["doc.rust-lang.org", "docs.rs"], registry: "crates" },
  { id: "java", aliases: ["java", "jdk"], hosts: ["docs.oracle.com/en/java"] },
  { id: "spring", aliases: ["spring boot"], hosts: ["docs.spring.io"] },
  { id: "dotnet", aliases: [".net", "dotnet", "asp.net", "c#", "csharp"], hosts: ["learn.microsoft.com/dotnet"] },
  { id: "rails", aliases: ["rails", "ruby on rails", "activerecord"], hosts: ["guides.rubyonrails.org", "api.rubyonrails.org"] },
  { id: "laravel", aliases: ["laravel"], hosts: ["laravel.com/docs"] },
  { id: "docker", aliases: ["docker", "dockerfile", "docker compose"], hosts: ["docs.docker.com"] },
  { id: "kubernetes", aliases: ["kubernetes", "k8s", "kubectl"], hosts: ["kubernetes.io/docs"] },
  { id: "postgres", aliases: ["postgres", "postgresql"], hosts: ["postgresql.org/docs"] },
  { id: "redis", aliases: ["redis"], hosts: ["redis.io/docs"] },
  { id: "mongodb", aliases: ["mongodb", "mongoose"], hosts: ["mongodb.com/docs"] },
  { id: "git", aliases: ["git"], hosts: ["git-scm.com/docs"] },
  { id: "github", aliases: ["github actions", "github"], hosts: ["docs.github.com"] },
  { id: "aws", aliases: ["aws", "dynamodb"], hosts: ["docs.aws.amazon.com"] },
  { id: "openai", aliases: ["openai"], hosts: ["platform.openai.com/docs"] },
  { id: "anthropic", aliases: ["anthropic", "claude api"], hosts: ["docs.anthropic.com"] },
];

const BY_ALIAS = new Map<string, DocsEntry>();
for (const d of DOCS) {
  BY_ALIAS.set(d.id, d);
  for (const a of d.aliases) BY_ALIAS.set(a, d);
}
/** What a question can name an entry by: its aliases, not its id (the id "node" or "next" is also a plain word). */
const TEXT_ALIASES = new Map<string, DocsEntry>();
for (const d of DOCS) for (const a of d.aliases) TEXT_ALIASES.set(a, d);

/** The name an entry is best called by in a search query. */
export function nameOf(d: DocsEntry): string { return d.aliases[0] ?? d.id; }

/** The documentation entry for a name as ctx or a question gives it (an id or an alias, case does not matter). */
export function docsFor(name: string | undefined): DocsEntry | undefined {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return undefined;
  return BY_ALIAS.get(n) ?? BY_ALIAS.get(n.replace(/\.js$/, "")) ?? BY_ALIAS.get(n.replace(/^@/, "").split("/")[0]!);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALIASES_LONGEST_FIRST = [...TEXT_ALIASES.keys()].sort((a, b) => b.length - a.length);
const ALIAS_RES = new Map(ALIASES_LONGEST_FIRST.map((a) => [a, new RegExp(`(?<![\\w.-])${escapeRe(a)}(?![\\w-]|\\.\\w)`, "i")]));

/** The documentation entries a text names, in the order they first appear. "react-native" is not "react". */
export function findDocsInText(text: string): DocsEntry[] {
  const found: Array<{ at: number; entry: DocsEntry }> = [];
  const seen = new Set<DocsEntry>();
  for (const a of ALIASES_LONGEST_FIRST) {
    const m = ALIAS_RES.get(a)!.exec(text);
    if (!m) continue;
    const entry = TEXT_ALIASES.get(a)!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    found.push({ at: m.index, entry });
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.entry);
}

interface ParsedHost { host: string; path: string }
const parsedHosts = (d: DocsEntry): ParsedHost[] => d.hosts.map((h) => {
  const slash = h.indexOf("/");
  return slash < 0 ? { host: h, path: "" } : { host: h.slice(0, slash), path: h.slice(slash) };
});
const HOSTS_PARSED = new Map(DOCS.map((d) => [d.id, parsedHosts(d)]));

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** The documentation entry an address belongs to, or undefined. Only the entry's own host and path prefix count: not a lookalike, not a subdomain of it. */
export function docsMatch(raw: string): DocsEntry | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  const host = bareHost(u.hostname);
  for (const d of DOCS) {
    for (const h of HOSTS_PARSED.get(d.id)!) {
      if (host !== bareHost(h.host)) continue;
      if (!h.path || u.pathname === h.path || u.pathname.startsWith(`${h.path}/`)) return d;
    }
  }
  return undefined;
}

// ------------------------------------------------------------------- the rest

/** Sites that are mostly padding around other people's answers. A mild downrank, not a ban. */
export const CONTENT_FARMS: readonly string[] = [
  "geeksforgeeks.org", "tutorialspoint.com", "javatpoint.com", "w3resource.com", "codegrepper.com", "programmersought.com",
  "stackoverrun.com", "askdev.io", "qastack.com", "stackanswers.net", "tutorialspoint.dev", "intellipaat.com", "educba.com",
];

export function isContentFarm(raw: string): boolean {
  try {
    const host = bareHost(new URL(raw).hostname);
    return CONTENT_FARMS.some((f) => host === f || host.endsWith(`.${f}`));
  } catch {
    return false;
  }
}

/** Hosts of registries, where a package's own page is the authority on it. */
export const REGISTRY_HOSTS: readonly string[] = ["npmjs.com", "pypi.org", "crates.io", "docs.rs", "pkg.go.dev"];

/**
 * How far each source is trusted in general (0 to 1.2), before the question is
 * looked at. A search engine's answer is only as good as the page it points to,
 * so its weight is lower than a registry's, and the page's own host decides the rest (rank.ts).
 */
export const SOURCE_WEIGHT: Readonly<Record<ResultSource, number>> = {
  npm: 1, pypi: 1, crates: 1, github: 0.95, stackoverflow: 1, mdn: 1, hn: 0.7, wikipedia: 0.6,
  index: 0.95, searxng: 0.8, ddg: 0.8, brave: 0.85,
};

/** How well a kind of result answers each kind of question (0 to 1). A kind not listed counts as 0.6. */
export const INTENT_FIT: Readonly<Record<Intent, Readonly<Record<string, number>>>> = {
  package_lookup: { package: 1, repo: 0.9, doc: 0.7, page: 0.7, article: 0.5, question: 0.4, issue: 0.35, story: 0.4 },
  api_docs: { doc: 1, question: 0.8, page: 0.8, repo: 0.5, article: 0.6, issue: 0.5, package: 0.3, story: 0.3 },
  error_fix: { issue: 1, question: 1, page: 0.7, article: 0.6, doc: 0.6, repo: 0.35, package: 0.2, story: 0.3 },
  how_to: { question: 1, doc: 0.95, page: 0.9, article: 0.8, issue: 0.6, repo: 0.5, package: 0.3, story: 0.4 },
  compare_libs: { story: 1, article: 0.95, page: 0.9, repo: 0.9, package: 0.5, doc: 0.7, question: 0.5, issue: 0.3 },
  version_news: { repo: 1, doc: 0.9, package: 0.9, story: 0.9, article: 0.85, page: 0.8, issue: 0.6, question: 0.3 },
  general: { page: 1, article: 1, doc: 0.9, question: 0.7, story: 0.6, repo: 0.6, package: 0.5, issue: 0.4 },
};

// ------------------------------------------------------------ what may be indexed

/**
 * Hosts whose pages may go into our own index. The index is searched by everyone,
 * so only pages that are public by design are let in: a page a person read because
 * they were handed an unlisted link (a shared document, a paste) must not become
 * something another person's search can find. Official documentation, the
 * registries, and the big public reference sites are such pages.
 */
const EXTRA_INDEXABLE: readonly string[] = [
  "developer.mozilla.org", "stackoverflow.com", "stackexchange.com", "wikipedia.org", "npmjs.com", "pypi.org", "crates.io",
  "raw.githubusercontent.com", "readthedocs.io", "readthedocs.org", "docs.rs", "pkg.go.dev",
];

/**
 * Hosts where a page is public only to whoever holds its link: shared documents, pastes,
 * workspaces. Some of them start with "docs." and would pass the rule below; none may be indexed.
 */
const SHARED_BY_LINK: readonly string[] = [
  "docs.google.com", "drive.google.com", "sites.google.com", "notion.site", "notion.so", "gist.github.com", "pastebin.com", "paste.ee", "hastebin.com",
  "dropbox.com", "onedrive.live.com", "1drv.ms", "sharepoint.com", "atlassian.net", "hackmd.io", "codepen.io", "jsfiddle.net", "replit.com", "airtable.com",
  "docs.zoho.com", "docs.live.com", "scribd.com", "slack.com", "trello.com",
];

export function isIndexableHost(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = bareHost(u.hostname);
    if (SHARED_BY_LINK.some((h) => host === h || host.endsWith(`.${h}`))) return false;
    if (docsMatch(raw)) return true;
    if (host.startsWith("docs.") || host.endsWith(".readthedocs.io")) return true;
    return EXTRA_INDEXABLE.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------- seeding

export interface SeedSite {
  id: string;
  /** A sitemap, or a sitemap index. */
  sitemap: string;
  /** For a sitemap index: only the entries whose address matches this. */
  pick?: RegExp;
  /** Only pages whose address matches this. */
  include: RegExp;
}

/** The documentation the seed script crawls for the index (scripts/seed-web-index.ts). Checked against the live sitemaps on 2026-10-26. */
export const SEED_SITES: readonly SeedSite[] = [
  { id: "vue", sitemap: "https://vuejs.org/sitemap.xml", include: /^https:\/\/vuejs\.org\/(guide|api)\// },
  { id: "next", sitemap: "https://nextjs.org/sitemap.xml", include: /^https:\/\/nextjs\.org\/docs\// },
  { id: "vite", sitemap: "https://vite.dev/sitemap.xml", include: /^https:\/\/vite\.dev\/(guide|config|plugins)\// },
  { id: "prisma", sitemap: "https://www.prisma.io/docs/sitemap.xml", include: /^https:\/\/www\.prisma\.io\/docs\// },
  { id: "expo", sitemap: "https://docs.expo.dev/sitemap.xml", include: /^https:\/\/docs\.expo\.dev\// },
  { id: "supabase", sitemap: "https://supabase.com/docs/sitemap.xml", include: /^https:\/\/supabase\.com\/docs\// },
  { id: "fastapi", sitemap: "https://fastapi.tiangolo.com/sitemap.xml", include: /^https:\/\/fastapi\.tiangolo\.com\/(?!(?:[a-z]{2}|[a-z]{2}-[a-z]{2,4})\/)/ },
  { id: "django", sitemap: "https://docs.djangoproject.com/sitemap.xml", pick: /sitemap-en\.xml$/, include: /^https:\/\/docs\.djangoproject\.com\/en\/dev\// },
  { id: "mdn", sitemap: "https://developer.mozilla.org/sitemap.xml", pick: /\/en-us\/sitemap\.xml\.gz$/, include: /^https:\/\/developer\.mozilla\.org\/en-US\/docs\/Web\/(JavaScript|API|HTML|CSS)\// },
];
