/**
 * THE FIELD THEY ARE WRITING IN. Until now the writer knew only an app's
 * name, and guessed the field from it: "Gmail" could be the search box, the
 * To line, the subject or the message, and only the message wants
 * sentences. Clients that can read the field now say what it is (Android's
 * input type, iOS's keyboard traits, the desktop's accessibility role) and
 * what it is labelled, and the writer is told: "In Gmail, a text field
 * labelled “Subject”".
 *
 * The label is text off their screen, put there by whoever made the page, so
 * it is cleaned, cut short and quoted before the writer sees it, the way
 * every value inside a sentence of the rules is.
 */
import type { FieldKind } from "../../../shared/types/api.js";

const KINDS: Record<FieldKind, string> = {
  search: "a search box",
  url: "an address bar",
  email: "an email address field",
  number: "a number field",
  phone: "a phone number field",
  name: "a name field",
  address: "a postal address field",
  message: "a message box",
  text: "a text field",
  longtext: "a text area",
};

/** Fields that take a value, not a sentence: no capital or full stop added,
 *  no question or dropped-words checks (see cleanup.fieldShapesIt). */
const TAKES_A_VALUE = new Set<FieldKind>(["search", "url", "email", "number", "phone", "name", "address"]);

export function fieldKindOf(v: unknown): FieldKind | undefined {
  const k = typeof v === "string" ? v.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(KINDS, k) ? (k as FieldKind) : undefined;
}

/** A label as the writer may see it: one line, no quotes or angle brackets
 *  to break out of its quoting with, and short. */
export function cleanLabel(v: unknown, max = 40): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v
    .replace(/[\u0000-\u001f\u007f<>"“”‘’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || undefined;
}

export function takesAValue(kind?: string): boolean {
  const k = fieldKindOf(kind);
  return !!k && TAKES_A_VALUE.has(k);
}

/** "a message box labelled “Message #design”", "the field labelled
 *  “Subject”", "a search box"; "" when the client said nothing. */
export function describeField(kind?: string, label?: string): string {
  const k = fieldKindOf(kind);
  const l = cleanLabel(label);
  if (!k && !l) return "";
  const what = k ? KINDS[k] : "the field";
  return l ? `${what} labelled “${l}”` : what;
}
