/**
 * THE PROJECT BOOK END TO END, WITH THE PRODUCT'S OWN LOGIC AND REAL MODELS, ON A REAL PROJECT.
 *
 *   npx tsx e2e/book-e2e.ts --repo chedfox/tailzu-desktop --dir /path/to/checkout [--strip-docs] [--cap 20] [--brain-inr 10] [--out file.md]
 *
 * 1. The checkout's files are a project on the rig's local GitHub; its brain is built with real models (summaries, features, the welcome), as when a
 *    person connects a repo. Its GitHub reads of history, pull requests, issues and milestones go to the real repo on api.github.com.
 * 2. The book is made from all of that (BrainHandle.book()).
 * 3. The person asks the Xode chat what the book is for (what it is, where it is heading, what changed and why), through the front door: the tiny
 *    model decides, the chat looks with its read-only tools, the book's facts are in its brief.
 * 4. The owner answers the book's three questions (BrainHandle.answerBook), and the first question is asked again: their words must lead.
 * 5. What a job would be told (bookForJobs) is printed.
 *
 * --strip-docs leaves out every .md, docs/ and the README: a project with no docs. It stops before a step once the cap (rupees) is spent.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRig, USER } from "./adapters/rig.js";
import { proxyAwareFetch } from "./fetch.js";
import { bookForJobs, bookMarkdown } from "../src/code/project/book.js";
import { createFront } from "../src/front/index.js";
import type { FrontCtx, Turn } from "../src/front/types.js";
import { MemoryThreadStore } from "../src/code/chat/threads.js";

const arg = (name: string, d = ""): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const REPO = arg("repo");
const DIR = arg("dir");
const STRIP_DOCS = process.argv.includes("--strip-docs");
const CAP_PAISE = Math.round(Number(arg("cap", "20")) * 100);
const BRAIN_PAISE = Math.round(Number(arg("brain-inr", "10")) * 100);
const OUT = arg("out", path.join("e2e", "out", `book-e2e-${REPO.replace(/\W+/g, "-")}${STRIP_DOCS ? "-nodocs" : ""}.md`));
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO) || !DIR) throw new Error("Use --repo owner/name --dir /path/to/checkout");

/** What the owner says when the book asks: per repo, in their words. */
const OWNER: Record<string, { for: string; next: string; keep: string }> = {
  "chedfox/tailzu-desktop": {
    for: "People who write all day on Windows and Mac: press one key, speak, and clean text is pasted where they type. It also hosts the X0 bots on the computer.",
    next: "Ship Ask (the on-screen agent) to everyone, and a signed Mac build.",
    keep: "One key press to dictate; nothing leaves the computer without the person's say.",
  },
  "chedfox/tailzu-backend": {
    for: "The X0 Bot server: it builds every screen of the phone and desktop apps (server-driven UI) and runs the bots, Xode the coding bot first.",
    next: "Make Xode the best coding bot on cheap models; then the bots platform for everyone.",
    keep: "Screens are built on the server; keys never reach logs or the apps.",
  },
};

const QUESTIONS = [
  "what is this project, and who is it for?",
  "where is it heading next?",
  "what changed lately, and why?",
  "What should we do",
];

