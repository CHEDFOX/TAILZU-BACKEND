/**
 * THE FEW FILE FORMATS A MANIFEST COMES IN, READ JUST FAR ENOUGH.
 *
 * tsconfig.json has comments and trailing commas; Cargo.toml and pyproject.toml
 * are TOML; pubspec.yaml, pnpm-workspace.yaml and the translation files are YAML;
 * go.mod is its own thing. None of these gets a library here (no new
 * dependencies), and none needs a whole parser: the project brain wants a name,
 * a list of dependencies, a few settings. So each reader below handles the shapes
 * that real manifests are written in (nested tables, lists, strings, numbers,
 * booleans, inline tables) and gives up quietly, returning what it had, on
 * anything stranger. A manifest that doesn't parse is a manifest that says
 * less, never a build that fails.
 */
import { blankComments } from "./symbols.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: Json };

export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export const asArr = (v: unknown): Json[] => (Array.isArray(v) ? v : []);
export const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

// ------------------------------------------------------------------- JSON(C)

/** JSON with comments and trailing commas (tsconfig, .eslintrc, biome.json); null when it isn't. */
export function parseJsonc(text: string): Json {
  const bare = blankComments(text, { slash: true, hash: false, triple: false, backtick: false, apostrophe: "string" })
    .replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(bare) as Json; } catch { return null; }
}

// -------------------------------------------------------------------- TOML

function tomlScalar(raw: string): Json {
  const v = raw.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  let m: RegExpExecArray | null;
  if ((m = /^"((?:[^"\\]|\\.)*)"$/.exec(v))) return m[1]!.replace(/\\(["\\])/g, "$1");
  if ((m = /^'([^']*)'$/.exec(v))) return m[1]!;
  if (/^[+-]?\d[\d_]*(?:\.\d+)?$/.test(v)) return Number(v.replace(/_/g, ""));
  if (v.startsWith("[")) return tomlArray(v);
  if (v.startsWith("{")) return tomlInline(v);
  return v;
}

