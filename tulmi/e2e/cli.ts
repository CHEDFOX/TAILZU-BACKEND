/**
 * ONE STRICT COMMAND-LINE PARSER FOR EVERY E2E TOOL.
 *
 * Why it exists: `npx tsx e2e/bakeoff/index.ts --help` once started a REAL bake-off (the old parsers looked flags up by name and ignored the rest, so an unknown
 * flag was just a normal run with defaults, and the default cap was ₹100). It cost ₹0.48 before it was killed; a plan of ₹677 was on the way. Rules, for every tool:
 *
 *   - `--help` (or `-h`) prints the tool's help and exits 0 before anything else happens;
 *   - an unknown flag is an error (exit 2), with the closest known flag if there is one; nothing runs;
 *   - a flag that takes a value and gets none, or a number that is not a number, is an error;
 *   - an argument that is not a flag is an error unless the tool takes positionals;
 *   - a run that SPENDS MONEY needs an explicit `--budget-inr N` (`requireBudget`): there is no default cap to fall back on.
 *
 * A tool declares its flags once (`CliSpec`); `parseCli` returns the values; `runCli` turns the two ways of stopping early (`--help`, a usage error) into an exit
 * code. Pure functions: the tests call them with arrays of words.
 */

export type FlagKind = "bool" | "string" | "number" | "list";

export interface FlagSpec {
  kind: FlagKind;
  about: string;
  /** For the help text only: the placeholder of the value (`N`, `<glob>`). */
  value?: string;
}

export interface CliSpec {
  /** The command as a person types it (`npm run reality --`). */
  name: string;
  /** One line: what it does. */
  about: string;
  flags: Record<string, FlagSpec>;
  /** Words that are not flags (a sub-command, ids). `false`: none are accepted. */
  positionals?: { name: string; about: string; max?: number } | false;
  examples?: string[];
  /** Extra lines under the flags (rules the flags cannot say). */
  notes?: string[];
}

/** Thrown to stop a tool early with a message and an exit code (0 for --help). */
export class CliExit extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "CliExit";
  }
}

export interface Parsed {
  /** The flags that were given, by name without the dashes. */
  given: ReadonlyMap<string, string | number | boolean | string[]>;
  positionals: string[];
  has(name: string): boolean;
  str(name: string): string | undefined;
  num(name: string): number | undefined;
  list(name: string): string[];
  /** The raw words, for a tool that passes them on. */
  argv: string[];
}

const HELP = { kind: "bool", about: "print this help and exit" } as const satisfies FlagSpec;

function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** The known flag nearest to a mistyped one, if it is near enough to be a typo. */
export function closestFlag(name: string, known: readonly string[]): string | undefined {
  // `--budget` for `--budget-inr`: a prefix of a known flag is what was meant.
  const prefixed = name.length >= 3 ? known.filter((k) => k.startsWith(name)) : [];
  if (prefixed.length === 1) return prefixed[0];
  let best: { n: string; d: number } | undefined;
  for (const k of known) {
    const d = distance(name, k);
    if (!best || d < best.d) best = { n: k, d };
  }
  return best && best.d <= Math.max(2, Math.floor(name.length / 3)) ? best.n : undefined;
}

export function helpText(spec: CliSpec): string {
  const L: string[] = [spec.name, `  ${spec.about}`, ""];
  const entries = Object.entries({ ...spec.flags, help: HELP });
  const left = (n: string, f: FlagSpec): string => `--${n}${f.kind === "bool" ? "" : ` ${f.value ?? (f.kind === "number" ? "N" : f.kind === "list" ? "a,b" : "<text>")}`}`;
  const w = Math.min(34, Math.max(...entries.map(([n, f]) => left(n, f).length)) + 2);
  L.push("flags:");
  for (const [n, f] of entries) L.push(`  ${left(n, f).padEnd(w)}${f.about}`);
  if (spec.positionals) L.push("", `arguments: ${spec.positionals.name}  ${spec.positionals.about}`);
  else L.push("", "no other arguments are accepted: an unknown flag is an error, nothing runs");
  for (const n of spec.notes ?? []) L.push("", n);
  if (spec.examples?.length) L.push("", "examples:", ...spec.examples.map((e) => `  ${e}`));
  return L.join("\n");
}

