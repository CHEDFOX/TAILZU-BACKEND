/**
 * The element-id scanner for JSX/TSX.
 *
 * It reads the artifact's ORIGINAL source (before Sucrase touches it) and puts `data-tz-id="<line>:<col>"` into the
 * opening tag of every element, right after the tag name. `<line>:<col>` is the position of the element's `<` in the
 * original text, so the server can find the element's source span from it. Nothing else in the text moves except that
 * insertion, and the insertions are returned, so a position in the edited text (a Sucrase syntax error, a stack frame
 * mapped through its source map) can be taken back to the original.
 *
 * It is a small hand-written lexer, not a parser: it knows strings, template literals (with `${}` nesting), comments,
 * regex literals, braces, and when a `<` can begin JSX (after an operator, an opening bracket, a keyword like `return`,
 * or at the start) as opposed to meaning less-than or a TypeScript type argument (after a name, a number, `)` or `]`).
 * A `<` that looks like JSX but whose element never closes is put back and read as an operator, so a type like
 * `<T>(x: T) => T` cannot swallow the rest of the file.
 *
 * Fragments (`<>` and `<Fragment>`) get no id. It never throws: on a half-written source it returns what it found.
 */
import { ELEMENT_ID_ATTR } from "../../tulmi/src/artifacts/protocol.js";
import { applyInserts, lineColAt, lineStarts, type Insert } from "./text.js";

export interface ImportRef {
  /** The module specifier, as written. */
  spec: string;
  /** Offset of the string literal in the original source. */
  offset: number;
  /** `import type …` / `export type … from`: Sucrase removes it, so it needs no library. */
  typeOnly: boolean;
}

export interface ScanResult {
  /** The source with the ids in. */
  code: string;
  inserts: (Insert & { text: string })[];
  imports: ImportRef[];
  /** How many elements got an id. */
  ids: number;
}

/** Words after which an expression (and so a regex or a JSX element) can start. */
const EXPR_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "default",
]);

const NO_ID_NAMES = new Set(["Fragment", "React.Fragment"]);

const isIdentStart = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
const isIdentPart = (c: number): boolean => isIdentStart(c) || (c >= 48 && c <= 57);
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;