const rupees = (p: number): string => `₹${(p / 100).toFixed(2)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const indent = (s: string): string => s.split("\n").map((l) => `    ${l}`).join("\n");

function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const list = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  for (const p of list) {
    if (/(^|\/)(?:e2e\/(?:cache|out|cassettes|results)|node_modules)\//.test(p)) continue;
    if (STRIP_DOCS && (/\.(?:md|mdx|rst|txt)$/i.test(p) || /(^|\/)docs?\//i.test(p))) continue;
    let buf: Buffer;
    try { buf = fs.readFileSync(path.join(dir, p)); } catch { continue; }
    if (buf.length > 300_000 || buf.includes(0)) continue;
    out[p] = buf.toString("utf8");
  }
  return out;
}

async function main(): Promise<void> {
  const lines: string[] = [];
  const out = (s = ""): void => { lines.push(s); console.log(s); };
  const t0 = Date.now();
  const files = filesOf(DIR);
  const short = REPO.split("/")[1]!;
  const named = (s: string): string => s.split(`alice/${short}`).join(REPO);
  out(`# The project book end to end: ${REPO}${STRIP_DOCS ? ", with no docs" : ""}`);
  out(`${new Date(t0).toISOString().slice(0, 10)}. ${Object.keys(files).length} files. Brain budget ${rupees(BRAIN_PAISE)}, cap ${rupees(CAP_PAISE)}.`);
  out();

  const rig = await createRig({ mode: "real", brainBudgetPaise: BRAIN_PAISE, room: false, log: (m) => { if (/^warn /.test(m)) console.error(m); } });
  const prompts: string[] = [];
  const spent = (): number => Math.ceil(rig.kit.logs.reduce((n, l) => n + l.paise, 0));
  try {
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

    // ---- 1. the brain, with real models
    const task = { id: short, repo: "synthetic", base: { files }, checks: {}, oracle: {} } as never;
    const h = await rig.addProjectFor(task, short);
    const brain = await rig.code.brain!.open(USER, h.project.id);
    const status = await brain.status();
    out(`## 1. The brain`);
    out(`${status.status}, ${status.structure?.fileCount ?? 0} files, ${rupees(spent())}, ${secs(Date.now() - t0)}.`);
    out(`Welcome:\n${indent(named(status.welcome ?? ""))}`);
    out();

    // ---- 2. the book
    const t1 = Date.now();
    const book = (await brain.book())!;
    out(`## 2. The book (${book.facts.length} facts, ${book.gaps.length} gaps, made in ${secs(Date.now() - t1)})`);
    out();
    out(named(bookMarkdown(book)).replace(/^#/gm, "###"));
    out();

    // ---- 3. the chat, through the front door
    const threads = new MemoryThreadStore();
    const call = (async (input: { purpose: string; messages: Array<{ role: string; content: unknown }> }) => {
      if (/^front\.(code_answer|reply)$/.test(input.purpose)) prompts.push(input.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n"));
      return rig.kit.call(input as never);
    }) as typeof rig.kit.call;
    const front = createFront({
      force: true, code: rig.code, jobs: rig.jobs, agent: rig.orch, call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}),
      threads, personal: async () => [],
    })!;
    const threadId = randomUUID();
    const ask = async (say: string, label: string): Promise<string> => {
      if (spent() >= CAP_PAISE) { out(`(stopped before "${say}": ${rupees(spent())} spent)`); return ""; }
      const recent: Turn[] = [];
      const kept = await threads.get(USER, h.project.id, threadId).catch(() => null);
      if (kept?.lastQuestion) recent.push({ said: kept.lastQuestion, did: "code_question" });
      const ctx: FrontCtx = { userId: USER, plan: "paid", device: "desktop", mode: "text", visuals: "auto", projectId: h.project.id, threadId, recent, attachments: [] };
      out(`### ${label}. You: ${say}`);
      const at = Date.now();
      const before = rig.kit.logs.length;
      const sentBefore = prompts.length;
      try {
        const r = await front.ask(say, ctx);
        const calls = rig.kit.logs.slice(before);
        const p = prompts.slice(sentBefore).join("\n");
        const bookIn = /<book>([\s\S]*?)<\/book>/.exec(p)?.[1]?.trim() ?? "";
        out(`(read as ${r.decision.intent} → ${r.decision.route}, budget ${rupees(r.decision.budgetPaise)}; ${calls.length} model calls; ${secs(Date.now() - at)}; ${rupees(r.result.paise)}; the book in its brief: ${bookIn ? `${bookIn.split("\n").length} lines` : "none"})`);
        out(`Xode:\n${indent(named((r.result.text ?? "").trim()))}`);
        if (bookIn) out(`<details><summary>the book's lines it was given</summary>\n\n${named(bookIn)}\n\n</details>`);
        out();
        return r.result.text ?? "";
      } catch (err) {
        out(`Xode failed: ${(err as Error).message}`);
        for (const l of rig.kit.logs.slice(before)) out(`   call: ${l.purpose} ${l.model} ${l.promptTokens} in, ${l.completionTokens} out, ${rupees(l.paise)}${l.ok ? "" : ` FAILED ${l.error ?? ""} ${l.why ?? ""}`}`);
        out();
        return "";
      }
    };
    out(`## 3. Asking Xode`);
    out();
    for (const [i, q] of QUESTIONS.entries()) await ask(q, `3.${i + 1}`);

    // ---- 4. the owner answers, and the first question again
    const owner = OWNER[REPO];
    if (owner) {
      await brain.answerBook(owner);
      const again = (await brain.book())!;
      out(`## 4. The owner answers the book's questions`);
      out(`For: ${owner.for}\nNext: ${owner.next}\nKeep: ${owner.keep}`);
      out(`The book now has ${again.facts.filter((f) => f.status === "confirmed").length} confirmed facts and ${again.questions.length} questions left.`);
      out();
      const text = await ask(QUESTIONS[0]!, "4.1");
      await ask(QUESTIONS[1]!, "4.2");
      await ask(QUESTIONS[3]!, "4.3");
      const words = owner.for.toLowerCase().match(/[a-z]{5,}/g) ?? [];
      const kept = words.filter((w) => text.toLowerCase().includes(w)).length;
      out(`(the answer uses ${kept} of the owner's ${words.length} longer words)`);
      out();
      out(`## 5. What a job is told`);
      out("```");
      out(named(bookForJobs(again)));
      out("```");
    }
    out();
    out(`Done in ${secs(Date.now() - t0)}. Spent ${rupees(spent())} in all, the brain included.`);
  } finally {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${lines.join("\n")}\n`);
    if (prompts.length) fs.writeFileSync(OUT.replace(/\.md$/, ".prompts.txt"), `${prompts.join("\n\n========\n\n")}\n`);
    await rig.dispose();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
