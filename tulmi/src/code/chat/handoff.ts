/**
 * "OK, CHANGE IT": A QUESTION TURNS INTO A JOB, AND THE JOB IS HANDED WHAT THE CONVERSATION ALREADY FOUND.
 *
 * Talking about code ends, often, in "ok, change it". Starting that as an ordinary job would look for the place again (the locate phase) and might not
 * find the one the conversation did. So the thread keeps where its last answer found the code (threads.ts `lastLocated`), and a job made from the
 * conversation gets it as its located files, marked as coming from the chat: the agent's locate phase takes them as they are (agent/phases.ts), as it does
 * for a design the person approved. The job's TASK says what was asked and what is meant now, in the person's own words and Tailzu's file names; none of the
 * answer's prose goes into it.
 */
import type { Located } from "../work/locate.js";
import type { ChatThread } from "./threads.js";

export interface Handoff {
  located: Located;
  /** The last question asked, the person's words. */
  question: string;
  /** The files and lines the last answer rested on. */
  cites: string[];
  /** The conversation so far, as the thread's summary keeps it. */
  summary: string;
}

/** What a job is handed from a thread, or null when the conversation found no place in the code. */
export function handoffOf(thread: ChatThread | null): Handoff | null {
  if (!thread?.lastLocated?.targets.length) return null;
  return { located: thread.lastLocated, question: thread.lastQuestion, cites: thread.lastCites, summary: thread.summary };
}

/** The job's task: what the talk was about, where it found the code, and what the person now asks. */
export function taskFor(h: Handoff, message: string): string {
  const where = h.located.targets.slice(0, 4).map((t) => `${t.path}${t.lines ? `:${t.lines[0]}` : ""}`).join(", ");
  return [
    `The person asked about the code and now wants a change. What they say now: ${message.trim()}`,
    ...(h.question ? [`What they asked about before: ${h.question}`] : []),
    `The conversation found the place already: ${where}. Start there; do not look for it again.`,
    ...(h.summary ? [`The conversation so far:\n${h.summary}`] : []),
  ].join("\n\n");
}
