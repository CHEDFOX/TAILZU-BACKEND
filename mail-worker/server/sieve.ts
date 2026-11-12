// A company's filing, rules and auto-replies, compiled into the one Sieve script
// Stalwart runs on every message the company receives. The dashboard owns the
// script: it is rebuilt from the database after every change and replaces what
// was there (named "xooteq", active).
//
// Order, and why:
//   1. Rules, in the order shown. A rule that deletes stops everything after it.
//   2. Each address's folder: mail to support@ is also filed under "Support",
//      and stays in Inbox (fileinto :copy), so Inbox is everything and each
//      folder is one address, like a label.
//   3. Auto-replies: at most one per message (Sieve allows one vacation action),
//      within its dates if it has them, at most once per sender per N days.
import { Mailbox } from "./stalwart.ts";

export type AutoReply = {
  enabled: boolean;
  subject: string;
  body: string;
  /** Once per sender every this many days. */
  days: number;
  /** YYYY-MM-DD, inclusive; either may be empty. */
  start?: string;
  end?: string;
};

export type Address = {
  local: string;
  label: string;
  isPrimary: boolean;
  autoReply: AutoReply | null;
  /** The name it sends as; auto-replies use it too. */
  displayName?: string;
};

export type Condition = {
  field: "from" | "to" | "subject" | "body" | "header" | "attachment";
  op: "contains" | "is" | "starts" | "ends" | "not-contains";
  value: string;
  /** For field "header": the header's name. */
  header?: string;
};

export type Action = {
  type: "move" | "label" | "read" | "star" | "forward" | "delete" | "stop";
  /** Folder for move/label, address for forward. */
  value?: string;
};

export type Rule = {
  id?: number;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: Condition[];
  actions: Action[];
};

/** A Sieve quoted string. */
export function q(s: string): string {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ") + '"';
}

/** A Sieve multi-line string (text: ... .), dot-stuffed. */
function text(s: string): string {
  const body = String(s).replace(/\r\n?/g, "\n").split("\n").map((l) => (l.startsWith(".") ? "." + l : l)).join("\r\n");
  return `text:\r\n${body}\r\n.\r\n`;
}

/** A :matches pattern that matches the literal string. */
const literal = (s: string) => s.replace(/[\\*?]/g, (c) => "\\" + c);

function test(c: Condition): string {
  const v = c.value.trim();
  const [mt, val] =
    c.op === "is" ? [":is", v] :
    c.op === "starts" ? [":matches", literal(v) + "*"] :
    c.op === "ends" ? [":matches", "*" + literal(v)] :
    [":contains", v];
  let t: string;
  switch (c.field) {
    case "from": t = `address :all ${mt} "from" ${q(val)}`; break;
    case "to": t = `address :all ${mt} ["to", "cc"] ${q(val)}`; break;
    case "subject": t = `header ${mt} "subject" ${q(val)}`; break;
    case "body": t = `body :text ${mt} ${q(val)}`; break;
    case "header": t = `header ${mt} ${q(c.header || "x-unknown")} ${q(val)}`; break;
    // A message with a file attached is multipart/mixed at the top.
    case "attachment": t = `header :contains "content-type" "multipart/mixed"`; break;
  }
  return c.op === "not-contains" && c.field !== "attachment" ? `not ${t}` : t;
}

function actions(list: Action[]): string[] {
  const out: string[] = [];
  // Flags first, so the copies filed below carry them.
  for (const a of list) {
    if (a.type === "read") out.push(`addflag "\\\\Seen";`);
    if (a.type === "star") out.push(`addflag "\\\\Flagged";`);
  }
  for (const a of list) {
    if (a.type === "move" && a.value) out.push(`fileinto :create ${q(a.value)};`);
    if (a.type === "label" && a.value) out.push(`fileinto :copy :create ${q(a.value)};`);
    if (a.type === "forward" && a.value) out.push(`redirect :copy ${q(a.value)};`);
  }
  if (list.some((a) => a.type === "delete")) out.push("discard;", "stop;");
  else if (list.some((a) => a.type === "stop")) out.push("stop;");
  return out;
}

export function compile(domain: string, addresses: Address[], rules: Rule[]): string {
  const lines: string[] = [
    'require ["fileinto", "envelope", "copy", "mailbox", "vacation", "imap4flags", "body", "date", "relational"];',
    "# Written by Xooteq Mail. Edit addresses, rules and auto-replies in the dashboard:",
    "# this script is rebuilt from there and anything changed here is replaced.",
    "",
  ];

  const active = rules.filter((r) => r.enabled && r.conditions.length && r.actions.length);
  if (active.length) lines.push("# Rules");
  for (const r of active) {
    const tests = r.conditions.map(test);
    const cond = tests.length === 1 ? tests[0] : `${r.match === "any" ? "anyof" : "allof"} (${tests.join(", ")})`;
    lines.push(`# ${r.name.replace(/[\r\n]/g, " ")}`, `if ${cond} {`, ...actions(r.actions).map((a) => "  " + a), "}");
  }

  const filed = addresses.filter((a) => !a.isPrimary && a.label);
  if (filed.length) lines.push("", "# Each address into its folder (and Inbox)");
  for (const a of filed) {
    lines.push(`if envelope :all :is "to" ${q(`${a.local}@${domain}`)} { fileinto :copy :create ${q(a.label)}; }`);
  }

  const replies = addresses.filter((a) => a.autoReply?.enabled && a.autoReply.body.trim());
  if (replies.length) lines.push("", "# Auto-replies (one per message)");
  replies.forEach((a, i) => {
    const r = a.autoReply!;
    const addr = `${a.local}@${domain}`;
    const conds = [`envelope :all :is "to" ${q(addr)}`];
    if (r.start && /^\d{4}-\d{2}-\d{2}$/.test(r.start)) conds.push(`currentdate :value "ge" "date" ${q(r.start)}`);
    if (r.end && /^\d{4}-\d{2}-\d{2}$/.test(r.end)) conds.push(`currentdate :value "le" "date" ${q(r.end)}`);
    const days = Math.max(1, Math.min(365, Math.round(r.days || 1)));
    const head = `${i === 0 ? "if" : "elsif"} ${conds.length === 1 ? conds[0] : `allof (${conds.join(", ")})`} {`;
    lines.push(head,
      `  vacation :days ${days} :from ${q(a.displayName ? `"${a.displayName}" <${addr}>` : addr)} :subject ${q(r.subject || "Thanks for your message")} :handle ${q("xm-" + a.local)} ${text(r.body)}  ;`,
      "}");
  });
  return lines.join("\r\n") + "\r\n";
}

/** Uploads, validates and activates the script in the company's mailbox. */
export async function deploy(address: string, script: string): Promise<void> {
  const box = new Mailbox(address);
  const blob = await box.upload(Buffer.from(script, "utf8"), "application/sieve");
  await box.call("SieveScript/validate", { blobId: blob.blobId }).then((r) => {
    const err = r.error as { description?: string } | null | undefined;
    if (err) throw new Error(`the mail rules did not compile: ${err.description ?? "invalid script"}`);
  });
  const existing = (await box.call("SieveScript/get", { properties: ["name", "isActive"] })).list as { id: string; name: string; isActive: boolean }[];
  const ours = existing.find((s) => s.name === "xooteq");
  if (ours) {
    await box.call("SieveScript/set", { update: { [ours.id]: { blobId: blob.blobId } }, ...(ours.isActive ? {} : { onSuccessActivateScript: ours.id }) });
  } else {
    await box.call("SieveScript/set", { create: { s: { name: "xooteq", blobId: blob.blobId } }, onSuccessActivateScript: "#s" });
  }
}