/**
 * Reads `argv` against the spec. Throws CliExit(0, help) for --help and CliExit(2, why) for a mistake. `lenient`: unknown flags are kept in `given` as booleans
 * and not an error, for a first look at which mode a tool is in before the mode's own spec is applied (the caller must then parse again, strictly).
 */
export function parseCli(spec: CliSpec, argv: readonly string[], o: { lenient?: boolean } = {}): Parsed {
  const flags: Record<string, FlagSpec> = { ...spec.flags, help: HELP };
  const known = Object.keys(flags);
  const given = new Map<string, string | number | boolean | string[]>();
  const positionals: string[] = [];
  const words = [...argv];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    if (w === "-h") { given.set("help", true); continue; }
    if (!w.startsWith("--") || w === "--") {
      if (w === "--") { positionals.push(...words.slice(i + 1)); break; }
      if (!spec.positionals && !o.lenient) throw new CliExit(2, `unexpected argument "${w}".\n\n${spec.name} takes flags only; run with --help.`);
      positionals.push(w);
      continue;
    }
    const eq = w.indexOf("=");
    const name = w.slice(2, eq >= 0 ? eq : undefined);
    const f = flags[name];
    if (!f) {
      if (o.lenient) { given.set(name, true); continue; }
      const near = closestFlag(name, known);
      throw new CliExit(2, `unknown flag --${name}${near ? ` (did you mean --${near}?)` : ""}. Nothing was run.\n\nrun ${spec.name} --help for the flags.`);
    }
    if (f.kind === "bool") {
      if (eq >= 0) throw new CliExit(2, `--${name} takes no value.`);
      given.set(name, true);
      continue;
    }
    let value: string | undefined = eq >= 0 ? w.slice(eq + 1) : undefined;
    if (value === undefined) {
      const next = words[i + 1];
      // A value may start with a dash only when it is a negative number.
      if (next === undefined || (next.startsWith("--") && !/^-\d/.test(next))) throw new CliExit(2, `--${name} needs a value (${f.about}).`);
      value = next;
      i += 1;
    }
    if (f.kind === "number") {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n)) throw new CliExit(2, `--${name} needs a number, got "${value}".`);
      given.set(name, n);
    } else if (f.kind === "list") given.set(name, value.split(",").map((s) => s.trim()).filter(Boolean));
    else given.set(name, value);
  }
  if (spec.positionals && spec.positionals.max !== undefined && positionals.length > spec.positionals.max) {
    throw new CliExit(2, `too many arguments: ${spec.positionals.name} takes at most ${spec.positionals.max}, got ${positionals.length}.`);
  }
  if (given.get("help") === true && !o.lenient) throw new CliExit(0, helpText(spec));
  return {
    given, positionals, argv: [...argv],
    has: (n) => given.has(n),
    str: (n) => { const v = given.get(n); return typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : undefined; },
    num: (n) => { const v = given.get(n); return typeof v === "number" ? v : undefined; },
    list: (n) => { const v = given.get(n); return Array.isArray(v) ? v : typeof v === "string" ? [v] : []; },
  };
}

/**
 * A run that spends money names its cap. `spends` is the caller's judgement (a real model, not a replay, not an estimate). The cap is never defaulted: a
 * forgotten flag stops the run instead of starting one.
 */
export function requireBudget(p: Parsed, spends: boolean, what = "a run that calls a real model"): number {
  const n = p.num("budget-inr");
  if (!spends) return n ?? 0;
  if (n === undefined || !(n > 0)) {
    throw new CliExit(2, `${what} needs an explicit hard cap: --budget-inr N (rupees, more than 0). There is no default.\nTo see what it would cost first, add --estimate (or --dry); to run without paying, use a cassette (--replay) or a scripted model.`);
  }
  return n;
}

/**
 * Runs a tool's `main` with the exit-code rules: a CliExit prints its message (help to stdout, mistakes to stderr) and gives its code; any other error prints and
 * gives 1. `main` returns an exit code (or nothing for 0).
 */
export async function runCli(main: () => Promise<number | void>): Promise<number> {
  try {
    return (await main()) ?? 0;
  } catch (err) {
    if (err instanceof CliExit) {
      (err.code === 0 ? console.log : console.error)(err.message);
      return err.code;
    }
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}
