/**
 * XODE IN A PROJECT'S CHAT: ONE LOOP, THE PROJECT IN FRONT OF IT, WHAT IT CAN DO AS TOOLS.
 *
 *   converse(input, ports, model) -> { text, job?, clarify?, cites, thread, ... }
 *
 * There is no router guessing what a message is, and no road per guess with its own prompt and its own view of the project. Every message is the
 * same loop (look.ts), in the way a coding agent works:
 *
 *   CONTEXT  the project card (book.ts bookCard: what it is and for whom, the owner's words, where it is heading, how it stands, what changed, its
 *            rules, what is not known), where the map puts what the message names, and the chat so far (its summary, the last answer, the job it
 *            started, what it read). The card is the same for every message of a project, so it stays in the model's prompt cache.
 *   TOOLS    read the code (look.ts's read-only tools), a chapter of the book in full, start a job, ask the person. The tool the model calls is the
 *            decision: "what should we do?" is answered from the card, "where is X?" is looked up, "add X" starts a job, "fix it" with nothing
 *            before it is a question back. A new thing Xode can do is a new tool, not a new rule in a prompt.
 *   TRUTH    by code, after: a path the project does not have is put right when one file has its name (cite.ts fixPaths), every path:line is
 *            checked against what was read and a line nobody read is taken out (checkCitations).
 */
import type { ToolDef } from "../brain/types.js";
import type { FrontModel } from "../../front/model.js";
import { FrontError, type Length } from "../../front/types.js";
import type { ModelTier } from "../brain/tiers.js";
import { bookCard, bookChapter, CHAPTERS, type ProjectBook } from "../project/book.js";
import { catalogsOf } from "../project/texts.js";
import { fence, forModel } from "../work/index.js";
import { cut } from "../work/model.js";
import { redactText } from "../work/worklog.js";
import { isSecretPath } from "../project/lang.js";
import { CODE_ANSWER_TOKENS_MIN, LANGUAGE_WORDS, mapBrief, plainTags, splitNext, tidy, withoutNext, type ChatBrain } from "./answer.js";
import { Anchors, checkCitations, fixPaths, keptLocations, unknownPaths } from "./cite.js";
import { investigate, type Acts, type LookTools } from "./look.js";
import { afterTurn, withJob, type ChatThread } from "./threads.js";

export interface StartedJob { id: string; branch: string; state: string; budgetPaise: number }

export interface ConverseInput {
  userId: string;
  project: { id: string; fullName: string };
  /** The person's words. */
  message: string;
  /** What a reaction ("??", "why?") asks of the last answer, as the front door's rules read it: shown beside the words. */
  meant?: string;
  /** The front door read the message as a change to make: the loop is told, and starts the job with what it found, unless it asks for something else. */
  change?: boolean;
  /** The front door read it as a question for the web, at this depth: the loop researches it with the project in front of it. */
  research?: "quick" | "standard" | "deep";
  /** The front door read the message as talk said in passing: a line or two back, as a person would, with no looking. */
  talk?: boolean;
  thread: ChatThread | null;
  /** Where the latest job this chat started stands (handlers.ts jobBrief), when it started one. */
  job?: string | null;
  language?: string;
  /** How long the answer may be (the front door's read of the message): a setup guide is long, a "thanks" short. */
  length?: Length;
  tier: ModelTier;
  maxPaise: number;
  now: number;
  onText?: (piece: string) => void;
  onReset?: () => void;
  onStep?: (stage: string) => void;
}

export interface ConversePorts {
  brain: ChatBrain;
  /** The read-only code tools (look.ts). */
  look: LookTools;
  /** A file's text on the default branch: what show_file shows exactly. Null when it cannot be read. */
  read?: (path: string) => Promise<string | null>;
  /** The web (code/webTools.ts): its web_search and read_page, for what the project cannot say (a provider's options, a version, a price). */
  web?: { defs: readonly ToolDef[]; run(name: string, args: Record<string, unknown>): Promise<string> };
  /** Starts a coding job on a new branch with this task; absent where jobs are off (the tool then says so). */
  startJob?: (task: string) => Promise<StartedJob>;
}

