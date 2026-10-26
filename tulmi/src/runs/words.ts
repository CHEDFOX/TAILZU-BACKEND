/**
 * A RUN'S LAST WORD: one line for the person on how it ended, in English or
 * Hinglish (the two voices of connectors/words.ts, written the same way).
 *
 * The line goes on the receipt and on the You tab's Activity card, so it says
 * what happened and never what was asked: no app's text, no names, no
 * amounts. One line per reason; a run with no reason says how it ended. A
 * run that did part of the job says so first, then why it stopped.
 */
import { isHinglish } from "../connectors/words.js";
import type { RunReason, RunState } from "./types.js";

type Lines = Record<RunState | RunReason | "partial_lead", string>;

export const RUN_EN: Lines = {
  running: "Working on it.",
  done: "Done.",
  partial: "Part of it is done, not all of it.",
  partial_lead: "Part of it is done.",
  failed: "That didn’t work.",
  needs_you: "Waiting for you.",
  cancelled: "Stopped.",
  question: "Waiting for your answer.",
  approval: "Waiting for your OK.",
  handoff: "It’s ready in the other app for you to finish.",
  nothing_usable: "I couldn’t work out how to do that.",
  invalid_args: "I couldn’t fill that in. Try saying it another way.",
  desk_only: "That can’t be done from here.",
  model_unavailable: "I couldn’t think just then. Try again in a moment.",
  internal: "Something went wrong on my side.",
  no_speech: "I didn’t catch that.",
  private: "I don’t read private windows or sensitive apps.",
  too_many_steps: "That took too many steps, so I stopped.",
  bad_target: "I couldn’t find what to act on.",
  needs_reconnect: "An app needs you to sign in again.",
  not_connected: "That app isn’t connected.",
  blocked: "Your settings don’t let me do that there.",
  app_timeout: "The app took too long to answer.",
  app_unreachable: "I couldn’t reach the app.",
  app_error: "The app ran into a problem.",
  stopped: "I couldn’t finish that.",
  stuck: "This stopped before it finished.",
  denied: "You said no.",
  expired: "That waited too long for your OK.",
  unanswered: "No answer came, so I stopped.",
  device_stopped: "Stopped on your computer.",
  hung_up: "You stopped it.",
};

export const RUN_HG: Lines = {
  running: "Kaam chal raha hai.",
  done: "Ho gaya.",
  partial: "Kuch kaam ho gaya, sab nahi.",
  partial_lead: "Kuch kaam ho gaya.",
  failed: "Yeh nahi ho paaya.",
  needs_you: "Tumhara intezaar hai.",
  cancelled: "Ruk gaya.",
  question: "Tumhare jawab ka intezaar hai.",
  approval: "Tumhare OK ka intezaar hai.",
  handoff: "Doosre app mein taiyaar hai, wahan poora karo.",
  nothing_usable: "Samajh nahi aaya yeh kaise karun.",
  invalid_args: "Yeh bhar nahi paaya. Kisi aur tarah se bolo.",
  desk_only: "Yeh yahan se nahi ho sakta.",
  model_unavailable: "Abhi soch nahi paaya. Thodi der mein phir try karo.",
  internal: "Meri taraf kuch gadbad ho gayi.",
  no_speech: "Main sun nahi paaya.",
  private: "Main private windows aur sensitive apps nahi padhta.",
  too_many_steps: "Bahut steps lag gaye, isliye ruk gaya.",
  bad_target: "Jis cheez pe karna tha, woh nahi mili.",
  needs_reconnect: "Ek app mein phir se sign in karna hoga.",
  not_connected: "Woh app connected nahi hai.",
  blocked: "Tumhari settings wahan iski ijaazat nahi deti.",
  app_timeout: "App ne jawab dene mein bahut der lagayi.",
  app_unreachable: "App tak pahunch nahi paaya.",
  app_error: "App mein kuch problem aa gayi.",
  stopped: "Yeh poora nahi kar paaya.",
  stuck: "Yeh khatam hone se pehle ruk gaya.",
  denied: "Tumne mana kar diya.",
  expired: "Tumhare OK ka bahut der intezaar kiya.",
  unanswered: "Jawab nahi aaya, isliye ruk gaya.",
  device_stopped: "Computer pe ruk gaya.",
  hung_up: "Tumne rok diya.",
};

/** The line for a run that ended this way, for this reason, in their language. */
export function receiptLine(state: RunState, reason: RunReason | undefined, language?: string): string {
  const t = isHinglish(language) ? RUN_HG : RUN_EN;
  // A handoff is a run done the only way it can be; anything else plainly done is just done.
  if (state === "done") return reason === "handoff" ? t.handoff : reason === "denied" ? t.denied : t.done;
  if (state === "running") return t.running;
  if (!reason) return t[state];
  return state === "partial" ? `${t.partial_lead} ${t[reason]}` : t[reason];
}
