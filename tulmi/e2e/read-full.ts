/**
 * A WHOLE PROJECT READ, EVERY PART DESCRIBED AND TIED TO THE MAP, WITH REAL MODELS; THEN A PUSH THAT CHANGES ONE FUNCTION.
 *
 *   npx tsx e2e/read-full.ts --repo chedfox/tailzu-desktop --dir /path/to/checkout [--strip-docs] [--budget-inr 20] [--out file.md]
 *
 * 1. The checkout is a project on the rig's local GitHub; it is added with no model money (the structure, the symbols, the map: all code).
 * 2. A full read (depth "full"): every source file whole, every part given what it does and what people call it (summarize.ts cardFiles).
 *    Reported: what it cost, how long, how many calls, how much of the project has words.
 * 3. Three components as their cards (map.ts componentCard): the words beside the map's exact lines and connections.
 * 4. A push that changes one line inside one function: the next build describes that function again and nothing else.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRig, USER } from "./adapters/rig.js";
import { classOf } from "../src/code/project/lang.js";
import { isTestPath } from "../src/code/project/lang.js";
import { cardable } from "../src/code/project/summarize.js";
import { componentCard } from "../src/code/project/map.js";

const arg = (name: string, d = ""): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const REPO = arg("repo");
const DIR = arg("dir");
const STRIP_DOCS = process.argv.includes("--strip-docs");
const BUDGET = Math.round(Number(arg("budget-inr", "20")) * 100);
const OUT = arg("out", path.join("e2e", "out", `read-full-${REPO.replace(/\W+/g, "-")}.md`));
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO) || !DIR) throw new Error("Use --repo owner/name --dir /path/to/checkout");

const rupees = (p: number): string => `₹${(p / 100).toFixed(2)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean)) {
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
  const files = filesOf(DIR);
  const rig = await createRig({ mode: "real", brainBudgetPaise: 0, room: false, log: (m) => { if (/^warn /.test(m)) console.error(m); } });
  const spent = (purpose?: RegExp) => Math.ceil(rig.kit.logs.filter((l) => !purpose || purpose.test(l.purpose)).reduce((n, l) => n + l.paise, 0));
  try {
    const short = REPO.split("/")[1]!;
    const h = await rig.addProjectFor({ id: short, repo: "synthetic", base: { files }, checks: {}, oracle: {} } as never, short);
    const sourceChars = Object.entries(files).filter(([p]) => classOf(p) === "source" && !isTestPath(p)).reduce((n, [, t]) => n + t.length, 0);
    out(`# A whole project read: ${REPO}${STRIP_DOCS ? " (docs stripped)" : ""}`);
    out(`${new Date().toISOString().slice(0, 10)}. ${Object.keys(files).length} files, ${(sourceChars / 1e6).toFixed(2)} MB of source code (tests not counted). Cap ${rupees(BUDGET)}.`);
    out();

    // ---- the full read, after the estimate a person is shown
    const est = await (await rig.code.brain!.open(USER, h.project.id)).readEstimate();
    out(`Estimate shown before the read: ${rupees(est.paise)}, about ${est.minutes} min, ${est.files} source files, ${est.mb} MB.`);
    out();
    const t0 = Date.now();
    const before = rig.kit.logs.length;
    await rig.code.brain!.build(USER, h.project.id, { mode: "full", depth: "full", budgetPaise: BUDGET });
    const ms = Date.now() - t0;
    const calls = rig.kit.logs.slice(before);
    const brain = await rig.code.brain!.open(USER, h.project.id);
    const status = await brain.status();
    const paths = await brain.paths();
    let parts = 0, described = 0, srcFiles = 0, withLine = 0;
    for (const p of paths) {
      if (classOf(p) !== "source" || isTestPath(p)) continue;
      const f = await brain.file(p);
      if (!f) continue;
      srcFiles += 1;
      if (f.summary) withLine += 1;
      const want = cardable(f.symbols);
      parts += want.length;
      described += want.filter((i) => f.symbols[i]!.does).length;
    }
    const cardCalls = calls.filter((l) => l.purpose === "brain.cards");
    out("## The full read");
    out(`- Cost: ${rupees(spent())} in all, of which the parts ${rupees(Math.ceil(cardCalls.reduce((n, l) => n + l.paise, 0)))} (${cardCalls.length} calls); time ${secs(ms)}; summaries ${(status as { summaries?: string }).summaries ?? "?"}.`);
    out(`- Words: ${described} of ${parts} parts (${parts ? Math.round((described / parts) * 100) : 0}%) in ${srcFiles} source files; ${withLine} files have their line.`);
    out(`- Tokens read: ${cardCalls.reduce((n, l) => n + l.promptTokens, 0).toLocaleString("en-US")} in, ${cardCalls.reduce((n, l) => n + l.completionTokens, 0).toLocaleString("en-US")} out; models: ${[...new Set(cardCalls.map((l) => l.model))].join(", ")}.`);
    const failed = cardCalls.filter((l) => !l.ok);
    if (failed.length) out(`- Failed calls: ${failed.length}: ${[...new Set(failed.map((l) => `${l.error ?? "?"}${l.why ? ` (${l.why.slice(0, 120)})` : ""}`))].slice(0, 4).join("; ")}.`);
    out(`- Per MB of source: ${rupees(Math.ceil(cardCalls.reduce((n, l) => n + l.paise, 0) / Math.max(0.01, sourceChars / 1e6)))}.`);
    out();

    // ---- three cards
    const map = (await brain.projectMap())!;
    const ranked = Object.values(map.components).filter((c) => c.symbols.some((s) => s.does)).sort((a, b) => b.symbols.length - a.symbols.length);
    const picks = [ranked.find((c) => c.symbols.length >= 4 && c.symbols.length <= 12), ranked.find((c) => c.usedBy.length >= 2), ranked.find((c) => c.calls.length >= 2)]
      .filter((c, i, all): c is NonNullable<typeof c> => !!c && all.findIndex((x) => x?.path === c.path) === i);
    out("## Three components, as the map now shows them");
    for (const c of picks) { out("```"); out(componentCard(map, c.path, { max: 12 })!); out("```"); }
    out();

    // ---- a push that changes one line inside one function
    let target: { path: string; name: string; line: number; end: number } | null = null;
    for (const c of Object.values(map.components)) {
      const s = c.symbols.find((x) => x.kind === "function" && x.end && x.end - x.start >= 4 && x.does && x.hash);
      if (s && files[c.path]) { target = { path: c.path, name: s.name, line: s.start, end: s.end! }; break; }
    }
    if (target) {
      const text = files[target.path]!.split("\n");
      text.splice(target.line, 0, "  // changed by the update test: one new line inside this function");
      const others = (await brain.file(target.path))!.symbols.filter((s) => s.does && s.name !== target!.name).map((s) => [s.name, s.does!] as const);
      await h.repo.push(h.repo.defaultBranch, { [target.path]: text.join("\n") }, "Change one function");
      const u0 = rig.kit.logs.length;
      const t1 = Date.now();
      // What an update gets on the server: a fifth of the import budget (₹10), as INCREMENTAL_BUDGET_SHARE gives it.
      await rig.code.brain!.build(USER, h.project.id, { mode: "incremental", budgetPaise: 200 });
      const upd = rig.kit.logs.slice(u0).filter((l) => l.purpose === "brain.cards");
      const after = (await brain.file(target.path))!;
      const kept = others.filter(([n, d]) => after.symbols.find((s) => s.name === n)?.does === d).length;
      const fn = after.symbols.find((s) => s.name === target!.name);
      out("## A push that changes one function");
      out(`- Changed: ${target.path}, one line inside ${target.name}() (lines ${target.line}-${target.end}).`);
      out(`- The next build: ${upd.length} call(s), ${rupees(Math.ceil(upd.reduce((n, l) => n + l.paise, 0)))}, ${secs(Date.now() - t1)}; the other ${others.length} described parts of that file kept their words: ${kept} of ${others.length}.`);
      out(`- ${target.name} now: lines ${fn?.line}-${fn?.endLine}, ${fn?.does ? `"${fn.does}"` : "no words"}.`);
    } else out("(no function with a fingerprint to change)");
    out();
    out(`Spent ${rupees(spent())} in all.`);
  } finally {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${lines.join("\n")}\n`);
    await rig.dispose();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
