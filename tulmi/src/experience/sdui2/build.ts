/**
 * WRITING A VOCABULARY-2 SCREEN (pure/SPEC.md 2.2 to 2.10, 2.12).
 *
 * Small typed helpers that emit the shapes in `shared/types/sdui.ts` section 8, and nothing else. They sit beside
 * the kit (`experience/bots/kit.ts`), which keeps doing exactly what it does today: nothing here changes what any
 * existing helper emits, and a screen that calls none of these is a vocabulary-1 screen, served to everyone.
 *
 *   import { v, t, cond, use, slot, list, input, withMotion, withGestures, rule, vocab2 } from "../sdui2/build.js";
 *
 *   return vocab2(page(ctx, { body: [
 *     text("…"),
 *     list({ data: v("state.feed"), item: use("feed.row", { row: v("item") }) }),
 *   ] }), { defs: { "feed.row": { params: ["row"], root: … } } });
 *
 * Two rules worth saying out loud, because a screen that breaks them passes TypeScript and fails on the device:
 *
 *   • `text("…")` keeps a person's words LITERAL. Never wrap words that came from someone — a note's title, a
 *     calendar invite — in `t()`. Only what the server itself wrote may be a template (SPEC principle 4).
 *   • a gesture's `min`, `max` and `snap` are plain numbers, not `v()`: the device reads them through a check that
 *     takes numbers only.
 *
 * `lintScreen` (sdui2/lint.ts) refuses anything these helpers let through, with the device's own compiler. Run it
 * in the screen's test, as `lintTree` is run today.
 */
import type {
  ActionRef, ActionSpec, AudioProps, BlockName, CameraProps, Defs, EachProps, ExprCondition, GestureSpec,
  InputProps, ListProps, MotionEase, MotionKeys, Node, NodeMotion, RuleSpec, ScreenResponse, SubscribeSpec,
  TextTemplate, ValueBinding, VideoProps,
} from "../../../../shared/types/sdui.js";
import { lintScreen } from "./lint.js";

type Style = Record<string, unknown>;

// ===================================================================== values (B1)

/** One value, worked out on the device: `v("state.busy ? 0.4 : 1")`. */
export const v = (expr: string): ValueBinding => ({ $: expr });

/** Text with holes: `t("{{ count(state.done) }} of {{ count(state.items) }} done")`. Server words only. */
export const t = (template: string): TextTemplate => ({ $t: template });

/** A condition as an expression: `cond("device.keyboard.enabled && !state.dismissed")`. */
export const cond = (expr: string): ExprCondition => ({ expr });

// ===================================================================== templates (B2)

/** A screen's templates, by name. Pass to `vocab2(screen, { defs })`. */
export const defs = (map: Defs): Defs => map;

/** Draw a template. A `Use` carries nothing else: a style or a visibleIf on it would be lost when it expands. */
export function use(def: string, args?: Record<string, unknown>, slots?: Record<string, Node | Node[]>): Node {
  return { type: "Use", def, ...(args ? { args } : {}), ...(slots ? { slots } : {}) };
}

/** Where a `Use`'s `slots` content lands inside a template. */
export const slot = (name: string): Node => ({ type: "Slot", name });

// ===================================================================== lists (B6)

/** Rows from an array, one template each, windowed. A List in a Screen's body becomes the screen's scroller. */
export const list = (props: ListProps, style: Style = {}): Node =>
  ({ type: "List", props: props as unknown as Record<string, unknown>, ...(Object.keys(style).length ? { style } : {}) });

/** One template repeated over a small array. Everything is drawn; nothing is windowed. */
export const each = (props: EachProps, style: Style = {}): Node =>
  ({ type: "Each", props: props as unknown as Record<string, unknown>, ...(Object.keys(style).length ? { style } : {}) });

// ===================================================================== inputs (B8)

export interface FieldOpts {
  /** The state path the value is read from and written back to. */
  value?: string;
  style?: Style;
  onChange?: ActionRef;
  onSubmit?: ActionRef;
  onDismiss?: ActionRef;
}

/** One field node. The value is sanitized, capped and stored — never evaluated. */
export function input(props: InputProps, o: FieldOpts = {}): Node {
  const on: Record<string, ActionRef> = {};
  if (o.onChange) on.onChange = o.onChange;
  if (o.onSubmit) on.onSubmit = o.onSubmit;
  if (o.onDismiss) on.onDismiss = o.onDismiss;
  return {
    type: "Input",
    props: props as unknown as Record<string, unknown>,
    ...(o.value ? { bind: { value: o.value } } : {}),
    ...(o.style ? { style: o.style } : {}),
    ...(Object.keys(on).length ? { on } : {}),
  };
}

// ===================================================================== media (B10)

export interface PlayerOpts { style?: Style; children?: Node[]; on?: Record<string, ActionRef> }

