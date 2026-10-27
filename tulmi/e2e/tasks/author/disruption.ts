/**
 * DISRUPTIONS: THINGS THAT HAPPEN TO A JOB ON THE WAY, AND WHAT IT DOES ABOUT THEM.
 *
 * A person says something while the job works; the server dies and another takes over from the last saved step; the money runs out and the person adds
 * some. Each is a real task with hidden tests, so the job must still get to the right result; the scenario is what is done to it on the way, and
 * `expectEvents` says it must be seen to have happened (a job that ended before the crash turn tested nothing, and says so).
 */
import type { Task } from "../schema.js";
import { baseText, existing, variant } from "./lib.js";

export async function tasks(): Promise<Task[]> {
  const readme = await baseText("zustand", "README.md");
  const logger = (await existing("zustand-feat-logger")).oracle.files ?? {};
  return [
    await variant("zustand-feat-logger", {
      id: "zustand-disrupt-person-adds", title: "The person adds a requirement mid-task", category: "disruption",
      tags: ["disruption", "flow", "message", "bakeoff"],
      scenario: { message: { afterTurn: 2, text: "One more thing: please also add a short section about the logger to the README." } },
      truth: { allowed: ["^README\\.md$", "^docs/", "^tests/"] },
      checks: { expectEvents: ["message"], mustContain: [{ path: "README.md", pattern: "logger" }], questions: { max: 1 } },
      oracle: { kind: "patch", files: { ...logger, "README.md": `${readme.trimEnd()}\n\n## Logger\n\nWrap a store in the \`logger\` middleware from \`zustand/middleware\` to see every change: \`create(logger((set) => ({ count: 0 }), { name: 'counter' }))\` calls \`console.log('[counter]', { prev, next })\` once per change.\n` } },
    }),
    await variant("express-feat-nocontent", {
      id: "express-disrupt-server-dies", title: "The server dies halfway and another takes the job", category: "disruption",
      tags: ["disruption", "flow", "crash", "bakeoff", "quick"],
      scenario: { crash: { afterTurn: 1 }, timeoutSec: 240 },
      checks: { expectEvents: ["crash"], questions: { max: 1 } },
    }),
    await variant("commander-feat-envprefix", {
      id: "commander-disrupt-budget-runs-out", title: "The budget runs out and the person adds some", category: "disruption",
      tags: ["disruption", "flow", "budget", "bakeoff"],
      scenario: { budget: { paise: 14, addPaise: 3000 } },
      budgetPaise: 14,
      checks: { expectEvents: ["budget"], questions: { max: 1 } },
    }),
  ];
}
