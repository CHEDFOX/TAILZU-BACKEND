/**
 * THE FRONT DOOR'S READ OF A MESSAGE IN A PROJECT'S CHAT, SCORED: WHAT IT DECIDES TO DO, ON LABELLED MESSAGES, WITH THE REAL SMALL MODEL.
 *
 *   npx tsx e2e/router-eval.ts [--out e2e/out/router-eval.md]
 *
 * In a project's chat (CODE_CHAT_AGENT) the router decides only what is done, and the one loop does the rest:
 *
 *   loop      anything said or asked: talk, a question, a plan, how to set it up, a reaction to the last answer
 *   change    a change to the project's files: the loop, marked, starts the job with what it finds
 *   ask       a change asked with nothing that says what ("fix it", no chat before): a question back
 *   design    a UI to make: the design road
 *   research  a question for the web: the loop, marked, researches it with the project in mind
 *   handoff   "make that change" after the chat laid one out: the job at once, with the chat's plan
 *
 * Each case is a message, sometimes after a turn of the chat, in English, Hinglish or Hindi; `ok` lists what is right for it (a request to see
 * code may be read as a change: the loop then shows it, which is right too). The report: accuracy, what each label was read as, every miss.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { createRig } from "./adapters/rig.js";
import { decide } from "../src/front/decide.js";
import type { Decision, FrontCtx } from "../src/front/types.js";

type Act = "loop" | "change" | "ask" | "design" | "research" | "handoff";
interface Case { say: string; ok: Act[]; before?: { q: string; a: string } }

const PLAN = { q: "the session cookie never expires", a: "Set maxAge in startSession at src/auth/session.ts:5 to a day, and clear it in endSession. Want me to make that change?" };
const ANSWER = { q: "where is the session cookie set?", a: "In startSession, src/auth/session.ts:3: res.cookie(\"sid\", token, { httpOnly: true })." };

const CASES: Case[] = [
  // talk, anywhere in a conversation
  { say: "thanks!", ok: ["loop"] }, { say: "good morning", ok: ["loop"] }, { say: "you're great, this helped a lot", ok: ["loop"], before: ANSWER },
  { say: "hmm ok", ok: ["loop"], before: ANSWER }, { say: "shukriya bhai", ok: ["loop"] }, { say: "kya haal hai", ok: ["loop"] },
  // questions about the project and its code
  { say: "what is this project for?", ok: ["loop"] }, { say: "where is the login handled?", ok: ["loop"] },
  { say: "how does the checkout talk to stripe?", ok: ["loop"] }, { say: "why is the cart page slow?", ok: ["loop"] },
  { say: "what would break if I rename startSession?", ok: ["loop"] }, { say: "login kaha handle hota hai?", ok: ["loop"] },
  { say: "यह प्रोजेक्ट किस लिए है?", ok: ["loop"] }, { say: "what changed lately?", ok: ["loop"] },
  // plans and advice
  { say: "What should we do", ok: ["loop"] }, { say: "plan the next two weeks of work", ok: ["loop"] },
  { say: "how should we structure the payments module?", ok: ["loop"] }, { say: "is this code good enough to launch?", ok: ["loop"] },
  // setting it up, running it, files to copy
  { say: "how do I run this locally?", ok: ["loop"] }, { say: "give me the vps setup commands", ok: ["loop"] },
  { say: "what env settings does the server need?", ok: ["loop"] }, { say: "give me the database migration code to copy paste", ok: ["loop", "change"] },
  { say: "show me the deploy script", ok: ["loop"] }, { say: "server pe deploy kaise karu?", ok: ["loop"] },
  // reactions to the last answer
  { say: "??", ok: ["loop"], before: ANSWER }, { say: "why?", ok: ["loop"], before: ANSWER }, { say: "explain simpler", ok: ["loop"], before: ANSWER },
  { say: "matlab?", ok: ["loop"], before: ANSWER },
  // clear changes
  { say: "add a dark mode toggle to the settings page", ok: ["change"] }, { say: "fix the bug where the cart total rounds wrong", ok: ["change"] },
  { say: "write tests for src/auth/session.ts", ok: ["change"] }, { say: "rename startSession to beginSession everywhere", ok: ["change"] },
  { say: "make the pill show how long it has been recording", ok: ["change"] }, { say: "cart me coupon field add karo", ok: ["change"] },
  { say: "upgrade react to the latest version", ok: ["change"] },
  // a change with nothing that says what
  { say: "fix it", ok: ["ask"] }, { say: "make it work", ok: ["ask"] }, { say: "theek karo", ok: ["ask"] },
  // after the chat laid out a change
  { say: "make that change", ok: ["handoff"], before: PLAN }, { say: "ok do it", ok: ["handoff"], before: PLAN }, { say: "haan isko badal do", ok: ["handoff"], before: PLAN },
  // a UI to make
  { say: "show me how a pricing page would look", ok: ["design"] }, { say: "design a settings screen for the app", ok: ["design"] },
  // the web
  { say: "what's the latest version of next.js?", ok: ["research", "loop"] }, { say: "which email provider is cheapest for 10k mails a month?", ok: ["research"] },
  { say: "compare supabase and firebase for this project", ok: ["research", "loop"] },
];

/** What the decision does, in the labels above. */
function actOf(d: Decision): Act | string {
  if (d.clarify) return "ask";
  if (d.route === "code_job") return d.handoff ? "handoff" : "job (not the loop)";
  if (d.route === "artifact") return "design";
  if (d.reasons.includes("agent_research")) return "research";
  if (d.reasons.includes("agent_change")) return "change";
  if (d.reasons.includes("agent_chat")) return "loop";
  return d.route;
}

