/**
 * THE QUERIES A GRAMMAR IS ASKED: tags (definitions and references), imports, routes, and the text a person reads.
 *
 * Written as tree-sitter query files in queries/<language>/<kind>.scm (the form tree-sitter tooling reads: `(function_declaration name:
 * (identifier) @name) @definition.function`) and embedded in queries.gen.ts. TSX asks TypeScript's queries, and TSX and JavaScript both
 * ask JSX's text query, since JSX is the same syntax in both.
 *
 * Capture names are the contract with extract.ts:
 *   tags     @definition.<kind> (the declaration) with @name; @reference.<kind> (the use) with @name
 *   imports  @import (the statement) with @source (the module as written)
 *   routes   @route… (the call or annotation) with @verb, @path, @receiver, @handler, @config as the language needs
 *   text     @text, @literal, @attr.name with @attr.value
 */
import type { GrammarId } from "./host.js";
import { QUERY_FILES } from "./queries.gen.js";

export type QueryKind = "tags" | "imports" | "routes" | "text";

/** The .scm files whose text makes up a grammar's query of this kind, in order. */
function filesFor(id: GrammarId, kind: QueryKind): string[] {
  if (kind === "text") {
    if (id === "tsx" || id === "javascript") return ["jsx/text.scm"];
    if (id === "html") return ["html/text.scm"];
    return [];
  }
  const dir = id === "tsx" ? "typescript" : id;
  // JSX is the same syntax in TSX and in JavaScript, and a TypeScript grammar without it has no such nodes to ask about.
  return kind === "tags" && (id === "tsx" || id === "javascript") ? [`${dir}/${kind}.scm`, "jsx/tags.scm"] : [`${dir}/${kind}.scm`];
}

/** The source of a query, or null when this grammar has none of that kind. */
export function querySource(id: GrammarId, kind: QueryKind): string | null {
  const parts = filesFor(id, kind).map((f) => QUERY_FILES[f]).filter((t): t is string => typeof t === "string");
  return parts.length ? parts.join("\n") : null;
}

/**
 * All of a grammar's queries as one: tags, imports, routes and text. A query costs a walk of the whole tree whatever it asks, so a file is walked
 * once, and what each part found is told apart by its capture names (definition.*, reference.*, import*, route*, text, literal, attr.*).
 */
export function combinedSource(id: GrammarId): string | null {
  const parts = (["tags", "imports", "routes", "text"] as const).map((k) => querySource(id, k)).filter((t): t is string => t !== null);
  return parts.length ? parts.join("\n") : null;
}

/** Every (grammar, kind) that has a query, for the test that compiles them all. */
export function allQueries(ids: readonly GrammarId[]): Array<{ id: GrammarId; kind: QueryKind; source: string }> {
  const out: Array<{ id: GrammarId; kind: QueryKind; source: string }> = [];
  for (const id of ids) for (const kind of ["tags", "imports", "routes", "text"] as const) { const source = querySource(id, kind); if (source) out.push({ id, kind, source }); }
  return out;
}
