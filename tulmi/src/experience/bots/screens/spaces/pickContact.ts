/**
 * "ADD FROM CONTACTS", THE ONE BUTTON ON BOTH INVITE SCREENS (docs: perms §3).
 *
 * It opens the PHONE'S OWN contact picker, which runs outside X0 Bot. No permission is asked, no usage string exists, and no
 * store form changes: the person taps one person and only that one email comes back, into `$state.email`, exactly as if they had
 * typed it. The address book is never read, uploaded, hashed or counted, and nothing is sent until they tap Send the invite.
 *
 * So there is NO card in front of it either. A card belongs before a system prompt (5.1.1(iv)); in front of a picker it is one
 * more step that buys the person nothing.
 *
 * Only a store build's phone that declares ContactPick1 and only while PERM_CONTACT_PICK is on (kit canPickContact). The window
 * and every older binary get the email field alone, exactly as today.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { button, canPickContact, type BotsCtx } from "../../kit.js";
import { CONTACTS } from "../permitWords.js";
import { toast } from "./parts.js";

export function pickContact(ctx: BotsCtx): Node[] {
  if (!canPickContact(ctx)) return [];
  const pick: ActionSpec = { kind: "contact.pick", assignTo: "email", onError: toast(CONTACTS.error, true) } as unknown as ActionSpec;
  return [button(CONTACTS.button, pick, { kind: "secondary", size: "md" })];
}
