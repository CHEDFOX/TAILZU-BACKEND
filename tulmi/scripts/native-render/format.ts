/**
 * The one style for shared/native/looks.json.
 *
 * Pretty-printed with two spaces, except that any value whose compact form is
 * short enough goes on one line. That keeps a node ("type", "props", "style")
 * readable as one thing while the designs and roots around it stay a tree.
 *
 * A test pins the file to this output (tests/native-looks.test.ts), so a hand
 * edit in another style fails with "run format --write" instead of becoming a
 * review comment. Key order is whatever the file already has: the formatter
 * never reorders, only re-wraps.
 *
 *   npx tsx scripts/native-render/format.ts            # print the diff verdict
 *   npx tsx scripts/native-render/format.ts --write    # rewrite the file
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A value stays on one line while its own indent plus its compact form fits in this many columns. The key in front of it does not count: a long bind path should not break the node under it apart. */
export const COMPACT_WIDTH = 150;

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOOKS_PATH = resolve(HERE, "../../../shared/native/looks.json");

function compact(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(compact).join(", ")}]`;
  const parts = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${compact(v)}`);
  return `{${parts.join(", ")}}`;
}

function write(value: unknown, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const one = compact(value);
  if (indent.length + one.length <= COMPACT_WIDTH) return one;
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => inner + write(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (!entries.length) return "{}";
  const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The catalog as text, in the one style. Pure: same object in, same bytes out. */
export function formatCatalog(obj: unknown): string {
  return write(obj, "") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const raw = readFileSync(LOOKS_PATH, "utf8");
  const want = formatCatalog(JSON.parse(raw));
  if (want === raw) {
    console.log("looks.json is already in the one style.");
  } else if (process.argv.includes("--write")) {
    writeFileSync(LOOKS_PATH, want);
    console.log(`rewrote ${LOOKS_PATH} (${raw.length} -> ${want.length} bytes)`);
  } else {
    console.error("looks.json is not in the one style: run `npx tsx scripts/native-render/format.ts --write`.");
    process.exit(1);
  }
}