const GENERIC_ARROW = /<\s*[A-Za-z_$][\w$]*\s*(?:,|extends\b)/y;
const JSX_NAME = /[A-Za-z_$][\w$.:-]*/y;
const JSX_ATTR = /[A-Za-z_$][\w$:-]*/y;
const TYPE_ONLY = /\s+type\s+(?!from\b)(?:\{|\*|[A-Za-z_$])/y;

export function injectJsxIds(src: string, attr: string = ELEMENT_ID_ATTR): ScanResult {
  const n = src.length;
  const starts = lineStarts(src);
  const inserts: (Insert & { text: string })[] = [];
  const imports: ImportRef[] = [];
  let i = 0;
  let ids = 0;
  // Characters that failed JSX attempts may cost in total; past this, `<` is always an operator.
  let budget = n * 3 + 20000;
  let jsxOff = false;

  // The previous two significant tokens, for the regex/JSX decision and for spotting `import … from "x"`.
  let lastKind: "value" | "op" = "op";
  let last = "";
  let last2 = "";
  let stmtTypeOnly = false;

  const setTok = (kind: "value" | "op", text: string): void => {
    last2 = last;
    last = text;
    lastKind = kind;
  };

  const skipSpace = (): void => {
    while (i < n && isSpace(src.charCodeAt(i))) i++;
  };

  const skipJsxSpace = (): void => {
    for (;;) {
      skipSpace();
      if (src.charCodeAt(i) === 47 && src.charCodeAt(i + 1) === 42) {
        const end = src.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
      } else if (src.charCodeAt(i) === 47 && src.charCodeAt(i + 1) === 47) {
        const end = src.indexOf("\n", i);
        i = end < 0 ? n : end + 1;
      } else return;
    }
  };

  const readString = (): void => {
    const quote = src.charCodeAt(i);
    const start = i;
    i++;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === quote) {
        i++;
        break;
      } else if (c === 10) break; // unterminated: stop at the line end rather than eat the file
      else i++;
    }
    const closed = src.charCodeAt(i - 1) === quote && i - 1 > start;
    if (closed && (last === "from" || last === "import" || (last === "(" && last2 === "import"))) {
      imports.push({ spec: src.slice(start + 1, i - 1), offset: start, typeOnly: last === "from" && stmtTypeOnly });
    }
    setTok("value", "str");
  };

  const readTemplate = (): void => {
    i++;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === 96) {
        i++;
        break;
      } else if (c === 36 && src.charCodeAt(i + 1) === 123) {
        i += 2;
        const saveLast = [lastKind, last, last2] as const;
        scanCode(true);
        [lastKind, last, last2] = saveLast;
      } else i++;
    }
    setTok("value", "tpl");
  };

  const readRegex = (): void => {
    const start = i;
    i++;
    let inClass = false;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === 10) {
        // Not a regex after all.
        i = start + 1;
        setTok("op", "/");
        return;
      } else if (c === 91) {
        inClass = true;
        i++;
      } else if (c === 93) {
        inClass = false;
        i++;
      } else if (c === 47 && !inClass) {
        i++;
        break;
      } else i++;
    }
    while (i < n && isIdentPart(src.charCodeAt(i))) i++;
    setTok("value", "re");
  };

  /** Code up to the `}` that closes the brace this was called after (when `untilBrace`), or to the end. Returns false at the end of the text. */
  function scanCode(untilBrace: boolean): boolean {
    let depth = 0;
    if (untilBrace) setTok("op", "{");
    while (i < n) {
      const c = src.charCodeAt(i);
      if (isSpace(c)) {
        i++;
        continue;
      }
      if (c === 47) {
        const d = src.charCodeAt(i + 1);
        if (d === 47) {
          const end = src.indexOf("\n", i);
          i = end < 0 ? n : end + 1;
          continue;
        }
        if (d === 42) {
          const end = src.indexOf("*/", i + 2);
          i = end < 0 ? n : end + 2;
          continue;
        }
        if (lastKind === "value") {
          i++;
          setTok("op", "/");
        } else readRegex();
        continue;
      }
      if (c === 34 || c === 39) {
        readString();
        continue;
      }
      if (c === 96) {
        readTemplate();
        continue;
      }
      if (c === 123) {
        depth++;
        i++;
        setTok("op", "{");
        continue;
      }
      if (c === 125) {
        i++;
        if (depth === 0) {
          if (untilBrace) return true;
          continue;
        }
        depth--;
        setTok("op", "}");
        continue;
      }
      if (c === 60) {
        if (lastKind !== "value" && !jsxOff && jsxCanStart() && tryJsx()) {
          setTok("value", "jsx");
          continue;
        }
        i++;
        setTok("op", "<");
        continue;
      }
      if (isIdentStart(c)) {
        const start = i;
        i++;
        while (i < n && isIdentPart(src.charCodeAt(i))) i++;
        const word = src.slice(start, i);
        if (last === ".") setTok("value", word);
        else if (EXPR_KEYWORDS.has(word)) setTok("op", word);
        else {
          if (word === "import" || word === "export") {
            TYPE_ONLY.lastIndex = i;
            stmtTypeOnly = TYPE_ONLY.test(src);
          }
          setTok("value", word);
        }
        continue;
      }
      if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
        i++;
        while (i < n && (isIdentPart(src.charCodeAt(i)) || src.charCodeAt(i) === 46)) i++;
        setTok("value", "num");
        continue;
      }
      i++;
      if (c === 41 || c === 93) setTok("value", String.fromCharCode(c));
      else setTok("op", String.fromCharCode(c));
    }
    return false;
  }

  /** At a `<` in code position: does a JSX element plausibly start here (and not a TypeScript generic arrow)? */
  function jsxCanStart(): boolean {
    GENERIC_ARROW.lastIndex = i;
    if (GENERIC_ARROW.test(src)) return false;
    let j = i + 1;
    while (j < n && isSpace(src.charCodeAt(j))) j++;
    const c = src.charCodeAt(j);
    return c === 62 || isIdentStart(c);
  }

  function tryJsx(): boolean {
    const saveI = i;
    const saveInserts = inserts.length;
    const saveImports = imports.length;
    const saveIds = ids;
    if (scanElement()) return true;
    budget -= i - saveI;
    if (budget < 0) jsxOff = true;
    i = saveI;
    inserts.length = saveInserts;
    imports.length = saveImports;
    ids = saveIds;
    return false;
  }

  /** At a `<` that starts a JSX element or fragment. Leaves `i` after its closing tag. False if it is not one. */
  function scanElement(): boolean {
    const open = i;
    i++;
    skipJsxSpace();
    if (src.charCodeAt(i) === 62) {
      i++;
      return scanChildren("");
    }
    JSX_NAME.lastIndex = i;
    const m = JSX_NAME.exec(src);
    if (!m) return false;
    const name = m[0];
    i += name.length;
    // TypeScript type arguments on the element: <Foo<string> prop />. The id goes after them.
    if (src.charCodeAt(i) === 60) {
      let depth = 0;
      let j = i;
      for (; j < n && j < i + 400; j++) {
        const c = src.charCodeAt(j);
        if (c === 60) depth++;
        else if (c === 62 && --depth === 0) break;
      }
      if (depth !== 0) return false;
      i = j + 1;
    }
    if (!NO_ID_NAMES.has(name)) {
      const { line, col } = lineColAt(starts, open);
      const text = ` ${attr}="${line}:${col}"`;
      inserts.push({ at: i, len: text.length, text });
      ids++;
    }
    for (;;) {
      skipJsxSpace();
      if (i >= n) return false;
      const c = src.charCodeAt(i);
      if (c === 47) {
        i++;
        skipJsxSpace();
        if (src.charCodeAt(i) !== 62) return false;
        i++;
        return true;
      }
      if (c === 62) {
        i++;
        break;
      }
      if (c === 123) {
        i++;
        if (!scanCode(true)) return false;
        continue;
      }
      JSX_ATTR.lastIndex = i;
      if (!JSX_ATTR.exec(src)) return false;
      i = JSX_ATTR.lastIndex;
      skipJsxSpace();
      if (src.charCodeAt(i) !== 61) continue;
      i++;
      skipJsxSpace();
      const v = src.charCodeAt(i);
      if (v === 34 || v === 39) {
        const end = src.indexOf(src[i]!, i + 1);
        if (end < 0) return false;
        i = end + 1;
      } else if (v === 123) {
        i++;
        if (!scanCode(true)) return false;
      } else if (v === 60) {
        if (!scanElement()) return false;
      } else return false;
    }
    return scanChildren(name);
  }

  /** After the `>` of an opening tag: text, `{…}` and child elements, up to the matching `</name>`. */
  function scanChildren(name: string): boolean {
    for (;;) {
      while (i < n) {
        const c = src.charCodeAt(i);
        if (c === 60 || c === 123) break;
        i++;
      }
      if (i >= n) return false;
      if (src.charCodeAt(i) === 123) {
        i++;
        if (!scanCode(true)) return false;
        continue;
      }
      let j = i + 1;
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      if (src.charCodeAt(j) === 47) {
        j++;
        while (j < n && isSpace(src.charCodeAt(j))) j++;
        JSX_NAME.lastIndex = j;
        const m = JSX_NAME.exec(src);
        const closeName = m ? m[0] : "";
        j += closeName.length;
        while (j < n && isSpace(src.charCodeAt(j))) j++;
        if (src.charCodeAt(j) !== 62 || closeName !== name) return false;
        i = j + 1;
        return true;
      }
      if (!scanElement()) return false;
    }
  }

  scanCode(false);
  return { code: applyInserts(src, inserts), inserts, imports, ids };
}
