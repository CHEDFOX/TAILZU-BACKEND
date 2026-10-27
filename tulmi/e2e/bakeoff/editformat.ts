/**
 * THE EDIT-FORMAT PROBE: WHICH WAY OF ASKING FOR AN EDIT A MODEL GETS RIGHT. Ten tiny edits, each asked three ways, one call each, scored by whether the
 * edit APPLIES CLEANLY and the file comes out exactly as it should:
 *
 *   exact    JSON: a list of { old, new } where `old` is text copied from the file that occurs once (what Tailzu's edit_file does)
 *   blocks   SEARCH / REPLACE blocks, as Aider writes them
 *   diff     a unified diff, applied with `git apply --recount`
 *
 * Some models are better with one than another; the result per model is the format to prefer for it. The appliers are plain functions of text, so they are
 * tested without a model.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CallInput, CallResult } from "../../src/code/brain/gateway.js";
import { tmpDir, rmrf } from "../util.js";

export const EDIT_FORMATS = ["exact", "blocks", "diff"] as const;
export type EditFormat = (typeof EDIT_FORMATS)[number];

export interface EditCase { id: string; path: string; before: string; after: string; instruction: string }

export const EDIT_CASES: EditCase[] = [
  {
    id: "constant", path: "src/client.js", instruction: "Change the request timeout from 3000 ms to 5000 ms.",
    before: "const BASE_URL = 'https://api.example.com'\nconst TIMEOUT_MS = 3000\n\nasync function get(path) {\n  const res = await fetch(BASE_URL + path, { signal: AbortSignal.timeout(TIMEOUT_MS) })\n  return res.json()\n}\n",
    after: "const BASE_URL = 'https://api.example.com'\nconst TIMEOUT_MS = 5000\n\nasync function get(path) {\n  const res = await fetch(BASE_URL + path, { signal: AbortSignal.timeout(TIMEOUT_MS) })\n  return res.json()\n}\n",
  },
  {
    id: "param", path: "src/greet.js", instruction: "Give greet a second parameter `punctuation` that defaults to '!' and use it instead of the hard-coded '!'.",
    before: "function greet(name) {\n  return 'Hello, ' + name + '!'\n}\n\nmodule.exports = { greet }\n",
    after: "function greet(name, punctuation = '!') {\n  return 'Hello, ' + name + punctuation\n}\n\nmodule.exports = { greet }\n",
  },
  {
    id: "rename", path: "src/total.js", instruction: "Rename the variable `acc` to `sum` everywhere in sumPrices.",
    before: "function sumPrices(items) {\n  let acc = 0\n  for (const item of items) {\n    acc += item.price\n  }\n  return acc\n}\n",
    after: "function sumPrices(items) {\n  let sum = 0\n  for (const item of items) {\n    sum += item.price\n  }\n  return sum\n}\n",
  },
  {
    id: "offbyone", path: "src/list.js", instruction: "Fix the off-by-one error: the loop reads one past the end of the array.",
    before: "function names(users) {\n  const out = []\n  for (let i = 0; i <= users.length; i++) {\n    out.push(users[i].name)\n  }\n  return out\n}\n",
    after: "function names(users) {\n  const out = []\n  for (let i = 0; i < users.length; i++) {\n    out.push(users[i].name)\n  }\n  return out\n}\n",
  },
  {
    id: "guard", path: "src/user.js", instruction: "At the top of displayName, return 'anonymous' when user is null or undefined.",
    before: "function displayName(user) {\n  const first = user.first || ''\n  const last = user.last || ''\n  return (first + ' ' + last).trim()\n}\n",
    after: "function displayName(user) {\n  if (user == null) return 'anonymous'\n  const first = user.first || ''\n  const last = user.last || ''\n  return (first + ' ' + last).trim()\n}\n",
  },
  {
    id: "python-default", path: "app/retry.py", instruction: "Change the default of `attempts` from 3 to 5 and update the docstring to say 5.",
    before: "def retry(fn, attempts=3):\n    \"\"\"Call fn, retrying up to 3 times.\"\"\"\n    for i in range(attempts):\n        try:\n            return fn()\n        except Exception:\n            if i == attempts - 1:\n                raise\n",
    after: "def retry(fn, attempts=5):\n    \"\"\"Call fn, retrying up to 5 times.\"\"\"\n    for i in range(attempts):\n        try:\n            return fn()\n        except Exception:\n            if i == attempts - 1:\n                raise\n",
  },
  {
    id: "import", path: "src/paths.js", instruction: "Import `join` from 'node:path' at the top and use it in fullPath instead of the string concatenation.",
    before: "const ROOT = '/srv/data'\n\nfunction fullPath(name) {\n  return ROOT + '/' + name\n}\n\nmodule.exports = { fullPath }\n",
    after: "const { join } = require('node:path')\nconst ROOT = '/srv/data'\n\nfunction fullPath(name) {\n  return join(ROOT, name)\n}\n\nmodule.exports = { fullPath }\n",
  },
  {
    id: "delete", path: "src/util.js", instruction: "Delete the unused function `legacyFormat` and nothing else.",
    before: "function pad(n) {\n  return String(n).padStart(2, '0')\n}\n\nfunction legacyFormat(d) {\n  return d.getFullYear() + '-' + pad(d.getMonth() + 1)\n}\n\nfunction isoDay(d) {\n  return d.toISOString().slice(0, 10)\n}\n\nmodule.exports = { pad, isoDay }\n",
    after: "function pad(n) {\n  return String(n).padStart(2, '0')\n}\n\nfunction isoDay(d) {\n  return d.toISOString().slice(0, 10)\n}\n\nmodule.exports = { pad, isoDay }\n",
  },
  {
    id: "two-places", path: "src/messages.js", instruction: "Change the wording 'could not save' to 'failed to save' in both messages.",
    before: "const errors = {\n  profile: 'Your profile could not save, try again',\n  settings: 'Your settings could not save, try again',\n  billing: 'Billing details are invalid'\n}\n",
    after: "const errors = {\n  profile: 'Your profile failed to save, try again',\n  settings: 'Your settings failed to save, try again',\n  billing: 'Billing details are invalid'\n}\n",
  },
  {
    id: "wrap-try", path: "app/load.py", instruction: "Wrap the json.load call in try/except ValueError and return {} when the file is not valid JSON.",
    before: "import json\n\ndef load(path):\n    with open(path) as f:\n        data = json.load(f)\n    return data\n",
    after: "import json\n\ndef load(path):\n    with open(path) as f:\n        try:\n            data = json.load(f)\n        except ValueError:\n            return {}\n    return data\n",
  },
];

// ------------------------------------------------------------------ prompts

const SPEC: Record<EditFormat, string> = {
  exact: "Reply with JSON only, no prose and no code fences: {\"edits\":[{\"old\":\"<text copied exactly from the file, occurring once in it>\",\"new\":\"<its replacement>\"}]}. Use as many edits as the change needs.",
  blocks: "Reply with one or more blocks and nothing else:\n<<<<<<< SEARCH\n<lines copied exactly from the file>\n=======\n<the replacement lines>\n>>>>>>> REPLACE\nEach SEARCH must match the file exactly and occur once.",
  diff: "Reply with a unified diff only, no prose: a `--- a/<path>` and `+++ b/<path>` header, then @@ hunks with their context lines.",
};

export function editPrompt(format: EditFormat, c: EditCase): CallInput["messages"] {
  return [
    { role: "system", content: `You make exactly the edit asked for in one file, and nothing else. ${SPEC[format]}` },
    { role: "user", content: `File ${c.path}:\n\`\`\`\n${c.before}\`\`\`\n\nEdit: ${c.instruction}` },
  ];
}

// ----------------------------------------------------------------- appliers

const unfence = (s: string): string => { const m = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/.exec(s); return m ? m[1]! : s; };

function replaceOnce(text: string, old: string, now: string): string {
  if (!old) throw new Error("an empty `old`");
  const n = text.split(old).length - 1;
  if (n !== 1) throw new Error(n === 0 ? "the old text is not in the file" : `the old text occurs ${n} times`);
  return text.replace(old, () => now);
}

/** The text after the model's reply is applied to `before`, or why it could not be. */
export function applyReply(format: EditFormat, c: EditCase, reply: string): { ok: true; text: string } | { ok: false; why: string } {
  try {
    const body = unfence(reply.trim());
    if (format === "exact") {
      const j = JSON.parse(body) as { edits?: Array<{ old?: unknown; new?: unknown }> };
      if (!Array.isArray(j.edits) || !j.edits.length) return { ok: false, why: "no edits" };
      let t = c.before;
      for (const e of j.edits) {
        if (typeof e.old !== "string" || typeof e.new !== "string") return { ok: false, why: "an edit without old and new text" };
        t = replaceOnce(t, e.old, e.new);
      }
      return { ok: true, text: t };
    }
    if (format === "blocks") {
      const re = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
      let t = c.before;
      let n = 0;
      for (const m of body.matchAll(re)) { n += 1; t = replaceOnce(t, m[1]!, m[2]!); }
      return n ? { ok: true, text: t } : { ok: false, why: "no SEARCH/REPLACE block" };
    }
    // diff
    const dir = tmpDir("editfmt");
    try {
      const file = path.join(dir, c.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, c.before);
      const patch = body.endsWith("\n") ? body : `${body}\n`;
      for (const p of ["-p1", "-p0"]) {
        const r = spawnSync("git", ["apply", "--recount", "--whitespace=nowarn", p], { cwd: dir, input: patch, encoding: "utf8" });
        if (r.status === 0) return { ok: true, text: fs.readFileSync(file, "utf8") };
        fs.writeFileSync(file, c.before);
      }
      return { ok: false, why: "the diff does not apply" };
    } finally { rmrf(dir); }
  } catch (err) {
    return { ok: false, why: (err as Error).message.slice(0, 100) };
  }
}

