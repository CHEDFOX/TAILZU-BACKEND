/**
 * A PERSON TALKING TO XODE ABOUT A REAL PROJECT, STEP BY STEP, THROUGH THE PRODUCT'S OWN FRONT DOOR.
 *
 *   npx tsx e2e/conversation.ts [--cap-inr 80] [--task changesets-bug-e522996]
 *
 * One rig (adapters/rig.ts: the real code bot over a local GitHub, a local runner and the real model door), one real project put on it, and a
 * conversation a person would have: what is this, how does a part work, a follow-up, "??", a bug report that becomes a job, the job's live steps,
 * what it changed, the merge, and a question after the merge. Every message goes through createFront().ask, the way POST /v1/ask sends it, with the
 * project and the chat thread the app sends. A job is driven the way the app's person drives it: an approval is given, a question is answered.
 *
 * At the end the task's hidden test (written by the project's own maintainers for this bug, never shown to the bot) is run on what the job changed:
 * the one check that is not the bot's opinion of itself. A transcript is written to e2e/out/conversation/.
 *
 * It spends real money: it stops before a message once the cap is reached. It needs OPENROUTER_API_KEY.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { E2E_DIR, realKey } from "./env.js";
import { createRig, USER, type Rig } from "./adapters/rig.js";
import { keyProblem } from "./adapters/upstream.js";
import { loadTasks, type Task } from "./tasks/schema.js";
import { runHidden } from "./score/hidden.js";
import { createFront } from "../src/front/index.js";
import type { FrontCtx, Turn } from "../src/front/types.js";
import { MemoryThreadStore } from "../src/code/chat/threads.js";
import { buildProjectBrain } from "../src/code/project/index.js";
import { isEnded } from "../src/code/jobs/types.js";
import { stateOf } from "../src/code/agent/types.js";

const arg = (name: string, d: string): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const CAP_PAISE = Math.round(Number(arg("cap-inr", "80")) * 100);
const TASK_ID = arg("task", "changesets-bug-e522996");
const JOB_TIMEOUT_MS = Number(arg("job-minutes", "25")) * 60_000;
/** What the project brain may spend summarising the repo when it is added: the product's own default (CODE_IMPORT_BUDGET_PAISE, ₹10) unless said. */
const BRAIN_PAISE = Math.round(Number(arg("brain-inr", "10")) * 100);
const OUT = path.join(E2E_DIR, "out", "conversation");

/**
 * What the person says, in order, per task. `after: "merge"` merges the last job's branch on GitHub first; `whileJob` is said while the last job is
 * still working (after it has started on the code), the way a person checks in; the job is then followed to its end before the next step.
 */
interface Step { say: string; after?: "merge"; whileJob?: boolean }
const SCRIPTS: Record<string, Step[]> = {
  "changesets-bug-e522996": [
    { say: "hi! I just connected this repo. what is it, in a few lines?" },
    { say: "how does it check the config file? where's that code?" },
    { say: "and for the fixed and linked groups, what rules does it check?" },
    { say: "??" },
    { say: "hmm I think there's a bug. with fixed: [[\"pkg-a\"], [\"pkg-a\"], [\"pkg-b\"]] the \"pkg-a is defined in multiple groups\" error shows up twice. can you fix it?" },
    { say: "what did you change, and how do you know it works?" },
    { say: "looks good, I merged it. is the 3-group case covered by a test now?", after: "merge" },
  ],
  "commander-feat-deprecated-option": [
    { say: "what does this library do, briefly?" },
    { say: "how does an option get declared, and how does the help print an option's line? point me at the code" },
    { say: "and where are the TypeScript typings for Option?" },
    { say: "I want to retire some options gently. add Option#deprecated(message?), returning the option so it chains. "
      + "a deprecated option still works exactly as before, but when it's given on the command line write ONE warning per parse to the command's writeErr: "
      + "`warning: option '<flags>' is deprecated: <message>` plus a newline, or `warning: option '<flags>' is deprecated` when there's no message, flags as declared (like `--old-name <value>`). "
      + "not an error, the action still runs. no warning when the value only comes from a default or an env var. it has to work for subcommand options too. "
      + "in the help, the option's line should say `deprecated` next to the default/env info. and add it to the typings." },
    { say: "how's it going? anything tricky so far?", whileJob: true },
    { say: "what did you change, and how did you check the help output and the subcommand case?" },
    { say: "merged, thanks. is there a test for the env var case, where no warning should show?", after: "merge" },
  ],
  "express-bug-trust-proxy-hops": [
    { say: "a customer says req.ip can be spoofed behind their load balancer. how does express work out req.ip?" },
    { say: "and where does the 'trust proxy' hop count get used?" },
    { say: "??" },
    { say: "they run behind exactly one load balancer with app.set('trust proxy', 1). the client sends its own X-Forwarded-For: 6.6.6.6, the LB appends the real address, "
      + "so the app gets '6.6.6.6, <real address>' and req.ip comes out 6.6.6.6. req.ips lists the spoofed one too. find out why and fix it please" },
    { say: "is it in our code or in proxy-addr?", whileJob: true },
    { say: "so what was the actual cause, in plain words?" },
    { say: "merged. is the one-hop case covered by a test now, and would two hops still work?", after: "merge" },
  ],
};
// Python, and a person who starts with chat, sets it up, then reports a bug in their own words: the job is the fix, judged by flask's own hidden test.
SCRIPTS["flask-bug-7203fea"] = [
  { say: "hey! just connected this. what is it, in a few lines?" },
  { say: "how do I set it up locally and run its tests?" },
  { say: "how does app.run decide which host and port to use? where's that code?" },
  { say: "??" },
  { say: "bug: we set SERVER_NAME = \"[::1]:8080\" and app.run() crashes with ValueError: invalid literal for int() with base 10: ':1]:8080'. "
    + "IPv6 addresses have colons in them. can you fix it so IPv6 server names work, with or without a port?" },
  { say: "is the problem in flask or in werkzeug?", whileJob: true },
  { say: "what did you change, and how do you know it works?" },
  { say: "merged, thanks. does an IPv4 one like 127.0.0.1:5000 still work the same?", after: "merge" },
];
const SCRIPT: Step[] = SCRIPTS[TASK_ID] ?? [];

