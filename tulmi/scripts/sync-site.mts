/**
 * THE LANDING PAGE, AS A MACHINE READS IT.
 *
 * tailzu.space draws its words from GET /v1/site once its script runs. Most
 * of what reads a page does not run scripts: the crawlers behind ChatGPT,
 * Claude and Perplexity, link previews, and a search engine on its first
 * pass. To them the page was a title that said "Tailzu", an empty FAQ and
 * empty steps. This writes the backend's own words into the page's HTML, so
 * the first read is the real one; the script still takes over as before.
 *
 * Only what sits between the page's SEO markers is touched (src/seo/home.ts
 * builds every line of it, and says what each marker holds):
 *
 *   SEO:HEAD  SEO:steps  SEO:toneSaid  SEO:toneGrid  SEO:faq  SEO:faqCopy
 *   and on the redesigned page, all four together:
 *   SEO:hero  SEO:line  SEO:langs  SEO:siteCopy
 *
 * A page without the redesign's four (the page from before it) gets its six
 * filled exactly as it always did; a page with some of them stops the sync.
 * A page with SEO:HEAD and no other marker gets its head alone.
 *
 *   npx tsx scripts/sync-site.mts /home/user/TAILZU-WEB/index.html           write
 *   npx tsx scripts/sync-site.mts /home/user/TAILZU-WEB/index.html --check   exit 1 if stale
 *
 * Either way it then runs the site's csp.mjs, so the page's CSP hashes follow
 * the script this rewrites.
 *
 * The free allowance comes from FREE_MONTHLY_WORDS, as on the server: set it
 * to production's value when syncing if production changed it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Config validation wants the server's keys; none of them are used here.
for (const [k, v] of Object.entries({
  OPENROUTER_API_KEY: "unused", OPENAI_API_KEY: "unused", STT_PROVIDER: "openai", DEV_SKIP_AUTH: "true", NODE_ENV: "development",
})) process.env[k] ??= v;

const { filmProblems, syncHome } = await import("../src/seo/home.js");

const file = process.argv[2];
const check = process.argv.includes("--check");
if (!file) { console.error("usage: sync-site.mts <index.html> [--check]"); process.exit(2); }

const before = fs.readFileSync(file, "utf8");
const { html, redesigned, headOnly } = syncHome(before);
if (headOnly) {
  console.log("note: only SEO:HEAD in this page (the head-only page): filled its head");
} else if (!redesigned) {
  console.log("note: no SEO:hero, SEO:line, SEO:langs or SEO:siteCopy in this page (the page from before the redesign): filled its six markers");
} else {
  // The redesigned head names its films as VideoObjects: hold them to the
  // files beside the page before writing a word, so the head never points
  // a search engine at a video the site does not have.
  const media = path.join(path.dirname(path.resolve(file)), "media");
  if (!fs.existsSync(media)) {
    console.log("note: no media/ beside this page, so the films' structured data was not checked against the files");
  } else {
    const at = path.join(media, "manifest.json");
    const manifest = fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, "utf8")) : null;
    if (!manifest) console.log("note: no media/manifest.json, so the films' lengths were not checked");
    const problems = filmProblems(manifest, (f) => fs.existsSync(path.join(media, f)));
    if (problems.length) {
      for (const p of problems) console.error(`film: ${p}`);
      console.error("fix src/seo/facts.ts FILM_MEDIA (or the media), then sync again");
      process.exit(1);
    }
  }
}

if (check) {
  if (html !== before) { console.error(`${file} is stale: run scripts/sync-site.mts`); process.exit(1); }
  console.log("site in sync");
} else {
  fs.writeFileSync(file, html);
  console.log(html === before ? "site already in sync" : `synced ${file}`);
}

// The page's CSP (vercel.json) allows its inline script and style by hash,
// and the copy above lives inside that script: a sync that changed it
// changed the hash, and a stale one stops the page's script from running.
// csp.mjs beside the page writes (or, with --check, checks) the hashes.
const csp = path.join(path.dirname(path.resolve(file)), "csp.mjs");
if (fs.existsSync(csp)) execFileSync(process.execPath, [csp, ...(check ? ["--check"] : [])], { stdio: "inherit" });
