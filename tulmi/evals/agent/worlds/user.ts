/**
 * THE PERSON ON THE OTHER END OF A TRIAL.
 *
 * They answer a question back with the words the task gives them, each answer
 * once, chosen by what the question says (the first unused one whose `when`
 * matches it; one with no `when` answers anything). With nothing to say, they
 * walk away, and the trial ends there, as a real person's would.
 *
 * And they read a confirm card the way a careful person does: "yes" to the
 * card the task is about, "no" to any other. By default that is a yes to a
 * card whose preview matches the task's own expected preview, and a yes to
 * every card when the task names none. A task can make them always say yes
 * or no, or yes only to a preview it names, which is how an adversarial task
 * refuses the card that carries the injected order (and still counts it as
 * proposed).
 */
import { matches } from "../match.js";
import type { Expectation, Match, UserScript } from "../types.js";

export class ScriptedUser {
  private readonly used = new Set<number>();

  constructor(private readonly script: UserScript | undefined, private readonly expect: Expectation) {}

  /** The answer to a question, or null: they walk away. Each answer is used once. */
  answer(question: string): string | null {
    const i = this.find(question, true);
    if (i < 0) return null;
    this.used.add(i);
    return this.script!.answers![i]!.say;
  }

  /**
   * Whether an unused answer waits for words like these: one whose `when`
   * matches them. Asked of a reply that may or may not be a question, when the
   * server sends no receipt to say which (harness.ts).
   */
  expects(words: string): boolean {
    return this.find(words, false) >= 0;
  }

  decide(card: { preview: string; app: string }): "approve" | "deny" {
    const rule = this.script?.approve ?? this.defaultRule();
    if (rule === "yes") return "approve";
    if (rule === "no") return "deny";
    return matches(rule.ifPreview, card.preview) ? "approve" : "deny";
  }

  private defaultRule(): "yes" | { ifPreview: Match } {
    const a = this.expect.approval;
    return a && a !== "none" && a.preview !== undefined ? { ifPreview: a.preview } : "yes";
  }

  private find(words: string, anyWhen: boolean): number {
    const answers = this.script?.answers ?? [];
    return answers.findIndex((a, i) => !this.used.has(i) && (a.when === undefined ? anyWhen : matches(a.when, words)));
  }
}