async function main(): Promise<void> {
  const out = path.join("e2e", "out", "router-eval.md");
  const file = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : out;
  const rig = await createRig({ mode: "real", brainBudgetPaise: 0, room: false });
  const rows: string[] = [];
  const misses: string[] = [];
  const confusion = new Map<string, Map<string, number>>();
  let right = 0;
  try {
    for (const c of CASES) {
      const ctx: FrontCtx = {
        userId: "eval", plan: "paid", device: "desktop", mode: "text", visuals: "auto", projectId: "11111111-1111-4111-8111-111111111111", projectName: "alice/shop",
        projectAbout: "A small online shop with a cart, a checkout through Stripe and sessions kept in a cookie.",
        threadId: "22222222-2222-4222-8222-222222222222", recent: c.before ? [{ said: c.before.q, did: "code_question" }] : [], attachments: [],
        ...(c.before ? { lastAnswer: c.before.a } : {}),
      };
      const d = await decide(c.say, ctx, { call: rig.kit.call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}), agentChat: true });
      const act = actOf(d);
      const ok = (c.ok as string[]).includes(act);
      if (ok) right += 1; else misses.push(`- "${c.say}"${c.before ? " (after a turn)" : ""}: read as ${act} (${d.intent}, ${d.confidence}, via ${d.via}); right is ${c.ok.join(" or ")}`);
      const row = confusion.get(c.ok[0]!) ?? new Map<string, number>();
      row.set(act, (row.get(act) ?? 0) + 1);
      confusion.set(c.ok[0]!, row);
      rows.push(`| ${ok ? "✅" : "❌"} | ${c.say}${c.before ? " _(after a turn)_" : ""} | ${c.ok.join(" / ")} | ${act} | ${d.intent} ${d.confidence} ${d.via} |`);
      console.error(`${ok ? "PASS" : "FAIL"} ${c.say} -> ${act}`);
    }
  } finally {
    await rig.dispose();
  }
  const spent = Math.ceil(rig.kit.logs.reduce((n, l) => n + l.paise, 0));
  const lines = [
    `# The front door's read of a message in a project's chat (${new Date().toISOString().slice(0, 10)})`, "",
    `**${right} of ${CASES.length}** read right, with the real small model; ₹${(spent / 100).toFixed(2)} in all.`, "",
    "| Right is | What it was read as |", "|---|---|",
    ...[...confusion].map(([want, got]) => `| ${want} | ${[...got].map(([a, n]) => `${a} ${n}`).join(", ")} |`), "",
    ...(misses.length ? ["## Misses", "", ...misses, ""] : []),
    "## Every case", "", "| | Message | Right | Read as | The model's read |", "|---|---|---|---|---|", ...rows,
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  console.log(lines.slice(0, 16).join("\n"));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
