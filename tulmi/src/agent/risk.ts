/**
 * HOW CAREFUL TO BE WITH ONE ACTION.
 *
 * Every action leaves with a risk: "free" runs at once, "confirm" waits for a
 * yes, "always" waits for a yes even when the user has said not to ask. It is
 * worked out here from what the action does and what it is done to, never
 * from what the model says about it, and the device works it out again and
 * keeps the higher of the two. So this can only make a step more careful:
 * a rule here that the device lacks still holds, and one the device has that
 * this lacks still holds there.
 *
 * The rules, in the order they are checked:
 *   - words in the target's label or the action's own text: sending and
 *     signing out ask first, paying and deleting ask every time
 *   - keys that send or destroy (a chord with enter, enter in a message box,
 *     close and quit, delete-forever), and a bare letter or TYPE outside a
 *     text field, where it would fire one of the app's shortcuts instead
 *   - text that would carry something off the screen: a one-time code, an
 *     email address, or a long run copied from another element, that the
 *     user did not say themselves
 *   - every press in a browser, whose page authors write the labels and can
 *     write them to lie
 *   - opening a different app
 */
import type { AgentElement, AgentEvent, AgentRisk, AgentStepRequest } from "../../../shared/types/api.js";

export type ActionEvent = Extract<AgentEvent, { t: "action" }>;
export type PlannedAction = Omit<ActionEvent, "t" | "risk" | "confirm">;

export interface Scene {
  req: AgentStepRequest;
  /** Everything the user said in this run. A code they read out themselves
   *  is theirs to type. */
  said: string;
}

const CONFIRM_WORDS = /\b(?:send|post|submit|reply all|share|invite|publish|merge|deploy|sign out|log out|uninstall|close without saving)\b/i;
const ALWAYS_WORDS = /\b(?:delete|remove|erase|empty (?:the )?trash|pay|buy|purchase|order|checkout|transfer|subscribe|cancel (?:my |the )?subscription)\b/i;

const BROWSER = /\b(?:chrome|chromium|safari|edge|firefox|arc|brave|opera|vivaldi)\b/i;
export function isBrowser(app: string): boolean {
  return BROWSER.test(app);
}

/** Chords that send, close, quit or delete for good, whatever has focus. */
const SENDS_OR_DESTROYS = new Set(["cmd+w", "ctrl+w", "cmd+q", "alt+f4", "cmd+delete", "cmd+backspace", "shift+delete"]);

const RANK: Record<AgentRisk, number> = { free: 0, confirm: 1, always: 2 };
const higher = (a: AgentRisk, b: AgentRisk): AgentRisk => (RANK[b] > RANK[a] ? b : a);

function wordsRisk(s: string | undefined): AgentRisk {
  if (!s) return "free";
  if (ALWAYS_WORDS.test(s)) return "always";
  if (CONFIRM_WORDS.test(s)) return "confirm";
  return "free";
}

export function isTextEntry(el: AgentElement | undefined): boolean {
  return !!el && (el.role === "field" || el.role === "area" || el.role === "combo");
}

const MESSAGE_LABEL = /\b(?:message|reply|comment|chat|compose|write|post|send)\b/i;
function isMessageBox(el: AgentElement | undefined, field: AgentStepRequest["screen"]["field"]): boolean {
  if (el) return el.role === "area" || (isTextEntry(el) && MESSAGE_LABEL.test(el.label ?? ""));
  return !!field && (field.kind === "message" || field.kind === "longtext" || MESSAGE_LABEL.test(field.label ?? ""));
}

const focusedOf = (req: AgentStepRequest) => req.screen.elements.find((e) => e.focused);
const byId = (req: AgentStepRequest, id?: string) => (id ? req.screen.elements.find((e) => e.id === id) : undefined);

/** Where typed text goes is a text field: the focused element is one, or,
 *  when no element is marked focused, the device read a field or a selection. */
function typingIntoText(req: AgentStepRequest): boolean {
  const f = focusedOf(req);
  return f ? isTextEntry(f) : !!(req.screen.field || req.screen.selection);
}

const CODE = /(?<!\d)\d{4,8}(?!\d)/g;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const COPY_RUN = 12;

/**
 * Would this text carry something off the screen that the user never said?
 * A 4–8 digit number (one-time codes are) or an email address that is shown
 * somewhere else on the screen, or 12 characters in a row lifted from another
 * element's value. The element being typed into is not "somewhere else": what
 * is already in it is going nowhere.
 */
