/**
 * THE PROJECT BOOK: WHAT THE PROJECT IS, HOW IT STANDS NOW, WHAT CHANGED, WHY, AND WHERE IT IS HEADING. AS FACTS, EACH WITH ITS SOURCE.
 *
 * The map (map.ts) is for the one who writes code: every component, its functions and their exact lines. The book is for everyone, the chat and the
 * jobs included: what this project is and where it is going. It is not an essay a model wrote once and that went stale. It is a list of short facts,
 * each one with where it came from (a file, a commit, a pull request, an issue, a milestone, the project's own checks, or the owner's words) and when it
 * was true, in seven chapters:
 *
 *   what        what it is and who it is for         the owner's words, the index's welcome and features
 *   build       how it is built                       the languages, frameworks, the monorepo's packages, the entry points
 *   state       how it stands now                     the project's own checks, which files a test covers, TODOs, code nothing reaches
 *   recent      what changed lately                   the commits of the last 30 days and the areas they touched, the merged pull requests
 *   why         why it is this way                    decision records, and the reasons pull requests and commits give ("because", "instead of")
 *   direction   where it is heading                   the owner's words, milestones, a roadmap file, open pull requests, open issues
 *   rules       its rules and its words               the project's own rules (CONTRIBUTING and the like), its formatter and linter
 *
 * FREE FIRST: everything here is read from GitHub and the brain's kept rows, with no model. FACTS KNOW WHERE THEY CAME FROM, and how sure they are:
 * "confirmed" (the owner said it), "found" (read from a source), "guessed" (inferred). WHAT IS NOT KNOWN IS SAID: a chapter with nothing in it says
 * why (`gaps`), and the owner is asked three short questions (who is it for, what comes next, what must not change) when the sources cannot say.
 *
 * It is made again when the default branch moves or the owner answers (index.ts BrainHandle.book), so it is the project as it is now.
 */
import type { IssueInfo, MilestoneInfo, PullSummary } from "../github.js";
import type { ProjectMap } from "./map.js";
import { classOf, isTestPath } from "./lang.js";
import type { BrainView, CommitRecord, StoredFile } from "./types.js";

export const CHAPTERS = ["what", "build", "state", "recent", "why", "direction", "rules"] as const;
export type Chapter = (typeof CHAPTERS)[number];
export const CHAPTER_TITLES: Readonly<Record<Chapter, string>> = {
  what: "What it is", build: "How it is built", state: "How it stands now", recent: "What changed lately", why: "Why it is this way",
  direction: "Where it is heading", rules: "Its rules",
};

export type FactStatus = "confirmed" | "found" | "guessed";
export interface Source { kind: "owner" | "index" | "file" | "commit" | "pull" | "issue" | "milestone" | "check"; ref: string; url?: string }
export interface BookFact { chapter: Chapter; text: string; source: Source; status: FactStatus; at: number }

export const OWNER_QUESTIONS = {
  for: "Who is this project for, and what do they mainly use it for? One or two lines.",
  next: "What should come next? The two or three things you most want built or fixed.",
  keep: "Is there anything that must not change: an API, a design, a rule?",
} as const;
export type QuestionId = keyof typeof OWNER_QUESTIONS;
export interface OwnerAnswers { for?: string; next?: string; keep?: string; at: number }

export interface ProjectBook {
  version: 1;
  project: string;
  commit: string;
  builtAt: number;
  facts: BookFact[];
  /** What could not be known, chapter by chapter, in plain words. */
  gaps: string[];
  /** What the owner is asked, when the sources cannot say. */
  questions: Array<{ id: QuestionId; text: string }>;
}

export interface BookInput {
  project: string;
  commit: string;
  now: number;
  view: Pick<BrainView, "welcome" | "structure" | "features" | "conventions" | "baseline">;
  files: readonly StoredFile[];
  map: ProjectMap | null;
  /** The newest commits of the default branch, newest first; null when they could not be read. */
  commits: ReadonlyArray<{ sha: string; message: string; at: number; body?: string }> | null;
  /** The brain's kept history: the files each commit touched. */
  history: readonly CommitRecord[];
  merged: readonly PullSummary[] | null;
  open: readonly PullSummary[] | null;
  issues: readonly IssueInfo[] | null;
  milestones: readonly MilestoneInfo[] | null;
  /** Roadmap-like files and the README, by path. */
  docs: Readonly<Record<string, string>>;
  owner: OwnerAnswers | null;
}

