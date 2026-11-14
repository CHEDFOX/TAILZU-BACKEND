/**
 * THE DEVICE'S OWN COMPILER, HERE (pure/SPEC.md 2.0 principle 1, 2.12).
 *
 * The publish gate has to refuse exactly what the device would refuse, so the server keeps no second compiler: it
 * loads the generated copy of the phone's kernel, `shared/sdui/kernel.cjs`, and runs that. The file is written by
 * `node src/sdui/kernel/genKernel.mjs` in TAILZU-FRONTEND/app and never by hand; `tests/sdui-kernel.test.ts`
 * checks the sha chain in its header against the phone's sources.
 *
 * It is CommonJS (one file, no dependencies), so it comes in through `createRequire` rather than an import. The
 * shapes below are what this package uses of it, written out once so the rest of the package is typed.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Compiled {
  src: string;
  ops: number;
  deps: readonly string[];
  run(scope: Record<string, unknown>): unknown;
}

export interface CompiledText {
  src: string;
  ops: number;
  deps: readonly string[];
  literals: readonly string[];
  holes: readonly Compiled[];
  run(scope: Record<string, unknown>): string;
}

export interface CompiledRule {
  id: string;
  kind: "when" | "every" | "after";
  every: number;
  after: number;
  do: unknown;
}

export interface Expansion { node: unknown; nodes: number; depth: number; steps: number }

/** Everything the gate asks of the kernel. Each name is an export of shared/sdui/kernel.cjs. */
export interface Kernel {
  LIMITS: Readonly<Record<string, number>>;
  byteLen(s: string): number;
  VOCAB: number;
  BLOCKS: readonly string[];
  isBlock(name: unknown): boolean;
  unknownBlocks(names: readonly unknown[]): string[];
  missingBlocks(declared: readonly unknown[], needed: readonly unknown[]): string[];
  canDraw(declared: readonly unknown[], needed: readonly unknown[]): boolean;
  statePathError(path: unknown): string;
  localKeyError(key: unknown): string;
  looksLikeSecret(name: string): boolean;
  networkPathError(path: unknown): string;
  encodeHole(value: unknown): string;
  FUNCTION_NAMES: readonly string[];
  compileExpr(src: unknown, opts?: { maxOps?: number }): Compiled;
  tryCompileExpr(src: unknown, opts?: { maxOps?: number }): { ok: true; expr: Compiled } | { ok: false; error: string };
  compileText(src: unknown, opts?: { encode?: boolean }): CompiledText;
  isTextTemplate(v: unknown): boolean;
  isValueBinding(v: unknown): boolean;
  isEvaluable(v: unknown): boolean;
  isExprCondition(v: unknown): boolean;
  looksLikeForgottenTemplate(v: unknown): boolean;
  checkDefs(defs: unknown): string[];
  expandTree(root: unknown, defs?: unknown, opts?: { maxNodes?: number; maxDepth?: number }): Expansion;
  expandItem(root: unknown, defs?: unknown): Expansion;
  compileRules(list: unknown, opts?: { foreground?: boolean }): { rules: CompiledRule[]; errors: string[] };
}

/** Where the generated kernel sits, from here, from a bundle, or from the directory an operator named. */
function kernelFile(): string {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle with no file address */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "sdui", "kernel.cjs"),
    here && resolve(here, "..", "..", "..", "..", "shared", "sdui", "kernel.cjs"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "sdui", "kernel.cjs"),
    resolve(process.cwd(), "..", "shared", "sdui", "kernel.cjs"),
    resolve(process.cwd(), "shared", "sdui", "kernel.cjs"),
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("shared/sdui/kernel.cjs is missing: run `node src/sdui/kernel/genKernel.mjs` in TAILZU-FRONTEND/app");
  return found;
}

let loaded: Kernel | null = null;

/** The kernel, loaded once. Everything in this package goes through it rather than checking anything twice. */
export function kernel(): Kernel {
  if (!loaded) loaded = createRequire(import.meta.url)(kernelFile()) as Kernel;
  return loaded;
}
