/**
 * THE CONTROL PLANE — change anything any client is sent, live, without a
 * deploy.
 *
 * catalog.ts builds every payload: the app's bootstrap and screens, the
 * keyboard's config, the site's copy. A rule here edits the built payload on
 * its way out, for whoever it targets. It can reach any value: a flag, a
 * label, a colour, a node anywhere in a tree, a whole screen. It can target
 * a platform, a build range, an app version, a language, signed-in users,
 * named users, a percentage of users, a date window, or several variants of
 * an experiment.
 *
 * The code is the default. A rule is a decision made after the build, and
 * taking a rule away restores the default exactly.
 *
 * Nothing here can break a payload. A rule that does not match does nothing;
 * an operation that cannot apply (a path that is not there, a selector that
 * finds nothing) is skipped and reported to the preview, and the payload the
 * client gets is always the last good one.
 */
import { z } from "zod";

// "push" is not sent to a client: it is the smart-notification engine's own
// config (src/push/defaults.ts), edited per person before each plan.
export const SURFACES = ["bootstrap", "screen", "keyboard", "site", "push"] as const;
export type Surface = (typeof SURFACES)[number];

/** What is known about the request a payload is being built for. */
export interface ControlCtx {
  surface: Surface;
  /** The screen id, for surface "screen". */
  screen?: string;
  /** ios | android | web | desktop — normalised by the route. */
  platform?: string;
  /** phone | desktop | web */
  formFactor?: string;
  /** Keyboard binary build (the K-stamp number). */
  build?: number;
  /** App version, "1.4.2". */
  appVersion?: string;
  /** Running bundle: "embedded" or an update id prefix. */
  bundle?: string;
  userId?: string;
  /** The user's language code. */
  locale?: string;
  signedIn?: boolean;
  /** Current time; injectable for tests and previews. */
  now?: number;
}

// ---------------------------------------------------------------- schema

const Json: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(Json)]));
const Obj = z.record(Json);

/**
 * One edit. Two ways to point at what it edits:
 *   path   — a JSON Pointer into the payload: "/flags/kb.touch.vSlop",
 *            "/root/children/2", "/copy/hero/title". "-" appends to an array.
 *   select — a partial object; every object in the payload that contains it
 *            is a target: { "type": "LetterKey", "props": { "char": "q" } }.
 */
export const OpSchema = z.discriminatedUnion("op", [
  /** Replace the value at `path` (creating objects on the way). */
  z.object({ op: z.literal("set"), path: z.string(), value: Json }),
  /** Deep-merge `value` into the object at `path` (objects merge, arrays replace). */
  z.object({ op: z.literal("merge"), path: z.string(), value: Obj }),
  /** Delete the key or array element at `path`. */
  z.object({ op: z.literal("remove"), path: z.string() }),
  /** Insert `value` into the array at `path` before `index` (end if absent). */
  z.object({ op: z.literal("insert"), path: z.string(), index: z.number().int().optional(), value: Json }),
  /** Deep-merge `value` into every object matching `select`. */
  z.object({ op: z.literal("patch"), select: Obj, value: Obj, limit: z.number().int().positive().optional() }),
  /** Replace every object matching `select` with `value`. */
  z.object({ op: z.literal("replace"), select: Obj, value: Json, limit: z.number().int().positive().optional() }),
  /** Remove every object matching `select` from wherever it sits. */
  z.object({ op: z.literal("drop"), select: Obj, limit: z.number().int().positive().optional() }),
  /** Put `value` (one node or a list) beside the first match, in its array. */
  z.object({ op: z.literal("before"), select: Obj, value: Json }),
  z.object({ op: z.literal("after"), select: Obj, value: Json }),
  /** Add `value` (one or a list) to the `field` array ("children") of every match. */
  z.object({ op: z.literal("append"), select: Obj, value: Json, field: z.string().optional(),
    limit: z.number().int().positive().optional() }),
  z.object({ op: z.literal("prepend"), select: Obj, value: Json, field: z.string().optional(),
    limit: z.number().int().positive().optional() }),
  /** Rewrite text: every string equal to `find` (or containing it, whole=false). */
  z.object({ op: z.literal("text"), find: z.string().min(1), value: z.string(), whole: z.boolean().optional() }),
]);
export type Op = z.infer<typeof OpSchema>;

