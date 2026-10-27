/**
 * GITLEAKS' DEFAULT RULES, RUN IN-PROCESS: THE PROVIDER-SPECIFIC HALF OF THE SECRET SCAN (policy.ts scanForSecrets).
 *
 * The rules (gitleaksRules.ts, generated from Gitleaks' own gitleaks.toml; MIT; THIRD_PARTY_NOTICES.md) are applied the way Gitleaks applies them:
 *
 *   1. keywords   a rule runs only on text that holds one of its keywords (case-insensitive). One Aho-Corasick pass over the text finds every rule's
 *                 keywords at once, so the ~220 rules cost one walk of the text plus the rules whose words are there.
 *   2. regex      the rule's regular expression; the secret is its `secretGroup`, or the first capture group that took part, or the whole match.
 *   3. entropy    the secret's Shannon entropy must be above the rule's floor (and, for the generic rule, hold a digit).
 *   4. allowlists the global one and the rule's own: paths, regexes (tested on the secret, the whole match or the line) and stopwords, alone or all together.
 *
 * Gitleaks reads whole files; so does this. A file that Gitleaks' global allowlist names by path (lockfiles, images, vendored code) is not scanned by
 * these rules, but the older rules in policy.ts still look at it.
 *
 * What comes out is the KINDS ("an Adafruit API key"), never the text that matched: the matched text is dropped as soon as it has been judged.
 *
 * Pure: no I/O, no `node:` import, so it runs the same on the VPS and in the jobs Worker.
 */
import { GL_GLOBAL, GL_RULES, type GlAllow, type GlRule, type Rx } from "./gitleaksRules.js";

// ------------------------------------------------------------ keyword prefilter (Aho-Corasick)

interface Automaton {
  /** Dense transition table, already multiplied: next[state + class] is the next state's offset. */
  next: Int32Array;
  /** UTF-16 code unit to class (0 = a character no keyword uses). */
  cls: Uint8Array;
  /** 1 at the offset of a state where a keyword ends (this state or any suffix of it). */
  ends: Uint8Array;
  /** Offset of such a state -> the rules whose keywords end there. */
  out: Map<number, Int32Array>;
}

function automatonOf(rules: readonly GlRule[]): Automaton {
  const cls = new Uint8Array(65536);
  let K = 1;
  for (const r of rules) {
    for (const word of r.kw) {
      for (let i = 0; i < word.length; i++) {
        const c = word.charCodeAt(i);
        if (c >= 128) throw new Error(`gitleaks keyword ${JSON.stringify(word)} is not ASCII`);
        if (!cls[c]) cls[c] = K++;
      }
    }
  }
  for (let c = 65; c <= 90; c++) cls[c] = cls[c + 32]!; // a capital letter is its small letter
  const trans: number[] = new Array(K).fill(-1);
  const ends: number[][] = [[]];
  rules.forEach((r, ri) => {
    for (const word of r.kw) {
      let s = 0;
      for (let i = 0; i < word.length; i++) {
        const c = cls[word.charCodeAt(i)]!;
        let t = trans[s * K + c]!;
        if (t < 0) {
          t = ends.length;
          ends.push([]);
          for (let k = 0; k < K; k++) trans.push(-1);
          trans[s * K + c] = t;
        }
        s = t;
      }
      ends[s]!.push(ri);
    }
  });
  const fail = new Array<number>(ends.length).fill(0);
  const queue: number[] = [];
  for (let c = 0; c < K; c++) {
    const v = trans[c]!;
    if (v < 0) trans[c] = 0;
    else queue.push(v);
  }
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q]!;
    for (let c = 0; c < K; c++) {
      const v = trans[u * K + c]!;
      if (v < 0) trans[u * K + c] = trans[fail[u]! * K + c]!;
      else {
        fail[v] = trans[fail[u]! * K + c]!;
        for (const r of ends[fail[v]!]!) if (!ends[v]!.includes(r)) ends[v]!.push(r);
        queue.push(v);
      }
    }
  }
  const next = new Int32Array(trans.length);
  for (let i = 0; i < trans.length; i++) next[i] = trans[i]! * K;
  const out = new Map<number, Int32Array>();
  const flags = new Uint8Array(trans.length);
  ends.forEach((e, s) => { if (e.length) { out.set(s * K, Int32Array.from(e)); flags[s * K] = 1; } });
  return { next, cls, ends: flags, out };
}