export const video = (props: VideoProps, o: PlayerOpts = {}): Node => player("Video", props, o);
export const audio = (props: AudioProps, o: PlayerOpts = {}): Node => player("Audio", props, o);

/** The viewfinder, or the code scanner. Its children draw until the permission is granted, and over it after. */
export const camera = (props: CameraProps, o: PlayerOpts = {}): Node => player("Camera", props, o);

function player(type: string, props: object, o: PlayerOpts): Node {
  return {
    type,
    props: props as Record<string, unknown>,
    ...(o.style ? { style: o.style } : {}),
    ...(o.children ? { children: o.children } : {}),
    ...(o.on ? { on: o.on } : {}),
  };
}

// ===================================================================== motion and gestures (B4, B5)

/** Keyframes over a clock in seconds: `keys([[0, 0], [0.26, 1, "out"]])`. */
export const keys = (k: Array<[number, number] | [number, number, MotionEase]>, loop?: boolean): MotionKeys =>
  ({ k, ...(loop ? { loop } : {}) });

/** Motion on a node, typed. Returns the node with the motion on it; the node is not changed in place. */
export const withMotion = (n: Node, m: NodeMotion): Node => ({ ...n, motion: m });

/** The same, as a value, for a screen that builds its motion once and uses it twice. */
export const motion = (m: NodeMotion): NodeMotion => m;

/** One gesture. `min`, `max` and `snap` are numbers, never `v()`. */
export const gesture = (g: GestureSpec): GestureSpec => g;

/** Fingers on a node. */
export const withGestures = (n: Node, gestures: GestureSpec[]): Node => ({ ...n, gestures });

/** A Screen's or a Scroll's own offset, under `ui.`, so a motion can drive off it. */
export const withScroll = (n: Node, into: string): Node => ({ ...n, scrollInto: into });

// ===================================================================== rules (B3)

/** One rule: exactly one of `when`, `every` or `after`. */
export const rule = (r: RuleSpec): RuleSpec => r;

/** Fired on the change from false to true. */
export const when = (id: string, expr: string, action: ActionRef, o: Omit<RuleSpec, "id" | "when" | "do"> = {}): RuleSpec =>
  ({ id, when: cond(expr), do: action, ...o });

/** Every so many milliseconds (at least 1000, or 250 while visible and in front). */
export const every = (id: string, ms: number, action: ActionRef, o: Omit<RuleSpec, "id" | "every" | "do"> = {}): RuleSpec =>
  ({ id, every: ms, do: action, ...o });

/** Once, this long after the rule starts. */
export const after = (id: string, ms: number, action: ActionRef, o: Omit<RuleSpec, "id" | "after" | "do"> = {}): RuleSpec =>
  ({ id, after: ms, do: action, ...o });

/** Rules on one node: live only while it is on screen. */
export const withRules = (n: Node, rules: RuleSpec[]): Node => ({ ...n, rules });

// ===================================================================== data and local (B9, B10)

/** Listen to a live topic. A topic, not a path. */
export const subscribe = (s: SubscribeSpec): ActionSpec => ({ kind: "subscribe", ...s } as unknown as ActionSpec);

/** Remember something on this phone: a hint dismissed, a draft, a last choice. Never a secret. */
export const localSet = (path: string, value: unknown): ActionSpec => ({ kind: "local.set", path, value } as unknown as ActionSpec);
export const localRemove = (path: string): ActionSpec => ({ kind: "local.remove", path } as unknown as ActionSpec);

// ===================================================================== the screen

export interface Vocab2Opts {
  /** The screen's own templates. */
  defs?: Defs;
  /** Rules for the screen as a whole. */
  rules?: RuleSpec[];
  /** Blocks this screen needs beyond the ones lint reads off the tree. Rarely wanted: lint works them out. */
  needs?: BlockName[];
}

/**
 * Mark a built screen as vocabulary 2. The `needs` it ends up with is what `lintScreen` reads off the tree, plus
 * anything named here, so a screen cannot quietly use a block it did not declare — and a client without one of
 * them is sent the short screen instead (gate.ts), never a lowered version of this one.
 *
 * It is a separate call rather than an option on `page()` so that no existing screen's bytes change by a byte.
 */
export function vocab2(screen: ScreenResponse, o: Vocab2Opts = {}): ScreenResponse {
  const withParts: ScreenResponse = {
    ...screen,
    ...(o.defs ? { defs: o.defs } : {}),
    ...(o.rules ? { rules: [...(screen.rules ?? []), ...o.rules] } : {}),
  };
  const read = lintScreen({ ...withParts, needs: [] });
  const needs = [...new Set([...read.needs, ...(o.needs ?? [])])] as BlockName[];
  return { ...withParts, needs };
}
