/**
 * THE ASSERTIONS OF AN EVAL FIXTURE: WHAT "THE MODEL DID WELL" MEANS FOR ONE INPUT, CHECKED WITHOUT A MODEL.
 *
 * evals/<role>.jsonl holds one fixture per line, { input, expect }. `input` is the dynamic user message of
 * the call, exactly as the product would send it (the stable block is added by compose(), so it is never
 * in a fixture). `images` names pictures in evals/images/ that go with it (the vision roles). `expect` says
 * what the answer must look like, and every key is optional:
 *
 *   json      { "path.to.field": value }   the parsed JSON has that value there; an array of values means any one of them
 *   has       ["path", ...]                these paths exist in the JSON and are not empty
 *   max       { "path": number }           the string at the path is at most that long; an array at it, at most that many items
 *   range     { "path": [min, max] }       the number at the path is between them
 *   include   ["text", ...]                the answer, as text, contains each (case does not matter)
 *   exclude   ["text", ...]                the answer contains none of them (case does not matter)
 *   tool      "name" | ["name", ...]       the first tool call is one of these (for a role that answers with tool calls)
 *   maxChars  number                       the answer is at most this long
 *
 * An example used to sit in the prompt and cost tokens on every call; here it costs nothing until a person
 * runs scripts/eval-prompts.ts with a key, and then it shows whether the principles alone were enough.
 *
 * Pure. Nothing here reads the environment, a store or a model.
 */

export interface Expect {
  json?: Record<string, unknown>;
  has?: string[];
  max?: Record<string, number>;
  range?: Record<string, [number, number]>;
  include?: string[];
  exclude?: string[];
  tool?: string | string[];
  maxChars?: number;
}

export interface Fixture {
  input: string;
  expect: Expect;
  /** File names in evals/images/, sent with the input. */
  images?: string[];
}

export interface Answer {
  text: string;
  /** The first tool call's name, when the model made any. */
  tool?: string;
}

export interface Verdict {
  ok: boolean;
  /** What failed, one line each. Empty when ok. */
  failures: string[];
}

const KEYS = ["json", "has", "max", "range", "include", "exclude", "tool", "maxChars"] as const;

/** Why a fixture line is not usable, or null when it is. */
export function fixtureProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "a fixture is an object { input, expect }";
  const f = raw as { input?: unknown; expect?: unknown; images?: unknown };
  if (typeof f.input !== "string" || !f.input.trim()) return "input is the user message, a non-empty string";
  if (f.images !== undefined && !(Array.isArray(f.images) && f.images.every((x) => typeof x === "string" && /^[\w.-]+\.png$/.test(x)))) return "images is a list of png file names in evals/images/";
  if (!f.expect || typeof f.expect !== "object" || Array.isArray(f.expect)) return "expect is an object";
  const e = f.expect as Record<string, unknown>;
  const keys = Object.keys(e);
  if (!keys.length) return "expect holds at least one assertion";
  const stray = keys.find((k) => !(KEYS as readonly string[]).includes(k));
  if (stray) return `expect.${stray} is not an assertion (json, has, max, range, include, exclude, tool, maxChars)`;
  for (const k of ["has", "include", "exclude"] as const) {
    if (e[k] !== undefined && !(Array.isArray(e[k]) && (e[k] as unknown[]).every((x) => typeof x === "string" && x))) return `expect.${k} is a list of non-empty strings`;
  }
  if (e.json !== undefined && (!e.json || typeof e.json !== "object" || Array.isArray(e.json))) return "expect.json maps a path to a value";
  if (e.max !== undefined && (!e.max || typeof e.max !== "object" || Object.values(e.max as object).some((n) => typeof n !== "number"))) return "expect.max maps a path to a number";
  if (e.range !== undefined && (!e.range || typeof e.range !== "object" || Object.values(e.range as object).some((r) => !Array.isArray(r) || r.length !== 2 || r.some((n) => typeof n !== "number")))) return "expect.range maps a path to [min, max]";
  if (e.tool !== undefined && !(typeof e.tool === "string" || (Array.isArray(e.tool) && e.tool.every((x) => typeof x === "string")))) return "expect.tool is a name or a list of names";
  if (e.maxChars !== undefined && typeof e.maxChars !== "number") return "expect.maxChars is a number";
  return null;
}

/** The first JSON value in a model's answer: the whole text, a code fence's inside, or from the first brace to its last partner. */
export function parseAnswerJson(text: string): unknown {
  const tries: string[] = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) tries.push(fence[1].trim());
  const open = text.search(/[{[]/);
  if (open >= 0) {
    const close = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (close > open) tries.push(text.slice(open, close + 1));
  }
  for (const t of tries) {
    try { return JSON.parse(t); } catch { /* the next form */ }
  }
  return undefined;
}

/** The value at a dotted path: `needs.web`, `summaries.0.summary`. Undefined when any step is missing. */
export function at(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const step of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[step];
  }
  return cur;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const empty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Whether an answer meets a fixture's assertions. */
export function check(expect: Expect, answer: Answer): Verdict {
  const failures: string[] = [];
  const lower = answer.text.toLowerCase();
  const needsJson = expect.json !== undefined || expect.has !== undefined || expect.max !== undefined || expect.range !== undefined;
  const parsed = needsJson ? parseAnswerJson(answer.text) : undefined;
  if (needsJson && parsed === undefined) failures.push("the answer is not JSON");

  if (parsed !== undefined) {
    for (const [path, want] of Object.entries(expect.json ?? {})) {
      const got = at(parsed, path);
      const ok = Array.isArray(want) ? want.some((w) => same(w, got)) : same(want, got);
      if (!ok) failures.push(`${path} is ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
    }
    for (const path of expect.has ?? []) if (empty(at(parsed, path))) failures.push(`${path} is missing or empty`);
    for (const [path, n] of Object.entries(expect.max ?? {})) {
      const got = at(parsed, path);
      const size = typeof got === "string" ? got.length : Array.isArray(got) ? got.length : undefined;
      if (size === undefined) failures.push(`${path} is not a string or a list`);
      else if (size > n) failures.push(`${path} is ${size} long, at most ${n}`);
    }
    for (const [path, [lo, hi]] of Object.entries(expect.range ?? {})) {
      const got = at(parsed, path);
      if (typeof got !== "number") failures.push(`${path} is not a number`);
      else if (got < lo || got > hi) failures.push(`${path} is ${got}, wanted ${lo} to ${hi}`);
    }
  }
  for (const s of expect.include ?? []) if (!lower.includes(s.toLowerCase())) failures.push(`missing "${s}"`);
  for (const s of expect.exclude ?? []) if (lower.includes(s.toLowerCase())) failures.push(`contains "${s}"`);
  if (expect.tool !== undefined) {
    const names = Array.isArray(expect.tool) ? expect.tool : [expect.tool];
    if (!answer.tool || !names.includes(answer.tool)) failures.push(`first tool is ${answer.tool ?? "none"}, wanted ${names.join(" or ")}`);
  }
  if (expect.maxChars !== undefined && answer.text.length > expect.maxChars) failures.push(`${answer.text.length} characters, at most ${expect.maxChars}`);
  return { ok: failures.length === 0, failures };
}