const Range = z.object({ min: z.number().optional(), max: z.number().optional() });
const VersionRange = z.object({ min: z.string().optional(), max: z.string().optional() });

export const WhenSchema = z.object({
  /** For surface "screen": which screens ("*" = all). */
  screens: z.array(z.string()).optional(),
  platform: z.array(z.string()).optional(),
  formFactor: z.array(z.string()).optional(),
  /** Keyboard build numbers, inclusive. */
  build: Range.optional(),
  /** App versions, inclusive, dotted-number compare. */
  appVersion: VersionRange.optional(),
  bundle: z.array(z.string()).optional(),
  locale: z.array(z.string()).optional(),
  signedIn: z.boolean().optional(),
  users: z.array(z.string()).optional(),
  exceptUsers: z.array(z.string()).optional(),
  /** Rollout slice: user buckets 0–99, inclusive. Signed-out requests only
   *  match a slice that covers everyone. */
  percent: z.tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)]).optional(),
  /** ISO times: live from / until. */
  from: z.string().optional(),
  until: z.string().optional(),
}).strict();

export const VariantSchema = z.object({
  name: z.string().min(1),
  /** Relative share of users. */
  weight: z.number().positive(),
  ops: z.array(OpSchema),
});

export const RuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i, "letters, digits, . _ - (max 80)"),
  surface: z.union([z.enum(SURFACES), z.literal("*")]),
  enabled: z.boolean().default(true),
  /** Lower runs first; ties by id. */
  order: z.number().default(0),
  note: z.string().optional(),
  when: WhenSchema.default({}),
  /** Applied to everyone the rule targets. */
  ops: z.array(OpSchema).default([]),
  /** An experiment: each targeted user gets one variant, stable by user id. */
  variants: z.array(VariantSchema).optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}).strict();
export type Rule = z.infer<typeof RuleSchema>;

// ---------------------------------------------------------------- targeting

/** djb2 over salt:user — the same bucketing the keyboard rollouts use. */
export function bucket(userId: string, salt: string): number {
  const s = `${salt}:${userId}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h % 100;
}

/** Dotted-number compare: "1.10.0" > "1.9.3". Non-numbers count as 0. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const inList = (list: string[] | undefined, v: string | undefined) =>
  !list || list.length === 0 || list.includes("*") || (v !== undefined && list.includes(v));

export function matches(rule: Rule, ctx: ControlCtx): boolean {
  if (!rule.enabled) return false;
  if (rule.surface !== "*" && rule.surface !== ctx.surface) return false;
  const w = rule.when;
  if (ctx.surface === "screen" && w.screens && !inList(w.screens, ctx.screen)) return false;
  if (!inList(w.platform, ctx.platform)) return false;
  if (!inList(w.formFactor, ctx.formFactor)) return false;
  if (!inList(w.bundle, ctx.bundle)) return false;
  if (w.locale?.length && !inList(w.locale, ctx.locale?.toLowerCase().split(/[-_]/)[0])) return false;
  if (w.signedIn !== undefined && !!ctx.signedIn !== w.signedIn) return false;
  if (w.build) {
    if (ctx.build === undefined) return false;
    if (w.build.min !== undefined && ctx.build < w.build.min) return false;
    if (w.build.max !== undefined && ctx.build > w.build.max) return false;
  }
  if (w.appVersion) {
    if (!ctx.appVersion) return false;
    if (w.appVersion.min && cmpVersion(ctx.appVersion, w.appVersion.min) < 0) return false;
    if (w.appVersion.max && cmpVersion(ctx.appVersion, w.appVersion.max) > 0) return false;
  }
  if (w.users?.length && !(ctx.userId && w.users.includes(ctx.userId))) return false;
  if (w.exceptUsers?.length && ctx.userId && w.exceptUsers.includes(ctx.userId)) return false;
  if (w.percent) {
    const [lo, hi] = w.percent;
    const everyone = lo === 0 && hi === 99;
    if (!everyone) {
      if (!ctx.userId) return false;
      const b = bucket(ctx.userId, rule.id);
      if (b < lo || b > hi) return false;
    }
  }
  const now = ctx.now ?? Date.now();
  if (w.from && now < Date.parse(w.from)) return false;
  if (w.until && now > Date.parse(w.until)) return false;
  return true;
}

/** Which variant of an experiment this user is in. Signed-out: the first. */
export function pickVariant(rule: Rule, ctx: ControlCtx): z.infer<typeof VariantSchema> | undefined {
  const vs = rule.variants;
  if (!vs?.length) return undefined;
  if (!ctx.userId) return vs[0];
  const total = vs.reduce((s, v) => s + v.weight, 0);
  const b = (bucket(ctx.userId, `${rule.id}#variant`) + 0.5) / 100 * total;
  let acc = 0;
  for (const v of vs) { acc += v.weight; if (b < acc) return v; }
  return vs[vs.length - 1];
}

