/**
 * THE KEYBOARD'S NAME, AND THE ONE THEY GAVE IT.
 *
 * X0 is its name for everyone, always (the product is X0 Bot; X0 for short).
 * Beside it a person may give it a second name of their own ("Zara", "Jarvis",
 * "Munna"), asked for in onboarding ("What will you call me?") and changed in
 * Settings, and call it either while they talk ("Zara, make it formal"). Both reach the
 * writer as the names it answers to, so speech addressed to it by either is an
 * instruction and never part of the message; and both reach the recognizer,
 * so an unusual name is heard as the name rather than as a near word.
 */
export const ASSISTANT_NAME = "X0";
/** Its name said in full, which is the name too: saving it as a nickname clears the nickname. */
const FULL_NAME = "X0 Bot";
export const NICKNAME_MAX = 24;

/**
 * A nickname as it is stored: trimmed, single-spaced, letters (any alphabet),
 * marks, digits, spaces, apostrophes and hyphens only, at most NICKNAME_MAX
 * characters and three words. "" clears it, and so does X0 itself, or X0 Bot
 * (it is already the name). Anything else that is not a name is refused (null), so
 * nothing a person types can become an instruction inside a prompt.
 */
export function cleanNickname(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > NICKNAME_MAX || s.split(" ").length > 3) return null;
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’-]*$/u.test(s)) return null;
  if (s.toLowerCase() === ASSISTANT_NAME.toLowerCase() || s.toLowerCase() === FULL_NAME.toLowerCase()) return "";
  return s;
}

/** Their name for it, when they gave one. */
export function nicknameOf(p: { assistantName?: unknown } | undefined | null): string | undefined {
  const n = cleanNickname(p?.assistantName);
  return n ? n : undefined;
}

/** "X0", or "X0 (they also call you Zara)" — for the first line of a prompt. */
export function nameForPrompt(p: { assistantName?: unknown } | undefined | null): string {
  const nick = nicknameOf(p);
  return nick ? `${ASSISTANT_NAME} (they also call you ${nick})` : ASSISTANT_NAME;
}

/**
 * Their saved words, and both names when they gave it one, for the
 * recognizer's hint. Only then: a hint biases what is heard, and priming every
 * recognizer for everyone with "X0" would change what all of them hear to
 * help the few who call it by name.
 */
