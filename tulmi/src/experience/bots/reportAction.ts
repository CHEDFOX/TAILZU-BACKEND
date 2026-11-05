/**
 * "REPORT" UNDER A BOT'S ANSWER (App Review 1.2: AI content creation apps must let people report what is made; 4.7.1 the same for
 * chatbots). It opens the report screen (screens/safety.ts bots.report) with the answer as the person saw it; the report goes into the
 * same queue as a reported message, acted on within 24 hours (src/botsBots/safety.ts, kind "answer").
 *
 *   link("Report", reportAnswer({ bot: "Plan Ease", text: answer, id: turn.id }))
 */
import type { ActionSpec } from "../../../../shared/types/sdui.js";
import { SCREENS } from "./kit.js";

export function reportAnswer(a: { bot: string; text: string; id?: string }): ActionSpec {
  return {
    kind: "navigate", screenId: SCREENS.report,
    params: { kind: "answer", bot: a.bot.slice(0, 40), text: a.text.slice(0, 4000), ...(a.id ? { id: a.id.slice(0, 80) } : {}) },
  } as ActionSpec;
}