export interface Conversed {
  text: string;
  paise: number;
  next: string[];
  notes: string[];
  cites: string[];
  reads: string[];
  seen: string[];
  steps: number;
  job?: StartedJob;
  clarify?: { question: string; options: string[] };
  thread: ChatThread | null;
}

/** An answer that says it could not find what decides the question: a reason to look again on a tier that reasons. */
export function admitsMiss(text: string): boolean {
  return /\b(?:could not|couldn't|can't|cannot|did not|didn't|was not able to|wasn't able to|unable to)\s+(?:find|see|locate|read|confirm|tell)\b|\bnot (?:in )?(?:anything|what) I (?:read|found)\b/i.test(text);
}
/** What must be left of a message's money to climb a tier. */
const ESCALATE_MIN_PAISE = 60;

/**
 * What a change asked for owes when the loop ends it with words alone: the job, a question, or why not. Said once (look.ts `owed`); its first
 * words stay the answer if words come back.
 */
/** The steps a change asked for looks before it starts the job: enough to place the work; the job reads the code in full. */
export const CHANGE_LOOK_STEPS = 3;
export const CHANGE_OWED = "This was asked as a change to the project. If it is still to be made, start it now with start_job: the whole task, with the files and lines you found. If you need the person's say first, ask_person. If nothing is to change, say why in one line.";

/** Room for talk said in passing: a line or two, the follow-ups after. */
export const TALK_TOKENS = 300;

/** The button under a change the loop laid out but did not start (front/rules.ts reads it as a hand-off). */
export const MAKE_CHANGE = "Make that change";

/** The same words said again, near enough: the person asked again because the answer did not do. */
export function saidAgain(now: string, before: string): boolean {
  const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const a = words(now);
  const b = words(before);
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size) >= 0.7;
}

/** What one answer may show of files (show_file): files, lines of each, characters in all. And the web calls one answer may make. */
const SHOW_FILES_MAX = 3;
const SHOW_LINES_MAX = 400;
const SHOW_CHARS_MAX = 24_000;
const WEB_CALLS_MAX = 3;
/** The room an answer has, by how long the front door read it should be: a setup guide with its commands needs the most. */
const ANSWER_TOKENS: Readonly<Record<Length, number>> = { short: 800, medium: 1_400, long: 2_600 };
/** A file's language for its code block, by its extension. */
const FENCE: Readonly<Record<string, string>> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", json: "json", jsonc: "jsonc", sql: "sql", sh: "bash", bash: "bash", ps1: "powershell",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", yml: "yaml", yaml: "yaml", toml: "toml", md: "markdown",
  html: "html", css: "css", dockerfile: "dockerfile", conf: "nginx", xml: "xml", php: "php", cs: "csharp", dart: "dart",
};
const fenceOf = (path: string): string => {
  const b = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (b === "dockerfile" || b.startsWith("dockerfile.")) return "dockerfile";
  if (b === "caddyfile") return "";
  return FENCE[b.slice(b.lastIndexOf(".") + 1)] ?? "";
};
interface Shown { path: string; from: number; to: number; total: number; text: string }

/** The most of the last answer the loop is shown, and the turns of the chat it sees word for word. */
const LAST_ANSWER_CHARS = 1_500;
const TURNS_SHOWN = 3;
/** A task shorter than this names nothing a job could do. */
const TASK_MIN = 12;

