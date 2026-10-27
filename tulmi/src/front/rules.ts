/**
 * WHAT A MESSAGE IS, READ FOR NOTHING: THE FRONT DOOR'S RULES.
 *
 * readByRules() reads one message with patterns in English, Hinglish (Hindi in Latin letters) and Hindi, and says which intent it is
 * and how sure that is. It reuses the Code bot's free classifier (code/brain/classify.ts classifyByRules) for the code signals (a bug,
 * a change, a question about code, an error pasted in, the language), and adds what only the front door knows: whether there is a
 * project, whether something is attached, what the person's earlier turns were about, and the wording of a design, a plan, a piece
 * of research or small talk.
 *
 * Evidence is combined the way the classifier combines it: every hit adds weight to an intent, hits on the same intent combine like
 * independent evidence (1 - the chance that none of them is right), and a rival intent that also scored takes away from the
 * confidence. Under 0.7 the caller asks the small model (decide.ts); the rules never call one.
 *
 * Nothing here reads the environment, a store or a model, so the same words give the same answer and every rule is a table in the
 * tests. The message is never kept: `signals` are short ids ("design:make_ui"), never any of its words.
 */
import { classifyByRules } from "../code/brain/classify.js";
import type { Classification } from "../code/brain/types.js";
import { extractCues, isVague } from "../code/work/cues.js";
import type { FrontCtx, Intent, ResearchDepth, Turn } from "./types.js";
import { INTENTS } from "./types.js";
import { askedKind } from "./visual.js";

export interface RuleRead {
  intent: Intent;
  /** 0 to 1. */
  confidence: number;
  /** The best intent each rule found, for the runner-up. */
  scores: Partial<Record<Intent, number>>;
  rival?: Intent;
  signals: string[];
  /** The Code bot's free read of the same words. */
  cls: Classification;
  depth?: ResearchDepth;
  /** A short follow-up to an earlier turn: what that turn was about, to be put in front of this one. */
  followUp?: { base: string };
}

/** How much of a rival's score is taken off the leader's confidence (the classifier's own number). */
const RIVAL_PENALTY = 0.4;

