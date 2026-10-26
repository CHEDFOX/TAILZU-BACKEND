/**
 * A TOOL CALL'S ARGUMENTS, AGAINST THE TOOL'S OWN SCHEMA.
 *
 * The planner writes a USE line's arguments as JSON, and until now nothing
 * looked at them before the tool's own reader did: a call with no title, or
 * "max": "ten", went on to the app, which failed it in its own words, or on
 * to the person's confirm card. checkArgs reads the call against the input
 * schema the tool declares, in TaskService.use before anything is judged,
 * shown or run, so a call that cannot be right is never previewed, approved,
 * audited or called. What is wrong goes back to the planner in one line
 * (problemLine), and the run asks it once to fix the call (agent/run.ts).
 *
 * It reads the small part of JSON Schema the tools use: `type` (one, or a
 * list), `properties`, `required`, `items` (one schema), `enum` (of strings
 * and numbers) and `additionalProperties: false`, at most DEPTH_MAX deep.
 * Everything else (anyOf, oneOf, $ref, format, pattern, minimum, maxLength,
 * const, default …) is never a reason to refuse: the app's own reader still
 * has its say after this, and `nullable: true` only ever lets a null through.
 * A schema that is not an object says nothing, and every call passes it.
 *
 * It is more forgiving than a strict validator, in the ways the readers
 * already are, and the call goes on as it was made right:
 *
 *   a number or true/false where text is declared    -> the text of it
 *   "12", "+3.5", "1,50,000", "५००" for a number     -> the number
 *   "true" / "false" for true or false               -> true / false
 *   one value where a list is declared (but below)   -> a list of that one
 *   null or "" for a value that may be left out      -> left out
 *   "Walking" for one of walking, driving            -> "walking"
 *
 * It is never stricter than the reader after it, so some things go on as
 * they were written, for the reader to read its own way:
 *
 *   text where a list of text is declared            Calendar splits "a@x.com, b@y.com" itself;
 *                                                    a list of that one would be one bad address
 *   null as an item of a list                        Sheets reads it as an empty cell
 *   text, a number or true/false where a list's      Forms reads "Your name?" as a question
 *   item is an object
 *
 * Text is never read as JSON: a list written inside a string stays a string.
 *
 * `required: false` is for a hand-off (TaskService.use, an app with no
 * sign-in): a value it needs and was not given is left for the tool, whose
 * own question ("What's their UPI ID?") is better worded than a model's and
 * costs no model call. A wrong type or an unknown choice is still refused.
 *
 * WHAT IT SAYS BACK. The problems name the schema's own names, cleaned to
 * [A-Za-z0-9_.-] and cut to 40 characters, and never a value. The line goes
 * to the planner as one of Tailzu's own ("fix: …"), above the data fence, and
 * an app added by link writes its own schema: nothing an app or a person wrote
 * may speak in it as it was written.
 *
 * Not ajv: it is in node_modules only because the MCP SDK brings it, it is
 * strict where this must be forgiving, and it is far more than this needs.
 */
import type { ToolInfo } from "./client.js";

/** One thing wrong with a call's arguments. Names only ever from the schema, never values. */
export interface ArgProblem {
  /** "title", "attendees[0]". */
  path: string;
  kind: "missing" | "type" | "enum" | "not_object" | "extra";
  /** "text", "a number", "one of: walk, drive". */
  expected?: string;
}

export type Checked =
  | { ok: true; args: Record<string, unknown>; coerced: string[] }
  | { ok: false; problems: ArgProblem[] };

/** How deep into the arguments the schema is read: deeper than this, a value passes as it is. */
const DEPTH_MAX = 4;
/** A name as a Tailzu line carries it. */
const NAME_MAX = 40;
/** A path as a Tailzu line carries it ("rows[3][1]", "filter.status"). */
const PATH_MAX = 80;
/** Problems kept for one call, and said in one line. */
const PROBLEMS_MAX = 20;
const LINE_PROBLEMS = 6;
/** Choices named in an enum's problem. */
const ENUM_SHOWN = 8;

type Kind = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
const KINDS: readonly Kind[] = ["string", "number", "integer", "boolean", "object", "array", "null"];
const WORDS: Record<Kind, string> = {
  string: "text", number: "a number", integer: "a whole number", boolean: "true or false",
  object: "an object", array: "a list", null: "null",
};