export interface EditRow { format: EditFormat; id: string; applied: boolean; correct: boolean; why: string }

export interface EditFormatScore {
  rates: Record<EditFormat, number>;
  /** The format with the highest rate; ties go to the first of exact, blocks, diff. */
  best: EditFormat;
  rows: EditRow[];
  calls: number;
  failedCalls: number;
}

export type EditCall = (input: CallInput<unknown>) => Promise<CallResult<unknown>>;

/** Asks a model for each of the ten edits in each of the three formats, one call apiece, and scores whether they apply and come out right. */
export async function scoreEditFormats(call: EditCall, o: { cases?: EditCase[]; formats?: readonly EditFormat[] } = {}): Promise<EditFormatScore> {
  const cases = o.cases ?? EDIT_CASES;
  const formats = o.formats ?? EDIT_FORMATS;
  const rows: EditRow[] = [];
  let failed = 0;
  for (const format of formats) {
    for (const c of cases) {
      try {
        const r = await call({ tier: "cheap", messages: editPrompt(format, c), maxTokens: 500, purpose: `probe.edit_${format}`, userId: "probe", budget: { maxPaise: 100 } } as CallInput<unknown>);
        const a = applyReply(format, c, r.text);
        const correct = a.ok && a.text.trimEnd() === c.after.trimEnd();
        rows.push({ format, id: c.id, applied: a.ok, correct, why: a.ok ? (correct ? "" : "applied, but not the intended file") : a.why });
      } catch {
        failed += 1;
        rows.push({ format, id: c.id, applied: false, correct: false, why: "the call failed" });
      }
    }
  }
  const rates = Object.fromEntries(EDIT_FORMATS.map((f) => [f, rows.filter((r) => r.format === f && r.correct).length / Math.max(1, rows.filter((r) => r.format === f).length)])) as Record<EditFormat, number>;
  const best = [...formats].sort((a, b) => rates[b] - rates[a] || EDIT_FORMATS.indexOf(a) - EDIT_FORMATS.indexOf(b))[0] ?? "exact";
  return { rates, best, rows, calls: rows.length, failedCalls: failed };
}
