/**
 * THE PUBLISH GATE for vocabulary-2 screens (pure/SPEC.md 2.12, 5.1; docs/renderer.md section 5).
 *
 *   const r = lintScreen(screen);
 *   if (r.errors.length) throw new Error(r.errors.join("; "));   // never served
 *
 * Everything a screen says is checked here with THE DEVICE'S OWN COMPILER (sdui2/kernel.ts), so the server refuses
 * exactly what the phone would refuse and there is one set of numbers, not two that drift. What it finds:
 *
 *   • every expression and every text with holes compiles, inside the op and character caps;
 *   • the limits of SPEC 5.1 — the screen's bytes, its nodes, its depth, its expressions, rules, timers, gestures,
 *     animated nodes, live topics;
 *   • paths: a state path is plain segments, a `local` key is not a secret, a network path is relative, under
 *     /v1/, with every hole encoded;
 *   • a bare string holding "{{ … }}" is probably a forgotten `$t` — a WARNING, never a refusal, because a note's
 *     title or a stranger's calendar invite may hold those characters and must draw as written (SPEC 2.2, and
 *     principle 4: user text is never a template). `strict` turns the warnings into errors for a screen whose
 *     text is all the kit's own;
 *   • unknown node types, unknown props on the blocks' own nodes, and a block used without being declared;
 *   • `device.canOpen.*` in a request body, so the server never collects a list of what someone has installed;
 *   • a List inside a scroller that runs the same way (SPEC 2.6).
 *
 * It also WORKS OUT `needs`: the blocks this screen cannot be drawn without. `gate.ts` serves it only to a client
 * that declared every one of them.
 */
import {
  BLOCK_NODES, CAN_OPEN_SCHEMES, DEVICE_FACTS, GESTURE_KINDS, INPUT_KINDS, MOTION_KEYS, PAINT_BLEND_MODES,
  PAINT_BLUR_TINTS, PAINT_FILTERS, PAINT_KEYS, PRESENTATIONS, SDUI_BLOCKS, SHELL_NODES, SHELL_TRANSITIONS,
  type ActionRef, type BlockName, type Node, type ScreenResponse,
} from "../../../../shared/types/sdui.js";
import { kernel } from "./kernel.js";

// ===================================================================== what each node and prop may be

/** Which block brings which node type (shared/types/sdui.ts BLOCK_NODES, which mirrors the phone's v3Spec). */
export const BLOCK_OF_NODE: Readonly<Record<string, BlockName>> = Object.freeze(
  Object.fromEntries(
    Object.entries(BLOCK_NODES).flatMap(([block, types]) => types.map((t) => [t, block as BlockName])),
  ) as Record<string, BlockName>,
);

/** Every prop each of the blocks' nodes takes. A prop outside its list is refused here rather than ignored on the
 *  device, because a prop that silently does nothing is the hardest kind of screen to debug from a server. */
const NODE_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  List: ["data", "item", "key", "estimatedSize", "uniform", "horizontal", "scroll", "page", "pageMode",
    "onEndReached", "endThreshold", "refresh", "sticky", "clip"],
  Each: ["data", "item", "key", "max"],
  Input: ["kind", "label", "placeholder", "disabled", "maxLength", "length", "digitsOnly", "min", "max", "step",
    "decimals", "live", "threshold", "options", "stars", "minuteStep", "into", "autoFocus"],
  Video: ["source", "contentFit", "loop", "muted", "volume", "rate", "autoplay", "playing", "controls",
    "fullscreen", "into", "tickMs"],
  Audio: ["source", "loop", "muted", "volume", "rate", "playing", "into"],
  Camera: ["mode", "facing", "zoom", "torch", "active", "quality", "capture", "barcodeTypes", "scanInto",
    "readyInto", "permissionInto"],
  TabBar: ["height", "background", "borderColor", "bottomInset"],
  Header: ["height", "background"],
  Toast: ["bottom", "background", "ms"],
  Modal: ["background", "dismissible", "backdrop", "radius"],
  Sheet: ["background", "detents", "initial", "dismissible", "backdrop", "radius"],
  Slot: ["name"],
});

/** Props that name a place in the screen's own store. */
const STATE_PATH_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Input: ["into"],
  Camera: ["scanInto", "readyInto", "permissionInto"],
});

