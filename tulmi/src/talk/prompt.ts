/**
 * WHAT THE ANSWERING MODEL IS TOLD IN A TURN OF TALK (code/agent/context.ts's way).
 *
 * The stable block is the role talk_reply (principles/roles.ts), the same bytes for every person and turn, so a provider can cache it.
 * Everything that changes is the one user message built here, in this order, each part only when there is one, each under its cap:
 *
 *   Today: …            the person's date and time (bots/prompt.ts todayLine)
 *   <context>           what X0 keeps about them (src/context), already capped at CONTEXT_MAX_CHARS
 *   <talk>              this conversation: the folded summary, then the last turns whole (session.ts), TALK_BLOCK_MAX
 *   <where>             the app, the window, the address (no query) and the selection in front of them
 *   <page>              the whole page or document, reduced (page.ts), PAGE_MAX_CHARS
 *   <found_now>         what was just looked up (look.ts), LOOK_CHARS_MAX
 *   <said>, <meant>     their words now, and the same made whole when a follow-up was (complete)
 *
 * All of it is data: our fence tags are broken inside every part (`data`), and a part the secret scan flags is withheld (forModel).
 * The caps add up to under TALK_INPUT_CHARS (road.ts), which is what a reply's cap is reckoned on.
 */
import { todayLine } from "../bots/prompt.js";
import { forModel, oneLine } from "../code/work/model.js";
import { reducePage, type PageText } from "./page.js";
import { talkLines, type TalkSession } from "./session.js";

const TAGS = "context|talk|where|page|found_now|said|meant";
const TAG = new RegExp(`<\\s*(/?)\\s*(${TAGS})\\b`, "gi");
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const TALK_BLOCK_MAX = 3_000;
const WORDS_MAX = 1_500;
const SELECTION_MAX = 1_500;
const CONTEXT_MAX = 2_500;
const FOUND_MAX = 5_000;

/** Text made safe to sit inside one of our fences: our tags broken, control characters out. */
export function data(s: string): string {
  return s.replace(CONTROL, " ").replace(TAG, (_m, slash: string, name: string) => `&lt;${slash}${name}`);
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fence = (tag: string, body: string): string => `<${tag}>\n${body}\n</${tag}>`;

export interface TalkPromptInput {
  words: string;
  /** The words made whole, when they were a follow-up and differ. */
  meant?: string;
  now: number;
  tz?: number;
  context?: string;
  session?: TalkSession | null;
  app?: string;
  title?: string;
  url?: string;
  selection?: string;
  page?: PageText | null;
  /** What was looked up this turn (look.ts), already fenced as data by the tools. */
  found?: string;
}

/** The turn's user message. */
export function talkUser(i: TalkPromptInput): string {
  const parts: string[] = [todayLine(i.now, i.tz)];
  const ctx = i.context?.trim();
  if (ctx) parts.push(fence("context", data(forModel(cut(ctx, CONTEXT_MAX)))));
  const talk = talkLines(i.session);
  if (talk) parts.push(fence("talk", data(forModel(cut(talk, TALK_BLOCK_MAX)))));
  const where = [
    i.app ? `App: ${oneLine(i.app, 60)}` : "",
    i.title ? `Window: ${oneLine(i.title, 160)}` : "",
    i.url ? `Address: ${oneLine(i.url, 200)}` : "",
    i.selection?.trim() ? `Selected: ${cut(i.selection.trim(), SELECTION_MAX)}` : "",
  ].filter(Boolean);
  if (where.length) parts.push(fence("where", data(forModel(where.join("\n")))));
  const page = reducePage(i.page, `${i.words} ${i.meant ?? ""}`).text;
  if (page) parts.push(fence("page", data(forModel(page))));
  if (i.found?.trim()) parts.push(fence("found_now", data(cut(i.found.trim(), FOUND_MAX))));
  parts.push(fence("said", data(forModel(cut(i.words.trim(), WORDS_MAX)))));
  if (i.meant && i.meant.trim() !== i.words.trim()) parts.push(fence("meant", data(forModel(cut(i.meant.trim(), WORDS_MAX)))));
  return parts.join("\n");
}