export const CHAT_ACTS: readonly ToolDef[] = [
  {
    name: "project_book",
    description: "One chapter of the project book in full, each line with its source: what (it is), build, state, recent, why, direction, rules.",
    parameters: { type: "object", properties: { chapter: { type: "string", enum: [...CHAPTERS] } }, required: ["chapter"] },
  },
  {
    name: "start_job",
    description: "Makes a change the person asked for: a coding job on a new branch, checked with the project's tests, that they review before it is merged. "
      + "Put in the task what you found (the files, the functions, what is there already).",
    parameters: {
      type: "object",
      properties: { task: { type: "string", description: "The whole change: what to do, where if you know (files, functions), and how to tell it is done." } },
      required: ["task"],
    },
  },
  {
    name: "show_file",
    description: "Shows the person a file of the project exactly as it is, below your answer, to read or copy (a migration, a config, a script). "
      + "You do not repeat it. Up to 400 lines at a time; a file that holds secrets is never shown.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, from: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 } },
      required: ["path"],
    },
  },
  {
    name: "ask_person",
    description: "Asks the person one question before a change, when a wrong guess would make the wrong change. A question, even an open one, is answered: recommend, and say what would change it.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" }, description: "2 to 4 short answers they can tap." } },
      required: ["question"],
    },
  },
];

/**
 * Words that tell of the looking rather than answer, taken off the start: a lead-in ("I have enough to answer: it is…" keeps "It is…") or a whole
 * first line ("Let me check the pill."). The answer starts with the answer.
 */
