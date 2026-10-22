/**
 * A NATIVE CONNECTOR: our own code behind the interface MCP apps already have.
 *
 * The engine only ever asks an app three things: what are your tools (name,
 * description, input schema, annotations), what is the risk of this call, and
 * please run it. client.ts answers those by speaking MCP; a native connector
 * answers them with code against the vendor's REST API (google/). Everything
 * above that line, the router, the risk gate, approvals, audit, the confirm
 * card and the screens, is the same code for both and never learns which it is.
 *
 * Errors leave a native connector the way they leave the MCP client: a thrown
 * ConnectorError with a code and a sentence that can be said aloud, which the
 * hub turns into the same { code, message } failure.
 */
import type { CallOutcome, ToolInfo } from "./client.js";
import type { Risk } from "./risk.js";
import type { WordKey } from "./words.js";

export type Args = Record<string, unknown>;

/** A tool with the risk it carries. Declared by us, never read from a server's say-so. */
export interface NativeTool extends ToolInfo {
  risk: Risk;
  /** Its link opens only on a phone (a call, a text, a UPI payment): asked for on a computer, it is one line and nothing runs. */
  phoneOnly?: boolean;
}

/** Something to open on the person's own device: a hand-off (handoffs/). */
export interface Handoff {
  /** The link to open: one on the hand-off list (handoffs/links.ts), never anything else. */
  url: string;
  /** The button's words in English; the run words it for the person from `words`. */
  label: string;
  /** Opened instead when `url` cannot be (the email's mailto: link). */
  fallback?: string;
  /** What is said and what the button reads, as lines of the word table and the words that fill them. */
  words?: HandoffWords;
}

export interface HandoffWords {
  say: WordKey;
  open: WordKey;
  vars?: Record<string, string>;
}

export interface NativeConnector {
  /** The tools, with their risk. No network. */
  tools(): NativeTool[];
  /**
   * What THIS call would do, for the few tools whose risk depends on the
   * arguments (an event with guests is a send; one without is a write). May
   * look something up. undefined means the tool's own risk.
   */
  riskOf?(userId: string, tool: string, args: Args): Promise<Risk | undefined>;
  /** The exact change in plain words, for the confirm card. undefined means the generic preview. */
  preview?(userId: string, tool: string, args: Args): Promise<string | undefined>;
  /** Run one tool. Throws ConnectorError; never returns an error as text. */
  call(userId: string, tool: string, args: Args): Promise<CallOutcome>;
  /**
   * A hand-off that names who it goes to (a number, a username, a UPI ID):
   * whether that is in `words`, the person's own. true when the call names
   * no one. Asked once the run has read another app's results, which may
   * never pick who a message goes to or who is paid.
   */
  recipientSaid?(tool: string, args: Args, words: string): boolean;
}

export type NativeSet = Record<string, NativeConnector>;

export type { CallOutcome };
