/**
 * WHAT A CHAT IS CALLED, AND WHICH PROJECT A TASK MEANS.
 *
 * These are one file because they are one problem. A person who says "fix the login thing" into a bot, with nothing selected
 * and no folder to read, has given a task that must land on ONE project and ONE chat. The names are what make that possible:
 * they are not decoration, they are the list the reasoning picks from.
 *
 *   nameFor(...)    a short name for a chat: the repo, and what the chat is actually about
 *   whichProject()  which of the person's projects a task means, from free signals first and a model only if it must
 *
 * THE NAME. Short enough to read in a list, and it says the two things a person needs to tell one chat from another: the repo,
 * and the thing. "tailzu-backend · the login redirect". The repo half is a fact. The thing half is the first question, cut
 * down by `thingOf` with no model at all — the words that carry meaning, the rest dropped — and a model is asked for a better
 * one ONLY when the free version comes out empty or useless, once per chat, on the cheap tier. A name is never asked for
 * twice: once a chat has one it keeps it, because a name that moves is worse than a name that is dull.
 *
 * WHICH PROJECT. In the order that costs least:
 *
 *   1. the person SAID one            a repo's name or owner/name in the words, or a path that only one project has
 *   2. there is only one              nothing to choose between
 *   3. the chat they are in           a thread already belongs to a project
 *   4. the one they were just in      their newest chat, when the task carries no sign of another
 *   5. a model, once, on the cheap tier, shown only the projects' names and what they are
 *   6. ASK BACK                       two or three to choose from, in their own words. Never a guess that spends money
 *
 * The rule under all of it: A WRONG PROJECT IS WORSE THAN A QUESTION. Steps 1 to 4 are facts and cost nothing. Step 5 is a
 * guess and must say how sure it is; under `SURE_ENOUGH` it is not used. Step 6 is what the bot does rather than start a job
 * on the wrong repository — and asking is cheap, because the question is one the person can answer in one tap.
 */
import type { Classification } from "../brain/types.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { z } from "zod";

/** The most a chat's name may be, so a list can show it whole. */
export const NAME_MAX = 48;
/** Below this the model's pick is not used: the bot asks instead. */
export const SURE_ENOUGH = 0.7;
/** The most projects shown to the model, or offered in a question. */
export const PICK_MAX = 12;
export const ASK_MAX = 3;

/** A project as the naming and the picking see it: nothing of its code, only what it is called and what it is. */
export interface ProjectBrief {
  id: string;
  /** owner/name, as GitHub has it. */
  fullName: string;
  /** One line on what it is, from the index's welcome or the book: what tells two repos apart when their names do not. */
  about?: string;
  /** When the person last had a chat or a job on it: the tie-breaker when nothing else says. */
  lastAt?: number;
}

// --------------------------------------------------------------- the name

/** The words that carry no meaning in a name: a request's scaffolding. */
const NOISE = new Set([
  "the", "a", "an", "my", "our", "this", "that", "please", "can", "you", "could", "would", "will", "should", "i", "we",
  "it", "its", "is", "are", "be", "to", "for", "of", "in", "on", "at", "and", "or", "but", "so", "then", "now", "just",
  "want", "need", "make", "let", "lets", "help", "me", "us", "there", "here", "some", "any", "all",
  // The auxiliaries a question is built from, and the words people open and close with: every chat would carry them.
  "does", "do", "did", "done", "has", "have", "had", "was", "were", "am", "been", "being",
  "thanks", "thank", "thankyou", "cheers", "hi", "hey", "hello", "ok", "okay", "yeah", "yes", "no", "sorry",
]);
/** What a person says instead of naming the thing: dropped, because every chat would be called this. */
const VERBS = new Set(["fix", "change", "update", "add", "remove", "delete", "make", "build", "write", "check", "look", "find", "see", "tell", "show", "explain", "why", "what", "where", "how", "when", "who"]);

