/**
 * THE MAP AFTER A CHANGE: the brain's rows with the changed files read again, so that the commit making a change carries the map of the code as
 * it leaves it (.xode/map.json and .xode/MAP.md, phases.ts commitStaged) and the next request lands on the right lines.
 *
 * Only the changed files are parsed, by the same reader a build uses (symbols with their line ranges and fingerprints, imports resolved against
 * every path the project will have, references), with no model. A changed file keeps its summary and its rank until the next build; a new one
 * has none yet. A changed test file is linked to the components it imports. The map names the commit the change builds on (`commit`) and the
 * files the change touched (`changed`); each changed file's `blob` is git's own hash of its new content.
 */
import { createHash } from "node:crypto";
import { nextRootsOf } from "./build.js";
import { buildResolver, extractImports, resolveImport } from "./graph.js";
import { isTestPath, languageOf } from "./lang.js";
import { buildMap, withHashes, type ProjectMap } from "./map.js";
import { extractSymbols } from "./symbols.js";
import { analyse, ensureGrammars } from "./treesitter/index.js";
import type { CoreEntry, Feature, StoredFile } from "./types.js";

/** The folder the map lives in, in the repo: Xode's own, never a change of the model's. */
export const MAP_DIR = ".xode";

export interface MapChange { path: string; content?: string | null; delete?: boolean }

/** git's blob hash of a text: what `git hash-object` prints for it. */
export function gitBlobSha(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

export async function mapAfterChanges(input: {
  commit: string; files: readonly StoredFile[]; features: readonly Feature[]; entries: readonly string[]; core: Record<string, CoreEntry>; changes: readonly MapChange[];
}): Promise<ProjectMap> {
  const rows = new Map(input.files.map((f) => [f.path, { ...f, tests: [...f.tests] }]));
  const changes = input.changes.filter((c) => !c.path.startsWith(`${MAP_DIR}/`));
  for (const c of changes) if (c.delete || c.content == null) rows.delete(c.path);
  const written = changes.filter((c): c is MapChange & { content: string } => !c.delete && typeof c.content === "string");
  await ensureGrammars(written.map((c) => ({ path: c.path, lang: languageOf(c.path) })));
  const resolver = buildResolver(new Set([...rows.keys(), ...written.map((c) => c.path)]), input.core);
  const nextRoots = nextRootsOf(input.core);
  for (const c of written) {
    const lang = languageOf(c.path);
    const old = rows.get(c.path);
    const refs = analyse(c.path, lang, c.content)?.refs;
    const imports = [...new Set(extractImports(c.path, lang, c.content).flatMap((i) => resolveImport(resolver, i, c.path, lang)))].filter((p) => p !== c.path).sort();
    rows.set(c.path, {
      path: c.path, blobSha: gitBlobSha(c.content), lang, bytes: Buffer.byteLength(c.content, "utf8"),
      symbols: withHashes(c.content, extractSymbols(c.path, lang, c.content, { nextRoots })), imports,
      rank: old?.rank ?? 0, hot: old?.hot ?? 0, todo: old?.todo ?? 0, tests: old?.tests ?? [], summary: old?.summary ?? "", ...(refs ? { refs } : {}),
    });
    // A test the change wrote covers what it imports.
    if (isTestPath(c.path)) for (const p of imports) { const t = rows.get(p); if (t && !t.tests.includes(c.path)) t.tests.push(c.path); }
  }
  const map = buildMap({ commit: input.commit, files: [...rows.values()], features: input.features, entries: input.entries });
  return { ...map, changed: changes.map((c) => c.path).sort() };
}
