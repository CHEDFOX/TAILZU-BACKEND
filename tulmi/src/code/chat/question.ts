/**
 * WHAT KIND OF QUESTION ABOUT CODE THIS IS, READ FOR NOTHING.
 *
 * "where is the session cookie set" is a lookup the project brain answers by itself. "how does login work" is a flow: the brain's graph and summaries
 * draw it. "what breaks if I change slug()" is the import graph and the test map. "why is checkout slow" needs the code itself, and a stronger model.
 * Telling these apart costs nothing, and decides three things:
 *
 *   the road     brain only (the fast path), or the brain and a few reads of the located spans
 *   the tier     cheap by default; strong only for a deep "why" (performance, memory, races, flakiness) or an "impact" question, which are the ones
 *                where a cheap model's answer is most often confidently wrong. The front door's decision says so (front/decide.ts uses `deepCodeQuestion`)
 *   the picture  a flow is drawn from the graph (flow.ts), for nothing
 *
 * English, Hinglish and Hindi, like the front door's rules. Pure: the same words give the same answer.
 */

export type QuestionKind = "where" | "what" | "how" | "why" | "impact" | "other";

export interface QuestionRead {
  kind: QuestionKind;
  /** A question the cheap tier answers badly: a why about performance, memory, races or flakiness; or what a change reaches. */
  deep: boolean;
  /** The person wants the code itself (the lines, the implementation), so the brain's summary is not an answer. */
  wantsCode: boolean;
  /** The answer is a path through the code (a flow), so a diagram of it helps. */
  flow: boolean;
  /** The question asks for a value the code holds (a default, a limit, a window, a timeout, a port, a setting): the answer needs the constants, not a summary. */
  values: boolean;
  /** The question is about the project as a whole ("what do you understand of the project", "what does this app do"): read like a newcomer would, README first. */
  whole: boolean;
}