// ---------------------------------------------------------------- patching

type Container = Record<string, unknown> | unknown[];
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parsePointer(p: string): string[] {
  if (p === "" || p === "/") return [];
  if (!p.startsWith("/")) throw new Error(`path must start with "/": ${p}`);
  return p.slice(1).split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function parentOf(root: unknown, tokens: string[], create: boolean): { parent: Container; key: string } {
  let cur: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    const next = Array.isArray(cur) ? cur[Number(t)] : isObj(cur) ? cur[t] : undefined;
    if (next === undefined || next === null) {
      if (!create || !isObj(cur)) throw new Error(`no ${"/" + tokens.slice(0, i + 1).join("/")}`);
      cur[t] = {};
      cur = cur[t];
    } else {
      cur = next;
    }
  }
  if (!Array.isArray(cur) && !isObj(cur)) throw new Error(`not a container: /${tokens.slice(0, -1).join("/")}`);
  return { parent: cur, key: tokens[tokens.length - 1]! };
}

function get(root: unknown, tokens: string[]): unknown {
  let cur: unknown = root;
  for (const t of tokens) {
    cur = Array.isArray(cur) ? cur[Number(t)] : isObj(cur) ? cur[t] : undefined;
    if (cur === undefined) throw new Error(`no /${tokens.join("/")}`);
  }
  return cur;
}

export function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const t = target[k];
    if (isObj(t) && isObj(v)) deepMerge(t, v);
    else target[k] = clone(v);
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** Does `node` contain everything in `sel`? Objects recurse; everything else is equal. */
export function contains(node: unknown, sel: unknown): boolean {
  if (isObj(sel)) {
    if (!isObj(node)) return false;
    for (const [k, v] of Object.entries(sel)) if (!contains(node[k], v)) return false;
    return true;
  }
  if (Array.isArray(sel)) {
    return Array.isArray(node) && node.length === sel.length && sel.every((s, i) => contains(node[i], s));
  }
  return node === sel;
}

interface Hit { node: Record<string, unknown>; parent: Container | null; key: string | number }

