/**
 * "WRITE A POEM FOR MY GIRLFRIEND" IS A REQUEST, NOT A MESSAGE.
 *
 * The keyboard has two jobs. Most of the time it writes down what someone
 * said, cleaned up, in their voice. Sometimes they ask it to write a small
 * piece for them instead — a birthday wish, a sorry message, a reply, a short
 * email, a caption, a poem — and say who it is for and what it should feel
 * like. The owner: it "should act like an intelligent writing assistant…
 * not write technical things or big things, but it can write small things".
 *
 * The prompt allowed this in one clause and then told the model to treat
 * anything it was unsure of as dictation, and the check after it (slipIn's
 * "added") read a finished poem as words nobody said and asked for it again
 * — so the request came back cleaned up instead of carried out. This module
 * is the code half of the fix: it recognises the requests that are
 * unmistakably asks to write a piece, so the writer can be told so, and so
 * the checks that guard dictation stand aside for one.
 *
 * UNMISTAKABLE IS THE DESIGN, as it is for splitInstruction. The same words
 * are also things people send: "can you write me a recommendation letter"
 * is a question to a professor, "write me a text when you land" is said to a
 * friend, and "write a poem about the sea" dictated into ChatGPT is a prompt
 * for ChatGPT. So a request counts only when it is shaped as one (an
 * imperative, or "can you…" with someone to write it for) AND says who or
 * what occasion it is for, or is said in an app where people write to people.
 * Everything else is left to the writer's own judgement, as before.
 */

/** Small pieces a keyboard can write in one go. */
const PIECE = [
  "message", "msg", "messages", "text", "texts", "sms", "dm", "reply", "replies", "response",
  "e-?mail", "mail", "note", "letter", "card", "poem", "poems", "poetry", "shayari", "sher",
  "haiku", "limerick", "verse", "rhyme", "song", "lyrics", "caption", "captions", "bio",
  "tweet", "post", "status", "wish", "wishes", "greeting", "greetings", "toast", "apology",
  "invite", "invitation", "quote", "line", "lines", "joke", "compliment", "excuse", "comment",
  "review", "slogan", "tagline", "headline", "subject line", "announcement", "reminder",
  "kavita", "chitthi", "patra", "sandesh", "jawab",
].join("|");

/** More than a keyboard should write, or not writing at all. */
const BIG = [
  "code", "program", "script", "function", "class", "query", "sql", "regex", "formula",
  "algorithm", "api", "website", "html", "css", "javascript", "python", "essay", "essays",
  "article", "blog", "blog post", "report", "thesis", "dissertation", "paper", "assignment",
  "homework", "chapter", "book", "novel", "story", "stories", "kahani", "nibandh", "speech",
  "presentation", "proposal", "documentation", "resume", "cv", "cover letter", "research",
  "analysis", "business plan", "contract", "agreement", "policy",
].join("|");

const VERB = "(?:write|draft|compose|craft|create|make|prepare|frame|pen|come\\s+up\\s+with|put\\s+together|give\\s+me|help\\s+me\\s+(?:write|with))";
/** Where an imperative can start: the top, a sentence break, a comma, or a word people open with. */
const OPENER = "(?:^|[.!?\\n]\\s*|[,;:]\\s*|\\b(?:so|and|then|now|please|pls|plz|just|okay|ok|hey|tailzu|yaar|bro|also)\\s+)";
/** Spoken filler between the opening and the ask: "so um write…", "okay please write…". */
const FILL = "(?:(?:u+m+|u+h+|h+m+|so|like|okay|ok|please|pls)\\s+){0,3}";
const ASKING = "(?:(?:can|could|would|will)\\s+(?:you|u)\\s+(?:please\\s+)?)";
/** Up to six words between the verb and the piece: "a short and sweet good morning message". */
const BETWEEN = "(?:\\s+(?:me|us|her|him|them|my\\s+\\w+))?(?:\\s+[\\p{L}'’-]+){0,6}?\\s+";

const objectAfter = (objects: string) =>
  new RegExp(`${OPENER}${FILL}${ASKING}?${VERB}${BETWEEN}(?:${objects})(?![\\p{L}])`, "iu");
const IMPERATIVE_PIECE = objectAfter(PIECE);
const IMPERATIVE_BIG = objectAfter(BIG);

/**
 * Hinglish puts the verb last ("ek pyaari si shayari likh do") and Hindi in
 * its own letters does the same. Only imperative forms: likh do / likho /
 * bana do. "Likha", "likhunga" and the rest are about writing, not asks.
 */
const HI_VERB = "(?:likh(?:\\s*(?:do|de|dena|dijiye|dijie))?|likho|likhdo|likhde|bana(?:\\s*(?:do|de|dena|dijiye))?|banao|banado|banade)";
const HI_PIECE = new RegExp(`(?<![\\p{L}])(?:${PIECE})(?:\\s+[\\p{L}]+){0,3}?\\s+${HI_VERB}(?![\\p{L}])`, "iu");
const HI_BIG = new RegExp(`(?<![\\p{L}])(?:${BIG})(?:\\s+[\\p{L}]+){0,3}?\\s+${HI_VERB}(?![\\p{L}])`, "iu");
const DEVA_PIECE = /(?:कविता|शायरी|मैसेज|मेसेज|संदेश|ईमेल|मेल|चिट्ठी|पत्र|कैप्शन|विश|स्टेटस|जवाब|नोट)(?:\s+\S+){0,3}?\s+(?:लिख\s*(?:दो|दे|दीजिए|देना)|लिखो|बना\s*(?:दो|दे|दीजिए)|बनाओ)/u;
const DEVA_BIG = /(?:निबंध|कहानी|कोड|रिपोर्ट|लेख)(?:\s+\S+){0,3}?\s+(?:लिख\s*(?:दो|दे|दीजिए|देना)|लिखो|बना\s*(?:दो|दे|दीजिए)|बनाओ)/u;

