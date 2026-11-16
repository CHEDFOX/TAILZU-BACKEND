/**
 * THE APP'S DESIGN RULES, AS CHECKS OVER A DRAWN SCREEN. The other half of the publish gate.
 *
 *   const r = checkDesign(screen, { theme, drawn: true });
 *   if (r.errors.length) … // not served as it is: drawn again, or the built screen instead
 *
 * `lint.ts` is the STRUCTURAL gate: does every expression compile, is the screen inside its caps, are the paths and
 * the node types ones the device knows. It answers "can the phone draw this at all". It says nothing about whether
 * what the phone draws looks like this app, because until now every screen was hand-written TypeScript and the kit's
 * helpers (`experience/bots/kit.ts`) were the design rules — you got them by calling `text()` rather than by being told.
 *
 * A screen a MODEL draws calls no helpers. So the kit's rules, which lived in its header as prose, are checks here:
 * the reasoning may draw whatever the situation needs, and code decides whether it is this app. That is the same
 * shape as everything else — the model proposes, code decides — and it is what lets a drawn screen be served at all.
 *
 * THE RULES, and why each one is a rule (kit.ts's header says them in prose; the reason is in brackets):
 *
 *   pressable inside pressable   ERROR  the window runs both handlers, so one tap does two things
 *   text with no line height     WARN   two clients set their own otherwise, and the text jumps between them
 *   a border the CSS way         ERROR  borders are borderWidth + borderColor, or the phone draws nothing
 *   an image with no size        WARN   neither client should guess a size (kit's `picture()`)
 *   a touch target under 44      WARN   smaller than a finger: Apple's own floor, and the one everyone knows
 *   contrast under 4.5 to 1      ERROR  text nobody can read. Only when BOTH colours are known from the theme:
 *                                       a colour this code cannot resolve is not guessed at
 *
 * WHAT IS DELIBERATELY NOT A RULE. A colour written out (#5c5c5c) is NOT wrong here: the kit writes explicit styles on
 * purpose, "so the phone (React Native) and the window draw the same thing" (kit.ts). A first version of this file called
 * that an error and 900 of the app's own nodes broke it, which is how a rule written down wrong shows itself. The kit's
 * other prose rules — colour belongs to bots, errors and links are ink — need to know what a node MEANS, which this cannot
 * read off a tree, so they stay prose and are not guessed at here.
 *
 * MACHINE-MADE TELLS (`tells`), never errors: the things that mark a page as drawn by a model rather than designed —
 * a label above every heading, one word of a headline in another colour, the same card repeated with nothing in it.
 * They are counted and reported so a drawing can be asked for again, and because a person reading the report should
 * see them. After Nutlope's hallmark (MIT; the idea, not its text), whose floor-and-tells split this follows.
 *
 * Nothing here is about one bot. Every bot's drawn screens go through it, and so do Xode's.
 */
import type { Node, ScreenResponse, ThemeTokens } from "../../../../shared/types/sdui.js";

export interface DesignFinding {
  /** The rule, as a short id for the log: "pressable.nested", "colour.raw". */
  rule: string;
  /** Where it is, as a path through the tree: "root.children[2].children[0]". */
  at: string;
  /** One line a person could read. */
  text: string;
}

export interface DesignChecked {
  /** Not served as it is. */
  errors: DesignFinding[];
  /** Served, and said in the report. */
  warnings: DesignFinding[];
  /** Marks of a drawing rather than a design: counted, never a refusal. */
  tells: DesignFinding[];
}

/** The least a finger finds (Apple's own floor, and the one every other platform copied). */
export const TOUCH_MIN = 44;
/** Normal text must reach this against what is behind it (WCAG AA). */
export const CONTRAST_MIN = 4.5;
/** The most findings of one kind kept, so one bad screen cannot fill a log. */
export const PER_RULE_MAX = 8;