type Schema = Record<string, unknown>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A name from a schema (or a key the planner wrote), as a Tailzu line may carry it. */
export const cleanName = (s: string, max = NAME_MAX): string => s.replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, max);

const segment = (k: string) => cleanName(k) || "?";
const at = (path: string, key: string) => (path ? `${path}.${segment(key)}` : segment(key));

/**
 * Set as an own property, whatever the key. A planner's "__proto__" is a key
 * like any other (JSON.parse makes it one), and assigned plainly it would
 * become the arguments' prototype, which a reader then reads through.
 */
function put(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** The types a schema declares that this reads; null when it declares none of them (any value). */
function kindsOf(s: Schema): Kind[] | null {
  const list = Array.isArray(s.type) ? s.type : [s.type];
  const kinds = list.filter((t): t is Kind => typeof t === "string" && (KINDS as readonly string[]).includes(t));
  return kinds.length ? kinds : null;
}

function fits(v: unknown, k: Kind): boolean {
  switch (k) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "object": return isObject(v);
    case "array": return Array.isArray(v);
    case "null": return v === null;
  }
}

/** Digits in Devanagari as ASCII, so "५००" is 500. */
const asciiDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966));
/** A number as text: a sign, digits plain or grouped with commas (1,00,000 or 100,000), a decimal point. */
const NUMBER_TEXT = /^[+-]?(?:\d+|\d{1,3}(?:,\d{2,3})+)(?:\.\d+)?$/;

function numberOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = asciiDigits(v.trim());
  if (!NUMBER_TEXT.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** The value made into this type, the way the readers would read it, or undefined when it cannot be. */
function coerce(v: unknown, k: Kind): { v: unknown } | undefined {
  switch (k) {
    case "string":
      return (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean" ? { v: String(v) } : undefined;
    case "number":
    case "integer": {
      const n = numberOf(v);
      return n !== null && (k === "number" || Number.isInteger(n)) ? { v: n } : undefined;
    }
    case "boolean":
      return typeof v === "string" && /^(?:true|false)$/i.test(v.trim()) ? { v: v.trim().toLowerCase() === "true" } : undefined;
    case "array":
      return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? { v: [v] } : undefined;
    default:
      return undefined;
  }
}

/** The enum, when it is one this reads: strings and numbers only. Anything else is not a reason to refuse. */
function choicesOf(s: Schema): Array<string | number> | null {
  const e = s.enum;
  if (!Array.isArray(e) || !e.length) return null;
  return e.every((x) => typeof x === "string" || typeof x === "number") ? (e as Array<string | number>) : null;
}

function choiceWords(choices: ReadonlyArray<string | number>): string {
  const shown = choices.map((c) => cleanName(String(c))).filter(Boolean);
  if (!shown.length) return "one of its choices";
  const some = shown.slice(0, ENUM_SHOWN).join(", ");
  return `one of: ${shown.length > ENUM_SHOWN ? `${some}, …` : some}`;
}

interface Run {
  required: boolean;
  problems: ArgProblem[];
  coerced: string[];
}

const problem = (r: Run, p: ArgProblem) => { if (r.problems.length < PROBLEMS_MAX) r.problems.push(p); };

/** One value against its schema: its type made right where it can be, its choice, then what is inside it. */
function value(s: unknown, v: unknown, path: string, depth: number, r: Run): unknown {
  if (!isObject(s) || depth > DEPTH_MAX) return v;
  if (v === null && takesNull(s)) return v;
  let x = v;
  const kinds = kindsOf(s);
  if (kinds && !kinds.some((k) => fits(x, k))) {
    if (typeof x === "string" && kinds.includes("array") && mayBeText(s.items)) return x;
    const made = kinds.map((k) => coerce(x, k)).find((c) => c !== undefined);
    if (!made) {
      problem(r, { path, kind: "type", expected: kinds.map((k) => WORDS[k]).join(" or ") });
      return v;
    }
    x = made.v;
    r.coerced.push(path);
  }
  const choices = choicesOf(s);
  if (choices && !choices.includes(x as string | number)) {
    const loose = typeof x === "string" || typeof x === "number" ? String(x).trim().toLowerCase() : null;
    const hit = loose === null ? undefined : choices.find((c) => String(c).toLowerCase() === loose);
    if (hit === undefined) {
      problem(r, { path, kind: "enum", expected: choiceWords(choices) });
      return x;
    }
    x = hit;
    r.coerced.push(path);
  }
  if (isObject(x)) return object(s, x, path, depth, r);
  if (Array.isArray(x) && isObject(s.items)) {
    const items = s.items;
    return x.map((item, i) => (leftToReader(items, item) ? item : value(items, item, `${path}[${i}]`, depth + 1, r)));
  }
  return x;
}

/** Whether a list's items may be text: declared text among others, or declared nothing this reads. */
const mayBeText = (items: unknown) => {
  const kinds = isObject(items) ? kindsOf(items) : null;
  return !kinds || kinds.includes("string");
};

/**
 * An item of a list that goes on as it was written, for the tool's reader to
 * read: null (a Sheets cell left empty), and a plain value where the items
 * are objects (a Forms question given as its words alone).
 */
function leftToReader(items: Schema, item: unknown): boolean {
  if (item === null) return true;
  const kinds = kindsOf(items);
  return !!kinds && kinds.every((k) => k === "object") && (typeof item === "string" || typeof item === "number" || typeof item === "boolean");
}

/** Whether a schema takes null as a value of its own: type ["string", "null"], or OpenAPI's nullable. */
const takesNull = (s: unknown) => isObject(s) && (s.nullable === true || (kindsOf(s)?.includes("null") ?? false));

/** An object's properties, each against its own schema; what it needs and does not have; keys it does not take. */
function object(s: Schema, o: Record<string, unknown>, path: string, depth: number, r: Run): Record<string, unknown> {
  const props = isObject(s.properties) ? s.properties : {};
  const needs = new Set(Array.isArray(s.required) ? s.required.filter((k): k is string => typeof k === "string") : []);
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(o)) {
    const own = Object.hasOwn(props, k) ? props[k] : undefined;
    if (own === undefined) {
      if (s.additionalProperties === false) problem(r, { path: at(path, k), kind: "extra" });
      else put(out, k, raw);
      continue;
    }
    // Empty: as good as not given. Refused when it is needed; otherwise left out.
    if ((raw === null && !takesNull(own)) || raw === "") {
      if (r.required && needs.has(k)) problem(r, { path: at(path, k), kind: "missing" });
      else r.coerced.push(at(path, k));
      continue;
    }
    put(out, k, value(own, raw, at(path, k), depth + 1, r));
  }
  if (r.required) {
    for (const k of needs) if (!Object.hasOwn(o, k)) problem(r, { path: at(path, k), kind: "missing" });
  }
  return out;
}

/**
 * The call's arguments against the tool's declared input schema, with the
 * coercions every reader already makes. `required: false` leaves missing
 * values to the tool (a hand-off asks the person for them in their words).
 */
export function checkArgs(schema: ToolInfo["inputSchema"], args: unknown, o: { required?: boolean } = {}): Checked {
  if (!isObject(args)) return { ok: false, problems: [{ path: "", kind: "not_object" }] };
  if (!isObject(schema)) return { ok: true, args, coerced: [] };
  const r: Run = { required: o.required !== false, problems: [], coerced: [] };
  const out = value(schema, args, "", 0, r);
  if (r.problems.length) return { ok: false, problems: r.problems };
  // A schema that declares the arguments something other than an object
  // cannot make them one: what came back is still the arguments.
  return { ok: true, args: isObject(out) ? out : args, coerced: r.coerced };
}

/** A path as it goes in the line: the names and the brackets of a list, nothing else. */
const pathWords = (p: string) => p.replace(/[^A-Za-z0-9_.[\]?-]+/g, "").slice(0, PATH_MAX) || "?";

/** For the planner: `missing "title"; "max" is a number`. Names cleaned to [A-Za-z0-9_.-], 40 characters. */
export function problemLine(problems: ArgProblem[]): string {
  const said = problems.slice(0, LINE_PROBLEMS).map((p) => {
    const name = `"${pathWords(p.path)}"`;
    switch (p.kind) {
      case "missing": return `missing ${name}`;
      case "extra": return `${name} is not one of its arguments`;
      case "not_object": return "the arguments go in one JSON object";
      default: return `${name} is ${(p.expected ?? "something else").replace(/[^A-Za-z0-9_.,:…' -]+/g, "").slice(0, 160)}`;
    }
  });
  const more = problems.length - LINE_PROBLEMS;
  return more > 0 ? `${said.join("; ")}; and ${more} more` : said.join("; ");
}