const DAY = 86_400_000;
const RECENT_DAYS = 30;
const one = (s: string, n = 200): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const date = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const plural = (n: number, w: string, ws = `${w}s`): string => `${n} ${n === 1 ? w : ws}`;
const isSource = (p: string): boolean => classOf(p) === "source" && !isTestPath(p);

export function buildBook(i: BookInput): ProjectBook {
  const facts: BookFact[] = [];
  const gaps: string[] = [];
  const add = (chapter: Chapter, text: string, source: Source, status: FactStatus = "found", at = i.now) => {
    const t = one(text, 280);
    if (t && !facts.some((f) => f.chapter === chapter && f.text === t)) facts.push({ chapter, text: t, source, status, at });
  };
  const index = (ref: string): Source => ({ kind: "index", ref });

  // ------------------------------------------------------------------ what it is
  if (i.owner?.for) add("what", i.owner.for, { kind: "owner", ref: "the owner" }, "confirmed", i.owner.at);
  const about = i.view.structure?.about ?? null;
  const readme = !!i.view.structure?.readme?.blurb;
  const said = about?.text && !readme ? `${about.product && !about.text.toLowerCase().includes(about.product.toLowerCase()) ? `${about.product}: ` : ""}${about.text}` : "";
  if (said) add("what", said, { kind: "file", ref: about!.path });
  const welcome = i.view.welcome.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  // With neither a README nor a manifest that says what it is, the welcome's first lines are the index's reading of the code: a guess until the owner
  // says. A welcome that only repeats the manifest (the template written when no model could) is not said twice.
  if (welcome && !(said && welcome.includes(about!.text.slice(0, 60)))) {
    add("what", welcome, index(readme ? "the project's index (README and code)" : "the project's index (its code)"), readme || said ? "found" : "guessed");
  }
  for (const f of i.view.features.slice(0, 8)) add("what", `${f.name}: ${f.summary}`, index(`feature ${f.name}`));
  if (!facts.some((f) => f.chapter === "what")) gaps.push("What it is: the index has no summary of the project yet.");

  // ------------------------------------------------------------------ how it is built
  const st = i.view.structure;
  if (st) {
    const langs = st.languages.slice(0, 4).map((l) => `${l.lang} ${Math.round(l.pct)}%`).join(", ");
    if (langs) add("build", `Written in ${langs}, ${plural(st.fileCount, "file")}.`, index("languages"));
    if (st.frameworks.length) add("build", `Built with ${st.frameworks.slice(0, 6).join(", ")}.`, index("frameworks"));
    if (st.monorepo) add("build", `${/repo\b/i.test(st.monorepo.tool) ? `A ${st.monorepo.tool}` : `A ${st.monorepo.tool} monorepo`} of ${plural(st.monorepo.packages.length, "package")}: ${st.monorepo.packages.slice(0, 8).map((p) => p.name).join(", ")}.`, index("monorepo"));
    for (const e of st.entryPoints.filter((x) => !ASIDE.test(x.path)).slice(0, 4)) add("build", `Starts at ${e.path} (${e.why}).`, { kind: "file", ref: e.path });
    if (st.ci.length) add("build", `CI: ${st.ci.slice(0, 4).join(", ")}.`, index("ci"));
  }
  // The owners' own overview of how it is built, when they wrote one.
  for (const [path, text] of Object.entries(i.docs)) if (ARCH_DOC.test(path)) { const p = firstParagraph(text); if (p) add("build", p, { kind: "file", ref: path }); }

  // ------------------------------------------------------------------ how it stands now
  const base = i.view.baseline;
  const results = base?.recorded?.results ?? [];
  if (results.length) {
    for (const r of results.filter((x) => x.kind !== "install")) {
      add("state", r.exitCode === 0 ? `${r.kind}: passes.` : `${r.kind}: fails${r.failing?.length ? ` (${plural(r.failing.length, "failure")}, the first: ${one(r.failing[0]!, 90)})` : ""}.`,
        { kind: "check", ref: `${r.kind} at ${base!.recorded!.headSha.slice(0, 7)}` }, "found", base!.recorded!.at);
    }
  } else gaps.push("How it stands: the project's own checks have not been run yet (they run before the first change).");
  const source = i.files.filter((f) => isSource(f.path));
  if (source.length) {
    const tested = source.filter((f) => f.tests.length).length;
    add("state", `${tested} of ${plural(source.length, "source file")} have a test that imports them (${Math.round((tested / source.length) * 100)}%).`, index("tests"));
    const risky = source.filter((f) => f.hot >= 2 && !f.tests.length).sort((a, b) => b.hot - a.hot).slice(0, 5);
    for (const f of risky) add("state", `${f.path} changed ${plural(f.hot, "time")} lately and no test covers it.`, { kind: "file", ref: f.path });
    const todo = source.reduce((n, f) => n + f.todo, 0);
    if (todo) {
      const top = source.filter((f) => f.todo).sort((a, b) => b.todo - a.todo).slice(0, 3);
      add("state", `${plural(todo, "TODO or FIXME", "TODOs and FIXMEs")} in the code, ${top[0]!.todo > 1 ? "most in" : "in"} ${top.map((f) => (top[0]!.todo > 1 ? `${f.path} (${f.todo})` : f.path)).join(", ")}.`, index("todo"));
    }
  }
  if (i.map) {
    // Only code that is reached by imports: a shell script, a SQL file or a workflow is run by name, and nothing ever imports it.
    const unused = Object.values(i.map.components).filter((c) => c.live === false && IMPORTED.test(c.path) && !ASIDE.test(c.path));
    if (unused.length) add("state", `${plural(unused.length, "file")} nothing reaches from the entry points, such as ${unused.slice(0, 3).map((c) => c.path).join(", ")}.`, index("project map"), "guessed");
  }

  // ------------------------------------------------------------------ what changed lately
  if (i.commits?.length) {
    const last = i.commits[0]!;
    add("recent", `Last change ${date(last.at)}: ${one(last.message, 120)}`, { kind: "commit", ref: last.sha.slice(0, 7) }, "found", last.at);
    const since = i.now - RECENT_DAYS * DAY;
    const recent = i.commits.filter((c) => c.at >= since);
    if (recent.length) {
      const kinds = new Map<string, number>();
      for (const c of recent) { const k = /^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)(?:\(|!|:)/i.exec(c.message)?.[1]?.toLowerCase(); if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1); }
      // The kinds only when the project names them (feat:, fix:): four "docs:" among a hundred commits is not what the month was.
      const named = [...kinds.values()].reduce((a, b) => a + b, 0);
      const kindLine = named >= recent.length * 0.3 ? [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${KIND_WORDS[k] ?? k}`).join(", ") : "";
      const all = recent.length === i.commits.length && i.commits.length >= 100;
      add("recent", `${all ? `${recent.length} or more commits` : plural(recent.length, "commit")} in the last ${RECENT_DAYS} days${kindLine ? `: ${kindLine}` : ""}.`, { kind: "commit", ref: `${recent.at(-1)!.sha.slice(0, 7)}..${last.sha.slice(0, 7)}` });
      const shas = new Set(recent.map((c) => c.sha));
      const top = busiestAreas(i.history.filter((h) => shas.has(h.sha)).map((h) => h.files), 4);
      if (top.length) add("recent", `Most work in ${top.map(([a, n]) => `${a} (${plural(n, "commit")})`).join(", ")}.`, index("history"));
    } else add("recent", `No commit in the last ${RECENT_DAYS} days.`, { kind: "commit", ref: last.sha.slice(0, 7) });
  } else gaps.push("What changed lately: the history could not be read.");
  for (const p of (i.merged ?? []).slice(0, 8)) add("recent", `Merged #${p.number} ${date(p.at)}: ${p.title}`, { kind: "pull", ref: `#${p.number}`, url: p.url }, "found", p.at);

  // ------------------------------------------------------------------ why it is this way
  for (const f of i.files.filter((x) => DECISION_DOC.test(x.path)).slice(0, 8)) add("why", `Decision record: ${f.path}${f.summary ? `, ${one(f.summary, 140)}` : ""}`, { kind: "file", ref: f.path });
  for (const p of i.merged ?? []) for (const s of reasonsIn(p.body).slice(0, 2)) add("why", `#${p.number} (${one(p.title, 60)}): ${s}`, { kind: "pull", ref: `#${p.number}`, url: p.url }, "found", p.at);
  for (const c of (i.commits ?? []).slice(0, 100)) {
    const inBody = reasonsIn(c.body ?? "")[0];
    const reason = inBody ? `${one(c.message, 70)}: ${inBody}` : reasonsIn(c.message)[0];
    if (reason) add("why", reason, { kind: "commit", ref: c.sha.slice(0, 7) }, "found", c.at);
  }
  trim(facts, "why", 12);
  if (!facts.some((f) => f.chapter === "why")) gaps.push("Why it is this way: no decision records, and no reasons in the recent pull requests and commits.");

  // ------------------------------------------------------------------ where it is heading
  if (i.owner?.next) add("direction", `Next, in the owner's words: ${i.owner.next}`, { kind: "owner", ref: "the owner" }, "confirmed", i.owner.at);
  if (i.owner?.keep) add("direction", `Must not change: ${i.owner.keep}`, { kind: "owner", ref: "the owner" }, "confirmed", i.owner.at);
  for (const m of (i.milestones ?? []).slice(0, 5)) {
    add("direction", `Milestone "${m.title}": ${m.closed} of ${m.open + m.closed} done${m.dueOn ? `, due ${date(m.dueOn)}` : ""}${m.description ? `. ${one(m.description, 120)}` : ""}`, { kind: "milestone", ref: m.title, url: m.url });
  }
  for (const [path, text] of Object.entries(i.docs)) for (const line of planLines(path, text).slice(0, 6)) add("direction", line, { kind: "file", ref: path });
  for (const p of (i.open ?? []).slice(0, 6)) add("direction", `In flight: #${p.number} ${p.title}${p.draft ? " (draft)" : ""}`, { kind: "pull", ref: `#${p.number}`, url: p.url }, "found", p.at);
  if (i.issues) {
    if (i.issues.length) {
      const bugs = i.issues.filter((x) => x.labels.some((l) => /bug|defect|regression/i.test(l))).length;
      const asks = i.issues.filter((x) => x.labels.some((l) => /feature|enhancement|request|proposal/i.test(l))).length;
      add("direction", `${plural(i.issues.length, "open issue")}${i.issues.length >= 50 ? " or more" : ""}${bugs || asks ? `: ${plural(bugs, "bug")}, ${plural(asks, "feature request")}` : ""}.`, { kind: "issue", ref: "open issues" });
      const top = [...i.issues].sort((a, b) => b.comments - a.comments || b.updatedAt - a.updatedAt).slice(0, 5);
      for (const x of top) add("direction", `#${x.number} ${x.title}${x.labels.length ? ` [${x.labels.slice(0, 3).join(", ")}]` : ""}${x.comments ? `, ${plural(x.comments, "comment")}` : ""}`, { kind: "issue", ref: `#${x.number}`, url: x.url }, "found", x.updatedAt);
    } else add("direction", "No open issues.", { kind: "issue", ref: "open issues" });
  } else gaps.push("Where it is heading: the issues could not be read (the GitHub App may not be allowed to read them).");

  // ------------------------------------------------------------------ its rules
  const conv = i.view.conventions;
  if (conv) {
    if (conv.formatter.length || conv.linter.length) add("rules", `Formatted with ${conv.formatter.join(", ") || "nothing named"}; linted with ${conv.linter.join(", ") || "nothing named"}.`, index("conventions"));
    for (const r of (conv.rules ?? []).slice(0, 6)) add("rules", `${r.path}: ${one(r.text, 160)}`, { kind: "file", ref: r.path });
  }

  // ------------------------------------------------------------------ what to ask the owner
  const questions: ProjectBook["questions"] = [];
  if (!i.owner?.for) questions.push({ id: "for", text: OWNER_QUESTIONS.for });
  if (!i.owner?.next) questions.push({ id: "next", text: OWNER_QUESTIONS.next });
  if (!i.owner?.keep) questions.push({ id: "keep", text: OWNER_QUESTIONS.keep });
  if (!i.owner?.next && !facts.some((f) => f.chapter === "direction" && (f.source.kind === "milestone" || f.source.kind === "file"))) {
    gaps.push("Where it is heading: no milestones or roadmap file, so this rests on open pull requests and issues until the owner says.");
  }
  return { version: 1, project: i.project, commit: i.commit, builtAt: i.now, facts, gaps, questions };
}

const KIND_WORDS: Record<string, string> = { feat: "features", fix: "fixes", refactor: "refactors", docs: "docs changes", test: "test changes", chore: "chores", perf: "speed-ups", build: "build changes", ci: "CI changes", style: "style changes" };
const DECISION_DOC = /(^|\/)(?:adr|adrs|decisions?|rfcs?)\/[^/]+\.(?:md|mdx|rst|txt)$/i;
/** Paths that are not the project's own running code: fixtures, examples, tests, vendored copies. */
const ASIDE = /(^|\/)(?:fixtures?|examples?|samples?|e2e|tests?|__tests__|vendor|third_party|evals?|bench(?:marks?)?)\/|\.d\.ts$/i;
/** Languages whose files are reached by imports, so "nothing reaches it" means something. */
const IMPORTED = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|dart|vue|svelte)$/i;
/** The owners' own overview of how the project is built. */
const ARCH_DOC = /(^|\/)(?:architecture|overview|design)\.(?:md|txt)$/i;

/** The first paragraph of a document that says something (not a heading, a badge or a table), cut to one line. */
function firstParagraph(text: string): string {
  for (const block of text.split(/\n\s*\n/)) {
    const t = block.replace(/^\s*>\s?/gm, "").trim();
    if (!t || /^(?:#|!\[|\||<|```|---|\[!)/.test(t) || t.length < 40) continue;
    return one(t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""), 260);
  }
  return "";
}
const REASON = /\b(?:because|so that|in order to|instead of|rather than|to avoid|we (?:decided|chose|moved|switched)|the reason|trade-?off|otherwise)\b/i;

/** A path's folder `depth` deep ("tulmi/src/code" at 3), or "" for a file that is not that deep in. */
/** Files at the root of the repo, as an area of their own. */
export const TOP_LEVEL = "top-level files";
/** A file's folder, at most `depth` folders deep; a file at the root is in TOP_LEVEL. */
const folderOf = (path: string, depth: number): string => { const dir = path.split("/").slice(0, -1); return dir.length ? dir.slice(0, depth).join("/") : TOP_LEVEL; };

/**
 * Where the commits went, as folders, deep enough to say something: a folder that holds most of the work ("tulmi/src" in a repo whose code is all
 * there) is split into the folders under it, down to four deep. Each commit counts once a folder.
 */
export function busiestAreas(commits: ReadonlyArray<readonly string[]>, n: number): Array<[string, number]> {
  let depth = 2;
  let counted: Array<[string, number]> = [];
  for (; depth <= 4; depth++) {
    const areas = new Map<string, number>();
    for (const files of commits) for (const a of new Set(files.map((f) => folderOf(f, depth)))) areas.set(a, (areas.get(a) ?? 0) + 1);
    counted = [...areas].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    // Deeper only while one folder holds most of the work and can still be split.
    const top = counted[0];
    if (!top || top[1] <= commits.length * 0.5 || top[0] === TOP_LEVEL || top[0].split("/").length < depth || depth === 4) break;
  }
  return counted.slice(0, n);
}

/** Sentences that give a reason, from a pull request's text or a commit message. */
export function reasonsIn(text: string): string[] {
  const clean = text.replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " ").replace(/^#+\s.*$/gm, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // A paragraph's wrapped lines are one text (commit bodies wrap at ~72 columns); a bullet starts a text of its own.
  const texts = clean.split(/\n\s*\n/).flatMap((para) => para.split(/\n(?=\s*(?:[-*+]|\d+\.)\s)/).map((t) => t.replace(/\s*\n\s*/g, " ")));
  return texts.flatMap((t) => t.split(/(?<=[.!?])\s+(?=[A-Z"'(])/)).map((s) => s.replace(/^[-*+>\s]+|^\d+\.\s+/g, "").trim())
    .filter((s) => s.length >= 25 && s.length <= 260 && REASON.test(s)).map((s) => one(s, 220));
}

/** The plan in a roadmap file, or under a README heading about what is next: its bullets. */
export function planLines(path: string, text: string): string[] {
  if (ARCH_DOC.test(path)) return [];
  const roadmapFile = /(^|\/)(?:roadmap|plans?|todo|backlog|[\w-]*gaps)\.(?:md|txt)$/i.test(path);
  // A list of what is missing (a gaps file, a backlog, a TODO list) holds open items, not plans.
  const open = /(^|\/)(?:todo|backlog|[\w-]*gaps)\.(?:md|txt)$/i.test(path);
  const out: string[] = [];
  let inPlan = roadmapFile;
  for (const line of text.split("\n")) {
    const h = /^#{1,4}\s+(.+)$/.exec(line);
    if (h) { inPlan = roadmapFile || /\b(?:roadmap|planned|coming|next|future|todo|upcoming)\b/i.test(h[1]!); continue; }
    if (!inPlan) continue;
    const b = /^\s*(?:[-*+]|\d+\.)\s+(?:\[( |x)\]\s+)?(.+)$/i.exec(line);
    if (!b || b[2]!.trim().length < 2) continue;
    const item = b[2]!.trim();
    // Done: ticked, struck through, or marked with a check mark. A list of what is missing keeps only what is still missing.
    const done = b[1]?.toLowerCase() === "x" || /^(?:✓|✔|✅|~~)/.test(item) || /^\*?\*?done\b/i.test(item);
    if (done && open) continue;
    out.push(`${done ? "Done" : open ? "Open" : "Planned"}: ${one(item.replace(/^(?:✓|✔|✅)\s*|~~/g, ""), 160)}`);
  }
  return out;
}

function trim(facts: BookFact[], chapter: Chapter, max: number): void {
  let n = 0;
  for (let k = 0; k < facts.length; k++) {
    if (facts[k]!.chapter !== chapter) continue;
    if (++n > max) { facts.splice(k, 1); k--; }
  }
}

const sourceWords = (s: Source): string => (s.kind === "owner" ? "you said" : s.kind === "index" ? s.ref : `${s.kind} ${s.ref}`);

/** The book as a person reads it: the chapters in order, every fact with where it came from; ✓ the owner confirmed it, ~ it is a guess. */
export function bookMarkdown(b: ProjectBook): string {
  const out = [`# ${b.project}: the project book`, "", `As of commit \`${b.commit.slice(0, 7)}\`, ${date(b.builtAt)}. Each line says where it comes from; ✓ means you confirmed it, ~ means it is a guess.`];
  // The owner's questions first, as on the app's page: their three answers say more than any chapter the code can give.
  if (b.questions.length) out.push("", "## Questions for you", "", ...b.questions.map((q) => `- ${q.text}`));
  for (const c of CHAPTERS) {
    const fs = b.facts.filter((f) => f.chapter === c);
    if (!fs.length) continue;
    out.push("", `## ${CHAPTER_TITLES[c]}`, "", ...fs.map((f) => `- ${f.status === "confirmed" ? "✓ " : f.status === "guessed" ? "~ " : ""}${f.text} _(${sourceWords(f.source)})_`));
  }
  if (b.gaps.length) out.push("", "## Not known yet", "", ...b.gaps.map((g) => `- ${g}`));
  return out.join("\n");
}

const STOP = new Set(["the", "and", "for", "what", "where", "when", "how", "why", "this", "that", "with", "does", "are", "was", "its", "it's", "from", "into", "about", "project", "repo"]);
const wordsOf = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
const ASKS: ReadonlyArray<[RegExp, Chapter]> = [
  [/\b(?:heading|roadmap|next|plan|plans|planned|future|goal|goals|priorit\w*|milestone)\b/i, "direction"],
  [/\b(?:why|reason|decid\w*|decision|chose|choice)\b/i, "why"],
  [/\b(?:recent\w*|lately|changed|latest|last\s+(?:week|month))\b/i, "recent"],
  [/\b(?:health|broken|failing|passing|state|status|tested|coverage|todo|debt|risky)\b/i, "state"],
  [/\b(?:stack|built|architecture|framework|language|monorepo|packages)\b/i, "build"],
  [/\b(?:rules?|conventions?|style|lint\w*|format\w*)\b/i, "rules"],
  [/\b(?:what\s+is|what's|who\s+is\s+it\s+for|purpose|about|overview|for\s+whom)\b/i, "what"],
];

/**
 * The few facts that matter to a question, for a prompt: the owner's own words always, the chapter the question is about, then the facts sharing its
 * words, then the state of the checks. One line each, with the source, at most `limit`.
 */
export function bookBrief(b: ProjectBook, question: string, limit = 10): string {
  const want = wordsOf(question);
  const chapters = new Set(ASKS.filter(([re]) => re.test(question)).map(([, c]) => c));
  const score = (f: BookFact): number => (f.status === "confirmed" ? 100 : 0) + (chapters.has(f.chapter) ? 50 : 0)
    + [...wordsOf(f.text)].filter((w) => want.has(w)).length * 10 + (f.chapter === "state" && f.source.kind === "check" ? 5 : 0);
  const picked = b.facts.map((f, k) => ({ f, k, s: score(f) })).filter((x) => x.s > 0).sort((a, c) => c.s - a.s || a.k - c.k).slice(0, limit).sort((a, c) => a.k - c.k);
  const gaps = b.gaps.filter((g) => [...chapters].some((c) => g.startsWith(`${CHAPTER_TITLES[c]}:`)));
  // A question the owner has not answered yet, when this one is about it: the chat can say where they can answer it, and the book keeps it.
  const open = b.questions.filter((q) => [...chapters].some((c) => QUESTION_CHAPTER[q.id] === c));
  return [
    ...picked.map(({ f }) => `[${CHAPTER_TITLES[f.chapter]}] ${f.text} (${f.source.kind === "owner" ? "the owner said: newer than the README, the docs and any earlier answer, and right where they differ" : sourceWords(f.source)})`),
    ...gaps.map((g) => `[not known] ${g}`),
    ...open.map((q) => `[the owner has not answered] ${q.text} (the person can answer it on the Project book page: the book button on the project's page)`),
  ].join("\n");
}

/** The chapter each of the owner's questions fills. */
const QUESTION_CHAPTER: Readonly<Record<QuestionId, Chapter>> = { for: "what", next: "direction", keep: "direction" };

/** When the owner last said something in the book: answers given before then may be out of date. 0 when they never have. */
export const ownerSaidAt = (b: ProjectBook): number => Math.max(0, ...b.facts.filter((f) => f.source.kind === "owner").map((f) => f.at));

/** What a job is told of the book: the owner's words, where it is heading, what changed lately. A few lines, for the agent's project memory. */
export function bookForJobs(b: ProjectBook): string {
  const pick = (c: Chapter, n: number) => b.facts.filter((f) => f.chapter === c).slice(0, n).map((f) => `- ${f.status === "confirmed" ? "(the owner) " : ""}${f.text}`);
  const heading = pick("direction", 6);
  const recent = pick("recent", 3);
  const what = b.facts.filter((f) => f.chapter === "what" && f.status === "confirmed").map((f) => `- (the owner) ${f.text}`);
  return [
    ...(what.length ? ["## Who it is for", ...what] : []),
    ...(heading.length ? ["## Where the project is heading", ...heading] : []),
    ...(recent.length ? ["## Recent work", ...recent] : []),
  ].join("\n");
}

/** An owner's answers, cleaned: each one line of plain text, 400 characters at most; an empty one is left out. Null when there is none at all. */
export function cleanAnswers(raw: unknown, now: number, prev: OwnerAnswers | null): OwnerAnswers | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: OwnerAnswers = { ...(prev ?? {}), at: now };
  let any = false;
  for (const id of Object.keys(OWNER_QUESTIONS) as QuestionId[]) {
    const v = o[id];
    if (typeof v !== "string") continue;
    const t = one(v.replace(/[<>]/g, " "), 400);
    if (t) { out[id] = t; any = true; } else delete out[id];
  }
  return any || prev ? out : null;
}
