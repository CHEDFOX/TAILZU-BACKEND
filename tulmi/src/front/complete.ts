/**
 * A MESSAGE MADE COMPLETE BEFORE ANYTHING IS LOOKED UP.
 *
 * "and the logout?" after "where is the login checked?" means "where is the logout checked?". What is searched for, and what the model is told
 * the person meant, is the complete message, so a short follow-up finds the right files, facts and pages instead of whatever its few words match.
 *
 *   completeMessage(model, { message, lastQuestion, lastAnswer })
 *
 * A message that stands on its own is used as it is, for nothing. Only a short or pointing one (code/chat/question.ts isFollowUp) with a question
 * before it asks the tiny model, once, with the last question, the start of the last answer and the message, all as data (role front_complete).
 * A model that is down, over budget or answers with something that is not one line falls back to the last question in front of the message,
 * which is what was done before. The person's words are never changed in the chat: this is what is looked up with, and what the model is told
 * they meant.
 */
import { isFollowUp } from "../code/chat/question.js";
import { fence, forModel } from "../code/work/index.js";
import { cut } from "../code/work/model.js";
import { askText, type FrontModel } from "./model.js";

export interface CompleteInput {
  message: string;
  /** The question this message may go on from. */
  lastQuestion?: string;
  /** What was answered to it: its start is enough to know what "it" is. */
  lastAnswer?: string;
  /** Already known to go on from lastQuestion (the front door's rules saw it): complete it whatever its length. */
  followUp?: boolean;
}

export interface Completed {
  text: string;
  /** as_is: it stood on its own. model: the tiny model completed it. joined: the last question in front of it. */
  via: "as_is" | "model" | "joined";
  paise: number;
}

const ANSWER_HEAD = 600;
const COMPLETE_TOKENS = 120;
const COMPLETE_PAISE = 5;
const COMPLETE_MAX = 400;

export async function completeMessage(m: FrontModel, i: CompleteInput): Promise<Completed> {
  const message = i.message.trim();
  const last = i.lastQuestion?.trim();
  if (!last || !message || (!i.followUp && !isFollowUp(message))) return { text: message, via: "as_is", paise: 0 };
  const joined = `${last}. ${message}`;
  const user = [
    `<last_question>\n${fence(forModel(last))}\n</last_question>`,
    ...(i.lastAnswer?.trim() ? [`<last_answer>\n${fence(forModel(cut(i.lastAnswer.trim(), ANSWER_HEAD)))}\n</last_answer>`] : []),
    `<message>\n${fence(forModel(message))}\n</message>`,
  ].join("\n\n");
  try {
    const r = await askText(m, { role: "front_complete", tier: "tiny", purpose: "front.complete", maxTokens: COMPLETE_TOKENS, budget: { maxPaise: COMPLETE_PAISE }, user });
    const text = (r.text.split("\n").find((l) => l.trim()) ?? "").trim().replace(/^["'“]+|["'”]+$/g, "").trim();
    if (text.length < 2 || text.length > COMPLETE_MAX) return { text: joined, via: "joined", paise: r.paise };
    return { text, via: "model", paise: r.paise };
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === "AbortError") throw err;
    return { text: joined, via: "joined", paise: 0 };
  }
}
