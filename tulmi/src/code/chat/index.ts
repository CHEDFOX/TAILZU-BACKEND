/**
 * TALKING ABOUT CODE: THE CODE BOT'S ANSWERS TO "HOW DOES LOGIN WORK", "WHERE IS X HANDLED", "WHY IS THIS SLOW", "WHAT BREAKS IF I CHANGE Y". The story is
 * in docs/code-chat.md.
 *
 *   question.ts   what kind of question it is, and whether it is a deep one (the strong tier), read for nothing
 *   cite.ts       every path:line in an answer is checked against what was seen; the rest is taken out
 *   flow.ts       a flow drawn from the import graph (Mermaid), by code
 *   answer.ts     the brain first, a few reads only when it must; one call of the front_code_answer role
 *   threads.ts    the conversation's rolling summary and what the last answer found (migration 0034)
 *   handoff.ts    "ok, change it": a job that starts with the place the conversation found
 *
 * The front door's `codeAnswer` road calls CodeChat.answer (front/handlers.ts); nothing else in the front door depends on how it answers. Everything it
 * needs comes in through the constructor, so the tests run it over a fixture brain, a fake GitHub and a scripted model.
 */
import type { FrontModel } from "../../front/model.js";
import type { Length } from "../../front/types.js";
import type { GatewayDeps } from "../brain/gateway.js";
import type { ModelTier } from "../brain/tiers.js";
import type { LiveFiles } from "../live/ports.js";
import type { ProjectBrain } from "../project/index.js";
import { ownProject, workspace, type ProjectDeps } from "../projects.js";
import type { CallFn } from "../work/model.js";
import type { Located } from "../work/locate.js";
import { answerCode, searchFor, type ChatAnswer } from "./answer.js";
import { handoffOf, taskFor, type Handoff } from "./handoff.js";
import { newThread, threadStore, type ChatThread, type ThreadStore } from "./threads.js";

export * from "./answer.js";
export * from "./cite.js";
export * from "./flow.js";
export * from "./handoff.js";
export * from "./question.js";
export * from "./threads.js";

export interface CodeChatDeps {
  projects: ProjectDeps;
  brain: Pick<ProjectBrain, "open">;
  call?: CallFn;
  gateway?: GatewayDeps;
  threads?: ThreadStore;
  /** The job's copy of the code, when the person has a job open on the project (grep and read with no GitHub call). Absent: GitHub reads. */
  rooms?: (userId: string, projectId: string) => Promise<Pick<LiveFiles, "read" | "grep"> | null>;
  now?: () => number;
  log?: { warn(o: object, msg: string): void };
}

export interface ChatRequest {
  userId: string;
  projectId: string;
  /** The person's own words. */
  question: string;
  /** The conversation this belongs to; none: asked on its own, nothing is kept. */
  threadId?: string;
  /** The earlier question this one follows, when the front door's rules saw that (a short follow-up): looked up together with it. */
  context?: string;
  /**
   * What the person's words ask of the last answer, written out by the front door ("??" after an answer: explain it again, simpler). The model
   * is asked `context` and this; the chat shows the person's own words, and the thread keeps `context` as the question.
   */
  ask?: string;
  tier: ModelTier;
  length: Length;
  /** The decision plans a diagram. */
  diagram: boolean;
  maxPaise: number;
  /** The default branch is read. */
  signal?: AbortSignal;
  /** The answer's words as they are written, word that they are void, and what it is doing (answer.ts ChatInput). */
  onText?: (piece: string) => void;
  onReset?: () => void;
  onStep?: (stage: string) => void;
}

const UNREAD = "X0 Bot hasn't read this project yet. Start its brain first, then ask again.";

export class CodeChat {
  private readonly threads: ThreadStore;
  private readonly now: () => number;

  constructor(private readonly d: CodeChatDeps) {
    this.threads = d.threads ?? threadStore();
    this.now = d.now ?? Date.now;
  }

  private model(userId: string, signal?: AbortSignal): FrontModel {
    return { ...(this.d.call ? { call: this.d.call } : {}), ...(this.d.gateway ? { gateway: this.d.gateway } : {}), userId, ...(signal ? { signal } : {}) };
  }

  /** The thread this turn belongs to: the one kept, or a new one with the id the app made. Null when there is no id. */
  private async threadFor(r: Pick<ChatRequest, "userId" | "projectId" | "threadId">): Promise<ChatThread | null> {
    if (!r.threadId) return null;
    const kept = await this.threads.get(r.userId, r.projectId, r.threadId).catch(() => null);
    return kept ?? newThread(r.userId, r.projectId, r.threadId, this.now());
  }

  async answer(r: ChatRequest): Promise<ChatAnswer> {
    const project = await ownProject(this.d.projects, r.userId, r.projectId);
    const brain = await this.d.brain.open(r.userId, project.id);
    const status = await brain.status();
    const thread = await this.threadFor(r);
    if (status.status === "none") {
      return {
        text: UNREAD, paise: 0, notes: ["The project has not been read."], road: "overview", reads: [], greps: [], cites: [],
        located: { targets: [], related: [], tests: [], confidence: 0, used: { expanded: false, picked: false, paise: 0 } }, thread, next: [],
      };
    }
    let ws: Awaited<ReturnType<typeof workspace>> | null = null;
    const read = async (path: string): Promise<string | null> => {
      try { ws ??= await workspace(this.d.projects, r.userId, project.id, project.defaultBranch); return (await ws.read(path)).text; } catch { return null; }
    };
    const files = (await this.d.rooms?.(r.userId, project.id).catch(() => null)) ?? null;
    const out = await answerCode({
      userId: r.userId, projectId: project.id, question: r.ask && r.context ? `${r.context}\n\n${r.ask}` : r.question,
      ...(r.ask && r.context ? { shown: r.question, kept: r.context } : {}), search: r.context ? `${r.context}. ${r.question}` : searchFor(r.question, thread), tier: r.tier, length: r.length,
      maxPaise: r.maxPaise, thread, diagram: r.diagram, now: this.now(),
      ...(r.onText ? { onText: r.onText } : {}), ...(r.onReset ? { onReset: r.onReset } : {}), ...(r.onStep ? { onStep: r.onStep } : {}),
    }, { brain, read, files }, this.model(r.userId, r.signal));
    if (out.thread) await this.threads.put(out.thread).catch((err) => this.d.log?.warn({ error: (err as Error)?.name }, "code chat: a thread was not kept"));
    return out;
  }

  /**
   * "Ok, change it": what a job made from this conversation is handed, or null when the conversation found no place in the code (then the job
   * looks for it as any job does). `task` is the job's request; `located` is where to start, and the agent does not locate again.
   */
  async handoff(userId: string, projectId: string, threadId: string, message: string): Promise<{ task: string; located: Located; handoff: Handoff } | null> {
    const thread = await this.threads.get(userId, projectId, threadId).catch(() => null);
    const h = handoffOf(thread);
    return h ? { task: taskFor(h, message), located: h.located, handoff: h } : null;
  }
}