/** The keys of a media node's `into`, each a state path. */
const MEDIA_INTO = ["playing", "time", "duration", "progress", "ended", "loading"];

/** Node types that scroll, and which way they run by default. */
const SCROLLERS: Readonly<Record<string, "x" | "y">> = Object.freeze({ Screen: "y", Scroll: "y" });

/** The one place a topic's grammar is written on this side; the phone's is live/subscribe.ts. */
const TOPIC = /^[A-Za-z0-9:_\-.*]{1,64}$/;

// ===================================================================== the result

export interface LintCounts {
  bytes: number;
  nodes: number;
  depth: number;
  steps: number;
  exprs: number;
  ops: number;
  rules: number;
  timers: number;
  gestures: number;
  motionNodes: number;
  topics: number;
}

export interface LintResult {
  /** Anything in here and the screen is not served. */
  errors: string[];
  /** Worth a look, not a refusal. */
  warnings: string[];
  /** The blocks the screen cannot be drawn without, in SDUI_BLOCKS order. */
  needs: BlockName[];
  counts: LintCounts;
}

export interface LintOptions {
  /** Turn the warnings into refusals. For a screen whose every string is the kit's own, never for one carrying
   *  words a person or a connected service wrote. */
  strict?: boolean;
}

// ===================================================================== the walk

interface Work {
  errors: string[];
  warnings: string[];
  needs: Set<BlockName>;
  counts: LintCounts;
  /** How many Lists have taken a Screen over as its scroller. */
  screenScrollers: number;
}

const isNode = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as Node).type === "string";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const owns = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Does this list of paths read something under `device.` / `local.`? Used to work out `needs`. */
function depBlocks(deps: readonly string[], w: Work): void {
  for (const d of deps) {
    if (d === "device" || d.startsWith("device.")) w.needs.add("device");
    if (d === "local" || d.startsWith("local.")) w.needs.add("local");
  }
}

/** One expression or one text with holes. Everything else comes back as it was. */
function compileOne(v: unknown, where: string, w: Work, opts: { encode?: boolean } = {}): void {
  const k = kernel();
  w.counts.exprs += 1;
  if (w.counts.exprs > k.LIMITS.exprPerScreen) {
    if (w.counts.exprs === k.LIMITS.exprPerScreen + 1) w.errors.push(`a screen has at most ${k.LIMITS.exprPerScreen} expressions`);
    return;
  }
  w.needs.add("expr");
  try {
    if (k.isValueBinding(v)) {
      const c = k.compileExpr((v as { $: string }).$);
      w.counts.ops += c.ops;
      depBlocks(c.deps, w);
      return;
    }
    const t = k.compileText((v as { $t: string }).$t, opts);
    w.counts.ops += t.ops;
    depBlocks(t.deps, w);
  } catch (e) {
    w.errors.push(`${where}: ${(e as Error).message}`);
  }
}

/** A `{ expr }` condition. */
function compileCondition(v: unknown, where: string, w: Work): void {
  const k = kernel();
  if (!k.isExprCondition(v)) return;
  w.counts.exprs += 1;
  w.needs.add("expr");
  const c = k.tryCompileExpr((v as { expr: string }).expr);
  if (!c.ok) { w.errors.push(`${where}: ${c.error}`); return; }
  w.counts.ops += c.expr.ops;
  depBlocks(c.expr.deps, w);
}

/**
 * Everything inside one value: the expressions it holds, the strings it holds, however deep. A screen is data, so
 * this never follows anything but plain arrays and plain objects, and it stops at the tree's own depth limit.
 */
function scanValue(v: unknown, where: string, w: Work, opts: LintOptions, depth = 0): void {
  const k = kernel();
  if (depth > k.LIMITS.depth) { w.errors.push(`${where}: nested deeper than ${k.LIMITS.depth}`); return; }
  if (typeof v === "string") {
    if (k.byteLen(v) > k.LIMITS.stringBytes) w.errors.push(`${where}: a string prop is at most ${k.LIMITS.stringBytes} bytes`);
    if (k.looksLikeForgottenTemplate(v)) {
      const note = `${where}: a plain string holds "{{ … }}". If the server wrote it, it wanted { "$t": … }; if a person did, it draws as written`;
      if (opts.strict) w.errors.push(note); else w.warnings.push(note);
    }
    return;
  }
  if (k.isEvaluable(v)) { compileOne(v, where, w); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => scanValue(x, `${where}[${i}]`, w, opts, depth + 1)); return; }
  if (isObj(v)) for (const key of Object.keys(v)) scanValue(v[key], `${where}.${key}`, w, opts, depth + 1);
}

