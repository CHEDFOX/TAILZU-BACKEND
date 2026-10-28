/**
 * THE NEW-PROJECT QUESTIONS, ONE TAP AWAY (bots.code.new): quick answers for the intake's questions (code/newproject
 * intake.ts asks them in words), and how the picked ones become the answer the intake reads. Pure.
 *
 * The intake reads words, so a pick is sent as words ("Website, Phone app"): its own reading (answeredBy) and the spec
 * writer take them like anything typed. A question with no quick answers is typed.
 */

export interface QuickAnswer { label: string; value: string; sub?: string }

/** Quick answers by question id (code/newproject QUESTION_IDS). Multi: several can be picked. */
export const QUICK: Partial<Record<string, { multi: boolean; options: QuickAnswer[] }>> = {
  platforms: {
    multi: true,
    options: [
      { label: "Phone app", value: "a phone app (one that can be added to the home screen)", sub: "Sits on their home screen like an app. No app store wait." },
      { label: "Website", value: "a website", sub: "Opens from any phone or laptop. Nothing to install." },
      { label: "WhatsApp link", value: "a link people open from WhatsApp chats", sub: "A link you send in chats. Opens the same page." },
      { label: "Desktop app", value: "a desktop app" },
    ],
  },
  constraints: {
    multi: true,
    options: [
      { label: "Free hosting", value: "free hosting only" },
      { label: "Keep it cheap", value: "a small monthly budget" },
      { label: "No preference", value: "no preference: you decide" },
    ],
  },
};

/** The answer the intake is sent: the picks' words joined, then whatever was typed. Empty when there is neither. */
export function answerText(questionId: string, picks: Record<string, unknown> | undefined, typed: string | undefined): string {
  const q = QUICK[questionId];
  const chosen = q ? q.options.filter((o) => picks?.[slugOf(o.label)] === true).map((o) => o.value) : [];
  const words = (typed ?? "").trim();
  return [chosen.join(", "), words].filter(Boolean).join(". ").slice(0, 1500);
}

/** A quick answer's key in the screen's state ("phone-app"). */
export const slugOf = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A question in a few words, for the plan's "Still to decide" and the answered list. */
export const SHORT: Record<string, string> = {
  what: "Who it's for",
  platforms: "Where people use it",
  features: "What the first version does",
  constraints: "Budget and hosting",
  examples: "Apps to take after",
};
