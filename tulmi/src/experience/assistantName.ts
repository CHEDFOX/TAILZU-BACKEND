/**
 * THE KEYBOARD'S NAME, AND THE ONE THEY GAVE IT.
 *
 * Tailzu is its name for everyone, always. Beside it a person may give it a
 * second name of their own ("Zara", "Jarvis", "Munna"), set in Settings, and
 * call it either while they talk ("Zara, make it formal"). Both reach the
 * writer as the names it answers to, so speech addressed to it by either is an
 * instruction and never part of the message; and both reach the recognizer,
 * so an unusual name is heard as the name rather than as a near word.
 */
export const ASSISTANT_NAME = "Tailzu";
export const NICKNAME_MAX = 24;

/**
 * A nickname as it is stored: trimmed, single-spaced, letters (any alphabet),
 * marks, digits, spaces, apostrophes and hyphens only, at most NICKNAME_MAX
 * characters and three words. "" clears it, and so does Tailzu itself (it is
 * already the name). Anything else that is not a name is refused (null), so
 * nothing a person types can become an instruction inside a prompt.
 */
export function cleanNickname(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > NICKNAME_MAX || s.split(" ").length > 3) return null;
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’-]*$/u.test(s)) return null;
  if (s.toLowerCase() === ASSISTANT_NAME.toLowerCase()) return "";
  return s;
}

/** Their name for it, when they gave one. */
export function nicknameOf(p: { assistantName?: unknown } | undefined | null): string | undefined {
  const n = cleanNickname(p?.assistantName);
  return n ? n : undefined;
}

/** "Tailzu", or "Tailzu (they also call you Zara)" — for the first line of a prompt. */
export function nameForPrompt(p: { assistantName?: unknown } | undefined | null): string {
  const nick = nicknameOf(p);
  return nick ? `${ASSISTANT_NAME} (they also call you ${nick})` : ASSISTANT_NAME;
}

/**
 * Their saved words, and both names when they gave it one, for the
 * recognizer's hint. Only then: a hint biases what is heard, and priming every
 * recognizer for everyone with "Tailzu" would change what all of them hear to
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