const words = (s: string): string[] => String(s ?? "").toLowerCase().replace(/[`"'*_#>|~]+/g, " ").split(/[^a-z0-9./_-]+/).filter(Boolean);

/**
 * What a question is ABOUT, in a few words, with no model: the words that carry meaning, in the order they were said, and a
 * path or a name kept whole. Empty when the question is all scaffolding ("can you fix it please"), which is when a model is worth asking.
 */
export function thingOf(question: string, max = 34): string {
  const kept: string[] = [];
  for (const w of words(question)) {
    if (NOISE.has(w)) continue;
    if (VERBS.has(w) && kept.length === 0) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    kept.push(w);
    if (kept.join(" ").length >= max) break;
  }
  const out = kept.join(" ").slice(0, max).trim();
  return out.length >= 4 ? out : "";
}

/** The repo's own half of a name: its name without the owner, which is what a person calls it. */
export const repoOf = (fullName: string): string => String(fullName ?? "").split("/").pop() ?? "";

/** A chat's name from the repo and the question, with no model. Empty `thing` gives the repo alone, which is still a name. */
export function nameFor(o: { fullName: string; question?: string }): string {
  const repo = repoOf(o.fullName);
  const thing = o.question ? thingOf(o.question, NAME_MAX - repo.length - 3) : "";
  const name = thing ? `${repo} · ${thing}` : repo;
  return cut(name, NAME_MAX);
}

export const NameReply = z.object({ name: z.string().min(1).max(NAME_MAX) });

/**
 * A better name, asked for once, only when the free one is the repo alone and the question had something in it. The model sees
 * the question as DATA and answers a few words; what comes back is cut and joined to the repo here, so it cannot rename the repo
 * or write a sentence. A model that cannot be reached leaves the free name as it is.
 */
export async function askName(o: { fullName: string; question: string }, model: ModelCtx): Promise<string> {
  const free = nameFor(o);
  const repo = repoOf(o.fullName);
  const r = await askJson(model, {
    tier: "tiny", purpose: "code.chat_name", role: "code_name", schema: NameReply, maxTokens: 60,
    user: `<request>\n${fence(cut(forModel(o.question), 600))}\n</request>`,
  });
  if (!r.ok) return free;
  const thing = thingOf(r.value.name, NAME_MAX - repo.length - 3) || oneLine(r.value.name, NAME_MAX - repo.length - 3);
  return thing ? cut(`${repo} · ${thing}`, NAME_MAX) : free;
}

// ------------------------------------------------------- which project

export interface WhichInput {
  task: string;
  projects: readonly ProjectBrief[];
  /** The chat the person is in, when they are in one: a thread already belongs to a project. */
  threadProjectId?: string;
  /** What the front door made of the message, when it has it. */
  classification?: Classification;
}

export type Which =
  /** One project, and why, in words a person could read. */
  | { kind: "one"; projectId: string; why: string }
  /** Nobody could say: these are the ones to offer, in the question the bot asks. */
  | { kind: "ask"; options: ProjectBrief[]; question: string }
  /** The person has no projects at all: the answer is to connect one, not to choose. */
  | { kind: "none" };

/** A repo named in the words: its full name, or its own name on its own, matched whole and not as part of another word. */
export function namedIn(task: string, projects: readonly ProjectBrief[]): ProjectBrief | null {
  const said = words(task);
  const set = new Set(said);
  const joined = said.join(" ");
  // owner/name first: the least ambiguous thing a person can say.
  for (const p of projects) if (joined.includes(p.fullName.toLowerCase())) return p;
  const hits = projects.filter((p) => {
    const repo = repoOf(p.fullName).toLowerCase();
    return set.has(repo) || (repo.includes("-") && joined.includes(repo));
  });
  return hits.length === 1 ? hits[0]! : null;
}

export const PickReply = z.object({
  projectId: z.string().min(1).max(64),
  confidence: z.number().min(0).max(1),
  why: z.string().max(200),
});

/**
 * Which project a task means. Free signals first; the model only when they cannot say, and a question when the model cannot
 * either. Never throws: a model that is down is a question, which is the safe end of the ladder.
 */
export async function whichProject(i: WhichInput, model: ModelCtx | null): Promise<Which> {
  const projects = i.projects.slice(0, PICK_MAX);
  if (!projects.length) return { kind: "none" };

  // 1. They said one.
  const said = namedIn(i.task, projects);
  if (said) return { kind: "one", projectId: said.id, why: `you named ${repoOf(said.fullName)}` };

  // 2. There is only one.
  if (projects.length === 1) return { kind: "one", projectId: projects[0]!.id, why: "it is your only project" };

  // 3. The chat they are in already belongs to one.
  const here = projects.find((p) => p.id === i.threadProjectId);
  if (here) return { kind: "one", projectId: here.id, why: `this chat is about ${repoOf(here.fullName)}` };

  // 4. The one they were just in, when the task names nothing of another.
  const newest = [...projects].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];
  const theOthersNamed = projects.some((p) => p !== newest && words(i.task).includes(repoOf(p.fullName).toLowerCase()));
  if (newest?.lastAt && !theOthersNamed && onlyOneRecent(projects)) {
    return { kind: "one", projectId: newest.id, why: `it is the one you were working on` };
  }

  // 5. A model, once, shown only the names and what they are.
  if (model) {
    const r = await askJson(model, {
      tier: "tiny", purpose: "code.which_project", role: "code_which", schema: PickReply, maxTokens: 120,
      user: [
        `<request>\n${fence(cut(forModel(i.task), 600))}\n</request>`,
        `the projects:\n<data>\n${projects.map((p) => `${p.id} — ${p.fullName}${p.about ? `: ${cut(forModel(p.about), 160)}` : ""}`).join("\n")}\n</data>`,
      ].join("\n"),
    });
    if (r.ok) {
      const pick = projects.find((p) => p.id === r.value.projectId);
      // A guess must say how sure it is, and a name that is not on the list is not an answer.
      if (pick && r.value.confidence >= SURE_ENOUGH) return { kind: "one", projectId: pick.id, why: oneLine(r.value.why, 160) || `it looks like ${repoOf(pick.fullName)}` };
    }
  }

  // 6. Ask. The newest few, because those are the ones a person is likely to mean.
  const options = [...projects].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, ASK_MAX);
  return { kind: "ask", options, question: "Which project do you mean?" };
}

/** Whether one project stands out as the recent one: the newest is more recent than the next by a clear day. */
function onlyOneRecent(projects: readonly ProjectBrief[]): boolean {
  const times = projects.map((p) => p.lastAt ?? 0).sort((a, b) => b - a);
  const [first, second] = [times[0] ?? 0, times[1] ?? 0];
  return first > 0 && first - second > 86_400_000;
}
