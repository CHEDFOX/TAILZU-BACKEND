/**
 * THE TOOLS OF AN APP A PERSON ADDED BY LINK: cleaned, and held to what they approved.
 *
 * A catalog app's tools come from a vendor we read before switching it on. An
 * app added by link is anybody's server, and its tool list is text the
 * planner reads: a description can carry instructions, hidden characters can
 * carry more, and a server can change the list after the person said yes to
 * it (a "rug pull"). So, for those apps only:
 *
 * CLEANED (cleanTools), every time the list is fetched:
 *   - a tool whose name is not ^[A-Za-z0-9_.-]{1,128}$ is dropped, and so is a
 *     second tool with a name already seen;
 *   - control, zero-width, bidirectional, tag and variation-selector
 *     characters are taken out of every string, the schema's included: they
 *     show nothing to a person and can say anything to a model;
 *   - a description is cut at 1,000 characters, and a tool whose argument
 *     schema is over 8 KB is dropped (a schema cannot be cut and stay one);
 *   - at most 100 tools are kept.
 *
 * PINNED (reviewTools): a sha256 per tool over the canonical JSON of
 * {name, title, description, inputSchema, annotations}, as cleaned, and one
 * over the whole set. The first list ever fetched for a connection is pinned
 * as it is: that is what the person saw when they added it. After that, a
 * tool that is new or whose hash moved is "changed": it is kept away from the
 * planner (visibleTools) and its policy goes back to "ask" (or stays "off")
 * until the person accepts the list again (acceptPatch). A tool that is gone
 * simply goes, from the pin and from the policies, so if it comes back it
 * comes back as new.
 */
import { createHash } from "node:crypto";
import type { ToolInfo } from "./client.js";
import { defaultPolicy, POLICIES, type Policy } from "./risk.js";
import type { Connection, ConnectionPatch, ToolsPin } from "./store.js";

export const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
export const MAX_CUSTOM_TOOLS = 100;
export const DESCRIPTION_MAX = 1000;
export const SCHEMA_MAX = 8 * 1024;
const TITLE_MAX = 200;
/** Deeper than this a schema is not describing arguments any more. */
const DEPTH_MAX = 24;

/**
 * Characters that print nothing: C0 and C1 controls (but tab and line
 * breaks), the soft hyphen, zero-width and joiner characters, the
 * bidirectional marks, embeddings, overrides and isolates, the word joiner
 * and invisible operators, the byte-order mark, variation selectors, and the
 * Unicode tag block, which can spell out a whole hidden sentence.
 */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

export const stripInvisible = (s: string): string => s.replace(INVISIBLE, "");