/** Devanagari words have combining marks, so \b does not see their edges: a lookbehind does. */
const hindi = (words: string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join("|")})`, "u");

// ------------------------------------------------------------------ small talk

const GREETING = /^\s*(?:hi+|hello+|hey+|hola|yo|sup|good\s+(?:morning|afternoon|evening|night)|gm|gn|thanks?(?:\s+a\s+lot)?|thank\s+you(?:\s+so\s+much)?|thx|ty|ok(?:ay)?|cool|nice|great|awesome|got\s+it|bye|see\s+you|namaste|namaskar|pranam|dhanyavaad|shukriya|theek\s+hai|thik\s+hai|accha|acha|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|kaise\s+ho|kaisi\s+ho|kya\s+haal(?:\s+hai)?|kya\s+chal\s+raha(?:\s+hai)?)[\s!.?,]*$/i;
const GREETING_HI = hindi(["(?:नमस्ते|नमस्कार|प्रणाम|हेलो|हाय|धन्यवाद|शुक्रिया|ठीक है|अच्छा|कैसे हो|कैसी हो|क्या हाल है|क्या हाल)(?=[\\s!।.?]*$)"]);

// ------------------------------------------------------------------ design

const UI_NOUN = "(?:pages?|landing(?:\\s+page)?|home\\s?page|screens?|ui|ux|interface|components?|cards?|nav\\s?bar|navigation|headers?|footers?|hero|sections?|forms?|modals?|pop-?ups?|dialogs?|dashboards?|layouts?|widgets?|banners?|pricing(?:\\s+(?:table|page|section|cards?))?|testimonials?|sidebars?|menus?|login(?:\\s+(?:page|screen|form))?|sign-?up(?:\\s+(?:page|screen|form))?|checkout|profile\\s+(?:page|screen|card)|web\\s?sites?|mock-?ups?|wireframes?|prototypes?|tabs?|carousel|gallery|accordion|toolbar|stepper|onboarding|empty\\s+state)";
/** Verbs that make something new: "the form" after one of these is an existing thing being changed, "a form" is a new one. */
const MAKE_NEW = "(?:add|make|create|build|generate|craft|give\\s+me|i\\s+need|i\\s+want|can\\s+you\\s+(?:make|build|create)|let'?s\\s+(?:make|build))";
/** Verbs that ask to SEE something. */
const MAKE_SEE = "(?:design|draw|show(?:\\s+me)?|sketch|mock\\s?up|prototype|visuali[sz]e|render)";
const DESIGN_NEW = new RegExp(`\\b${MAKE_NEW}\\s+((?:[\\w'-]+\\s+){0,3}?)${UI_NOUN}\\b`, "i");
const DESIGN_SEE = new RegExp(`\\b${MAKE_SEE}\\s+((?:[\\w'-]+\\s+){0,3}?)${UI_NOUN}\\b`, "i");
/** Words that make "add X to Y" a change to existing code, not a new thing to look at. */
const PART_WORD = /\b(field|input|column|row|label|text|colou?r|font|size|padding|margin|icon|link|logo|title|variable|param(?:eter)?|prop|argument|validation|rule|check|test|handler|endpoint|route|api|function|method|class|database|db|migration|query|config|dependency|package|bug|error|typo|spacing)\b/i;
const DEFINITE = /^(?:the|this|that|these|those|my|our|its|your|their)\b/i;
const HOW_LOOK = /\bhow\s+(?:would|will|might|should|could|can)\b[^.?!\n]{0,70}\b(?:look|appear|be\s+laid\s+out)\b/i;
const LOOK_LIKE = /\b(?:what|how)\s+(?:would|will|does|do)\b[^.?!\n]{0,60}\blook\s+like\b|\bshow\s+me\s+what\b[^.?!\n]{0,40}\blook/i;
const MOCKUP = /\b(?:mock-?ups?|wireframes?|prototypes?|ui\s+for|design\s+for|design\s+of)\b/i;
const DESIGN_HG = new RegExp(`\\b(?:banao|bana\\s+do|bana\\s+dena|dikhao|dikha\\s+do|design\\s+karo|design\\s+kar\\s+do)\\b[^.\\n]{0,30}\\b${UI_NOUN}\\b|\\b${UI_NOUN}\\b[^.\\n]{0,30}\\b(?:banao|bana\\s+do|dikhao|dikha\\s+do|design\\s+karo)\\b`, "i");
const WANT_HG = new RegExp(`\\b(?:mujhe|mereko|hamein|humein|mere\\s+liye)\\b[^.\\n]{0,40}\\b${UI_NOUN}\\b[^.\\n]{0,15}\\b(?:chahiye|chahie|banana\\s+hai)\\b|\\b${UI_NOUN}\\s+(?:chahiye|chahie)\\b`, "i");
const LOOK_HG = /\bkais[ae]\s+(?:dikhega|dikhe|dikhegi|lagega|lagegi)\b/i;
const DESIGN_HI = hindi(["(?:पेज|कार्ड|बटन|फॉर्म|स्क्रीन|डैशबोर्ड|लैंडिंग|नेवबार|मेन्यू|वेबसाइट)[^.\\n]{0,20}(?:बनाओ|बना दो|दिखाओ|डिज़ाइन|डिजाइन)", "कैसा दिखेगा", "कैसी दिखेगी", "कैसे दिखेगा", "डिज़ाइन दिखाओ", "डिजाइन दिखाओ"]);

// ------------------------------------------------------------------ plan, research

const PLAN_VERB = /\b(?:plan|planning)\s+(?:my|our|a|an|the|out|for|how\s+to)\b/i;
const PLAN_NOUN = /\b(?:roadmap|timeline|itinerary|milestones?|syllabus|agenda|action\s+plan|study\s+plan|sprint\s+plan|content\s+calendar|go-to-market|project\s+plan|meal\s+plan|workout\s+plan|launch\s+plan|step[-\s]by[-\s]step\s+plan)\b/i;
const PLAN_MAKE = /\b(?:make|create|draft|write|prepare|build|give\s+me|need|want)\b[^.\n]{0,25}\b(?:plan|schedule|checklist|strategy)\b/i;
const PLAN_HG = /\b(?:plan|schedule|roadmap|timeline|yojana)\s+(?:banao|bana\s+do|banana|batao|bana\s+dena)\b/i;
const PLAN_HI = hindi(["योजना", "प्लान\\s*(?:बनाओ|बनाइए|बना दो)", "टाइमलाइन", "रोडमैप", "शेड्यूल"]);

const RESEARCH_WORDS = /\b(?:research|investigate|look\s+into|find\s+out|deep\s+dive|in-?depth|thorough(?:ly)?|survey\s+of|literature|state\s+of\s+the\s+art|with\s+(?:sources|citations|references|links)|cite\s+(?:your\s+)?sources)\b/i;
const FRESH_WORDS = /\b(?:latest|newest|most\s+recent|recent(?:ly)?|news|what'?s\s+new|release\s+notes?|changelog|released|currently|right\s+now|this\s+(?:week|month|year)|trending|breaking|202[4-9]|203\d|price\s+of|stock\s+price|exchange\s+rate|score\s+of|weather)\b/i;
const RESEARCH_HG = /\b(?:taaza|tazaa|nayi\s+khabar|abhi\s+ka|aaj\s+ka|aaj\s+ki|khabar|research\s+karo|khoj|pata\s+lagao|jaankari\s+nikalo)\b/i;
const RESEARCH_HI = hindi(["ताज़ा", "ताजा", "नवीनतम", "खबर", "शोध", "रिसर्च", "पता लगाओ"]);
const DEEP_WORDS = /\b(?:deep|thorough(?:ly)?|in-?depth|comprehensive|exhaustive|full\s+report|detailed\s+research|everything\s+(?:about|on))\b|विस्तृत|गहन/i;
const QUICK_WORDS = /\b(?:latest\s+version|current\s+version|price|score|weather|exchange\s+rate|news)\b/i;

// ------------------------------------------------------------------ answers

/** Words that open a question or ask for something to be written, translated or worked out. */
const ASKING = /^\s*(?:explain|define|translate|summari[sz]e|rewrite|rephrase|paraphrase|write|draft|compose|convert|calculate|solve|list|suggest|recommend|tell\s+me|describe|teach|what|why|how|who|when|where|which)\b/i;
/** Auxiliary verbs open a question only when it is one: a mark at the end, or enough words after them. */
const ASKING_AUX = /^\s*(?:is|are|was|were|can|could|do|does|did|should|would|will|has|have)\b/i;
const ASKING_HG = /^\s*(?:samjhao|samjha\s+do|batao|bata\s+do|likho|translate\s+karo|kya|kaise|kyun|kyu|kab|kaun|kaunsa|kitna|kitne|kahan)\b/i;
const ASKING_HI = hindi(["^\\s*(?:समझाओ|बताओ|बताइए|लिखो|अनुवाद|क्या|कैसे|क्यों|कब|कौन|कितना)"]);
/** A job for the model that has a known shape: it is an answer, not a search. */
const TASK = /^\s*(?:translate|summari[sz]e|rewrite|rephrase|paraphrase|define|proofread|correct|convert|calculate|solve)\b/i;
const WRITE_CODE = /^\s*(?:write|create|give\s+me|show\s+me|generate)\b[^.\n]{0,30}\b(?:function|script|program|regex|query|snippet|class|sql|algorithm|one-?liner)\b/i;
const SUM = /\d+\s*(?:%|percent|\+|\*|\/|x)\s*\d+|\b\d+(?:\.\d+)?\s*(?:km|kg|miles?|celsius|fahrenheit|usd|inr|rs|dollars?|rupees?)\b|\b\d+\s*%\s*of\b|\bof\s+\d+\b/i;
const COMPARE = /\b(?:compar(?:e|ing|ison)|versus|vs\.?|difference\s+between|pros\s+and\s+cons|which\s+is\s+better|better\s+than|side\s+by\s+side)\b/i;
const COMPARE_HG = /\b(?:tulna|fark|antar|behtar\s+kaun|kaun\s*sa\s+(?:behtar|better|accha|acha)|comparison)\b/i;
const COMPARE_HI = hindi(["तुलना", "अंतर", "फर्क", "बनाम", "कौन सा बेहतर"]);
const CHART_WORDS = /\b(?:chart|graph|plot|visuali[sz]e|trend|histogram|bar\s+chart|pie\s+chart|line\s+chart)\b/i;

// ------------------------------------------------------------------ code, about a project

/** Words that make a question a question about the project in front of the person, not about the world. */
const CODE_WORDS = /\b(?:app|project|repo|repository|codebase|code|file|files|function|functions|component|components|class|module|route|routes|endpoint|api|login|log\s?in|signup|sign\s?up|auth|authentication|session|token|checkout|payment|cart|search|upload|notification|webhook|database|schema|model|migration|middleware|hook|store|state|reducer|screen|build|deploy|ci|tests?|config|env|dependency|dependencies|service|controller|handler|job|cron|worker|flow|bug|error|crash|stack\s+trace|commit|branch|pull\s+request|pr)\b|\b[\w/.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|swift|dart|vue|svelte|php|rb|css|html|json|yaml|yml|md)\b|\b(?:yeh|ye|is|iss)\s+(?:app|project|code)\b/i;
/** The shapes of names in code: camelCase and snake_case (case matters, so no `i` flag). */
const CODE_SHAPES = /\b[a-z]+[A-Z]\w*\b|\b[a-z]+_[a-z_]+\b/;
const CODE_HI = hindi(["कोड", "ऐप", "प्रोजेक्ट", "फ़ाइल", "फाइल", "फंक्शन", "लॉगिन"]);
/** A change asked for: the Code bot's classifier calls these small_edit, bug_fix, feature and refactor. */
const CHANGE_TYPES = new Set(["small_edit", "bug_fix", "feature", "refactor"]);
const FOLLOW_UP = /^\s*(?:and|also|what\s+about|how\s+about|now|then|ok(?:ay)?\s+(?:and|now)|make\s+it|change\s+it|do\s+(?:that|it)|same\s+(?:for|with)|aur|phir|ab|isko|usko|aur\s+kya)\b/i;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** Words that say nothing about WHAT to change: a request made only of these is "do something to it". */
const BARE = new Set([
  "fix", "change", "make", "update", "edit", "do", "it", "this", "that", "these", "those", "thing", "things", "stuff", "better", "good", "nice", "please", "plz", "just", "now", "can", "you", "the", "a", "an", "all", "some", "more", "again", "right", "properly",
  "isko", "usko", "ise", "use", "yeh", "ye", "woh", "wo", "sab", "kuch", "theek", "thik", "sahi", "karo", "kar", "karna", "kardo", "do", "dena", "de", "badal", "badlo", "badal", "bana", "banao", "hatao", "abhi", "zara", "bhai", "yaar", "isse", "kaam", "ko",
  "इसे", "उसे", "यह", "ये", "वह", "सब", "कुछ", "ठीक", "सही", "करो", "कर", "दो", "बदल", "बदलो", "बना", "बनाओ", "हटाओ", "अभी", "ज़रा", "जरा", "भाई", "प्लीज़", "को", "इसको", "उसको",
]);
/** Nothing but filler: no file, screen, feature or name to point at. */
const isBare = (text: string): boolean => {
  const tokens = text.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
  return tokens.length > 0 && tokens.every((t) => BARE.has(t));
};

/** Rivals that do not count against an intent: the runner-up is only a rival when it could really be what was meant. */
const NOT_RIVALS: Partial<Record<Intent, readonly Intent[]>> = {
  design: ["code_task", "code_question", "answer", "chat"],
  research: ["answer", "chat"],
  code_question: ["answer", "chat"],
  code_task: ["answer", "chat"],
  plan: ["answer", "chat"],
  answer: ["chat"],
  file_question: ["answer", "chat", "research", "code_question", "code_task"],
};

/** The turns' last `did` that is an intent. */
function lastIntent(recent: readonly Turn[]): { intent: Intent; said: string } | null {
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const t = recent[i]!;
    const did = t.did?.split(/[:\s]/)[0] as Intent | undefined;
    if (did && (INTENTS as readonly string[]).includes(did) && did !== "unclear") return { intent: did, said: t.said };
  }
  return null;
}

export function readByRules(message: string, ctx: Pick<FrontCtx, "projectId" | "recent" | "attachments" | "mode">): RuleRead {
  const text = message.trim();
  const cls = classifyByRules(text, { repoEmpty: false });
  const hasProject = !!ctx.projectId;
  const signals: string[] = [];
  const miss = new Map<Intent, number>();
  const hit = (intent: Intent, w: number, id: string): void => {
    miss.set(intent, (miss.get(intent) ?? 1) * (1 - w));
    signals.push(id);
  };
  const n = wordCount(text);

  // Something attached: the message is about it.
  if (ctx.attachments.length) hit("file_question", 0.92, "attachment");

  // Small talk.
  if (GREETING.test(text) || GREETING_HI.test(text)) hit("chat", 0.92, "chat:greeting");

  // A design: something to look at, new, or a question of how it would look.
  const designNew = DESIGN_NEW.exec(text);
  if (designNew && !PART_WORD.test(designNew[1] ?? "") && !DEFINITE.test((designNew[1] ?? "").trim())) hit("design", 0.75, "design:make_ui");
  const designSee = DESIGN_SEE.exec(text);
  if (designSee && !PART_WORD.test(designSee[1] ?? "")) hit("design", 0.78, "design:see_ui");
  if (HOW_LOOK.test(text) || LOOK_LIKE.test(text)) hit("design", 0.8, "design:how_look");
  if (MOCKUP.test(text)) hit("design", 0.7, "design:mockup");
  if (DESIGN_HG.test(text) || WANT_HG.test(text)) hit("design", 0.72, "design:hinglish");
  if (LOOK_HG.test(text)) hit("design", 0.8, "design:how_look_hg");
  if (DESIGN_HI.test(text)) hit("design", 0.72, "design:hindi");

  // A plan or a timeline.
  if (PLAN_VERB.test(text)) hit("plan", 0.7, "plan:verb");
  if (PLAN_NOUN.test(text)) hit("plan", 0.75, "plan:noun");
  if (PLAN_MAKE.test(text)) hit("plan", 0.65, "plan:make");
  if (PLAN_HG.test(text)) hit("plan", 0.75, "plan:hinglish");
  if (PLAN_HI.test(text)) hit("plan", 0.75, "plan:hindi");
  if (cls.type === "plan_project") hit("plan", Math.min(0.8, cls.confidence), "plan:new_project");

  // What kind of ask it is, before it is sorted into an intent.
  const asking = ASKING.test(text) || ASKING_HG.test(text) || ASKING_HI.test(text) || (ASKING_AUX.test(text) && (/[?？]\s*$/.test(text) || n >= 5));
  const questionMark = /[?？]/.test(text);
  const comparing = COMPARE.test(text) || COMPARE_HG.test(text) || COMPARE_HI.test(text);
  const aboutCode = CODE_WORDS.test(text) || CODE_SHAPES.test(text) || CODE_HI.test(text) || cls.signals.includes("error_text");

  // Looking something up on the web.
  let depth: ResearchDepth | undefined;
  const explicitResearch = RESEARCH_WORDS.test(text);
  const fresh = FRESH_WORDS.test(text) || RESEARCH_HG.test(text) || RESEARCH_HI.test(text);
  if (explicitResearch) hit("research", 0.7, "research:explicit");
  if (fresh) hit("research", 0.55, "research:fresh");
  if (fresh && (asking || questionMark)) hit("research", 0.4, "research:fresh_question");
  if (cls.type === "find_resource") hit("research", Math.min(0.75, cls.confidence), "research:find_resource");
  if (cls.type === "research" && !comparing) hit("research", Math.min(0.7, cls.confidence), "research:classifier");
  if (explicitResearch || fresh || cls.type === "find_resource") depth = DEEP_WORDS.test(text) ? "deep" : QUICK_WORDS.test(text) && !explicitResearch ? "quick" : "standard";
  const looksUp = miss.has("research");

  // About a project, when there is one: a question about its code, or a change to it. Else a question about the world.
  const projectAsk = hasProject && aboutCode;
  const vague = isVague(extractCues(text)) || isBare(text);
  if (hasProject) {
    if (CHANGE_TYPES.has(cls.type)) hit("code_task", Math.min(0.9, cls.confidence + (aboutCode ? 0.1 : 0)) * (vague ? 0.4 : 1), `code:${cls.type}`);
    if (cls.signals.includes("error_text")) hit("code_task", 0.8, "code:error_text");
    if (WRITE_CODE.test(text) && !miss.has("design")) hit("code_task", 0.6 * (vague ? 0.5 : 1), "code:write");
  } else if (CHANGE_TYPES.has(cls.type) && aboutCode) {
    // Code, but nothing to change it in: it is a question about how.
    hit("answer", Math.min(0.7, cls.confidence), "answer:code_no_project");
  }
  const askIntent: Intent = projectAsk && !looksUp ? "code_question" : "answer";
  if (!looksUp || !fresh) {
    if (cls.type === "question") hit(askIntent, Math.min(0.85, Math.max(0.5, cls.confidence + (projectAsk ? 0.1 : 0))), `${askIntent === "answer" ? "answer" : "code"}:question`);
    if (asking) hit(askIntent, 0.6, `${askIntent === "answer" ? "answer" : "code"}:asking`);
    if (questionMark) hit(askIntent, 0.45, `${askIntent === "answer" ? "answer" : "code"}:mark`);
  }
  if (SUM.test(text)) hit("answer", 0.55, "answer:sum");
  if (comparing) hit("answer", 0.7, "answer:compare");
  if (TASK.test(text)) hit("answer", 0.75, "answer:task");
  if (WRITE_CODE.test(text) && !hasProject) hit("answer", 0.75, "answer:write_code");
  if (CHART_WORDS.test(text) && (text.match(/\d+(?:\.\d+)?/g) ?? []).length >= 3) hit("answer", 0.65, "answer:chart_data");
  // "Put it in a table", "draw a diagram of ...": a request for a picture of an answer, whatever the words around it.
  if (askedKind(text) && !miss.has("design")) hit("answer", 0.7, "answer:asked_visual");

  // A short follow-up to what they were just doing.
  let followUp: RuleRead["followUp"];
  const last = lastIntent(ctx.recent);
  if (last && n <= 7 && FOLLOW_UP.test(text) && !miss.has("design")) {
    hit(last.intent, 0.6, "follow_up");
    followUp = { base: last.said };
  }

  // Nothing matched: two words or fewer is nothing to go on; the rest is conversation.
  if (!miss.size) {
    if (n <= 2) hit("unclear", 0.8, "no_rule:short");
    else hit("chat", 0.4, "no_rule");
  }

  const ranked = [...miss].map(([intent, m]) => [intent, 1 - m] as const).sort((a, b) => b[1] - a[1]);
  const [intent, top] = ranked[0]!;
  const ignored = NOT_RIVALS[intent] ?? [];
  const second = ranked.slice(1).find(([i]) => !ignored.includes(i));
  let confidence = Math.min(0.95, top) - RIVAL_PENALTY * (second?.[1] ?? 0);
  confidence = Math.max(0.1, Math.round(confidence * 100) / 100);

  const scores: Partial<Record<Intent, number>> = {};
  for (const [i, s] of ranked) scores[i] = Math.round(s * 100) / 100;
  return {
    intent, confidence, scores, ...(second ? { rival: second[0] } : {}), signals: [...new Set(signals)], cls,
    ...(intent === "research" && depth ? { depth } : {}), ...(followUp && intent === last?.intent ? { followUp } : {}),
  };
}