/** Every object in `root` containing `sel`, outermost first, with where it sits. */
function findAll(root: unknown, sel: Record<string, unknown>): Hit[] {
  const out: Hit[] = [];
  const walk = (v: unknown, parent: Container | null, key: string | number) => {
    if (isObj(v)) {
      if (contains(v, sel)) out.push({ node: v, parent, key });
      for (const [k, c] of Object.entries(v)) walk(c, v, k);
    } else if (Array.isArray(v)) {
      v.forEach((c, i) => walk(c, v, i));
    }
  };
  walk(root, null, "");
  return out;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

/** Apply one op to `root` in place. Returns how many places it changed. */
export function applyOp(root: Record<string, unknown>, op: Op): number {
  switch (op.op) {
    case "set": {
      const t = parsePointer(op.path);
      if (!t.length) throw new Error("cannot set the root");
      const { parent, key } = parentOf(root, t, true);
      if (Array.isArray(parent)) {
        if (key === "-") parent.push(clone(op.value)); else parent[Number(key)] = clone(op.value);
      } else parent[key] = clone(op.value);
      return 1;
    }
    case "merge": {
      const t = parsePointer(op.path);
      let target: unknown;
      if (!t.length) target = root;
      else {
        const { parent, key } = parentOf(root, t, true);
        if (Array.isArray(parent)) target = parent[Number(key)];
        else { if (!isObj(parent[key])) parent[key] = {}; target = parent[key]; }
      }
      if (!isObj(target)) throw new Error(`not an object: ${op.path}`);
      deepMerge(target, op.value);
      return 1;
    }
    case "remove": {
      const t = parsePointer(op.path);
      const { parent, key } = parentOf(root, t, false);
      if (Array.isArray(parent)) {
        const i = Number(key);
        if (!(i >= 0 && i < parent.length)) throw new Error(`no ${op.path}`);
        parent.splice(i, 1);
      } else {
        if (!(key in parent)) throw new Error(`no ${op.path}`);
        delete parent[key];
      }
      return 1;
    }
    case "insert": {
      const arr = get(root, parsePointer(op.path));
      if (!Array.isArray(arr)) throw new Error(`not an array: ${op.path}`);
      const i = op.index === undefined ? arr.length : Math.max(0, Math.min(arr.length, op.index));
      arr.splice(i, 0, ...asList(clone(op.value)));
      return 1;
    }
    case "text": {
      let n = 0;
      const walk = (v: unknown): unknown => {
        if (typeof v === "string") {
          if (op.whole === false ? v.includes(op.find) : v === op.find) {
            n++;
            return op.whole === false ? v.split(op.find).join(op.value) : op.value;
          }
          return v;
        }
        if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i]); return v; }
        if (isObj(v)) { for (const k of Object.keys(v)) v[k] = walk(v[k]); return v; }
        return v;
      };
      walk(root);
      return n;
    }
    default: {
      if (!Object.keys(op.select).length) throw new Error("select must name at least one field");
      let hits = findAll(root, op.select);
      if ("limit" in op && op.limit) hits = hits.slice(0, op.limit);
      if (!hits.length) return 0;
      switch (op.op) {
        case "patch":
          for (const h of hits) deepMerge(h.node, op.value);
          return hits.length;
        case "replace":
        case "drop": {
          // Innermost first, so removing a node never shifts one still to visit.
          let n = 0;
          for (const h of [...hits].reverse()) {
            if (!h.parent) continue;
            if (Array.isArray(h.parent)) {
              const i = h.parent.indexOf(h.node);
              if (i < 0) continue;
              if (op.op === "drop") h.parent.splice(i, 1); else h.parent[i] = clone(op.value);
            } else if (op.op === "drop") delete h.parent[h.key as string];
            else h.parent[h.key as string] = clone(op.value);
            n++;
          }
          return n;
        }
        case "before":
        case "after": {
          const h = hits.find((x) => Array.isArray(x.parent));
          if (!h) throw new Error("match is not in a list");
          const arr = h.parent as unknown[];
          const i = arr.indexOf(h.node);
          arr.splice(op.op === "before" ? i : i + 1, 0, ...asList(clone(op.value)));
          return 1;
        }
        case "append":
        case "prepend": {
          const field = op.field ?? "children";
          for (const h of hits) {
            if (!Array.isArray(h.node[field])) h.node[field] = [];
            const arr = h.node[field] as unknown[];
            if (op.op === "append") arr.push(...asList(clone(op.value)));
            else arr.unshift(...asList(clone(op.value)));
          }
          return hits.length;
        }
      }
    }
  }
  return 0;
}

export interface Applied {
  rule: string;
  variant?: string;
  op: number;
  changed: number;
  error?: string;
}

/**
 * Run every matching rule over a copy of `payload`. The payload is only
 * copied when a rule matches; with none, the original goes out untouched.
 * Experiment assignments are written to flags["control.variants"] when the
 * payload has flags, so a client (and analytics) can see which arm it is in.
 */
export function applyRules<T>(payload: T, rules: readonly Rule[], ctx: ControlCtx):
  { payload: T; applied: Applied[] } {
  const live = rules.filter((r) => matches(r, ctx))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (!live.length || !isObj(payload)) return { payload, applied: [] };
  const out = structuredClone(payload) as unknown as Record<string, unknown>;
  const applied: Applied[] = [];
  const variants: Record<string, string> = {};
  for (const r of live) {
    const v = pickVariant(r, ctx);
    if (v) variants[r.id] = v.name;
    const ops = [...r.ops, ...(v?.ops ?? [])];
    ops.forEach((op, i) => {
      try {
        applied.push({ rule: r.id, variant: v?.name, op: i, changed: applyOp(out, op) });
      } catch (e) {
        applied.push({ rule: r.id, variant: v?.name, op: i, changed: 0, error: (e as Error).message });
      }
    });
  }
  if (Object.keys(variants).length && isObj(out.flags)) {
    const prev = isObj(out.flags["control.variants"]) ? out.flags["control.variants"] : {};
    out.flags["control.variants"] = { ...prev, ...variants };
  }
  return { payload: out as unknown as T, applied };
}