/** A path that goes out to our API: relative, under /v1/, each hole encoded. */
function checkNetworkPath(v: unknown, where: string, w: Work): void {
  const k = kernel();
  if (k.isEvaluable(v)) {
    compileOne(v, where, w, { encode: true });
    if (k.isTextTemplate(v)) {
      // The literal half decides which endpoint is reached; the holes are encoded, so a filled value cannot climb
      // out of it. Checking the literals with every hole filled by a harmless word is what the device will see.
      try {
        const t = k.compileText((v as { $t: string }).$t, { encode: true });
        const sample = t.literals.join("x");
        const bad = k.networkPathError(sample);
        if (bad) w.errors.push(`${where}: ${bad}`);
      } catch { /* compileOne already said why */ }
    }
    return;
  }
  const bad = k.networkPathError(v);
  if (bad) w.errors.push(`${where}: ${bad}`);
}

function checkStatePath(v: unknown, where: string, w: Work): void {
  const bad = kernel().statePathError(v);
  if (bad) w.errors.push(`${where}: ${bad}`);
}

/** An https source for a picture, a clip or a sound. */
function checkMediaUrl(v: unknown, where: string, w: Work): void {
  if (kernel().isEvaluable(v)) { compileOne(v, where, w); return; }
  if (typeof v !== "string" || !/^https:\/\//.test(v)) { w.errors.push(`${where}: an https URL`); return; }
  if (v.length > 2048) w.errors.push(`${where}: at most 2048 characters`);
}

// ===================================================================== actions

/** Does any expression in here read `device.canOpen.*`? That list never goes to the server (SPEC 2.9). */
function readsCanOpen(v: unknown, depth = 0): boolean {
  const k = kernel();
  if (depth > 24) return false;
  if (k.isEvaluable(v)) {
    const src = k.isValueBinding(v) ? (v as { $: string }).$ : (v as { $t: string }).$t;
    const c = k.tryCompileExpr(k.isValueBinding(v) ? src : "0");
    if (k.isValueBinding(v) && c.ok) return c.expr.deps.some((d) => d.startsWith("device.canOpen"));
    return /device\s*\.\s*canOpen/.test(src);
  }
  if (Array.isArray(v)) return v.some((x) => readsCanOpen(x, depth + 1));
  if (isObj(v)) return Object.values(v).some((x) => readsCanOpen(x, depth + 1));
  return false;
}

function checkAction(a: ActionRef | undefined, where: string, w: Work, opts: LintOptions, depth = 0): void {
  const k = kernel();
  if (a === undefined || a === null) return;
  if (typeof a === "string") return;            // a name in the screen's own `actions` map, checked there
  if (depth > k.LIMITS.actionDepth) { w.errors.push(`${where}: actions chain deeper than ${k.LIMITS.actionDepth}`); return; }
  const o = a as unknown as Record<string, unknown>;
  const kind = String(o.kind ?? "");

  switch (kind) {
    case "callEndpoint": {
      checkNetworkPath(o.path, `${where}.path`, w);
      if (readsCanOpen(o.body)) w.errors.push(`${where}.body: device.canOpen.* is for drawing a chooser on the phone; it is never sent to the server`);
      for (const key of ["multipart", "progressInto", "retry", "queue", "cache", "optimistic"]) {
        if (o[key] !== undefined) w.needs.add("data");
      }
      if (o.progressInto !== undefined) checkStatePath(o.progressInto, `${where}.progressInto`, w);
      if (isObj(o.optimistic)) checkStatePath((o.optimistic as { path?: unknown }).path, `${where}.optimistic.path`, w);
      if (o.queue !== undefined && o.queue !== "outbox") w.errors.push(`${where}.queue: "outbox" is the only queue`);
      if (o.assignTo !== undefined) checkStatePath(o.assignTo, `${where}.assignTo`, w);
      break;
    }
    case "subscribe": {
      w.needs.add("data");
      w.counts.topics += 1;
      if (w.counts.topics > k.LIMITS.topics) w.errors.push(`a screen listens to at most ${k.LIMITS.topics} topics`);
      const topic = o.topic;
      if (typeof topic !== "string" || !TOPIC.test(topic)) w.errors.push(`${where}.topic: letters, digits and : _ - . *, at most 64`);
      else if (topic.includes("*") && !(topic === "*" || (topic.endsWith(":*") && topic.indexOf("*") === topic.length - 1))) {
        w.errors.push(`${where}.topic: a wildcard is the whole topic or a trailing ":*"`);
      }
      checkStatePath(o.into, `${where}.into`, w);
      break;
    }
    case "local.set":
    case "local.remove": {
      w.needs.add("local");
      const bad = k.localKeyError(o.path);
      if (bad) w.errors.push(`${where}.path: ${bad}`);
      break;
    }
    case "navigate": {
      if (o.presentation !== undefined || o.detents !== undefined || o.transition !== undefined) w.needs.add("shell");
      if (o.presentation !== undefined && !(PRESENTATIONS as readonly string[]).includes(String(o.presentation))) {
        w.errors.push(`${where}.presentation: one of ${PRESENTATIONS.join(", ")}`);
      }
      if (typeof o.transition === "string" && !(SHELL_TRANSITIONS as readonly string[]).includes(o.transition)) {
        w.errors.push(`${where}.transition: one of ${SHELL_TRANSITIONS.join(", ")}, or a motion value`);
      }
      if (isObj(o.transition)) w.needs.add("motion");
      if (o.screen !== undefined && o.screenId === undefined) w.errors.push(`${where}: navigate takes screenId, not screen`);
      break;
    }
    case "setState":
    case "toggleState":
    case "toggleInArray":
    case "appendState":
    case "incrementState":
    case "clearState":
      checkStatePath(o.path, `${where}.path`, w);
      break;
    default:
      break;
  }

  // The flow kinds carry other actions; so do the two every call has.
  for (const key of ["onSuccess", "onError", "then", "else"]) {
    if (o[key] !== undefined) checkAction(o[key] as ActionRef, `${where}.${key}`, w, opts, depth + 1);
  }
  for (const key of ["actions"]) {
    if (Array.isArray(o[key])) (o[key] as ActionRef[]).forEach((x, i) => checkAction(x, `${where}.${key}[${i}]`, w, opts, depth + 1));
  }
  if (k.isExprCondition(o.if)) { compileCondition(o.if, `${where}.if`, w); }
  scanValue(rest(o), where, w, opts);
}

/** Keys an action's own checks above have already read: the actions hanging off it, and the paths and names each
 *  kind spells out. Reading them again here would compile the same expression twice and count it twice. */
const DONE_KEYS: ReadonlySet<string> = new Set([
  "onSuccess", "onError", "then", "else", "actions", "if",
  "kind", "path", "topic", "into", "progressInto", "assignTo", "optimistic", "presentation", "detents", "transition",
]);

/** What is left of an action once its own checks have had the keys they know. */
function rest(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o)) if (!DONE_KEYS.has(key)) out[key] = o[key];
  return out;
}

