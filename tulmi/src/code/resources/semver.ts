/**
 * VERSIONS AND RANGES, JUST ENOUGH OF THEM: COMPARE TWO, TEST ONE AGAINST A RANGE, AND FIND THE LOWEST A RANGE ALLOWS.
 *
 * Two questions in layer 6 turn on versions, and neither is worth a dependency:
 * "does this library's peer range allow the React the project has?" (finder.ts)
 * and "which version does a manifest's `^4.17.0` really mean?" (audit.ts, when
 * there is no lockfile to say). So this reads npm's ranges (`^`, `~`, `>=`, `x`,
 * `*`, hyphen ranges, `||`, space as "and") and the plain `==`, `>=`, `~=` of
 * Python's, and treats a version as its numbers: `1.2.3-beta.1` and `1.2.3` are
 * compared as `1.2.3` with a pre-release ranking just below, and anything after
 * a `+` is ignored. It does not try to be semver.org; it errs on the side of
 * "satisfies" for a range it cannot read, because the callers use it to warn, not
 * to refuse.
 *
 * Pure.
 */

export interface Version { major: number; minor: number; patch: number; pre: string }

/** "v1.2.3-beta.1+build", "2", "1.2", "1.2.3.4" -> numbers. Null for something with no number at the front. */
export function parseVersion(raw: string): Version | null {
  const m = /^\s*[v=]*\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:\.\d+)*(?:[-.]?((?:a|b|c|rc|alpha|beta|dev|pre|post)[\w.]*|-[\w.]+))?(?:\+[\w.-]+)?\s*$/.exec(raw);
  if (!m) return null;
  const n = (s: string | undefined) => (s === undefined || /[xX*]/.test(s) ? 0 : Number(s));
  return { major: Number(m[1]), minor: n(m[2]), patch: n(m[3]), pre: (m[4] ?? "").replace(/^-/, "") };
}

/** -1, 0 or 1. A pre-release is below its release. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

type Cmp = { op: ">=" | ">" | "<" | "<=" | "="; v: Version };

const isX = (s: string | undefined) => s === undefined || s === "" || /^[xX*]$/.test(s);

/** One comparator set ("^1.2.3", ">=1 <3", "1.x", "1.2.3 - 2.0.0") as a list of bounds, or null when it allows anything. */
function boundsOf(range: string): Cmp[] | null {
  const r = range.trim();
  if (!r || r === "*" || r === "x" || r === "latest") return null;
  const hy = /^(\S+)\s+-\s+(\S+)$/.exec(r);
  if (hy) {
    const lo = parseVersion(hy[1]!), hi = parseVersion(hy[2]!);
    return lo && hi ? [{ op: ">=", v: lo }, { op: "<=", v: hi }] : null;
  }
  const out: Cmp[] = [];
  // ">= 1" is ">=1"; then the comparators are what is left between spaces.
  for (const tok of r.replace(/(>=|<=|===|==|~=|~>|>|<|=|\^|~)\s+/g, "$1").split(/\s+/)) {
    const m = /^(\^|~>|~=|~|>=|<=|==|===|>|<|=)?\s*v?([\d][\w.+-]*|[xX*])\s*$/.exec(tok.trim());
    if (!m) continue;
    const op = m[1] ?? "";
    if (isX(m[2])) continue;
    const parts = m[2]!.split(/[.+-]/);
    const v = parseVersion(m[2]!);
    if (!v) continue;
    const wild = parts.length < 3 || isX(parts[1]) || isX(parts[2]);
    if (op === "^") {
      const hi: Version = v.major > 0 ? { major: v.major + 1, minor: 0, patch: 0, pre: "" } : v.minor > 0 ? { major: 0, minor: v.minor + 1, patch: 0, pre: "" } : { major: 0, minor: 0, patch: v.patch + 1, pre: "" };
      out.push({ op: ">=", v }, { op: "<", v: hi });
    } else if (op === "~=") {
      // Python's compatible release: ~=2.1 is >=2.1 within 2.x, ~=2.1.3 is >=2.1.3 within 2.1.x.
      const hi: Version = parts.length >= 3 ? { major: v.major, minor: v.minor + 1, patch: 0, pre: "" } : { major: v.major + 1, minor: 0, patch: 0, pre: "" };
      out.push({ op: ">=", v }, { op: "<", v: hi });
    } else if (op === "~" || op === "~>") {
      const hi: Version = parts.length >= 2 && !isX(parts[1]) ? { major: v.major, minor: v.minor + 1, patch: 0, pre: "" } : { major: v.major + 1, minor: 0, patch: 0, pre: "" };
      out.push({ op: ">=", v }, { op: "<", v: hi });
    } else if ((op === "" || op === "=" || op === "==" || op === "===") && wild) {
      const hi: Version = parts.length >= 2 && !isX(parts[1]) ? { major: v.major, minor: v.minor + 1, patch: 0, pre: "" } : { major: v.major + 1, minor: 0, patch: 0, pre: "" };
      out.push({ op: ">=", v }, { op: "<", v: hi });
    } else if (op === "" || op === "=" || op === "==" || op === "===") {
      out.push({ op: "=", v });
    } else if (op === ">" || op === ">=" || op === "<" || op === "<=") {
      out.push({ op, v });
    }
  }
  return out.length ? out : null;
}

const cmpNum = (a: Version, b: Version): number => compareVersions(`${a.major}.${a.minor}.${a.patch}${a.pre ? `-${a.pre}` : ""}`, `${b.major}.${b.minor}.${b.patch}${b.pre ? `-${b.pre}` : ""}`);

function holds(c: Cmp, v: Version): boolean {
  const k = cmpNum(v, c.v);
  switch (c.op) {
    case ">=": return k >= 0;
    case ">": return k > 0;
    case "<": return k < 0;
    case "<=": return k <= 0;
    case "=": return k === 0;
  }
}

/** Whether `version` is inside `range` (npm's or Python's). A range that cannot be read allows everything; a version that cannot be read satisfies nothing but "any". */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const alts = range.split("||").map((s) => s.trim());
  if (alts.some((a) => boundsOf(a) === null)) return true;
  if (!v) return false;
  // Python writes "and" as a comma.
  return alts.some((a) => (boundsOf(a.replace(/,/g, " ")) ?? []).every((c) => holds(c, v)));
}

/**
 * The lowest version a manifest's range allows ("^4.17.0" -> "4.17.0", ">=2" ->
 * "2.0.0", "~1.4" -> "1.4.0", "==3.1.2" -> "3.1.2"), or null when it names none
 * ("*", "latest", a git address, a path). This is what an audit with no lockfile
 * has to go on, and why its answer is only approximate.
 */
export function minVersion(range: string): string | null {
  const first = range.split("||")[0]!.trim();
  if (!first || /^(?:\*|x|latest|next)$/i.test(first) || /^(?:workspace:|file:|link:|git|https?:|github:|npm:|\.|\/)/.test(first)) return null;
  const b = boundsOf(first.replace(/,/g, " "));
  const lows = (b ?? []).filter((c) => c.op === ">=" || c.op === ">" || c.op === "=").map((c) => c.v);
  if (!lows.length) {
    const bare = /(\d+(?:\.\d+){0,2})/.exec(first);
    return bare ? bare[1]!.split(".").concat(["0", "0"]).slice(0, 3).join(".") : null;
  }
  const v = lows.reduce((a, c) => (cmpNum(c, a) > 0 ? c : a));
  return `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;
}