const lines: string[] = [];
const toppedUp = new Set<string>();
let promptsOut: string[] = [];
const out = (s = ""): void => { lines.push(s); console.log(s); };
const rupees = (p: number): string => `₹${(p / 100).toFixed(2)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const indent = (s: string, n = 2): string => s.split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");

async function main(): Promise<void> {
  if (!realKey) throw new Error("OPENROUTER_API_KEY is not set.");
  const refused = await keyProblem(realKey);
  if (refused) throw new Error(`The model key was refused: ${refused}`);
  const task = loadTasks().find((t) => t.id === TASK_ID);
  if (!task) throw new Error(`No task ${TASK_ID}.`);
  if (!SCRIPT.length) throw new Error(`No conversation written for ${TASK_ID}: add one to SCRIPTS.`);

  const t0 = Date.now();
  out(`# Xode, a real conversation: ${task.repo} (${TASK_ID})`);
  out(`Started ${new Date(t0).toISOString()}. Cap ${rupees(CAP_PAISE)}.`);
  out();
  const rig = await createRig({ mode: "real", brainBudgetPaise: BRAIN_PAISE, room: true, log: (m) => { if (/^warn /.test(m)) console.error(m); } });
  let spent = 0;
  try {
    const h = await rig.addProjectFor(task, task.repo);
    const brainPaise = Math.ceil(rig.kit.logs.reduce((n, l) => n + l.paise, 0));
    out(`Project added: ${h.project.fullName} at ${h.baseSha.slice(0, 10)} (the project brain was built, as when a person connects a repo; its summaries cost ${rupees(brainPaise)}).`);
    out();

    const threads = new MemoryThreadStore();
    // What the answering model is sent, kept beside the transcript: a strange answer is read against its prompt.
    const prompts: string[] = [];
    const call = (async (input: { purpose: string; messages: Array<{ role: string; content: unknown }> }) => {
      if (/^front\.(code_answer|reply)$/.test(input.purpose)) prompts.push(`### ${input.purpose}\n${input.messages.map((m) => `[${m.role}]\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n")}`);
      return rig.kit.call(input as never);
    }) as typeof rig.kit.call;
    promptsOut = prompts;
    const front = createFront({
      force: true, code: rig.code, jobs: rig.jobs, agent: rig.orch, call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}),
      threads, personal: async () => [],
    })!;
    const threadId = randomUUID();
    let lastJob: { id: string; branch: string } | null = null;
    let pendingJob: { following: Promise<number>; id: string; branch: string } | null = null;

    for (const [i, step] of SCRIPT.entries()) {
      if (spent >= CAP_PAISE) { out(`(stopped before step ${i + 1}: ${rupees(spent)} spent, the cap is ${rupees(CAP_PAISE)})`); break; }
      if (step.after === "merge") {
        if (!lastJob) { out("(nothing to merge: no job ran)"); continue; }
        const head = await h.repo.head(lastJob.branch);
        const main = await h.repo.head(h.repo.defaultBranch);
        if (!head || head === main) out("[nothing was committed on the branch, so there is nothing to merge]");
        else if (main) {
          await h.repo.setRef(h.repo.defaultBranch, head, main);
          // GitHub's push webhook brings the brain up to date; the person merged on GitHub.
          await buildProjectBrain(rig.code.brain!.runtime, USER, h.project.id);
          out(`[the person merges ${lastJob.branch} into ${h.repo.defaultBranch} on GitHub]`);
          out();
        }
      }
      // As POST /v1/ask: the Xode chat sends no turns, and the thread it names says what was asked last (routes/ask/front.ts).
      const recent: Turn[] = [];
      const kept = await threads.get(USER, h.project.id, threadId).catch(() => null);
      if (kept?.lastQuestion) recent.push({ said: kept.lastQuestion, did: "code_question" });
      const ctx: FrontCtx = {
        userId: USER, plan: "paid", device: "desktop", mode: "text", visuals: "auto", projectId: h.project.id, threadId, recent, attachments: [],
      };
      out(`## ${i + 1}. You: ${step.say}`);
      const at = Date.now();
      const callsBefore = rig.kit.logs.length;
      let r;
      try {
        r = await front.ask(step.say, ctx);
      } catch (err) {
        out(`Xode failed: ${(err as Error).message}`);
        out();
        continue;
      }
      spent += r.result.paise;
      const d = r.decision;
      out(`   (read as ${d.intent} → ${d.route}${d.followUp ? `, a follow-up to "${d.followUp.slice(0, 60)}"` : ""}${d.reask ? `, a reaction said as "${d.reask.slice(0, 60)}"` : ""}; ${secs(Date.now() - at)}, ${rupees(r.result.paise)})`);
      if (r.result.text) out(`Xode:\n${indent(r.result.text.trim())}`);
      if (r.result.clarify) out(`Xode asks: ${JSON.stringify(r.result.clarify).slice(0, 400)}`);
      for (const n of r.result.notes) out(`   note: ${n}`);
      for (const l of rig.kit.logs.slice(callsBefore)) out(`   call: ${l.purpose} ${l.model} ${l.completionTokens} out, ${secs(l.ms)}${l.ok ? "" : ` FAILED ${l.error ?? ""}`}`);

      if (r.result.job) {
        lastJob = { id: r.result.job.id, branch: r.result.job.branch };
        const job = r.result.job;
        out(`Xode started a job on ${job.branch} (budget ${rupees(job.budgetPaise)}). Its steps, as the app shows them:`);
        const following = followJob(rig, job.id);
        const next = SCRIPT[i + 1];
        if (next?.whileJob) {
          // The person checks in once the job is at work on the code, and the job's steps go on beside the answer.
          await waitForWork(rig, job.id);
          pendingJob = { following, id: job.id, branch: job.branch };
          continue;
        }
        spent += await following;
        await report(rig, h, task, job.id, job.branch);
      }
      if (pendingJob && step.whileJob) {
        out("   (said while the job was still working)");
        spent += await pendingJob.following;
        await report(rig, h, task, pendingJob.id, pendingJob.branch);
        pendingJob = null;
      }
      out();
      out(`   running total ${rupees(spent)}`);
      out();
    }
    out(`Done in ${secs(Date.now() - t0)}. Spent ${rupees(spent)} in all (the brain's summaries not counted).`);
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${TASK_ID}-${new Date(t0).toISOString().replace(/[:.]/g, "-")}.md`);
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    fs.writeFileSync(file.replace(/\.md$/, ".prompts.txt"), promptsOut.join("\n\n"));
    console.log(`\nTranscript: ${path.relative(process.cwd(), file)}`);
    await rig.dispose();
  }
}

/** Until the job has started on the code (its first read or edit after the baseline), or ended, or two minutes. */
async function waitForWork(rig: Rig, jobId: string): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const entries = await rig.workLogOf(jobId).catch(() => []);
    if (entries.some((e) => e.kind === "edit") || isEnded((await rig.jobNow(jobId)).state)) return;
    await rig.sleep(1000);
  }
}

/** Plays the person until the job ends, printing its work log as it grows. Returns what the job spent. */
async function followJob(rig: Rig, jobId: string): Promise<number> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let shown = 0;
  const handled = new Set<string>();
  const start = Date.now();
  for (;;) {
    const entries = await rig.workLogOf(jobId).catch(() => []);
    for (const e of entries.slice(shown)) out(`   [${secs(e.at - start).padStart(7)}] ${e.kind}: ${e.text.replace(/\s+/g, " ").slice(0, 220)}`);
    shown = entries.length;
    const j = await rig.jobNow(jobId);
    if (isEnded(j.state)) break;
    if (Date.now() > deadline) { out("   (the job ran past the time allowed; stopping it)"); await rig.orch.stopJob(USER, jobId).catch(() => undefined); break; }
    if (j.state === "waiting_for_you") {
      const sig = `${j.waitingOn}:${j.updatedAt}`;
      if (!handled.has(sig)) {
        handled.add(sig);
        const view = await rig.orch.view(USER, jobId).catch(() => null);
        const w = view?.agent?.waiting as { kind?: string; question?: string; for?: string } | undefined;
        if (j.waitingOn === "answer") {
          out(`   Xode asks: ${w?.question ?? "?"}`);
          out("   You: go with what you think is right, keep it small.");
          await rig.orch.answer(USER, jobId, "go with what you think is right, keep it small.");
        } else if (j.waitingOn === "approval") {
          out(`   Xode asks for an OK (${w?.for ?? "approval"}). You: ok, go ahead.`);
          const asked = await rig.orch.approve(USER, jobId);
          if ("needsApproval" in asked) await rig.orch.approve(USER, jobId, asked.approvalId);
        } else if (j.waitingOn === "commit") {
          out("   Xode asks to commit. You: yes.");
          const asked = await rig.jobs.approveCommit(USER, jobId);
          if ("needsApproval" in asked && asked.needsApproval) await rig.jobs.approveCommit(USER, jobId, (asked as { approvalId: string }).approvalId);
        } else if (j.waitingOn === "budget") {
          // A person says "keep going" once, the way the report asks; a second time they stop.
          if (!toppedUp.has(jobId)) {
            toppedUp.add(jobId);
            out("   Xode ran out of budget. You: keep going (₹10 more).");
            await rig.orch.addBudget(USER, jobId, 1000);
          } else {
            out("   Xode ran out of budget again. You: stop there.");
            await rig.orch.stopJob(USER, jobId);
          }
        } else if (j.waitingOn === "paid") {
          await rig.jobs.approvePaid(USER, jobId).catch(() => undefined);
        }
      }
    }
    await rig.sleep(500);
  }
  await rig.orch.idle().catch(() => undefined);
  const entries = await rig.workLogOf(jobId).catch(() => []);
  for (const e of entries.slice(shown)) out(`   [${secs(e.at - start).padStart(7)}] ${e.kind}: ${e.text.replace(/\s+/g, " ").slice(0, 220)}`);
  return (await rig.jobNow(jobId)).spentPaise;
}

/** What the job ended with: its report, the diff on the branch, the pull request, and the maintainers' hidden test on it. */
async function report(rig: Rig, h: Awaited<ReturnType<Rig["addProjectFor"]>>, task: Task, jobId: string, branch: string): Promise<void> {
  const j = await rig.jobNow(jobId);
  const s = stateOf(j.checkpoint);
  out();
  out(`Job ended: ${j.state}${j.reason ? ` (${j.reason})` : ""}; spent ${rupees(j.spentPaise)}; ${s?.work.turns ?? 0} model turns, ${s?.work.fixRounds ?? 0} fix rounds; models: ${[...new Set(rig.kit.logs.filter((l) => /work|agent/.test(l.purpose) && l.ok).map((l) => l.model))].join(", ") || "?"}.`);
  if (s?.verify) out(`Checks: ${s.verify.summary}`);
  if (s?.report?.text) out(`Xode's report:\n${indent(s.report.text.trim())}`);
  const head = await h.repo.head(branch);
  if (!head || head === h.baseSha) { out("No commit on the branch."); return; }
  const changed = await h.repo.changedFiles(h.baseSha, head);
  out(`Files changed: ${changed.map((c) => `${c.status} ${c.path}`).join(", ")}`);
  const diff = await h.repo.g(["diff", h.baseSha, head]);
  out("```diff");
  out(diff.length > 6000 ? `${diff.slice(0, 6000)}\n… (${diff.length - 6000} more characters)` : diff.trimEnd());
  out("```");
  const pr = h.repo.pullFor(branch);
  if (pr) out(`Pull request #${pr.number}: ${pr.title}${pr.draft ? " (draft)" : ""}`);
  const changes: Record<string, string | null> = {};
  for (const c of changed) changes[c.path] = c.status.startsWith("D") ? null : await h.repo.fileAt(head, c.path);
  const hidden = await runHidden(task, changes).catch((err) => ({ ran: false, passed: false, why: (err as Error).message, run: null }));
  out(`Maintainers' hidden test on this change: ${hidden.ran ? (hidden.passed ? "PASSED" : `FAILED (${hidden.why})`) : `did not run (${hidden.why})`}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