function carriesOffScreen(text: string, scene: Scene, into?: AgentElement): boolean {
  const { req } = scene;
  const said = scene.said.toLowerCase();
  const others = req.screen.elements.filter((e) => e !== into && !e.focused);
  const shown = [...others.flatMap((e) => [e.label ?? "", e.value ?? ""]), req.screen.text ?? ""].join("\n").toLowerCase();
  const found = [...(text.match(CODE) ?? []), ...(text.match(EMAIL) ?? [])].map((x) => x.toLowerCase());
  if (found.some((x) => shown.includes(x) && !said.includes(x))) return true;
  const lower = text.toLowerCase();
  for (const e of others) {
    const v = (e.value ?? "").toLowerCase();
    for (let i = 0; i + COPY_RUN <= v.length; i++) {
      const run = v.slice(i, i + COPY_RUN);
      if (run.trim().length === COPY_RUN && lower.includes(run) && !said.includes(run)) return true;
    }
  }
  return false;
}

/**
 * The risk of one action. `rewrite`: the text is their own selection,
 * rewritten in place, so nothing in it is being carried from anywhere.
 */
export function riskOf(action: PlannedAction, scene: Scene, rewrite = false): AgentRisk {
  const { req } = scene;
  const target = byId(req, action.id);
  const focused = focusedOf(req);
  let risk = higher(wordsRisk(target?.label), wordsRisk(action.text ?? action.keys ?? action.app));

  switch (action.kind) {
    case "press":
      if (isBrowser(req.app)) risk = higher(risk, "confirm");
      break;
    case "key": {
      const keys = action.keys ?? "";
      const parts = keys.split("+");
      const key = parts.at(-1) ?? "";
      const mods = parts.slice(0, -1);
      if (key === "enter" && (mods.length > 0 || isMessageBox(focused, req.screen.field))) risk = higher(risk, "confirm");
      if (SENDS_OR_DESTROYS.has(keys)) risk = higher(risk, "confirm");
      const printable = key === "space" || [...key].length === 1;
      if (!mods.length && printable && !typingIntoText(req)) risk = higher(risk, "confirm");
      break;
    }
    case "type":
      if (!typingIntoText(req)) risk = higher(risk, "confirm");
      if (!rewrite && carriesOffScreen(action.text ?? "", scene, focused)) risk = higher(risk, "confirm");
      break;
    case "set":
      if (carriesOffScreen(action.text ?? "", scene, target)) risk = higher(risk, "confirm");
      break;
    case "open":
      if ((action.app ?? "").trim().toLowerCase() !== req.app.trim().toLowerCase()) risk = higher(risk, "confirm");
      break;
    default:
      break;
  }
  return risk;
}

const short = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The message waiting to go: the focused message box's text, and who it is
 *  to when its label says ("Message #design" → "#design"). */
function waitingMessage(req: AgentStepRequest): { to?: string; text: string } | null {
  const f = focusedOf(req);
  const box = f && isMessageBox(f, undefined) && f.value ? f
    : req.screen.elements.find((e) => e.role === "area" && e.value);
  if (!box?.value) return null;
  const to = /^(?:message|reply to|send (?:a )?message to|write to|chat with)\s+(.+)$/i.exec(box.label ?? "")?.[1];
  return { to: to ? short(to, 40) : undefined, text: box.value };
}

const sending = (m: { to?: string; text: string }) => `Send${m.to ? ` to ${m.to}` : ""}: “${short(m.text, 80)}”`;

/** The sentence the device shows when it asks before acting. */
export function confirmText(action: PlannedAction, scene: Scene): string {
  const { req } = scene;
  const label = byId(req, action.id)?.label;
  switch (action.kind) {
    case "press": {
      const m = label && /\b(?:send|post|reply)\b/i.test(label) ? waitingMessage(req) : null;
      if (m) return sending(m);
      return label ? `Press “${short(label)}”?` : "Press this?";
    }
    case "key": {
      const m = /(?:^|\+)enter$/.test(action.keys ?? "") ? waitingMessage(req) : null;
      if (m) return sending(m);
      return `Press ${action.keys}?`;
    }
    case "type":
      return `Type “${short(action.text ?? "", 80)}”?`;
    case "set":
      return label ? `Put “${short(action.text ?? "")}” in “${short(label, 40)}”?` : `Type “${short(action.text ?? "", 80)}”?`;
    case "open":
      return `Open ${action.app}?`;
    case "scroll":
      return `Scroll ${action.dir}?`;
    case "focus":
      return label ? `Go to “${short(label)}”?` : "Go there?";
    default:
      return "Do this?";
  }
}

/** The action as the device receives it: risk added, and the sentence to
 *  confirm with when it is not free. */
export function withRisk(action: PlannedAction, scene: Scene, rewrite = false): ActionEvent {
  const risk = riskOf(action, scene, rewrite);
  return risk === "free"
    ? { t: "action", ...action, risk }
    : { t: "action", ...action, risk, confirm: confirmText(action, scene) };
}