/** Someone or something it is for: the thing that turns "write a poem" into a request for one. */
const FOR_SOMEONE = new RegExp([
  "\\b(?:to|for)\\s+(?:my|our)\\s+[\\p{L}]+",
  "\\b(?:to|for)\\s+(?:the\\s+|this\\s+|that\\s+|our\\s+|my\\s+)?(?:mom|mum|mummy|mother|dad|papa|father|boss|manager|team|client|customer|teacher|professor|sir|madam|ma'am|landlord|hr|wife|husband|girlfriend|boyfriend|gf|bf|bestie|friend|friends|colleague|colleagues|bro|bhai|didi|sister|brother|her|him|them|everyone)\\b",
  "\\breply\\b|\\brespond\\b",
  // "…a message saying I'll be late": what it should say is a brief.
  "\\b(?:saying|telling|asking|that\\s+says)\\b",
  "\\b(?:birthday|bday|anniversary|wedding|farewell|congrat\\w*|sorry|apolog\\w*|thank\\w*|good\\s+morning|good\\s+night|condolence\\w*|get\\s+well|diwali|eid|christmas|new\\s+year|holi|rakhi|raksha\\s+bandhan|valentine\\w*|leave|sick\\s+leave|promotion|interview|follow[-\\s]?up)\\b",
  "\\bfor\\s+(?:this|the|my)\\s+(?:photo|pic|picture|post|reel|story|video)\\b",
  "(?<![\\p{L}])(?:ke\\s+liye|ko\\s+bhej\\w*|ko\\s+bol\\w*)(?![\\p{L}])",
  "के\\s+लिए|को\\s+भेज",
].join("|"), "iu");
/** "…for Priya", "…to Aarav": a name, capitalised by the recognizer, after to/for. */
const FOR_NAME = /\b(?:to|for)\s+[A-Z][\p{Ll}]+/u;
const ADDRESSED = /\b(?:hey\s+)?tailzu\b/i;

/** Apps where people write to people, as the clients name them. */
const PEOPLE_APPS = /\b(?:whatsapp|telegram|signal|slack|teams|discord|messenger|messages|sms|gmail|outlook|e-?mail|mail|instagram|linkedin|twitter|facebook)\b/i;

/**
 * Apps whose text box is a prompt for another AI, or code. What is said there
 * is a prompt to write down, never a request for the keyboard to carry out:
 * "explain black holes to a golden retriever" goes to ChatGPT as the prompt.
 */
const AI_APPS = /\b(?:chatgpt|openai|claude|gemini|bard|perplexity|copilot|grok|deepseek|meta\s*ai|poe|mistral|le\s*chat|cursor|windsurf|vs\s*code|visual\s+studio|terminal|iterm|warp)\b/i;

export function promptsAnAi(targetApp: string | undefined): boolean {
  return !!targetApp && AI_APPS.test(targetApp);
}

export type ComposeAsk = { kind: "piece" } | { kind: "tooBig" };

/**
 * Is this an unmistakable ask to write something for them?
 *
 *   piece   a small piece, said as a request, with who or what it is for
 *           (or said in a people app): write it.
 *   tooBig  an essay, code, a story, a report: not a keyboard's job, so it
 *           is part of what they are saying, and is written down as such.
 *   null    anything else, the writer decides as it always has.
 */
export function composeAsk(text: string, targetApp?: string): ComposeAsk | null {
  const said = (text ?? "").trim();
  if (!said || promptsAnAi(targetApp)) return null;
  if (IMPERATIVE_BIG.test(said) || HI_BIG.test(said) || DEVA_BIG.test(said)) return { kind: "tooBig" };
  const m = IMPERATIVE_PIECE.exec(said);
  const asked = !!m || HI_PIECE.test(said) || DEVA_PIECE.test(said);
  if (!asked) return null;
  const forSomeone = FOR_SOMEONE.test(said) || FOR_NAME.test(said) || ADDRESSED.test(said);
  // "Can you write me…" and "write me a text when you land" are how people
  // ask PEOPLE for things. Said that way, only a stated someone or occasion
  // makes it a request to the keyboard; being in a chat app is not enough.
  const toAPerson = !!m && /\b(?:can|could|would|will)\s+(?:you|u)\b|\b(?:me|us)\b/i.test(m[0]);
  const inAPeopleApp = !!targetApp && PEOPLE_APPS.test(targetApp);
  return forSomeone || (inAPeopleApp && !toAPerson) ? { kind: "piece" } : null;
}

/**
 * Looser: the words of a request to write something are there, anywhere,
 * whether or not it is unmistakably one. Used only to keep the dictation
 * checks from undoing a piece the writer chose to write — never to tell the
 * writer to write one.
 */
const LOOSE_PIECE = new RegExp(`\\b${VERB}${BETWEEN}(?:${PIECE})(?![\\p{L}])`, "iu");
export function mentionsAPiece(text: string): boolean {
  const said = (text ?? "").trim();
  return !!said && (LOOSE_PIECE.test(said) || HI_PIECE.test(said) || DEVA_PIECE.test(said));
}