export interface DesignOptions {
  /** The theme the screen is drawn against: what a `$color.x` token resolves to. Absent: colours are not resolved, so contrast is not checked. */
  theme?: Partial<ThemeTokens> | undefined;
  /** Whether a MODEL drew this screen. A hand-built one is held to the errors only: its warnings are the kit's own choices, made on purpose. */
  drawn?: boolean;
}

// ------------------------------------------------------------------ colour

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const isToken = (v: string): boolean => v.startsWith("$");

/** A colour as the renderer would resolve it: a token through the theme, a hex as it is. Null when it cannot be known here. */
export function resolveColour(v: unknown, theme?: Partial<ThemeTokens>): string | null {
  if (typeof v !== "string" || !v) return null;
  if (isToken(v)) {
    const path = v.slice(1).split(".");
    if (path[0] !== "color" || !path[1]) return null;
    const got = theme?.color?.[path[1]];
    return typeof got === "string" && HEX.test(got) ? got.toLowerCase() : null;
  }
  return HEX.test(v) ? v.toLowerCase() : null;
}

const chan = (h: string): number[] => {
  const s = h.slice(1);
  const n = s.length <= 4 ? s.slice(0, 3).split("").map((c) => c + c) : [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)];
  return n.map((p) => parseInt(p, 16) / 255);
};
const luminance = (hex: string): number => {
  const [r, g, b] = chan(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** How far apart two colours are, as WCAG counts it: 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

// ------------------------------------------------------------------- the walk

const TEXT_TYPES = new Set(["Text", "Label", "Heading", "Paragraph"]);
const IMAGE_TYPES = new Set(["Image", "Picture", "Avatar"]);
/** Written the CSS way, which the phone does not draw. */
const CSS_BORDER_KEYS = new Set(["border", "borderTop", "borderBottom", "borderLeft", "borderRight", "outline"]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Walked {
  node: Node;
  at: string;
  /** The nearest colour behind it, resolved, for contrast. */
  behind: string | null;
  /** Whether anything above it already takes a press. */
  underPress: boolean;
}

/** Every node of a screen, with where it is and what is behind it. `roots` carries each one's own path, so a lone root is "root" and a block is "blocks[0]". */
function* walk(roots: readonly { node: Node; at: string }[], o: { behind: string | null; theme?: Partial<ThemeTokens> }): Generator<Walked> {
  const stack: Walked[] = roots.map(({ node, at }) => ({ node, at, behind: o.behind, underPress: false }));
  while (stack.length) {
    const cur = stack.pop()!;
    yield cur;
    const style = (cur.node.style ?? {}) as Record<string, unknown>;
    const behind = resolveColour(style.backgroundColor, o.theme) ?? cur.behind;
    const underPress = cur.underPress || takesPress(cur.node);
    for (const [i, child] of (cur.node.children ?? []).entries()) {
      stack.push({ node: child, at: `${cur.at}.children[${i}]`, behind, underPress });
    }
  }
}

const takesPress = (n: Node): boolean => !!n.on && ("onPress" in n.on || "onLongPress" in n.on);

/**
 * The app's design rules over a drawn screen. Never throws: a screen it cannot read is a screen with no findings,
 * because this is a gate on what a model drew, not a parser anything depends on.
 */
export function checkDesign(screen: Pick<ScreenResponse, "root" | "blocks" | "theme">, o: DesignOptions = {}): DesignChecked {
  const out: DesignChecked = { errors: [], warnings: [], tells: [] };
  const theme = o.theme ?? screen.theme;
  const add = (to: keyof DesignChecked, rule: string, at: string, text: string) => {
    const list = out[to];
    if (list.filter((f) => f.rule === rule).length < PER_RULE_MAX) list.push({ rule, at, text });
  };
  // A hand-built screen is the kit's own work: its warnings were choices, so only the errors are held against it.
  const warn = (rule: string, at: string, text: string) => { if (o.drawn !== false) add("warnings", rule, at, text); };

  try {
    const roots: Array<{ node: Node; at: string }> = [];
    if (screen.root) roots.push({ node: screen.root, at: "root" });
    if (screen.blocks?.length) screen.blocks.forEach((node, i) => roots.push({ node, at: `blocks[${i}]` }));
    const headings: string[] = [];
    let labelAbove = 0;

    {
      for (const { node, at, behind, underPress } of walk(roots, { behind: null, theme })) {
        const style = (node.style ?? {}) as Record<string, unknown>;
        const props = (node.props ?? {}) as Record<string, unknown>;

        // A pressable inside a pressable: the window runs both, so one tap does two things.
        if (takesPress(node) && underPress) {
          add("errors", "pressable.nested", at, "This takes a press and so does something above it, so one tap would do both. Only the outer one or the inner one may take it.");
        }

        // Borders the CSS way, which the phone does not draw at all.
        for (const key of Object.keys(style)) {
          if (CSS_BORDER_KEYS.has(key)) {
            add("errors", "border.css", at, `${key} is the CSS way of writing a border and the phone draws nothing for it. Use borderWidth with borderColor.`);
          }
        }

        // Text the clients would each set themselves.
        if (TEXT_TYPES.has(node.type)) {
          if (num(style.lineHeight) === null) warn("text.lineHeight", at, "This text says no line height, so the phone and the window will each choose one and the text will not sit the same.");
          const fg = resolveColour(style.color, theme);
          if (fg && behind) {
            const ratio = contrast(fg, behind);
            if (ratio < CONTRAST_MIN) {
              add("errors", "contrast.low", at, `This text is ${ratio.toFixed(1)} to 1 against what is behind it, under the ${CONTRAST_MIN} to 1 that can be read. Use a token with more contrast.`);
            }
          }
          const content = typeof props.content === "string" ? props.content : typeof props.text === "string" ? props.text : "";
          if (content) {
            const size = num(style.fontSize) ?? 0;
            if (size >= 20 || /^h[1-3]$/i.test(String(props.variant ?? ""))) headings.push(content);
            // A small line in capitals or with letter-spacing, sitting right above a heading: the eyebrow that marks a drawn page.
            if (size > 0 && size <= 14 && (num(style.letterSpacing) ?? 0) > 0.4 && content === content.toUpperCase() && content.length <= 40) labelAbove += 1;
          }
        }

        // An image whose size neither client should have to guess.
        if (IMAGE_TYPES.has(node.type) && num(style.width) === null && num(style.height) === null && num(style.aspectRatio) === null) {
          warn("image.size", at, "This image says no width, height or aspect ratio, so each client guesses and the layout moves as it loads.");
        }

        // Something to press that a finger cannot find.
        if (takesPress(node)) {
          const h = num(style.height) ?? num(style.minHeight);
          const w = num(style.width) ?? num(style.minWidth);
          if ((h !== null && h < TOUCH_MIN) || (w !== null && w < TOUCH_MIN)) {
            warn("touch.small", at, `This takes a press but is ${[h, w].filter((x) => x !== null).join("×")} across, under the ${TOUCH_MIN} a finger needs.`);
          }
        }
      }
    }

    // The tells: counted, never a refusal.
    if (labelAbove >= 2) {
      out.tells.push({ rule: "tell.eyebrow", at: "screen", text: `${labelAbove} small capitalised labels sit above headings. One is a choice; several are the mark of a drawn page.` });
    }
    const dupes = headings.filter((h, i) => headings.indexOf(h) !== i);
    if (dupes.length) out.tells.push({ rule: "tell.repeated", at: "screen", text: `The heading ${JSON.stringify(dupes[0])} appears more than once.` });
  } catch {
    // A screen this cannot read is a screen with no findings: lint.ts is what refuses a shape the device cannot draw.
    return out;
  }
  return out;
}

/** The findings in words, for a log, a report, or the words a model is asked to draw again with. */
export function designWords(r: DesignChecked): string[] {
  return [
    ...r.errors.map((f) => `- ${f.at}: ${f.text}`),
    ...r.warnings.map((f) => `- ${f.at}: ${f.text}`),
    ...r.tells.map((f) => `- ${f.text}`),
  ];
}