/** Splits at commas that are not inside a string, bracket or brace. */
function topLevelSplit(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (quote) { cur += c; if (c === "\\" && quote === '"') { cur += s[i + 1] ?? ""; i += 1; } else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === "[" || c === "{") depth += 1;
    if (c === "]" || c === "}") depth -= 1;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function tomlArray(v: string): Json[] {
  const inner = v.trim().replace(/^\[/, "").replace(/\]$/, "");
  return topLevelSplit(inner).map((p) => tomlScalar(p)).filter((x) => x !== "");
}

function tomlInline(v: string): Obj {
  const inner = v.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Obj = {};
  for (const part of topLevelSplit(inner)) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim().replace(/^["']|["']$/g, "")] = tomlScalar(part.slice(eq + 1));
  }
  return out;
}

/** Strips a `#` comment that is not inside a string. */
function tomlLine(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quote) { if (c === "\\" && quote === '"') i += 1; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

/** A TOML document as nested objects. `[[table]]` becomes an array of objects. */
export function parseToml(text: string): Obj {
  const root: Obj = {};
  let table: Obj = root;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = tomlLine(lines[i]!).trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line))) {
      const path = m[1]!.split(".").map((p) => p.trim().replace(/^["']|["']$/g, ""));
      let cur: Obj = root;
      for (let k = 0; k < path.length - 1; k += 1) { const next = cur[path[k]!]; cur = isObj(next) ? next : (cur[path[k]!] = {}); }
      const last = path[path.length - 1]!;
      const list = Array.isArray(cur[last]) ? (cur[last] as Json[]) : (cur[last] = []);
      const t: Obj = {};
      list.push(t);
      table = t;
      continue;
    }
    if ((m = /^\[\s*([^\]]+?)\s*\]$/.exec(line))) {
      let cur: Obj = root;
      for (const p of m[1]!.split(".").map((x) => x.trim().replace(/^["']|["']$/g, ""))) {
        const next = cur[p];
        cur = isObj(next) ? next : Array.isArray(next) && isObj(next[next.length - 1]) ? (next[next.length - 1] as Obj) : (cur[p] = {});
      }
      table = cur;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    let rest = line.slice(eq + 1).trim();
    // An array or inline table that runs over several lines.
    const open = rest.startsWith("[") ? ["[", "]"] : rest.startsWith("{") ? ["{", "}"] : null;
    if (open) {
      const depth = (s: string) => (s.match(new RegExp(`\\${open[0]}`, "g")) ?? []).length - (s.match(new RegExp(`\\${open[1]}`, "g")) ?? []).length;
      let d = depth(rest);
      while (d > 0 && i + 1 < lines.length) { i += 1; const more = tomlLine(lines[i]!).trim(); rest += " " + more; d += depth(more); }
    } else if (rest.startsWith('"""') || rest.startsWith("'''")) {
      const q = rest.slice(0, 3);
      if (!rest.slice(3).includes(q)) { while (i + 1 < lines.length) { i += 1; if (lines[i]!.includes(q)) break; } }
      rest = '""';
    }
    // dotted keys: a.b = 1
    const dotted = key.split(".");
    let cur = table;
    for (let k = 0; k < dotted.length - 1; k += 1) { const next = cur[dotted[k]!]; cur = isObj(next) ? next : (cur[dotted[k]!] = {}); }
    cur[dotted[dotted.length - 1]!] = tomlScalar(rest);
  }
  return root;
}

// -------------------------------------------------------------------- YAML

function yamlScalar(raw: string): Json {
  let v = raw.trim();
  // a comment after a plain value
  if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, "");
  v = v.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  let m: RegExpExecArray | null;
  if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(v))) return m[1]!.replace(/\\(["\\])/g, "$1").replace(/\\n/g, "\n");
  if ((m = /^'((?:[^']|'')*)'/.exec(v))) return m[1]!.replace(/''/g, "'");
  if (/^[+-]?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) return topLevelSplit(v.slice(1, -1)).map((p) => yamlScalar(p));
  if (v.startsWith("{") && v.endsWith("}")) {
    const o: Obj = {};
    for (const part of topLevelSplit(v.slice(1, -1))) { const c = part.indexOf(":"); if (c > 0) o[part.slice(0, c).trim().replace(/^["']|["']$/g, "")] = yamlScalar(part.slice(c + 1)); }
    return o;
  }
  return v;
}

/** The key and the rest of a `key: value` line, or null. A key may be quoted. */
function yamlPair(s: string): [string, string] | null {
  const m = /^(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s#:"'-][^:#]*?|-[^\s:][^:#]*?))\s*:(?:\s+(.*)|\s*)$/.exec(s);
  return m ? [m[1] ?? m[2] ?? m[3] ?? "", m[4] ?? ""] : null;
}

/**
 * A YAML document as nested objects and arrays: maps, lists, `- key: value`
 * items, quoted and plain scalars, flow lists and maps on one line, and block
 * scalars (`|`, `>`, whose text is read as one string). No anchors, tags or
 * multi-document files.
 */
export function parseYaml(text: string): Json {
  type Line = { indent: number; text: string; no: number };
  const raw = text.split("\n");
  const lines: Line[] = [];
  raw.forEach((l, no) => {
    if (!l.trim() || /^\s*#/.test(l) || /^---\s*$/.test(l)) return;
    lines.push({ indent: l.length - l.trimStart().length, text: l.trim(), no });
  });
  let pos = 0;

  function block(indent: number): Json {
    if (pos >= lines.length) return null;
    return lines[pos]!.text.startsWith("- ") || lines[pos]!.text === "-" ? list(lines[pos]!.indent) : map(indent);
  }
  function scalarBlock(parentIndent: number, style: string): string {
    const parts: string[] = [];
    const startNo = lines[pos - 1]!.no;
    // block scalar lines may include blank/comment-looking lines; take them from the raw text
    let r = startNo + 1;
    let base = -1;
    while (r < raw.length) {
      const l = raw[r]!;
      if (l.trim() === "") { parts.push(""); r += 1; continue; }
      const ind = l.length - l.trimStart().length;
      if (ind <= parentIndent) break;
      if (base < 0) base = ind;
      parts.push(l.slice(Math.min(base, ind)));
      r += 1;
    }
    while (pos < lines.length && lines[pos]!.no < r) pos += 1;
    return style.startsWith(">") ? parts.join(" ").trim() : parts.join("\n").trim();
  }
  function map(indent: number): Json {
    const out: Obj = {};
    while (pos < lines.length && lines[pos]!.indent === indent && !lines[pos]!.text.startsWith("- ")) {
      const l = lines[pos]!;
      const kv = yamlPair(l.text);
      pos += 1;
      if (!kv) continue;
      const [k, v] = kv;
      if (/^[|>][+-]?\d*$/.test(v.trim())) { out[k] = scalarBlock(l.indent, v.trim()); continue; }
      if (v === "") {
        const next = lines[pos];
        if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")))) out[k] = block(next.indent);
        else out[k] = null;
      } else out[k] = yamlScalar(v);
    }
    return out;
  }
  function list(indent: number): Json {
    const out: Json[] = [];
    while (pos < lines.length && lines[pos]!.indent === indent && (lines[pos]!.text.startsWith("- ") || lines[pos]!.text === "-")) {
      const l = lines[pos]!;
      const rest = l.text.slice(1).trim();
      if (!rest) { pos += 1; out.push(lines[pos] && lines[pos]!.indent > indent ? block(lines[pos]!.indent) : null); continue; }
      const kv = yamlPair(rest);
      if (kv && !rest.startsWith("{") && !rest.startsWith("[")) {
        // `- key: value` begins a map whose other keys are indented to the key's column.
        const inner = indent + (l.text.length - rest.length);
        lines[pos] = { indent: inner, text: rest, no: l.no };
        out.push(map(inner));
      } else { pos += 1; out.push(yamlScalar(rest)); }
    }
    return out;
  }
  try {
    return lines.length ? block(lines[0]!.indent) : null;
  } catch { return null; }
}

// ------------------------------------------------------------------- go.mod

export interface GoMod { module: string; goVersion: string; requires: string[] }

export function parseGoMod(text: string): GoMod {
  const out: GoMod = { module: "", goVersion: "", requires: [] };
  let inRequire = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^module\s+("?)([^\s"]+)\1/.exec(line))) out.module = m[2]!;
    else if ((m = /^go\s+(\S+)/.exec(line))) out.goVersion = m[1]!;
    else if (/^require\s*\(/.test(line)) inRequire = true;
    else if (inRequire && line === ")") inRequire = false;
    else if (inRequire && (m = /^(\S+)\s+v/.exec(line))) out.requires.push(m[1]!);
    else if ((m = /^require\s+(\S+)\s+v/.exec(line))) out.requires.push(m[1]!);
  }
  return out;
}