// ===================================================================== motion, gestures, rules on a node

/** Is this the vocabulary-2 `motion`, or the old preset one? They cannot be confused: the old one has `appear`. */
function isNodeMotion(m: unknown): boolean {
  if (!isObj(m)) return false;
  if (owns(m, "appear") || owns(m, "durationMs") || owns(m, "delayMs")) return false;
  return ["enter", "exit", "loop", "drive", "layout", "shared"].some((key) => owns(m, key));
}

function checkMotion(m: Record<string, unknown>, where: string, w: Work): void {
  const k = kernel();
  w.needs.add("motion");
  w.counts.motionNodes += 1;
  if (w.counts.motionNodes > k.LIMITS.motionNodes) {
    if (w.counts.motionNodes === k.LIMITS.motionNodes + 1) w.errors.push(`a screen animates at most ${k.LIMITS.motionNodes} nodes`);
  }
  for (const key of Object.keys(m)) {
    if (!["enter", "exit", "loop", "drive", "layout", "shared"].includes(key)) {
      w.errors.push(`${where}.${key}: not a part of motion (enter, exit, loop, drive, layout, shared)`);
    }
  }
  for (const section of ["enter", "exit", "loop", "drive"] as const) {
    const body = m[section];
    if (body === undefined) continue;
    if (!isObj(body)) { w.errors.push(`${where}.${section}: style key to value`); continue; }
    for (const key of Object.keys(body)) {
      if (!(MOTION_KEYS as readonly string[]).includes(key)) { w.errors.push(`${where}.${section}.${key}: not a key motion moves (${MOTION_KEYS.join(", ")})`); continue; }
      const value = body[key];
      if (section === "drive") {
        if (!isObj(value) || typeof (value as { by?: unknown }).by !== "string") w.errors.push(`${where}.drive.${key}: { by, k }`);
      }
      if (section === "exit" && isObj(value) && owns(value, "spring")) {
        w.errors.push(`${where}.exit.${key}: a spring has no end to leave on; exit takes keyframes`);
      }
      const keys = isObj(value) ? (value as { k?: unknown }).k : undefined;
      if (Array.isArray(keys) && keys.length > k.LIMITS.keyframes) {
        w.errors.push(`${where}.${section}.${key}: at most ${k.LIMITS.keyframes} keyframes`);
      }
    }
  }
  if (m.shared !== undefined && typeof m.shared !== "string") w.errors.push(`${where}.shared: a name`);
}