let automaton: Automaton | undefined;
const rulesWithoutWords: number[] = GL_RULES.flatMap((r, i) => (r.kw.length ? [] : [i]));

/** Which rules' keywords are in `text`: fills `hit` (one byte per rule, 1 = the rule should run). */
function keywordsIn(text: string, hit: Uint8Array): void {
  const a = (automaton ??= automatonOf(GL_RULES));
  const { next, cls, ends, out } = a;
  let s = 0;
  for (let i = 0, n = text.length; i < n; i++) {
    s = next[s + cls[text.charCodeAt(i)]!]!;
    if (ends[s]) { const o = out.get(s)!; for (let j = 0; j < o.length; j++) hit[o[j]!] = 1; }
  }
}

// ------------------------------------------------------------------------------ regexes

const regexes = new Map<string, RegExp>();
/** A rule's regular expression, built the first time it is needed (a pattern costs nothing until a keyword brings it in). */
function rx(r: Rx, global: boolean): RegExp {
  const key = `${global ? "g" : "-"}${r[1]}/${r[0]}`;
  let re = regexes.get(key);
  if (!re) { re = new RegExp(r[0], global ? `${r[1]}g` : r[1]); regexes.set(key, re); }
  return re;
}

/** Shannon entropy of a string, in bits per character. */
function entropyOf(s: string): number {
  const n = new Map<string, number>();
  for (let i = 0; i < s.length; i++) { const c = s[i]!; n.set(c, (n.get(c) ?? 0) + 1); }
  let h = 0;
  for (const k of n.values()) { const p = k / s.length; h -= p * Math.log2(p); }
  return h;
}

const lineOf = (text: string, from: number, to: number): string => {
  const a = text.lastIndexOf("\n", from - 1) + 1;
  const b = text.indexOf("\n", to);
  return text.slice(a, b < 0 ? text.length : b);
};

const NAME_CHAR = /[\w.-]/;
/** The text Gitleaks calls the match: for a rule written with a lazy run of name characters in front, that run (up to 50 of them) and then what the regex matched. */
function matchOf(text: string, m: RegExpExecArray, pre?: boolean): string {
  if (!pre) return m[0];
  let from = m.index;
  while (from > 0 && m.index - from < 50 && NAME_CHAR.test(text[from - 1]!)) from--;
  return text.slice(from, m.index) + m[0];
}

/** Whether an allowlist excuses a finding: each part it has (paths, regexes, stopwords) is checked, and any one (or, with `cond: "AND"`, all) excuses. */
function allowed(a: GlAllow, path: string, text: string, m: RegExpExecArray, secret: string, pre?: boolean): boolean {
  const checks: boolean[] = [];
  if (a.paths?.length) checks.push(pathAllowed(a.paths, path));
  if (a.regexes?.length) {
    const target = a.target === "match" ? matchOf(text, m, pre) : a.target === "line" ? lineOf(text, m.index, m.index + m[0].length) : secret;
    checks.push(a.regexes.some((r) => rx(r, false).test(target)));
  }
  if (a.stop?.length) {
    const low = secret.toLowerCase();
    checks.push(a.stop.some((w) => low.includes(w)));
  }
  if (!checks.length) return false;
  return a.cond === "AND" ? checks.every(Boolean) : checks.some(Boolean);
}

function pathAllowed(list: readonly Rx[], path: string): boolean {
  return list.some((r) => rx(r, false).test(path));
}

const globalByPath = new Map<string, boolean>();
/** Whether Gitleaks' global allowlist names this path (lockfiles, images, vendored code): such a file is not scanned by these rules. */
export function skippedPath(path: string): boolean {
  let v = globalByPath.get(path);
  if (v === undefined) {
    v = !!GL_GLOBAL.paths && pathAllowed(GL_GLOBAL.paths, path);
    if (globalByPath.size > 512) globalByPath.clear();
    globalByPath.set(path, v);
  }
  return v;
}

