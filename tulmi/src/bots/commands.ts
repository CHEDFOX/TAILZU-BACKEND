/**
 * SAVED COMMANDS: A SHORT INSTRUCTION WITH {{input}} IN IT, RUN FROM CHAT AS /name.
 *
 *   checkCommand({ name, template })   capped and validated, or why not
 *   expand(commands, text)             "/summarise this week" -> the template with {{input}} = "this week"; null when it is no command of this bot
 *
 * A command is the owner's own text, so it is held to what their rules are held to: one short piece of text (600 characters), the only placeholder
 * is {{input}} (at most twice), no secret in it, and no instruction to ignore Tailzu's own rules. At most 30 a bot. What a person types after the name
 * goes in as plain text: it cannot add a placeholder, and it is capped like any message. A name that is not one of the bot's commands is not a command:
 * the message goes through as it was typed.
 */
import { forModel } from "../code/work/model.js";
import { LIMITS } from "./types.js";
import { inertRules } from "./validate.js";

const NAME = /^[a-z][a-z0-9_-]{0,23}$/;
/** Names chat keeps for itself. */
export const RESERVED_COMMANDS: readonly string[] = ["help", "new", "clear", "forget", "memory", "test", "commands", "stop"];
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const HAS_INPUT = /\{\{\s*input\s*\}\}/;

export type Checked = { ok: true; name: string; template: string } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex
const tidy = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export function checkCommand(raw: { name?: unknown; template?: unknown }): Checked {
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/^\//, "").toLowerCase() : "";
  if (!NAME.test(name)) return { ok: false, error: `name is lower-case letters, digits, - and _, starting with a letter, ${LIMITS.command.name} characters at most` };
  if (RESERVED_COMMANDS.includes(name)) return { ok: false, error: `/${name} is kept by chat` };
  if (typeof raw.template !== "string") return { ok: false, error: "template is the instruction, as text" };
  const template = tidy(raw.template);
  if (!template) return { ok: false, error: "template can't be empty" };
  if (template.length > LIMITS.command.template) return { ok: false, error: `template is ${LIMITS.command.template} characters at most` };
  let inputs = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (m[1] !== "input") return { ok: false, error: "the only placeholder a command can use is {{input}}" };
    inputs += 1;
  }
  if (inputs > 2) return { ok: false, error: "{{input}} can be used twice at most" };
  if (/\{\{|\}\}/.test(template.replace(PLACEHOLDER, ""))) return { ok: false, error: "a { or } left open: write {{input}} whole" };
  if (forModel(template) !== template) return { ok: false, error: "a command can't hold a secret" };
  if (inertRules([template]).length) return { ok: false, error: "a command can't tell the bot to ignore Tailzu's own rules" };
  return { ok: true, name, template };
}

export interface Expanded { name: string; message: string }

/** "/name rest" against a bot's commands: the template with {{input}} filled in, or null when the message is no command of this bot. */
export function expand(commands: ReadonlyArray<{ name: string; template: string }>, text: string): Expanded | null {
  const m = /^\s*\/([a-z][a-z0-9_-]{0,23})(?:\s+([\s\S]*))?$/i.exec(text);
  if (!m) return null;
  const c = commands.find((x) => x.name === m[1]!.toLowerCase());
  if (!c) return null;
  const input = tidy(m[2] ?? "").slice(0, LIMITS.message);
  // A function, so a "$&" in what they typed is text and not a pattern.
  let message = c.template.replace(PLACEHOLDER, () => input).trim();
  // A template with no {{input}} still takes what they typed, after it.
  if (input && !HAS_INPUT.test(c.template)) message = `${message}\n\n${input}`;
  return { name: c.name, message: message.slice(0, LIMITS.message) };
}
