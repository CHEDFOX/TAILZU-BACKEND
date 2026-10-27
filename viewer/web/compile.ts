/**
 * TSX/JSX → a module the browser can run. Loaded only for react artifacts.
 *
 *   1. element ids go into the ORIGINAL text (lib/scan.ts), so their positions are the author's;
 *   2. the imports are checked against the libraries the page can resolve;
 *   3. Sucrase turns TypeScript and JSX into plain modern JavaScript (ES modules stay, JSX becomes jsx() calls from
 *      react/jsx-runtime) and gives a source map;
 *   4. every position that comes back (a syntax error, a stack frame) is taken back to the original text.
 */
import { transform } from "@tz/sucrase";
import { ARTIFACT_LIBS } from "../../tulmi/src/artifacts/protocol.js";
import { makeLookup } from "../lib/srcmap.js";
import { injectJsxIds, type ImportRef } from "../lib/scan.js";
import { lineColAt, lineStarts, offsetAt, toOriginalOffset } from "../lib/text.js";
import { ViewerError, type Locator } from "./errors.js";

export interface Compiled {
  code: string;
  imports: ImportRef[];
  /** A position in `code` → the position in the artifact's original source. */
  locate: Locator;
  /** How many elements got an id. */
  ids: number;
}

function importProblem(spec: string): string {
  const libs = ARTIFACT_LIBS.join(", ");
  if (/^(\.{0,2}\/|~\/)/.test(spec)) return `Cannot import "${spec}": an artifact is a single file, so there are no relative imports. Put the code in this file. Libraries you can import: ${libs}.`;
  if (/^(https?:|data:|blob:|node:)/.test(spec)) return `Cannot import "${spec}": artifacts cannot load code from the network or from Node. Libraries you can import: ${libs}.`;
  return `Cannot import "${spec}": it is not one of the libraries available to artifacts. Libraries you can import: ${libs}.`;
}

/** The position of `name` inside the import statement of `spec`, so "does not provide an export named X" points at X. */
export function locateImportName(src: string, imports: ImportRef[], spec: string, name: string): { line: number; col: number } | undefined {
  const re = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$&")}(?![\\w$])`);
  for (const ref of imports) {
    if (ref.spec !== spec) continue;
    const stmt = Math.max(src.lastIndexOf("import", ref.offset), src.lastIndexOf("export", ref.offset));
    if (stmt < 0) continue;
    const m = re.exec(src.slice(stmt, ref.offset));
    if (m) return lineColAt(lineStarts(src), stmt + m.index);
  }
  return undefined;
}

export function compileReact(src: string, allowed: ReadonlySet<string>): Compiled {
  const original = lineStarts(src);
  const scan = injectJsxIds(src);

  for (const ref of scan.imports) {
    if (ref.typeOnly || allowed.has(ref.spec)) continue;
    const at = lineColAt(original, ref.offset);
    throw new ViewerError("import", importProblem(ref.spec), at.line, at.col);
  }

  const edited = lineStarts(scan.code);
  const toOriginal = (offset: number): { line: number; col: number } => lineColAt(original, toOriginalOffset(scan.inserts, offset));

  let out: ReturnType<typeof transform>;
  try {
    out = transform(scan.code, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "automatic",
      production: true,
      disableESTransforms: true,
      filePath: "artifact.tsx",
      sourceMapOptions: { compiledFilename: "artifact.js" },
    });
  } catch (e) {
    const err = e as { message?: string; pos?: number };
    const message = String(err.message ?? e).replace(/^Error transforming [^:]*: /, "").replace(/\s*\(\d+:\d+\)$/, "");
    const at = typeof err.pos === "number" ? toOriginal(err.pos) : undefined;
    throw new ViewerError("compile", message, at?.line, at?.col);
  }

  const lookup = makeLookup(out.sourceMap);
  const locate: Locator = (line, col) => {
    const src2 = lookup(line, col) ?? { line, col };
    return toOriginal(offsetAt(edited, src2.line, src2.col, scan.code.length));
  };
  return { code: out.code, imports: scan.imports, locate, ids: scan.ids };
}
