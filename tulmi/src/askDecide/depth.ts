/**
 * HOW HARD AN ASK IS, READ FOR NOTHING (code/chat/question.ts's way): quick, or think.
 *
 *   depthOf(words) -> { depth: "quick" | "think", why: string[] }
 *
 * think is for what a small model most often gets confidently wrong: maths past a sum in the head, a why or a how asked in depth,
 * a comparison, a plan, code. Everything else is quick. The decide model may raise quick to think (its `depth`); it never lowers
 * what these rules read (askDecide/index.ts). English, Hinglish and Hindi. Pure: the same words give the same answer.
 */

export const DEPTHS = ["quick", "think"] as const;
export type Depth = (typeof DEPTHS)[number];

const hindi = (words: string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join("|")})`, "u");

/** Working something out: a calculation word, or a sum of three numbers or more, or one with big numbers. */
const MATHS = /\b(?:calculate|calculation|compute|solve|equation|integral|derivative|differentiate|integrate|probability|percent(?:age)?|compound\s+interest|simple\s+interest|emi|square\s+root|cube\s+root|factorial|prove|proof|hisaab|hisab|calculate\s+karo)\b/i;
const SUM = /\d[\d,.]*\s*(?:[-+*/×÷^x]|\bplus\b|\bminus\b|\btimes\b|\bdivided\s+by\b)\s*\d[\d,.]*\s*(?:[-+*/×÷^x]|\bplus\b|\bminus\b|\btimes\b|\bdivided\s+by\b)\s*\d/i;
const BIG_SUM = /\d{3,}[\d,.]*\s*(?:[*/×÷^x]|\btimes\b|\bdivided\s+by\b)\s*\d{2,}|\d{2,}[\d,.]*\s*(?:[*/×÷^x]|\btimes\b|\bdivided\s+by\b)\s*\d{3,}/i;
const MATHS_HI = hindi(["गणना", "हल\\s+करो", "प्रतिशत", "ब्याज"]);

/** A why or a how asked in depth, or an explanation asked for step by step. */
const DEEP = /\b(?:in\s+(?:depth|detail)|step\s+by\s+step|walk\s+me\s+through|explain\s+(?:how|why)|how\s+(?:exactly|does\s+\w+(?:\s+\w+)?\s+work)|why\s+(?:exactly|really)|root\s+cause|reason\s+(?:through|it\s+out)|think\s+(?:it\s+)?through|detail\s+mein|vistar\s+se|samjha(?:o|iye)\s+(?:detail|vistar))\b/i;
const DEEP_HI = hindi(["विस्तार\\s+से", "कैसे\\s+काम\\s+करता", "समझाओ"]);

/** Weighing one thing against another. */
const COMPARE = /\b(?:compare|comparison|versus|vs\.?|better\s+than|difference\s+between|differences?\s+(?:of|in)|pros\s+and\s+cons|trade-?offs?|which\s+(?:is|one\s+is|should\s+i)\s+(?:better|best|cheaper|faster|pick|choose|buy)|kaun\s*sa\s+(?:behtar|accha|achha)|farak|fark)\b/i;
const COMPARE_HI = hindi(["तुलना", "अंतर", "फ़र्क", "फर्क", "कौन\\s+सा\\s+बेहतर"]);

/** A plan: steps, a schedule, a strategy. */
const PLAN = /\b(?:plan(?:ning)?\s+(?:for|out|a|an|my|the|how)|make\s+(?:a|me\s+a)\s+plan|itinerary|roadmap|strategy|break\s+(?:it|this|that)\s+down|plan\s+banao|yojana)\b/i;
const PLAN_HI = hindi(["योजना", "प्लान\\s+बनाओ"]);

/** Code: a language, a construct, or code itself in the words. */
const CODE = /\b(?:coding|(?:write|the)\s+code|code\s+(?:for|that|to)|function|regex|regexp|sql|query\s+for|script|algorithm|bug|debug|stack\s*trace|compile|compiler|python|javascript|typescript|java|kotlin|swift|rust|golang|c\+\+|bash|shell\s+command|api\s+call|json\s+schema|big[- ]o)\b|=>|\(\)\s*\{|;\s*$/im;

/** The rules' read. */
export function depthOf(raw: string): { depth: Depth; why: string[] } {
  const w = raw.trim();
  const why: string[] = [];
  if (MATHS.test(w) || SUM.test(w) || BIG_SUM.test(w) || MATHS_HI.test(w)) why.push("maths");
  if (DEEP.test(w) || DEEP_HI.test(w)) why.push("deep");
  if (COMPARE.test(w) || COMPARE_HI.test(w)) why.push("compare");
  if (PLAN.test(w) || PLAN_HI.test(w)) why.push("plan");
  if (CODE.test(w)) why.push("code");
  return { depth: why.length ? "think" : "quick", why };
}

/** The deeper of two reads: the model may raise the rules' quick, never lower their think. */
export const deeper = (a: Depth, b: Depth | null | undefined): Depth => (a === "think" || b === "think" ? "think" : "quick");
