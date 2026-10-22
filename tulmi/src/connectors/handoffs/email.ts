/**
 * THE EMAIL HAND-OFF: no permission, no sign-in, nothing sent by Tailzu.
 *
 * compose_email writes an email into the person's own Gmail compose window (a
 * https://mail.google.com compose link opened on their computer) for them to
 * read and send. The mailto: link is the fallback for a computer whose browser
 * does not do Gmail. The agent turns the hand-off into an `open` event and the
 * desktop opens it, only if it is on the hand-off list (links.ts). The other
 * hand-offs (WhatsApp, Maps, UPI and the rest) are in apps.ts.
 *
 * Its tier is "write": it prepares a draft and nothing leaves. It needs no yes
 * of its own, since the person sees the whole email before anything is sent
 * and sending is their own click.
 */
import type { CallOutcome } from "../client.js";
import type { Args, Handoff, NativeConnector, NativeTool } from "../native.js";
import { ConnectorError } from "../oauth.js";
import { LINK_MAX } from "./links.js";

const EMAIL = /^[^\s@<>,;"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const SUBJECT_MAX = 200;
/** Gmail and mail apps take a link, not a file: past this the email would be cut. */
const BODY_MAX = 3000;
const RECIPIENTS_MAX = 10;

const TOOLS: NativeTool[] = [
  {
    name: "compose_email", risk: "write",
    description: "Write an email in the person's Gmail for them to check and send. Nothing is sent: Gmail opens with the email filled in. Use only an email address they gave; without one Gmail opens with To empty for them to fill in.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma separated." },
        subject: { type: "string" },
        body: { type: "string", description: "The email text, plain text with line breaks." },
      },
      required: ["subject", "body"],
    },
    annotations: {},
  },
];

const enc = encodeURIComponent;

/** The two links for an email. Everything in them is percent-encoded, so no word of the email can add a field or end one. */
export function handoffLinks(to: string[], subject: string, body: string): { gmail: string; mailto: string } {
  const addrs = to.map(enc).join(",");
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${addrs}&su=${enc(subject)}&body=${enc(body)}`,
    mailto: `mailto:${addrs}?subject=${enc(subject)}&body=${enc(body)}`,
  };
}

export function emailHandoff(): NativeConnector {
  return {
    tools: () => TOOLS,
    async call(_userId: string, tool: string, args: Args): Promise<CallOutcome> {
      if (tool !== "compose_email") throw new ConnectorError("rejected", `Gmail doesn't have an action called ${tool.slice(0, 40)}.`);
      const list = (typeof args.to === "string" ? args.to : Array.isArray(args.to) ? args.to.join(",") : "")
        .split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      const bad = list.find((a) => !EMAIL.test(a));
      if (bad) throw new ConnectorError("rejected", `"${bad.slice(0, 60)}" doesn't look like an email address. Who should it go to?`);
      if (list.length > RECIPIENTS_MAX) throw new ConnectorError("rejected", "That's more people than I can put on one email.");
      const subject = (typeof args.subject === "string" ? args.subject : "").replace(/[\r\n]+/g, " ").trim().slice(0, SUBJECT_MAX);
      const body = (typeof args.body === "string" ? args.body : "").replace(/\r\n?/g, "\n").trim();
      const tooLong = () => new ConnectorError("rejected", "That email is too long for me to open in Gmail. Ask me for a shorter one.");
      if (body.length > BODY_MAX) throw tooLong();
      const links = handoffLinks(list, subject, body);
      // Encoded, a body in Hindi is up to nine times its length: the Gmail link (the longer of the two) must still open.
      if (links.gmail.length > LINK_MAX) throw tooLong();
      // No address: Gmail opens with To empty; a mailto: with no address is no fallback.
      const open: Handoff = { url: links.gmail, label: "Open in Gmail", ...(list.length ? { fallback: links.mailto } : {}), words: { say: "mail.done", open: "mail.open" } };
      return {
        ok: true, open,
        text: `Gmail is open with the email${list.length ? ` to ${list.join(", ")}` : ""} written. Nothing is sent until they press Send.`,
      };
    },
  };
}