export function vocabularyWithNames(p: { vocabulary?: string; assistantName?: unknown } | undefined | null): string | undefined {
  const nick = nicknameOf(p);
  if (!nick) return p?.vocabulary;
  const lines = String(p?.vocabulary ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const names = [ASSISTANT_NAME, nick];
  for (const n of names) if (!lines.some((l) => l.toLowerCase() === n.toLowerCase())) lines.push(n);
  return lines.join("\n");
}

/**
 * HOW X0 IS HEARD. Said aloud, "X0" reaches a recognizer spelled many ways: "X0", "XO", "x o", "X zero", "ex oh",
 * "Zo", "zero bot", "X0 Bot". Every one is the name. Lower case and single-spaced, as nameWords() leaves text, so
 * case and punctuation never matter ("X-0", "X.O.", "Ex-zero"). Tailzu, its old name, is here too, so a habit
 * keeps working. The desktop's one key router reads the same ways (appLists.ts desktop.router.heardAs).
 */
export const NAME_HEARD: readonly string[] = [
  "x0", "xo", "x o", "x 0", "x zero", "x oh", "ex zero", "ex oh", "ex o", "exo", "ex 0", "eks zero", "eks o", "zo", "zero bot",
  "x0 bot", "xo bot", "x o bot", "x 0 bot", "x zero bot", "ex zero bot", "ex oh bot", "x0bot", "xobot",
  "एक्स ज़ीरो", "एक्स जीरो", "एक्स ओ", "एक्सो", "एक्स0",
  "tailzu", "tail zu", "tailzoo",
];

/**
 * Of those, the ones that are ordinary words too: "xo" signs off a message ("love you, xo"), "zo" is a word in some
 * languages. They are the name only at the start of what was said (after a "hey"), never on their own at the end.
 */
export const NAME_HEARD_FRONT_ONLY: readonly string[] = ["xo", "x o", "zo"];

/** Lower case, punctuation as spaces, single-spaced: how a name and what was said are compared. */
export function nameWords(s: string): string {
  return String(s ?? "").normalize("NFC").toLowerCase()
    .replace(/[’'`ʼ]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A regular expression source (no anchors, for the "iu" flags) matching any of `forms` in text as it was said: the
 * words of a form apart by any run of spaces or punctuation ("X-zero", "x. o."), longest first. Latin forms only by
 * default, for patterns built on \b; `all` includes the Devanagari ones.
 */
export function namePattern(forms: readonly string[] = NAME_HEARD, all = false): string {
  return [...new Set(forms.map(nameWords).filter(Boolean))]
    .filter((f) => all || /^[a-z0-9 ]+$/.test(f))
    .sort((a, b) => b.length - a.length)
    .map((f) => f.split(" ").map(escapeRe).join("[\\s,.-]+"))
    .join("|");
}

/**
 * Was this said to it by name: X0 however it was heard, or their own name for it (`nick`)? At the start ("X zero,
 * make it formal", "hey Zara …"), or at the end ("… right, ex oh?") for every form but the ordinary words above.
 */
export function addressedByName(said: string, nick?: string | null): boolean {
  const words = nameWords(said);
  if (!words) return false;
  const own = nick ? nameWords(nick) : "";
  const front = [...NAME_HEARD, ...(own ? [own] : [])].map(nameWords).filter(Boolean);
  const back = front.filter((f) => !NAME_HEARD_FRONT_ONLY.includes(f));
  const alt = (list: string[]) => [...new Set(list)].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const G = "hey|hi|hello|ok|okay|oye|oi|arre|arey|suno|yo";
  if (new RegExp(`^(?:(?:${G}) )?(?:${alt(front)})(?: ji)?(?: |$)`, "u").test(words)) return true;
  if (new RegExp(`(?:^| )(?:hey|hi|hello|oye|arre|suno) (?:${alt(front)})(?: |$)`, "u").test(words)) return true;
  return new RegExp(`(?:^| )(?:${alt(back)})(?: ji)?$`, "u").test(words);
}

/** What was said, with the name it was addressed by (and a "hey" before it) taken off the front. */
export function withoutName(said: string, nick?: string | null): string {
  const s = String(said ?? "");
  const own = nick ? nameWords(nick) : "";
  const N = namePattern([...NAME_HEARD, ...(own ? [own] : [])], true);
  const out = s.replace(new RegExp(`^\\s*(?:(?:hey|hi|hello|ok|okay|oye|arre|suno|yo)[\\s,.!-]+)?(?:${N})(?:\\s+ji)?(?=[\\s,.:;!?-]|$)[\\s,.:;!?-]*`, "iu"), "");
  return out === s ? s : out;
}

/**
 * The name as it was said, when what was said addresses it by a spelling of X0 the recognizer chose ("Ex oh, make it
 * formal" gives "Ex oh"), at the start or (for every form but the ordinary words) at the end. Undefined when it was
 * not addressed, or was addressed as plain "X0" / "X0 Bot", which the writer reads as its name already.
 */
export function heardNameIn(said: string): string | undefined {
  const s = String(said ?? "");
  const all = namePattern(NAME_HEARD, true);
  const late = namePattern(NAME_HEARD.filter((f) => !NAME_HEARD_FRONT_ONLY.includes(f)), true);
  const front = new RegExp(`^\\s*(?:(?:hey|hi|hello|ok|okay|oye|arre|suno|yo)[\\s,.!-]+)?(${all})(?=[\\s,.:;!?-]|$)`, "iu").exec(s);
  const back = front ? null : new RegExp(`(?:^|[\\s,.;:-])(${late})[.!?…]*\\s*$`, "iu").exec(s);
  const hit = (front ?? back)?.[1];
  if (!hit) return undefined;
  const w = nameWords(hit);
  return w === nameWords(ASSISTANT_NAME) || w === nameWords(FULL_NAME) ? undefined : hit.trim();
}