/** Every string in a JSON value, keys included, with the invisible characters out. Undefined past DEPTH_MAX. */
function cleanValue(v: unknown, depth = 0): unknown {
  if (depth > DEPTH_MAX) return undefined;
  if (typeof v === "string") return stripInvisible(v);
  if (Array.isArray(v)) return v.map((x) => cleanValue(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[stripInvisible(k)] = cleanValue(x, depth + 1);
    return out;
  }
  return v;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** An app-added-by-link's raw tools/list, made safe to show a planner. See the top of this file. */
export function cleanTools(raw: readonly unknown[]): ToolInfo[] {
  const out: ToolInfo[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (out.length >= MAX_CUSTOM_TOOLS) break;
    if (!isObject(t)) continue;
    const name = t.name;
    if (typeof name !== "string" || !TOOL_NAME.test(name) || seen.has(name)) continue;
    const inputSchema = (isObject(t.inputSchema) ? cleanValue(t.inputSchema) : { type: "object" }) as ToolInfo["inputSchema"];
    if (!inputSchema || JSON.stringify(inputSchema).length > SCHEMA_MAX) continue;
    const tool: ToolInfo = { name, inputSchema };
    if (typeof t.title === "string" && stripInvisible(t.title).trim()) tool.title = stripInvisible(t.title).trim().slice(0, TITLE_MAX);
    if (typeof t.description === "string") tool.description = stripInvisible(t.description).slice(0, DESCRIPTION_MAX);
    if (isObject(t.annotations)) tool.annotations = cleanValue(t.annotations) as ToolInfo["annotations"];
    seen.add(name);
    out.push(tool);
  }
  return out;
}

// ------------------------------------------------------------------ pins

/** JSON with every object's keys in order, so the same tool always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObject(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** One tool's pin: what the planner and the person are shown of it. */
export function pinOf(t: ToolInfo): string {
  return sha256(canonical({
    name: t.name, title: t.title ?? null, description: t.description ?? null,
    inputSchema: t.inputSchema ?? null, annotations: t.annotations ?? null,
  }));
}

/** The hash over a set of tool pins. */
const listOf = (tools: Record<string, string>): string => sha256(canonical(tools));

/** The pin of a whole list. */
export function pinList(tools: readonly ToolInfo[]): ToolsPin {
  const byName = Object.fromEntries(tools.map((t) => [t.name, pinOf(t)]));
  return { list: listOf(byName), tools: byName };
}

type Pinned = Pick<Connection, "toolsPin" | "toolsChanged" | "toolPolicy">;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * What the connection should now hold, for the list just fetched: null when
 * nothing moved. `now` is the list's pin, when the caller has it already.
 */
export function reviewTools(tools: readonly ToolInfo[], was: Pinned, now: ToolsPin = pinList(tools)): ConnectionPatch | null {
  // First use: what is there is what the person added.
  if (!was.toolsPin) return { toolsPin: now, toolsChanged: [] };
  const pinned = was.toolsPin;
  if (pinned.list === now.list) return was.toolsChanged.length ? { toolsChanged: [] } : null;
  const present = new Set(tools.map((t) => t.name));
  // Gone is gone: out of the pin and out of the policies.
  const kept = Object.fromEntries(Object.entries(pinned.tools).filter(([n]) => present.has(n)));
  const changed = tools.filter((t) => kept[t.name] !== now.tools[t.name]).map((t) => t.name);
  const toolPolicy: Record<string, Policy> = Object.fromEntries(Object.entries(was.toolPolicy).filter(([n]) => present.has(n)));
  // Newly changed: back to asking, whatever it was allowed before. Off stays off.
  for (const n of changed) if (!was.toolsChanged.includes(n) && toolPolicy[n] !== "off") toolPolicy[n] = "ask";
  const toolsPin = { list: listOf(kept), tools: kept };
  const moved = toolsPin.list !== pinned.list || !sameList(changed, was.toolsChanged)
    || canonical(toolPolicy) !== canonical(was.toolPolicy);
  return moved ? { toolsPin, toolsChanged: changed, toolPolicy } : null;
}

/** The person looked at the list as it is now and said yes to it. */
export function acceptPatch(tools: readonly ToolInfo[], now: ToolsPin = pinList(tools)): ConnectionPatch {
  return { toolsPin: now, toolsChanged: [] };
}

/**
 * A tool's policy on this connection: the person's, else where it starts.
 * Only a setting the map itself holds, and only one of the three, counts: a
 * tool may be called "constructor" or "toString" (TOOL_NAME allows it), and
 * an ordinary object answers those with what it inherits, which is no policy.
 */
export function policyOf(t: ToolInfo, conn: Pick<Connection, "toolPolicy">): Policy {
  const set: unknown = Object.hasOwn(conn.toolPolicy, t.name) ? conn.toolPolicy[t.name] : undefined;
  return POLICIES.includes(set as Policy) ? (set as Policy) : defaultPolicy(t);
}

/** The tools the planner may see: accepted, and not switched off. */
export function visibleTools(tools: readonly ToolInfo[], conn: Pick<Connection, "toolsChanged" | "toolPolicy">): ToolInfo[] {
  return tools.filter((t) => !conn.toolsChanged.includes(t.name) && policyOf(t, conn) !== "off");
}