function checkGestures(list: unknown, where: string, w: Work, opts: LintOptions): void {
  const k = kernel();
  if (!Array.isArray(list)) { w.errors.push(`${where}: a list of gestures`); return; }
  w.needs.add("gesture");
  if (list.length > 6) w.errors.push(`${where}: at most 6 gestures on one node`);
  w.counts.gestures += list.length;
  if (w.counts.gestures > k.LIMITS.gestures) w.errors.push(`a screen has at most ${k.LIMITS.gestures} gestures`);
  list.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(raw)) { w.errors.push(`${at}: an object`); return; }
    const g = raw as Record<string, unknown>;
    if (!(GESTURE_KINDS as readonly string[]).includes(String(g.kind))) w.errors.push(`${at}.kind: one of ${GESTURE_KINDS.join(", ")}`);
    if (g.into !== undefined) checkStatePath(g.into, `${at}.into`, w);
    if (g.claim !== undefined) {
      const c = String(g.claim);
      if (c !== "exclusive" && c !== "simultaneous" && !c.startsWith("after:")) w.errors.push(`${at}.claim: exclusive, simultaneous or after:<id>`);
    }
    // The device reads these through a finite check that takes numbers only, so an expression here would collapse
    // the whole run to `min` (docs/renderer.md section 3). V1 resolves them before compiling; lint says so now.
    for (const key of ["min", "max", "snap", "springK", "springDamp", "projectMs", "taps", "window", "hold", "slop", "distance", "velocity", "minScale", "maxScale"]) {
      if (k.isEvaluable(g[key])) w.errors.push(`${at}.${key}: a number, not an expression — the device reads it as one`);
    }
    if (g.commitIf !== undefined) compileCondition(g.commitIf, `${at}.commitIf`, w);
    for (const key of ["do", "onCommit", "onCancel", "onLeft", "onRight", "onUp", "onDown"]) {
      if (g[key] !== undefined && !(key === "onCancel" && isObj(g[key]) && (g[key] as { kind?: unknown }).kind === "spring")) {
        checkAction(g[key] as ActionRef, `${at}.${key}`, w, opts);
      }
    }
  });
}

function checkRules(list: unknown, where: string, w: Work, opts: LintOptions): void {
  const k = kernel();
  if (list === undefined) return;
  w.needs.add("rules");
  const { rules, errors } = k.compileRules(list);
  for (const e of errors) w.errors.push(`${where}: ${e}`);
  w.counts.rules += rules.length;
  for (const r of rules) {
    if (r.kind !== "when") w.counts.timers += 1;
    checkAction(r.do as ActionRef, `${where} ${r.id}`, w, opts);
  }
  if (w.counts.rules > k.LIMITS.rules) w.errors.push(`a screen has at most ${k.LIMITS.rules} rules`);
  if (w.counts.timers > k.LIMITS.timers) w.errors.push(`a screen has at most ${k.LIMITS.timers} timers`);
}

// ===================================================================== paint

