/**
 * THE CONFIRM CARD, built here and only drawn on the device.
 *
 * An `approve` event carries the card: its title, the exact words, what the
 * assistant will and won't do, the three buttons and the route each one calls.
 * The desktop's guide and the phone render it as it comes; neither has a word
 * or a URL of its own for it. Spoken in the person's voice (connectors/words):
 * English, or Hinglish for a Hinglish profile.
 */
import type { ApprovalCard } from "../../../shared/types/api.js";
import type { ApprovalView } from "./tasks.js";
import { wordsFor, type WordKey } from "./words.js";

const TITLE: Record<ApprovalView["risk"], WordKey> = {
  send: "a3.h.send", write: "a3.h.write", destructive: "a3.h.destructive", pay: "a3.h.pay",
  // A look in an app added by link, after another app answered: what is asked is what it is sent.
  read: "a3.h.read",
};
const LABEL: Partial<Record<ApprovalView["risk"], WordKey>> = { send: "a3.lab.send", read: "a3.lab.read" };

/** Ids in a route are the server's own (a task id is a UUID); anything else is not put in a path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function approvalCard(taskId: string, approval: ApprovalView, app: string, language?: string): ApprovalCard | undefined {
  if (!SAFE_ID.test(taskId)) return undefined;
  const w = wordsFor(language);
  const body = { approvalId: approval.id };
  return {
    title: w(TITLE[approval.risk] ?? "a3.h.write"),
    app,
    label: w(LABEL[approval.risk] ?? "a3.lab.other"),
    preview: approval.preview,
    note: w("a3.wwl", { app }),
    buttons: [
      { id: "approve", label: w("a3.ok"), call: { method: "POST", path: `/v1/tasks/${taskId}/approve`, body } },
      // Changing it is saying no to this one and being asked what to change.
      { id: "edit", label: w("a3.edit"), call: { method: "POST", path: `/v1/tasks/${taskId}/deny` }, then: "listen" },
      { id: "deny", label: w("a3.later"), call: { method: "POST", path: `/v1/tasks/${taskId}/deny` } },
    ],
    after: { done: w("a3.done"), left: w("a3.left"), failed: w("a3.failed"), change: w("a3.change") },
  };
}