export function unnarrate(text: string): string {
  const lead = /^\s*(?:I (?:have|'ve got) enough(?: to answer(?: this| that)?)?|I can answer(?: this| that| now)?)\s*[:,.\u2014-]\s*/i.exec(text);
  if (lead && text.length > lead[0].length) { const rest = text.slice(lead[0].length); return rest.charAt(0).toUpperCase() + rest.slice(1); }
  const line = /^\s*(?:Let me\b|I'll (?:look|check|read|start)\b|I will (?:look|check|read)\b|Looking (?:at|into)\b|Now I\b)[^\n]{0,160}[.:]\s*\n+/i.exec(text);
  return line && text.length > line[0].length ? text.slice(line[0].length) : text;
}

/** The chat so far, as the loop sees it: the summary, the last few turns, the job it started, what it read. */
function chatBlock(t: ChatThread | null, job: string | null | undefined): string {
  if (!t || (!t.history.length && !t.summary)) return "(new)";
  const turns = t.history.slice(-TURNS_SHOWN);
  return [
    ...(t.summary && t.history.length > TURNS_SHOWN ? [`Earlier: ${t.summary}`] : []),
    ...turns.map((x, k) => `Q: ${x.q}\nA: ${cut(x.a, k === turns.length - 1 ? LAST_ANSWER_CHARS : 500)}`),
    ...(job ? [`The job this chat started:\n${job}`] : []),
    ...(t.seen?.length ? [`Read earlier in this chat: ${t.seen.slice(-12).join(", ")}`] : []),
  ].join("\n\n");
}

/** What is known of the project when it has no book yet: the brain's welcome and its parts. */
async function cardOf(brain: ChatBrain): Promise<string> {
  const [book, screens] = await Promise.all([brain.book ? brain.book().catch(() => null) : Promise.resolve(null), screenText(brain).catch(() => "")]);
  if (book) return [bookCard(book), screens].filter(Boolean).join("\n");
  const v = await brain.status();
  return [cut(v.welcome ?? "", 900), ...v.features.slice(0, 8).map((f) => `- ${f.name}: ${cut(f.summary, 120)}`), screens].filter(Boolean).join("\n");
}

/**
 * Where the words on its screens are kept, when the project keeps them in catalogs by language: the code names a key (t(messages.deleteTeamWarning)),
 * the words are in the catalog (public/intl/messages/en-US.json), and a guess at its place (src/lang/en-US.json) finds nothing.
 */
async function screenText(brain: ChatBrain): Promise<string> {
  if (!brain.paths) return "";
  const catalogs = catalogsOf(await brain.paths()).slice(0, 3);
  return catalogs.length ? `Screen text is kept by language in ${catalogs.map((c) => `${c.base} (and ${c.copies.length - 1} other languages)`).join(", ")}.` : "";
}

/** Words a message quotes ("I get 'Failed to authenticate.'"), not an apostrophe inside a word ("it's"). */
const QUOTED = /(?<![\p{L}\p{N}])["'“‘`]([^"'“”‘’`\n]{6,160}?)["'”’`](?![\p{L}\p{N}])/gu;
/** A setting's name as the code reads it (SALT_ROTATION, DATABASE_URL). */
const SETTING_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/g;

/**
 * What a message names exactly, found in the project's index before the model looks: the words it quotes (an error a person saw, a label) and
 * the settings it names, each where it is, so "where does 'Failed to authenticate.' come from" starts from every place it is written, not from the
 * first one a search happens on. Only the index's exact matches; their lines may be cited.
 */
export async function namedIn(brain: ChatBrain, message: string, anchors: Anchors): Promise<string> {
  const asked = [...new Set([...[...message.matchAll(QUOTED)].map((m) => m[1]!.trim()), ...(message.match(SETTING_NAME) ?? [])])].slice(0, 3);
  const lines: string[] = [];
  for (const q of asked) {
    const hits = (await brain.findTexts(q, 8).catch(() => [])).filter((h) => h.text.toLowerCase().includes(q.toLowerCase()));
    for (const h of hits.slice(0, 6)) { lines.push(`${h.path}:${h.line} ${JSON.stringify(cut(h.text, 140))}`); anchors.hit(h.path, h.line); }
  }
  return lines.length ? `Where what the message names is written (every place the index has it):\n${lines.join("\n")}` : "";
}

export async function converse(input: ConverseInput, ports: ConversePorts, model: FrontModel): Promise<Conversed> {
  const { brain } = ports;
  const anchors = new Anchors();
  const [card, map, named] = await Promise.all([cardOf(brain), mapBrief(brain, input.message).catch(() => ""), namedIn(brain, input.message, anchors).catch(() => "")]);
  const user = [
    `<project name="${forModel(input.project.fullName).replace(/"/g, "")}">\n${fence(forModel(card))}\n</project>`,
    `<chat>\n${fence(forModel(chatBlock(input.thread, input.job)))}\n</chat>`,
    ...(map ? [`<map>\n${fence(forModel(map))}\n</map>`] : []),
    ...(named ? [`<found>\n${fence(forModel(named))}\n</found>`] : []),
    `<message>\n${forModel(input.message).replace(/<\/message/gi, "<\\/message")}\n</message>`,
    ...(input.meant ? [`(That is: ${forModel(input.meant)})`] : []),
    ...(input.change ? ["(Read as a change to make: start_job with the whole task and what you found, unless the message asks for something else.)"] : []),
    ...(input.talk ? ["(Said in passing, not a question: a line or two back, as a person would.)"] : []),
    ...(input.research ? [`(Read as a question for the web: research it, ${input.research}, with this project in mind, and name the sources.)`] : []),
    ...(input.language && LANGUAGE_WORDS[input.language] ? [`Answer in ${LANGUAGE_WORDS[input.language]}.`] : []),
  ].join("\n\n");

  let job: StartedJob | undefined;
  let clarify: Conversed["clarify"];
  let book: ProjectBook | null | undefined;
  const shown: Shown[] = [];
  let webCalls = 0;
  const webNames = new Set((ports.web?.defs ?? []).map((d) => d.name));
  // What earlier turns read stays citable: a follow-up ("??", "why?") answers from those lines without reading them again.
  if (input.thread?.seen?.length) anchors.earlier(input.thread.seen);
  const acts: Acts = {
    // A question back with answers to tap settles a change before work; anything else is answered (it may still ask in words, and offer what next).
    defs: [...CHAT_ACTS.filter((d) => (d.name !== "project_book" || brain.book) && (d.name !== "show_file" || ports.read) && (d.name !== "ask_person" || input.change)), ...(ports.web?.defs ?? [])],
    exec: async (name, a) => {
      if (webNames.has(name)) {
        if (++webCalls > WEB_CALLS_MAX) return { content: `No more web this time (${WEB_CALLS_MAX} calls a message): answer from what you have.` };
        input.onStep?.(name === "web_search" ? "web:search" : "web:read");
        return { content: await ports.web!.run(name, a).catch((err: unknown) => `The web did not answer: ${cut(String((err as Error)?.message ?? err), 160)}`) };
      }
      if (name === "show_file") {
        const path = String(a.path ?? "").trim().replace(/^\.\//, "");
        if (!path) return { content: "show_file needs a path." };
        // A file that holds secrets is never shown, whatever is asked: say what goes in it and where it lives instead.
        if (isSecretPath(path)) return { content: `${path} holds secrets and is never shown. Say what goes in it and where it is kept, without any value.` };
        if (shown.length >= SHOW_FILES_MAX) return { content: `At most ${SHOW_FILES_MAX} files are shown in one answer.` };
        const text = ports.read ? await ports.read(path).catch(() => null) : null;
        if (text === null) return { content: `${path} could not be read: check the path with glob or list_dir.` };
        const lines = text.split("\n");
        const from = Math.max(1, Math.min(lines.length, Number(a.from) || 1));
        const to = Math.min(lines.length, Math.max(from, Number(a.to) || lines.length), from + SHOW_LINES_MAX - 1);
        const used = shown.reduce((n, x) => n + x.text.length, 0);
        const body = redactText(lines.slice(from - 1, to).join("\n"), Math.max(500, SHOW_CHARS_MAX - used));
        shown.push({ path, from, to, total: lines.length, text: body });
        anchors.read(path, text);
        input.onStep?.(`code:read:${path}`);
        return { content: `Shown to the person below your answer, exactly: ${path} lines ${from}-${to} of ${lines.length}${to < lines.length ? " (the rest is not shown: show_file again with from and to for more)" : ""}. Do not repeat it; say what it is and how to use it.` };
      }
      if (name === "project_book") {
        book ??= brain.book ? await brain.book().catch(() => null) : null;
        return { content: book ? bookChapter(book, String(a.chapter ?? "")) : "The project book is not ready yet." };
      }
      if (name === "start_job") {
        const task = String(a.task ?? "").trim();
        if (task.length < TASK_MIN) return { content: "That task names nothing a job could do: write the whole change." };
        if (!ports.startJob) return { content: "Jobs are not switched on here: answer instead, and say how the change could be made." };
        input.onStep?.("code:job");
        job = await ports.startJob(cut(task, 20_000));
        return { content: "", end: "" };
      }
      // ask_person
      const question = cut(String(a.question ?? "").trim(), 300);
      if (!question) return { content: "ask_person needs a question." };
      const options = (Array.isArray(a.options) ? a.options : []).filter((o): o is string => typeof o === "string" && !!o.trim()).map((o) => cut(o.trim(), 60)).slice(0, 4);
      clarify = { question, options };
      return { content: "", end: question };
    },
  };

  // The words stream as they are written, without the "Next:" line (the chat shows those as buttons).
  const words = input.onText ? withoutNext(input.onText) : null;
  let looked = await investigate({
    model, tier: input.tier, user, tools: ports.look, anchors, maxPaise: input.maxPaise, maxTokens: input.talk ? TALK_TOKENS : Math.max(CODE_ANSWER_TOKENS_MIN, ANSWER_TOKENS[input.length ?? "medium"]), role: "code_chat", acts,
    ...(input.change ? { owed: CHANGE_OWED, steps: CHANGE_LOOK_STEPS } : {}),
    // An answer from the code is tested before it goes (look.ts TEST_DRAFT); talk is not, and a change is the job's to prove.
    ...(!input.talk && !input.change ? { check: true } : {}),
    ...(words ? { onText: words.onText, onReset: () => { words.reset(); input.onReset?.(); } } : input.onReset ? { onReset: input.onReset } : {}),
    ...(input.onStep ? { onStep: input.onStep } : {}),
  });
  // Stuck on the cheap tier (the steps ran out, or it says it could not find what decides it): once more on the code tier, which reasons, told
  // what was already read so that it looks elsewhere. Its answer takes the place of the first.
  if (!job && !clarify && input.tier === "cheap" && (looked.ranOut || admitsMiss(looked.text)) && input.maxPaise - looked.paise >= ESCALATE_MIN_PAISE) {
    input.onStep?.("code:think");
    if (words) { words.reset(); input.onReset?.(); }
    const read = looked.seen.length ? `Already read: ${looked.seen.slice(-14).join(", ")}.` : "Nothing was read yet.";
    const again = await investigate({
      model, tier: "code", user: `${user}\n\n(A first look did not settle it. ${read} Look where it did not, then answer.)`, tools: ports.look, anchors,
      maxPaise: input.maxPaise - looked.paise, maxTokens: input.talk ? TALK_TOKENS : Math.max(CODE_ANSWER_TOKENS_MIN, ANSWER_TOKENS[input.length ?? "medium"]), role: "code_chat", acts,
      ...(input.change ? { owed: CHANGE_OWED, steps: CHANGE_LOOK_STEPS } : {}), ...(!input.talk && !input.change ? { check: true } : {}),
      ...(words ? { onText: words.onText } : {}), ...(input.onStep ? { onStep: input.onStep } : {}),
    }).catch(() => null);
    if (again && (again.text || job || clarify)) {
      looked = { ...again, paise: looked.paise + again.paise, reads: [...new Set([...looked.reads, ...again.reads])], seen: [...looked.seen, ...again.seen], escalated: true };
    }
  }
  if (!looked.text && !job && !clarify && !shown.length) throw new FrontError("model_down", "I could not finish that just now. Nothing was changed; try again in a moment.", 503);

  // The truth, by code: a path put right when the project has one file of that name, then every line cited checked against what was read.
  const notes: string[] = [];
  const { text: said, next } = splitNext(looked.text);
  let written = tidy(plainTags(unnarrate(said)));
  if (brain.paths && unknownPaths(written, (p) => anchors.has(p)).length) {
    const all = await brain.paths().catch(() => [] as string[]);
    if (all.length) written = fixPaths(written, all).text;
  }
  const checked = checkCitations(written, anchors);
  if (checked.dropped.length) notes.push(`I took out ${checked.dropped.length} reference${checked.dropped.length === 1 ? "" : "s"} to code I could not find.`);
  const cites = keptLocations(checked.kept);
  // A secret in the words (a key the model read in a file and repeated) is taken out by code, whatever the model was told; then the files it
  // chose to show, exactly as they are on the branch (their secrets taken out the same way).
  const said2 = redactText(checked.text, 40_000);
  const files = shown.map((x) => `**\`${x.path}\`**${x.from > 1 || x.to < x.total ? ` (lines ${x.from}-${x.to} of ${x.total})` : ""}\n\n\`\`\`${fenceOf(x.path)}\n${x.text}\n\`\`\``);
  const answer = [said2, ...files].filter(Boolean).join("\n\n");
  if (files.length && input.onText) input.onText(`\n\n${files.join("\n\n")}`);

  // A change the loop laid out but did not start: one tap starts it with this plan.
  if (input.change && !job && !clarify && answer) next.unshift(MAKE_CHANGE);
  // The turn before this one fell short if this message reacts to it or says it again: kept on it, a case to test Xode on.
  const before = input.thread?.history.at(-1);
  const fell = before ? (input.meant ? "reaction" as const : saidAgain(input.message, before.q) ? "rephrase" as const : null) : null;
  let thread = input.thread && fell ? { ...input.thread, history: [...input.thread.history.slice(0, -1), { ...before!, f: fell }] } : input.thread;
  if (thread) {
    thread = job
      ? withJob(thread, { id: job.id, branch: job.branch, said: input.message, now: input.now })
      : afterTurn(thread, { question: input.message, cites, located: null, now: input.now, answer, next, seen: looked.seen });
  }
  return {
    text: answer, paise: looked.paise, next, notes, cites, reads: looked.reads, seen: looked.seen, steps: looked.steps,
    ...(job ? { job } : {}), ...(clarify ? { clarify } : {}), thread,
  };
}