const hindi = (words: string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join("|")})`, "u");

const IMPACT = /\bwhat\s+(?:would\s+|will\s+|could\s+|might\s+)?(?:break|breaks|be\s+affected|is\s+affected|are\s+affected|depends?\s+on|uses|calls|imports)\b|\bwhat\s+happens\s+(?:if|when)\s+(?:i|we|you)\s+(?:change|remove|rename|delete|move|drop|replace)\b|\bimpact\s+of\b|\bblast\s+radius\b|\bsafe\s+to\s+(?:change|remove|rename|delete|move|drop)\b|\bwho\s+(?:uses|calls|imports|depends\s+on)\b|\bwhat\s+(?:else\s+)?(?:uses|calls|imports)\b|\bif\s+i\s+(?:change|remove|rename|delete|move|drop|replace)\b|\bkya\s+(?:tootega|toot\s+jayega|bigdega)\b|\bkahan\s+kahan\s+use\b/i;
const IMPACT_HI = hindi(["क्या\\s+टूटेगा", "कहाँ\\s+कहाँ\\s+इस्तेमाल"]);
const WHERE = /\b(?:where|which\s+(?:file|folder|module|function|class|route|component)|what\s+file)\b|\bkahan\b|\bkis\s+file\b/i;
const WHERE_HI = hindi(["कहाँ", "कहां", "किस\\s+फ़ाइल"]);
const WHY = /^\s*why\b|\bwhy\s+(?:is|does|do|did|are|was|were|would|can't|cannot|won't|isn't|doesn't)\b|\bkyun\b|\bkyu\b|\broot\s+cause\b/i;
const WHY_HI = hindi(["क्यों", "क्यूँ"]);
const HOW = /\bhow\s+(?:does|do|is|are|did|can)\b|\bflow\b|\bwalk\s+me\s+through\b|\bexplain\b|\blifecycle\b|\brequest\s+path\b|\bkaise\b|\bsamjha(?:o|iye)\b/i;
const HOW_HI = hindi(["कैसे", "समझाओ"]);
const WHAT = /\bwhat\s+(?:is|are|does|do)\b|\bsummar(?:y|ise|ize)\b|\bkya\s+(?:hai|karta|karti)\b|\bwhat'?s\b|\boverview\b/i;
const WHAT_HI = hindi(["क्या\\s+है", "क्या\\s+करता"]);

/** The why that is a performance, memory, concurrency or flakiness hunt. */
const DEEP_WHY = /\b(?:slow(?:ly)?|slower|performance|perf|latency|laggy?|lags?|memory|leak(?:s|ing)?|race(?:\s+condition)?|deadlock|flaky|intermittent(?:ly)?|sometimes|timeouts?|timing\s+out|bottleneck|regress(?:ion|ed)?|high\s+cpu|hangs?|freez(?:e|es|ing)|n\+1|dhima|dheema|atakta)\b/i;

const WANTS_CODE = /\b(?:show|print|paste|give|display)\s+(?:me\s+)?(?:the\s+)?(?:actual\s+|exact\s+|whole\s+|full\s+)?(?:code|source|implementation|function|lines?)\b|\bexact(?:ly)?\s+(?:code|lines?|implementation|logic)\b|\bline\s+by\s+line\b|\bimplementation\s+of\b|\bthe\s+code\s+(?:for|of|that|in)\b|\bcode\s+dikhao\b/i;

const FLOW = /\bflow\b|\bhow\s+(?:does|do|is|are|did)\b[^.?!\n]{2,60}\b(?:work|works|handled|processed|happen|happens|authenticate|authenticates|get|gets)\b|\bwalk\s+me\s+through\b|\blifecycle\b|\bsequence\b|\brequest\s+path\b|\bpipeline\b|\bkaise\s+(?:kaam|chalta|hota)\b|कैसे\s+काम/i;

/** A question about a number or a setting: what the default is, how many, how long, the limit, the window, the timeout, the port. */
const VALUES = /\b(?:defaults?|limits?|windows?|time-?outs?|ttl|intervals?|thresholds?|max(?:imum)?|min(?:imum)?|sizes?|ports?|retr(?:y|ies)|attempts?|quota|config(?:uration|ured|s)?|settings?|options?|constants?|how\s+(?:many|long|much|often|big|large|far)|rates?|expir\w*|delays?|durations?|budget)\b|\bkitna\b|\bkitne\b/i;

/** Asking about the whole: a project word at the very end, after a word that asks for the big picture; or "overview" anywhere. */
const PROJECT_END = /\b(?:project|repo|repository|codebase|code\s*base|app|application)(?:'s)?\s*(?:do(?:es)?|is\s+about|about|is|for|structured|structure|architecture|overall|in\s+short)?\s*[?.!]*\s*$/i;
const BIG_PICTURE = /\b(?:under\s*stand|know|explain|summari[sz]e|summary|describe|overview|tell\s+me\s+about|what\s+is|what'?s|what\s+does|walk\s+me\s+through|how\s+is|architecture|structure|about)\b/i;
const WHOLE_HI = /\b(?:project|repo|app|codebase)\s+(?:kya\s+(?:hai|karta|karti)|samjhao|samjha\s+do|ke\s+baare\s+mein|batao)\b/i;
const isWhole = (q: string): boolean => /\boverview\b/i.test(q) || (PROJECT_END.test(q) && BIG_PICTURE.test(q)) || WHOLE_HI.test(q);

export function readQuestion(raw: string): QuestionRead {
  const q = raw.trim();
  const impact = IMPACT.test(q) || IMPACT_HI.test(q);
  const why = !impact && (WHY.test(q) || WHY_HI.test(q));
  const where = !impact && !why && (WHERE.test(q) || WHERE_HI.test(q));
  const how = !impact && !why && !where && (HOW.test(q) || HOW_HI.test(q));
  const what = !impact && !why && !where && !how && (WHAT.test(q) || WHAT_HI.test(q));
  const kind: QuestionKind = impact ? "impact" : why ? "why" : where ? "where" : how ? "how" : what ? "what" : "other";
  return {
    kind,
    deep: impact || (why && DEEP_WHY.test(q)) || (DEEP_WHY.test(q) && /\bwhy\b|\bkyun\b/i.test(q)),
    wantsCode: WANTS_CODE.test(q),
    flow: FLOW.test(q) || kind === "how",
    values: VALUES.test(q),
    whole: isWhole(q),
  };
}

/** A question for the strong tier: what a cheap model answers worst. The front door's `decide` asks this to choose the tier. */
export const deepCodeQuestion = (q: string): boolean => readQuestion(q).deep;

const FOLLOW = /^\s*(?:and|also|what\s+about|how\s+about|then|so|aur|phir|aur\s+kya|what\s+of)\b/i;
const PRONOUN = /\b(?:it|its|that|this|those|these|there|them|they|uska|iska|unka|isme|usme)\b|\b(?:same|above|earlier|before)\b/i;

/**
 * Whether a question leans on the one before it: short, or begins like a follow-up, or points at "it" and "that". Such a question is looked
 * up together with the thread's last question; a question that stands alone is looked up as it is.
 */
export function isFollowUp(q: string): boolean {
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  return FOLLOW.test(q) || (words <= 8 && PRONOUN.test(q)) || words <= 3;
}
