/**
 * XODE IN A PROJECT'S CHAT: ONE LOOP, THE PROJECT IN FRONT OF IT, WHAT IT CAN DO AS TOOLS.
 *
 *   converse(input, ports, model) -> { text, job?, clarify?, cites, thread, ... }
 *
 * There is no router guessing what a message is, and no road per guess with its own prompt and its own view of the project. Every message is the
 * same loop (look.ts), in the way Claude Code works:
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
import { FrontError } from "../../front/types.js";
import type { ModelTier } from "../brain/tiers.js";
import { bookCard, bookChapter, CHAPTERS, type ProjectBook } from "../project/book.js";
import { fence, forModel } from "../work/index.js";
import { cut } from "../work/model.js";
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
  thread: ChatThread | null;
  /** Where the latest job this chat started stands (handlers.ts jobBrief), when it started one. */
  job?: string | null;
  language?: string;
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
    name: "ask_person",
    description: "Asks the person one question instead of answering, when a wrong guess would waste real work.",
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
  const book: ProjectBook | null = brain.book ? await brain.book().catch(() => null) : null;
  if (book) return bookCard(book);
  const v = await brain.status();
  return [cut(v.welcome ?? "", 900), ...v.features.slice(0, 8).map((f) => `- ${f.name}: ${cut(f.summary, 120)}`)].filter(Boolean).join("\n");
}

export async function converse(input: ConverseInput, ports: ConversePorts, model: FrontModel): Promise<Conversed> {
  const { brain } = ports;
  const [card, map] = await Promise.all([cardOf(brain), mapBrief(brain, input.message).catch(() => "")]);
  const user = [
    `<project name="${forModel(input.project.fullName).replace(/"/g, "")}">\n${fence(forModel(card))}\n</project>`,
    `<chat>\n${fence(forModel(chatBlock(input.thread, input.job)))}\n</chat>`,
    ...(map ? [`<map>\n${fence(forModel(map))}\n</map>`] : []),
    `<message>\n${forModel(input.message).replace(/<\/message/gi, "<\\/message")}\n</message>`,
    ...(input.meant ? [`(That is: ${forModel(input.meant)})`] : []),
    ...(input.language && LANGUAGE_WORDS[input.language] ? [`Answer in ${LANGUAGE_WORDS[input.language]}.`] : []),
  ].join("\n\n");

  let job: StartedJob | undefined;
  let clarify: Conversed["clarify"];
  let book: ProjectBook | null | undefined;
  const acts: Acts = {
    defs: CHAT_ACTS.filter((d) => d.name !== "project_book" || brain.book),
    exec: async (name, a) => {
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

  const anchors = new Anchors();
  // The words stream as they are written, without the "Next:" line (the chat shows those as buttons).
  const words = input.onText ? withoutNext(input.onText) : null;
  const looked = await investigate({
    model, tier: input.tier, user, tools: ports.look, anchors, maxPaise: input.maxPaise, maxTokens: CODE_ANSWER_TOKENS_MIN, role: "code_chat", acts,
    ...(words ? { onText: words.onText, onReset: () => { words.reset(); input.onReset?.(); } } : input.onReset ? { onReset: input.onReset } : {}),
    ...(input.onStep ? { onStep: input.onStep } : {}),
  });
  if (!looked.text && !job && !clarify) throw new FrontError("model_down", "I could not finish that just now. Nothing was changed; try again in a moment.", 503);

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

  let thread = input.thread;
  if (thread) {
    thread = job
      ? withJob(thread, { id: job.id, branch: job.branch, said: input.message, now: input.now })
      : afterTurn(thread, { question: input.message, cites, located: null, now: input.now, answer: checked.text, next, seen: looked.seen });
  }
  return {
    text: checked.text, paise: looked.paise, next, notes, cites, reads: looked.reads, seen: looked.seen, steps: looked.steps,
    ...(job ? { job } : {}), ...(clarify ? { clarify } : {}), thread,
  };
}
