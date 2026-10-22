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

export type Args = Record<string, unknown>;

/** A tool with the risk it carries. Declared by us, never read from a server's say-so. */
export interface NativeTool extends ToolInfo {
  risk: Risk;
}

/** Something to open on the person's own computer (the email hand-off). */
export interface Handoff {
  /** The link to open: https://mail.google.com/ only. */
  url: string;
  label: string;
  /** Opened instead when `url` cannot be: a mailto: link. */
  fallback?: string;
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
}

export type NativeSet = Record<string, NativeConnector>;

export type { CallOutcome };