/** The secret of a match: the rule's `group`, else the first capture group that took part, else the whole match. */
function secretOf(r: GlRule, m: RegExpExecArray): string {
  if (r.group) return m[r.group] ?? m[0];
  for (let i = 1; i < m.length; i++) if (m[i] !== undefined) return m[i]!;
  return m[0];
}

/** Gitleaks' global allowlist, minus its paths (those decide whether the file is scanned at all). */
const GLOBAL_ON_SECRET: GlAllow = { regexes: GL_GLOBAL.regexes, stop: GL_GLOBAL.stop };

/** Whether a regex match of rule `r` is a finding: past the entropy floor, and excused by no allowlist. */
function accepted(r: GlRule, path: string, text: string, m: RegExpExecArray): boolean {
  const secret = secretOf(r, m);
  if (r.entropy !== undefined) {
    if (entropyOf(secret) <= r.entropy) return false;
    if (r.generic && !/\d/.test(secret)) return false;
  }
  if (allowed(GLOBAL_ON_SECRET, path, text, m, secret)) return false;
  if (r.allow) for (const a of r.allow) if (allowed(a, path, text, m, secret, r.pre)) return false;
  return true;
}

/** A windowed rule reads at most this many characters of windows per file (about 50 ms of work), however often its anchor occurs. */
export const WINDOW_BUDGET = 2_000_000;

/** Whether rule number `ri` finds something in `text` (a file at `path`). */
export function ruleMatches(ri: number, path: string, text: string): boolean {
  const r = GL_RULES[ri]!;
  if (r.path && !rx(r.path, false).test(path)) return false;
  if (!r.re) return true;
  const re = rx(r.re, true);
  if (r.win) {
    const [anchor, span] = r.win;
    let budget = WINDOW_BUDGET;
    for (let at = text.indexOf(anchor); at >= 0 && budget > 0; at = text.indexOf(anchor, at + anchor.length)) {
      const from = Math.max(0, at - 1);
      const window = text.slice(from, at + span);
      budget -= window.length;
      if (matchIn(r, re, path, window)) return true;
    }
    return false;
  }
  return matchIn(r, re, path, text);
}

function matchIn(r: GlRule, re: RegExp, path: string, text: string): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === "") { re.lastIndex++; continue; }
    if (accepted(r, path, text, m)) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------ the scan

const hitBuf = new Uint8Array(GL_RULES.length);

/** The numbers of the rules that should run on `text`: those with a keyword in it, and those with no keywords at all. */
export function candidateRules(text: string): number[] {
  hitBuf.fill(0);
  keywordsIn(text, hitBuf);
  for (const i of rulesWithoutWords) hitBuf[i] = 1;
  const out: number[] = [];
  for (let i = 0; i < hitBuf.length; i++) if (hitBuf[i]) out.push(i);
  return out;
}

/** The ids of the rules that find something in the file. (`kinds` below is what the scan uses; this is for tests and for the benchmark.) */
export function ruleIdsFor(path: string, text: string): string[] {
  if (skippedPath(path)) return [];
  return candidateRules(text).filter((ri) => ruleMatches(ri, path, text)).map((ri) => GL_RULES[ri]!.id);
}

/** What kinds of secret Gitleaks' rules find in the file's text: each kind once, as the person reads it ("a GitLab token"). */
export function gitleaksKinds(path: string, text: string, generic = true): string[] {
  if (!text || skippedPath(path)) return [];
  const kinds = new Set<string>();
  let last = -1;
  for (const ri of candidateRules(text)) {
    const r = GL_RULES[ri]!;
    // The generic rule (a name that says "secret", then a value that looks random) is the slowest and the vaguest: it goes last, and only when asked and
    // when nothing more specific has been found.
    if (r.id === GENERIC_ID) { last = ri; continue; }
    if (kinds.has(r.kind)) continue;
    if (ruleMatches(ri, path, text)) kinds.add(r.kind);
  }
  if (last >= 0 && generic && kinds.size === 0 && ruleMatches(last, path, text)) kinds.add(GL_RULES[last]!.kind);
  return [...kinds];
}

const GENERIC_ID = "generic-api-key";

export const RULE_COUNT = GL_RULES.length;
export const ruleIds = (): string[] => GL_RULES.map((r) => r.id);
