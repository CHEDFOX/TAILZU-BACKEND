/**
 * THE CALL JUDGE'S WIRING, AT BOOT (PLAN_CALL_JUDGE; botsBots/planCallJudge.ts, docs/plan-call-judge.md). No route: the judge hears the
 * calendar's writes, keeps its verdicts, and rings through the call service's ringer (botsBots/planCallSeam.ts).
 *
 *   the calendar's change hook         every item written on the Plan is heard here (calendar/service.ts setChangeHook)
 *   setCallJudge                       the call service reads the verdict for a floor ring, a follow-through ring and the call's facts
 *   onAiConsentOff                     a person taking back their AI yes: every judgement of theirs is deleted
 *   start(log)                         the ring tick (every minute) and the fill (every 15)
 *
 * All four are undone on close. With the call service not installed yet, the judge judges and keeps, and its tick logs "no_ringer".
 */
import type { FastifyInstance } from "fastify";
import { calendarRows } from "../../calendar/store.js";
import { getConfig } from "../../config.js";
import { PlanCallJudge, type JudgeDeps } from "../../botsBots/planCallJudge.js";
import { judgementStore } from "../../botsBots/planCallJudgeStore.js";
import { callRinger, onAiConsentOff, setCallJudge } from "../../botsBots/planCallSeam.js";
import { serverReaders } from "../../botsBots/planCapture.js";
import type { PlanEase } from "../../botsBots/planEase.js";
import { planFollows } from "../../botsBots/planFollow.js";
import { followStores } from "../../botsBots/planFollowStore.js";
import { planPrefs } from "../../botsBots/planPrefs.js";
import { callsOn } from "../../botsBots/planSwitch.js";
import { aiAllowedFor } from "../../privacy/aiGate.js";
import { youStore } from "../../you/store.js";

/** The server's own deps: the calendar's rows, the judgement table, Plan Ease's text reader, the person's settings and yes. */
export function serverJudgeDeps(ease: Pick<PlanEase, "calendar">): JudgeDeps {
  const follows = planFollows();
  return {
    rows: calendarRows(), calendar: ease.calendar, table: judgementStore(), readers: serverReaders(), ringer: callRinger,
    flags: () => { const c = getConfig(); return { on: c.PLAN_CALL_JUDGE, allow: c.PLAN_CALL_JUDGE_ALLOW }; },
    callsOn,
    consent: (userId) => aiAllowedFor(userId),
    settings: (userId) => youStore().getSettings(userId),
    leaves: async (userId) => (await planPrefs().get(userId))?.leaves ?? [],
    followItem: async (followId) => { const [f] = await followStores().follows.select({ id: followId }, { limit: 1 }); return f?.item ?? null; },
    names: async (userId) => {
      try { return new Map([...(await follows.peopleOf(userId))].map(([id, name]) => [id, name.trim().split(/\s+/)[0] ?? ""])); } catch { return null; }
    },
  };
}

export function registerPlanCallJudge(app: FastifyInstance, o: { ease: Pick<PlanEase, "calendar"> }, deps: JudgeDeps = serverJudgeDeps(o.ease)): PlanCallJudge {
  const judge = new PlanCallJudge(deps);
  o.ease.calendar.setChangeHook((userId, ref, what) => judge.onChange(userId, ref, what));
  setCallJudge(judge);
  const offConsent = onAiConsentOff((userId) => judge.forget(userId));
  const stop = judge.start(app.log);
  app.addHook("onClose", async () => { stop(); o.ease.calendar.setChangeHook(null); setCallJudge(null); offConsent(); });
  return judge;
}