function checkPaint(style: Record<string, unknown>, where: string, w: Work): void {
  const paint = PAINT_KEYS.filter((key) => style[key] !== undefined);
  if (!paint.length) return;
  w.needs.add("paint");
  const filter = style.filter;
  const names = typeof filter === "string"
    ? Array.from(filter.matchAll(/([a-zA-Z-]+)\s*\(/g)).map((m) => m[1]!)
    : Array.isArray(filter) ? filter.flatMap((f) => (isObj(f) ? Object.keys(f) : [])) : [];
  for (const n of names) {
    if (!(PAINT_FILTERS as readonly string[]).includes(n)) {
      w.errors.push(`${where}.filter: only ${PAINT_FILTERS.join(" and ")} are drawn on both iPhone and Android`);
    }
  }
  if (style.mixBlendMode !== undefined && !(PAINT_BLEND_MODES as readonly string[]).includes(String(style.mixBlendMode))) {
    w.errors.push(`${where}.mixBlendMode: not a blend mode`);
  }
  const blur = style.blur;
  if (isObj(blur) && blur.tint !== undefined && !(PAINT_BLUR_TINTS as readonly string[]).includes(String(blur.tint))) {
    w.errors.push(`${where}.blur.tint: one of ${PAINT_BLUR_TINTS.join(", ")}`);
  }
}

// ===================================================================== the nodes

interface Where { path: string; scroller: "x" | "y" | null; scrollerIsRoot: boolean }

function checkNode(n: Node, at: Where, w: Work, opts: LintOptions, depth: number): void {
  const k = kernel();
  if (depth > k.LIMITS.depth) { w.errors.push(`${at.path}: deeper than ${k.LIMITS.depth}`); return; }
  const type = n.type;
  const block = BLOCK_OF_NODE[type];
  if (block) w.needs.add(block);
  if ((SHELL_NODES as readonly string[]).includes(type)) w.needs.add("shell");

  const props = (n.props ?? {}) as Record<string, unknown>;
  const allowed = NODE_PROPS[type];
  if (allowed) for (const key of Object.keys(props)) {
    if (!allowed.includes(key)) w.errors.push(`${at.path}: ${type} has no prop "${key}" (${allowed.join(", ")})`);
  }
  for (const key of STATE_PATH_PROPS[type] ?? []) {
    if (props[key] !== undefined) checkStatePath(props[key], `${at.path}.${key}`, w);
  }

  // A `Use` leaves nothing of itself behind, so anything written on it would quietly disappear.
  if (type === "Use") {
    if (typeof n.def !== "string" || !n.def) w.errors.push(`${at.path}: a Use names the definition it draws`);
    for (const key of Object.keys(n as unknown as Record<string, unknown>)) {
      if (!["type", "def", "args", "slots", "fallback"].includes(key)) {
        w.errors.push(`${at.path}: a Use carrying "${key}" would lose it when it expands; put it on the template or on a node around the Use`);
      }
    }
  }
  if (type === "Slot" && typeof n.name !== "string") w.errors.push(`${at.path}: a Slot has a name`);

  // Media sources, and a list's or a player's state paths.
  if (type === "Video" || type === "Audio") {
    checkMediaUrl(props.source, `${at.path}.source`, w);
    if (isObj(props.into)) for (const key of Object.keys(props.into)) {
      if (!MEDIA_INTO.includes(key)) w.errors.push(`${at.path}.into.${key}: not one of ${MEDIA_INTO.join(", ")}`);
      else checkStatePath((props.into as Record<string, unknown>)[key], `${at.path}.into.${key}`, w);
    }
  }
  if (type === "Camera" && props.mode !== undefined && props.mode !== "photo" && props.mode !== "scan") {
    w.errors.push(`${at.path}.mode: photo or scan`);
  }
  if (type === "Input" && !(INPUT_KINDS as readonly string[]).includes(String(props.kind))) {
    w.errors.push(`${at.path}.kind: one of ${INPUT_KINDS.join(", ")}`);
  }

  // Lists: where their pages come from, and the scroller rule (SPEC 2.6).
  let scroller = at.scroller;
  let scrollerIsRoot = at.scrollerIsRoot;
  if (type === "List" || type === "Each") {
    const page = props.page;
    if (isObj(page)) {
      checkNetworkPath(page.endpoint, `${at.path}.page.endpoint`, w);
      checkStatePath(page.into, `${at.path}.page.into`, w);
      if (page.cursor !== undefined) checkStatePath(page.cursor, `${at.path}.page.cursor`, w);
    }
    if (type === "Each" && typeof props.max === "number" && props.max > 200) w.errors.push(`${at.path}.max: Each draws at most 200 copies; a longer array wants a List`);
    if (type === "List") {
      const axis: "x" | "y" = props.horizontal === true ? "x" : "y";
      const style = (n.style ?? {}) as Record<string, unknown>;
      if (props.scroll === true) {
        if (typeof style.height !== "number" && typeof style.maxHeight !== "number") {
          w.errors.push(`${at.path}: a List with scroll needs a number for height or maxHeight, or it grows to its rows and windows nothing`);
        }
      } else if (at.scroller === axis) {
        if (at.scrollerIsRoot && w.screenScrollers === 0) w.screenScrollers += 1;   // it becomes the screen's scroller
        else w.errors.push(`${at.path}: a List inside a scroller that runs the same way windows nothing. Let it be the screen's own scroller, or give it scroll and a height`);
      }
    }
  }
  if (SCROLLERS[type]) {
    const style = (n.style ?? {}) as Record<string, unknown>;
    scroller = style.flexDirection === "row" ? "x" : SCROLLERS[type]!;
    // The screen's own scroller is the first one on the way down, wherever the page's wrapper put it (the kit's
    // phone page is SafeArea > Screen). A List inside THAT is the one the Screen hands itself over to.
    scrollerIsRoot = at.scroller === null;
  }

  if (n.visibleIf !== undefined) compileCondition(n.visibleIf, `${at.path}.visibleIf`, w);
  if (n.rules !== undefined) checkRules(n.rules, `${at.path}.rules`, w, opts);
  if (n.gestures !== undefined) checkGestures(n.gestures, `${at.path}.gestures`, w, opts);
  if (n.scrollInto !== undefined) { w.needs.add("gesture"); checkStatePath(n.scrollInto, `${at.path}.scrollInto`, w); }
  if (isNodeMotion(n.motion)) checkMotion(n.motion as unknown as Record<string, unknown>, `${at.path}.motion`, w);
  if (n.style) {
    checkPaint(n.style as Record<string, unknown>, `${at.path}.style`, w);
    // A style key may be an expression too (`"opacity": { "$": "state.busy ? 0.4 : 1" }`), so the style is read
    // for them exactly as the props are.
    scanValue(n.style, `${at.path}.style`, w, opts);
  }
  if (n.bind) for (const key of Object.keys(n.bind)) checkStatePath(n.bind[key], `${at.path}.bind.${key}`, w);
  if (n.on) for (const event of Object.keys(n.on)) {
    checkAction((n.on as Record<string, ActionRef>)[event], `${at.path}.on.${event}`, w, opts);
  }

  // Props, with the trees among them walked as trees and everything else as data.
  for (const key of Object.keys(props)) {
    const v = props[key];
    if (key === "item" && isNode(v)) { checkNode(v, { ...at, path: `${at.path}.item` }, w, opts, depth + 1); continue; }
    if (key === "page" || key === "into" || (STATE_PATH_PROPS[type] ?? []).includes(key)) continue;
    if ((key === "source") && (type === "Video" || type === "Audio")) continue;
    scanValue(v, `${at.path}.props.${key}`, w, opts);
  }
  if (n.args) scanValue(n.args, `${at.path}.args`, w, opts);
  if (n.slots) for (const name of Object.keys(n.slots)) {
    const s = n.slots[name];
    for (const c of Array.isArray(s) ? s : [s]) if (isNode(c)) checkNode(c, { ...at, path: `${at.path}.slots.${name}` }, w, opts, depth + 1);
  }
  if (n.fallback) checkNode(n.fallback, { ...at, path: `${at.path}.fallback` }, w, opts, depth + 1);

  const kids = n.children ?? [];
  kids.forEach((c, i) => {
    if (!isNode(c)) { w.errors.push(`${at.path}.children[${i}]: a node`); return; }
    checkNode(c, { path: `${at.path} > ${c.type}`, scroller, scrollerIsRoot }, w, opts, depth + 1);
  });
}

// ===================================================================== the screen

const EMPTY_COUNTS = (): LintCounts => ({
  bytes: 0, nodes: 0, depth: 0, steps: 0, exprs: 0, ops: 0, rules: 0, timers: 0, gestures: 0, motionNodes: 0, topics: 0,
});

/** Everything wrong with a screen, the blocks it needs, and what it cost. Empty `errors` means it may be served. */
export function lintScreen(screen: ScreenResponse, opts: LintOptions = {}): LintResult {
  const k = kernel();
  const w: Work = { errors: [], warnings: [], needs: new Set(), counts: EMPTY_COUNTS(), screenScrollers: 0 };

  let text = "";
  try { text = JSON.stringify(screen) ?? ""; } catch { w.errors.push("a screen must be plain JSON"); }
  w.counts.bytes = k.byteLen(text);
  if (w.counts.bytes > k.LIMITS.screenBytes) w.errors.push(`a screen is at most ${k.LIMITS.screenBytes} bytes; this one is ${w.counts.bytes}`);

  // The names it says it needs: they must be real names, and nothing it uses may be missing from them.
  const said = Array.isArray(screen.needs) ? screen.needs : [];
  const nonsense = k.unknownBlocks(said);
  for (const n of nonsense) w.errors.push(`needs "${n}": no build will ever have that block (${SDUI_BLOCKS.join(", ")})`);

  // The templates, then the tree they expand into.
  if (screen.defs !== undefined) {
    w.needs.add("defs");
    for (const e of k.checkDefs(screen.defs)) w.errors.push(`defs: ${e}`);
    if (Object.keys(screen.defs).length > k.LIMITS.defs) w.errors.push(`a screen has at most ${k.LIMITS.defs} definitions`);
    for (const name of Object.keys(screen.defs)) {
      const d = screen.defs[name];
      if (d && isNode(d.root)) checkNode(d.root, { path: `defs.${name}`, scroller: null, scrollerIsRoot: false }, w, opts, 1);
    }
  }

  if (screen.rules !== undefined) checkRules(screen.rules, "rules", w, opts);
  if (screen.actions) for (const name of Object.keys(screen.actions)) {
    checkAction(screen.actions[name]!, `actions.${name}`, w, opts);
  }
  if (screen.state) scanValue(screen.state, "state", w, opts);

  const root = screen.root;
  if (root) {
    checkNode(root, { path: root.type, scroller: null, scrollerIsRoot: false }, w, opts, 0);
    if (!w.errors.some((e) => e.startsWith("defs:"))) {
      try {
        const x = k.expandTree(root, screen.defs as unknown);
        w.counts.nodes = x.nodes;
        w.counts.depth = x.depth;
        w.counts.steps = x.steps;
        if (x.nodes > k.LIMITS.nodes) w.errors.push(`a screen draws at most ${k.LIMITS.nodes} nodes`);
        if (x.depth > k.LIMITS.depth) w.errors.push(`a screen nests at most ${k.LIMITS.depth} deep`);
      } catch (e) {
        w.errors.push(`the templates do not expand: ${(e as Error).message}`);
      }
    }
  }
  for (const b of (screen.blocks ?? [])) if (isNode(b)) checkNode(b, { path: b.type, scroller: null, scrollerIsRoot: false }, w, opts, 0);

  if (w.counts.ops > k.LIMITS.opsPerChange) {
    w.errors.push(`a screen's expressions cost ${w.counts.ops} operations; ${k.LIMITS.opsPerChange} is the ceiling for one change of the store`);
  }

  const needs = SDUI_BLOCKS.filter((b) => w.needs.has(b));
  for (const b of needs) if (!said.includes(b)) w.errors.push(`this screen uses the "${b}" block and does not say it needs it; add it to the screen's needs`);
  for (const b of said) if (k.isBlock(b) && !w.needs.has(b)) w.warnings.push(`needs "${b}", which nothing on this screen uses: a client without it would be sent away for nothing`);

  return { errors: w.errors, warnings: w.warnings, needs: [...needs], counts: w.counts };
}

/** The blocks a screen needs, worked out from the tree. Empty means any client can draw it. */
export function screenNeeds(screen: ScreenResponse): BlockName[] {
  return lintScreen(screen).needs;
}

/** True when a screen says nothing of vocabulary 2: it is served exactly as it is today, to everyone. */
export function isVocab1(screen: ScreenResponse): boolean {
  return !screen.needs?.length && screen.defs === undefined && screen.rules === undefined;
}

/** The device facts a screen may read, for anyone writing one. */
export const READABLE_DEVICE_FACTS = DEVICE_FACTS;
/** The `canOpen` names, and what each probes. */
export const CAN_OPEN = CAN_OPEN_SCHEMES;
