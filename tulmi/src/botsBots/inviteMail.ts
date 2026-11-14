/**
 * THE INVITE MAIL, AS ONE PURE FUNCTION (docs: perms §3.2).
 *
 *   inviteMail({ from, space, email, joinCode, link })  -> { sender, subject, text }
 *
 * `Spaces.inviteEmail` writes the outbox row with this, and the Invite screens show the person what they are about to send with
 * the very same call. App Review 5.1.2(v) asks for "a clear description of how the message will appear to the recipient before
 * sending it (for example, What will the message say? Who will appear to be the sender?)", and one function is the only way the
 * preview and the mail cannot drift apart: a change to the words changes both, and the test compares the body, not just the
 * subject.
 *
 * `email` is the address the mail is addressed to, which the body repeats ("sign in with this email"). The preview passes the
 * words "their email", because nothing is typed yet and nothing has been sent.
 *
 * Pure. Nothing here reads the environment, a store or a model.
 */

/** What goes into one invite mail. A draft space has no name yet, so `space` is "their space" there, as it always was. */
export interface InviteMailIn {
  /** The admin, as the recipient reads it ("Asha"). */
  from: string;
  /** The space's name, or "their space" while a draft is unnamed. */
  space: string;
  /** The address the invite is for, or, in the preview, the words standing in for it. */
  email: string;
  /** The space's own standing code, already shown 3-3 ("7KQ-29D"). */
  joinCode: string;
  /** Where to get X0 Bot, with the code in it. */
  link: string;
  /** The one line every member agrees to, so the invite says it before anyone joins (spacePerms.ts ADMIN_LINE_THERE). */
  adminLine: string;
}

export interface InviteMailOut {
  /** How the sender appears to the recipient: the display name and address of MAIL_FROM, and whose invite it is. */
  sender: string;
  subject: string;
  text: string;
}

/** The sender as the recipient sees it: "X0 Bot (noreply@x0bot.com), for Asha". */
export function inviteSender(mailFrom: string, from: string): string {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(mailFrom);
  const who = m ? `${m[1] || "X0 Bot"} (${m[2]})` : mailFrom.trim();
  return from ? `${who}, for ${from}` : who;
}

/** The subject and the body of an invite. The mail and the preview both come from here. */
export function inviteMail(o: InviteMailIn): Omit<InviteMailOut, "sender"> {
  return {
    subject: `${o.from} invited you to ${o.space} on X0 Bot`,
    text: [
      `${o.from} invited you to ${o.space} on X0 Bot.`,
      `Sign in to X0 Bot with this email (${o.email}) and the invite is waiting: open Spaces, tap your bot, and tap Accept.`,
      `Signing in with another email? Open Spaces, tap your bot, and type this code: ${o.joinCode}. ${o.from} will let you in.`,
      o.adminLine,
      `Get X0 Bot: ${o.link}`,
      "If you weren't expecting this, you can ignore it.",
    ].join("\n\n"),
  };
}
