/**
 * THE PAGE CORPUS FOR THE EXTRACTION BAKE-OFF: ABOUT FORTY REAL PAGES, FETCHED ONCE AND KEPT IN e2e/cache/pages (git-ignored).
 *
 *   npm run bakeoff -- --fetch-pages      fetch what is missing (curl, through the session's egress proxy), never re-fetch what is saved
 *
 * The mix is what a coding assistant reads: reference documentation (MDN, Python, Node, PostgreSQL, Go, Rust, Kubernetes, Express, Flask, Click), tutorials and
 * guides, long-form articles, an encyclopedia, a man page, specifications, and a few listing pages (a front page is the hard case for any extractor). Only
 * public pages; one request each, with an honest user agent. The HTML is stored as served: extraction, not fetching, is what is measured.
 */
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, mkdirp, readJson, run, writeJson } from "../util.js";

export type PageKind = "reference" | "guide" | "article" | "encyclopedia" | "spec" | "manpage" | "listing";

export interface PageSpec { id: string; url: string; kind: PageKind }

export const PAGES: readonly PageSpec[] = [
  { id: "mdn-array-map", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", kind: "reference" },
  { id: "mdn-using-fetch", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch", kind: "guide" },
  { id: "python-asyncio-task", url: "https://docs.python.org/3/library/asyncio-task.html", kind: "reference" },
  { id: "python-classes", url: "https://docs.python.org/3/tutorial/classes.html", kind: "guide" },
  { id: "node-intro", url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs", kind: "guide" },
  { id: "react-useeffect", url: "https://react.dev/reference/react/useEffect", kind: "reference" },
  { id: "ts-generics", url: "https://www.typescriptlang.org/docs/handbook/2/generics.html", kind: "guide" },
  { id: "postgres-select", url: "https://www.postgresql.org/docs/current/sql-select.html", kind: "reference" },
  { id: "postgres-index-types", url: "https://www.postgresql.org/docs/current/indexes-types.html", kind: "reference" },
  { id: "go-effective", url: "https://go.dev/doc/effective_go", kind: "guide" },
  { id: "go-slices-blog", url: "https://go.dev/blog/slices-intro", kind: "article" },
  { id: "rust-ownership", url: "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html", kind: "guide" },
  { id: "k8s-pods", url: "https://kubernetes.io/docs/concepts/workloads/pods/", kind: "reference" },
  { id: "express-routing", url: "https://expressjs.com/en/guide/routing.html", kind: "guide" },
  { id: "flask-quickstart", url: "https://flask.palletsprojects.com/en/stable/quickstart/", kind: "guide" },
  { id: "click-options", url: "https://click.palletsprojects.com/en/stable/options/", kind: "reference" },
  { id: "pytest-fixtures", url: "https://docs.pytest.org/en/stable/how-to/fixtures.html", kind: "guide" },
  { id: "fastapi-first", url: "https://fastapi.tiangolo.com/tutorial/first-steps/", kind: "guide" },
  { id: "vue-reactivity", url: "https://vuejs.org/guide/essentials/reactivity-fundamentals.html", kind: "guide" },
  { id: "docker-overview", url: "https://docs.docker.com/get-started/docker-overview/", kind: "guide" },
  { id: "git-rebase", url: "https://git-scm.com/docs/git-rebase", kind: "reference" },
  { id: "man-open2", url: "https://man7.org/linux/man-pages/man2/open.2.html", kind: "manpage" },
  { id: "tailwind-flex", url: "https://tailwindcss.com/docs/flex", kind: "reference" },
  { id: "vite-guide", url: "https://vite.dev/guide/", kind: "guide" },
  { id: "eslint-rules", url: "https://eslint.org/docs/latest/use/configure/rules", kind: "reference" },
  { id: "terraform-for", url: "https://developer.hashicorp.com/terraform/language/expressions/for", kind: "reference" },
  { id: "django-queries", url: "https://docs.djangoproject.com/en/5.1/topics/db/queries/", kind: "guide" },
  { id: "github-actions-workflows", url: "https://docs.github.com/en/actions/writing-workflows/about-workflows", kind: "guide" },
  { id: "azure-circuit-breaker", url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker", kind: "guide" },
  { id: "web-dev-lcp", url: "https://web.dev/articles/lcp", kind: "article" },
  { id: "fowler-microservices", url: "https://martinfowler.com/articles/microservices.html", kind: "article" },
  { id: "pg-great-work", url: "https://paulgraham.com/greatwork.html", kind: "article" },
  { id: "joel-test", url: "https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/", kind: "article" },
  { id: "jvns-hard-things", url: "https://jvns.ca/blog/2023/10/06/new-talk--making-hard-things-easy/", kind: "article" },
  { id: "wiki-rate-limiting", url: "https://en.wikipedia.org/wiki/Rate_limiting", kind: "encyclopedia" },
  { id: "wiki-prompt-injection", url: "https://en.wikipedia.org/wiki/Prompt_injection", kind: "encyclopedia" },
  { id: "twelve-factor-config", url: "https://12factor.net/config", kind: "spec" },
  { id: "conventional-commits", url: "https://www.conventionalcommits.org/en/v1.0.0/", kind: "spec" },
  { id: "semver", url: "https://semver.org/", kind: "spec" },
  { id: "rfc6749-oauth", url: "https://datatracker.ietf.org/doc/html/rfc6749", kind: "spec" },
  { id: "list-cloudflare-blog", url: "https://blog.cloudflare.com/", kind: "listing" },
  { id: "list-hn", url: "https://news.ycombinator.com/", kind: "listing" },
  { id: "list-bbc-tech", url: "https://www.bbc.com/news/technology", kind: "listing" },
];

export const PAGES_DIR = path.join(CACHE_DIR, "pages");
export const pageFile = (id: string): string => path.join(PAGES_DIR, `${id}.html`);

export interface CorpusIndex { fetchedAt: string; pages: Record<string, { url: string; bytes: number; status: number; fetchedAt: string }> }

export const loadIndex = (): CorpusIndex => readJson<CorpusIndex>(path.join(PAGES_DIR, "index.json"), { fetchedAt: "", pages: {} });

/** The saved pages, in corpus order. */
export function savedPages(): Array<PageSpec & { html: string }> {
  return PAGES.filter((p) => fs.existsSync(pageFile(p.id))).map((p) => ({ ...p, html: fs.readFileSync(pageFile(p.id), "utf8") }));
}

/** Fetches every page that is not saved yet; returns what it fetched and what failed. */
export async function fetchCorpus(log: (s: string) => void = () => undefined): Promise<{ fetched: string[]; failed: Array<{ id: string; why: string }>; have: number }> {
  mkdirp(PAGES_DIR);
  const index = loadIndex();
  const fetched: string[] = [];
  const failed: Array<{ id: string; why: string }> = [];
  for (const p of PAGES) {
    if (fs.existsSync(pageFile(p.id))) continue;
    const tmp = `${pageFile(p.id)}.part`;
    const r = await run("curl", ["-sS", "-L", "--max-time", "40", "--max-filesize", "4000000", "-A", "Mozilla/5.0 (compatible; TailzuE2E/1.0; +https://tailzu.com)", "-H", "Accept: text/html,application/xhtml+xml", "-o", tmp, "-w", "%{http_code}", p.url], { timeoutMs: 60_000 });
    const status = Number(r.stdout.trim().slice(-3)) || 0;
    if (r.code !== 0 || status !== 200 || !fs.existsSync(tmp) || fs.statSync(tmp).size < 2000) { failed.push({ id: p.id, why: `status ${status}${r.stderr ? `: ${r.stderr.trim().slice(0, 100)}` : ""}` }); fs.rmSync(tmp, { force: true }); log(`  ${p.id}: FAILED ${status}`); continue; }
    fs.renameSync(tmp, pageFile(p.id));
    index.pages[p.id] = { url: p.url, bytes: fs.statSync(pageFile(p.id)).size, status, fetchedAt: new Date().toISOString() };
    fetched.push(p.id);
    log(`  ${p.id}: ${Math.round(index.pages[p.id]!.bytes / 1024)} KB`);
  }
  index.fetchedAt = new Date().toISOString();
  writeJson(path.join(PAGES_DIR, "index.json"), index);
  return { fetched, failed, have: PAGES.filter((p) => fs.existsSync(pageFile(p.id))).length };
}
