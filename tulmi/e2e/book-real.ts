/**
 * THE PROJECT BOOK OF A REAL PROJECT, THROUGH THE PRODUCT'S OWN PATH, WITH NO MODEL.
 *
 *   npx tsx e2e/book-real.ts --repo chedfox/tailzu-backend --dir /path/to/checkout [--out e2e/out/book.md]
 *
 * The checkout's files (git ls-files, text only) are put on a rig's local GitHub as a project and its brain is built from them, with no model words
 * (brainBudgetPaise 0: no summaries). The book's GitHub reads (commits and the files each touched, merged and open pull requests, open issues,
 * milestones) go to the real repo on api.github.com, so the book is made by BrainHandle.book() from the real history, issues and plans. The project's
 * own checks are not run here, so that chapter says so. It writes the book's Markdown and prints it.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRig, USER } from "./adapters/rig.js";
import { proxyAwareFetch } from "./fetch.js";
import { bookMarkdown } from "../src/code/project/book.js";

const arg = (name: string, d = ""): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const REPO = arg("repo");
const DIR = arg("dir");
const OUT = arg("out", path.join("e2e", "out", `book-${REPO.replace(/\W+/g, "-")}.md`));
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO) || !DIR) throw new Error("Use --repo owner/name --dir /path/to/checkout");

/** The checkout's tracked text files, the e2e caches and anything big or binary left out. */
function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const list = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  for (const p of list) {
    if (/(^|\/)(?:e2e\/(?:cache|out|cassettes|results)|node_modules)\//.test(p)) continue;
    const full = path.join(dir, p);
    let buf: Buffer;
    try { buf = fs.readFileSync(full); } catch { continue; }
    if (buf.length > 300_000 || buf.includes(0)) continue;
    out[p] = buf.toString("utf8");
  }
  return out;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const files = filesOf(DIR);
  console.log(`${Object.keys(files).length} files from ${DIR}`);
  const rig = await createRig({ mode: "fake", brainBudgetPaise: 0, room: false });
  try {
    // The book's reads of the repo's history, pull requests, issues and milestones go to the real one; the code itself stays the local copy.
    const gh = rig.code.github as unknown as { rsend: (repo: unknown, method: string, url: string, body?: unknown, o?: unknown) => Promise<unknown> };
    const local = gh.rsend.bind(gh);
    const live = proxyAwareFetch();
    gh.rsend = async (repo, method, url, body, o) => {
      const m = /\/repos\/[^/]+\/[^/]+\/((?:issues|pulls|milestones|commits)(?:[/?].*)?)$/.exec(url);
      if (method !== "GET" || !m) return local(repo, method, url, body, o);
      const rest = m[1]!.replace(/([?&])sha=[^&]*/, "$1sha=main");
      const res = await live(`https://api.github.com/repos/${REPO}/${rest}`, { headers: { accept: "application/vnd.github+json", "user-agent": "x0bot-book-check" } });
      return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
    };
    const short = REPO.split("/")[1]!;
    const task = { id: short, repo: "synthetic", base: { files }, checks: {}, oracle: {} } as never;
    const h = await rig.addProjectFor(task, short);
    const brain = await rig.code.brain!.open(USER, h.project.id);
    const status = await brain.status();
    console.log(`brain: ${status.status}, ${status.structure?.fileCount ?? 0} files, built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const t1 = Date.now();
    const book = (await brain.book())!;
    const md = bookMarkdown(book).split(`alice/${short}`).join(REPO);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${md}\n`);
    console.log(`book: ${book.facts.length} facts, ${book.gaps.length} gaps, ${book.questions.length} questions, made in ${((Date.now() - t1) / 1000).toFixed(1)}s -> ${OUT}\n`);
    console.log(md);
  } finally {
    await rig.dispose();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
