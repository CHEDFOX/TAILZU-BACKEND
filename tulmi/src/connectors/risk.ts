/**
 * HOW RISKY IS THIS TOOL, AND MAY IT RUN?
 *
 * Every MCP tool gets one of five tiers:
 *   read         looks, changes nothing
 *   write        changes something of the person's, reversibly (a draft, a note, an issue)
 *   send         puts words in front of other people (a message, an email, a post)
 *   destructive  deletes or removes
 *   pay          moves money
 *
 * The tool's own annotations are asked first (readOnlyHint, destructiveHint),
 * then its name, then the first sentence of its description. Annotations come
 * from the server, which may be careless or lying, so a tool that CLAIMS to be
 * read-only but is named like a payment, a deletion or a send is judged by its
 * name instead. Names are split into words ("sendMessage", "send_message"),
 * and a name that opens with a looking verb (get, list, search...) is a read
 * even when a noun in it ("get_message") looks like a send.
 *
 * gate() then says what happens. The LEVEL is a ceiling the person set per app:
 *   look   only reads run at all
 *   draft  reads run; writes need a yes each time; nothing that sends,
 *          deletes or pays is available
 *   send   writes and sends run after a yes, or on their own when the person
 *          turned that tool on ("auto"); deletes and payments ALWAYS need a yes
 *
 * An app the person added by link has no level: its server is nobody we have
 * read, so each of its tools has a POLICY instead, set per tool (gateTool):
 *   allow  runs without asking, except deletes and payments, which still ask
 *   ask    a yes every time (the default for anything not plainly a read)
 *   off    never runs
 */
export type Risk = "read" | "write" | "send" | "destructive" | "pay";
export type Level = "look" | "draft" | "send";
export type Gate = "run" | "approve" | "block";
export type Policy = "allow" | "ask" | "off";
export const POLICIES: readonly Policy[] = ["allow", "ask", "off"];

export interface ToolLike {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } & Record<string, unknown>;
}

const PAY = new Set(["pay", "payment", "charge", "purchase", "buy", "transfer", "refund"]);
const DESTRUCTIVE = new Set(["delete", "remove", "archive", "destroy", "purge", "erase", "trash"]);
const SEND_STRONG = new Set(["send", "publish", "forward", "broadcast", "tweet"]);
/** Verbs that are also nouns (a post, an email, a message): a send unless the name opens with a looking verb. */
const SEND_WEAK = new Set(["post", "email", "message", "reply", "dm"]);
const READ_FIRST = new Set([
  "get", "list", "search", "find", "read", "fetch", "view", "show", "query", "lookup", "describe",
  "check", "count", "browse", "retrieve", "whoami",
]);

/** "sendMessage", "send_message", "send-message", "Messages.send" -> ["send", "message"]; a plural is its singular. */
function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function tierOf(ws: string[], leading: boolean): Risk | undefined {
  if (ws.some((w) => PAY.has(w))) return "pay";
  if (ws.some((w) => DESTRUCTIVE.has(w))) return "destructive";
  if (ws.some((w) => SEND_STRONG.has(w))) return "send";
  if (ws.includes("draft")) return "write";
  if (leading && READ_FIRST.has(ws[0] ?? "")) return "read";
  if (ws.some((w) => SEND_WEAK.has(w))) return "send";
  return undefined;
}

export function riskOf(tool: ToolLike): Risk {
  const a = tool.annotations ?? {};
  const byName = tierOf(words(tool.name), true);
  const named = byName === "pay" || byName === "destructive" || byName === "send";
  if (a.readOnlyHint === true && !named) return "read";
  if (a.destructiveHint === true && a.readOnlyHint !== true) return "destructive";
  if (byName) return byName;
  // A description speaks in sentences: its first word is the verb ("Sends a
  // message..."), and a strong verb anywhere in the first sentence counts.
  const first = (tool.description ?? "").split(/(?<=[.!?])\s/)[0] ?? "";
  const dw = words(first);
  const lead = dw[0] ?? "";
  if (PAY.has(lead) || DESTRUCTIVE.has(lead) || SEND_STRONG.has(lead) || SEND_WEAK.has(lead)) return tierOf([lead], false)!;
  const anywhere = tierOf(dw.filter((w) => PAY.has(w) || DESTRUCTIVE.has(w) || SEND_STRONG.has(w)), false);
  return anywhere ?? "write";
}

/** What happens to a tool of this risk, on a connection at this level. */
export function gate(risk: Risk, level: Level, autoOk: boolean): Gate {
  if (risk === "read") return "run";
  if (level === "look") return "block";
  if (level === "draft") return risk === "write" ? "approve" : "block";
  if (risk === "destructive" || risk === "pay") return "approve";
  return autoOk ? "run" : "approve";
}

/**
 * Where a tool of an app the person added starts. Only a tool that says it is
 * read-only AND reads as one by its name and description runs without a yes;
 * the server's say-so alone is not enough (the MCP spec: annotations from a
 * server you do not trust are untrusted).
 */
export function defaultPolicy(tool: ToolLike): Policy {
  return tool.annotations?.readOnlyHint === true && riskOf(tool) === "read" ? "allow" : "ask";
}

/** What happens to a tool of an app the person added, by its risk and the policy they set. */
export function gateTool(risk: Risk, policy: Policy): Gate {
  if (policy === "off") return "block";
  // Only a plain "allow" runs without asking; anything that is not one of the three asks.
  if (policy !== "allow") return "approve";
  // "Allow" never covers a delete or a payment: those are asked, every app, every time.
  return risk === "destructive" || risk === "pay" ? "approve" : "run";
}

/** The policies a tool of this risk may be set to: a delete or a payment cannot be allowed outright. */
export function policiesFor(risk: Risk): readonly Policy[] {
  return risk === "destructive" || risk === "pay" ? ["ask", "off"] : POLICIES;
}
