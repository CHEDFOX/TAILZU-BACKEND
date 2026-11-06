/**
 * STEPS 2 AND 3'S BUTTONS (planEase.ts PLAN_ACTS; docs/plan-ease.md "Buttons"). Each answers from the page, the widget and a
 * notification alike, through the one act door (POST /v1/widgets/act), so an answer anywhere is gone everywhere at the next read.
 *
 *   pt:<task>  paid / unpaid      a bill's round tick, and Paid on its push (a monthly bill's next one is made then, with no amount)
 *   pc:<id>    addall / undo      a capture's Add all (a push's adds the sure ones it named), and the page's Undo for 10 seconds
 *   pc:<id>    takeout            "Take out all 4 from the circular", from any one of them
 *   pl:offer   no / unno          "No thanks" to the work calendar offer (kept for ever), and its Undo
 */
import { ok, no } from "../widgets/act.js";
import type { PlanAct } from "./planEase.js";
import { planCapture } from "./planCapture.js";
import { LINK_NO } from "./planInCards.js";

const off = () => no(404, "off", "That isn't there any more.");

export const PLAN_IN_ACTS: Record<string, Record<string, PlanAct>> = {
  pt: {
    paid: {
      scope: "task.done",
      run: async (p, u, i) => {
        if (i.kind !== "pt") return no(400, "bad_request", "That can only be opened.");
        const c = planCapture();
        if (c) await c.paid(u, i.taskId, true); else await p.calendar.tickTask(u, i.taskId, true);
        return ok("paid");
      },
    },
    unpaid: {
      scope: "task.done",
      run: async (p, u, i) => {
        if (i.kind !== "pt") return no(400, "bad_request", "That can only be opened.");
        const c = planCapture();
        if (c) await c.paid(u, i.taskId, false); else await p.calendar.tickTask(u, i.taskId, false);
        return ok("undone");
      },
    },
  },
  pc: {
    addall: {
      scope: "needs.answer",
      run: async (_p, u, i) => {
        const c = planCapture();
        if (!c || i.kind !== "pc") return off();
        const r = await c.addAll(u, i.captureId);
        return ok("added", { message: r.line, n: r.n });
      },
    },
    undo: {
      scope: "session",
      run: async (_p, u, i) => {
        const c = planCapture();
        if (!c || i.kind !== "pc") return off();
        await c.undo(u, i.captureId);
        return ok("undone");
      },
    },
    takeout: {
      scope: "session",
      run: async (_p, u, i) => {
        const c = planCapture();
        if (!c || i.kind !== "pc") return off();
        const n = await c.takeOut(u, i.captureId);
        return ok("taken out", { message: n === 1 ? "Taken out" : `Took out all ${n}` });
      },
    },
  },
  pl: {
    no: {
      scope: "session",
      run: async (p, u, i) => {
        if (i.kind !== "pl" || i.linkId !== "offer") return no(400, "bad_request", "That can only be opened.");
        await p.answers.upsert({ user_id: u, key: LINK_NO, at_ms: Date.now() }, ["user_id", "key"]);
        return ok("kept");
      },
    },
    unno: {
      scope: "session",
      run: async (p, u, i) => {
        if (i.kind !== "pl" || i.linkId !== "offer") return no(400, "bad_request", "That can only be opened.");
        await p.answers.remove({ user_id: u, key: LINK_NO });
        return ok("undone");
      },
    },
  },
};
