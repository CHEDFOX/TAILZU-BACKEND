/**
 * The Code bot's newProject screen.
 */

import type { Node, ScreenResponse, ActionRef } from "../../../../../../shared/types/sdui.js";
import { SHORT, QUICK, slugOf } from "../../../../botsCode/intake.js";
import {
  type BotsCtx, row, text, C, col, meta, back, call, SCREENS, sectionLabel, chips, secondaryButton, quietButton, open, title, page,
  primaryButton, seq, statusMark, grow, grid, box,
} from "../../kit.js";
import {
  type Project, cut, numberDot, MOSS, unreachable, toast, REFRESH, openUrl, boxedField, short, backButton, tickBox, withAside,
} from "./parts.js";

export interface IntakeView {
  project: { id: string; fullName: string };
  request: string; answers: Record<string, string>;
  questions: Array<{ id: string; ask: string; why: string }>; answered: string[]; state: string;
  spec?: { name: string; summary: string; platforms: string[]; features: string[] };
  stack?: { label: string; hosting: string; tier: string };
  milestones?: Array<{ k: number; title: string }>;
}

// ===================================================================== bots.code.new (NewProject / DNewProject)
export type NewData =
  | { kind: "pick"; projects: Project[] }
  | { kind: "intake"; v: IntakeView };

/** "The plan so far": what is decided (the answers, or the plan the answers made) and what is still to decide. */
function planSoFar(ctx: BotsCtx, v: IntakeView): Node[] {
  const desk = ctx.client === "desktop";
  const h2 = (s: string, extra?: Node) => row([text("##", { size: 13, color: C.idle, lineHeight: 18 }), text(s, { size: 13, weight: 600, lineHeight: 18 }), ...(extra ? [extra] : [])], { gap: 5 });
  const line = (s: string, color: string = C.grey70) => text(s, { size: 13, color, lineHeight: 18 });
  const blocks: Node[] = [];
  if (v.spec && v.stack) {
    blocks.push(col([text(v.spec.name, { size: desk ? 19 : 16, weight: 700, tracking: -0.3, lineHeight: 24 }), line(cut(v.spec.summary, 220))], { gap: 6 }));
    blocks.push(col([h2("Built with"), line(`${v.stack.label} · ${v.stack.tier === "free" ? "free hosting on " : "hosting on "}${v.stack.hosting}`)], { gap: 5 }));
    if (v.milestones?.length) {
      blocks.push(col([h2("Steps"), ...v.milestones.slice(0, 6).map((m, i) => row([numberDot(m.k, i === 0 ? "done" : "todo"), text(m.title, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10 })),
        meta("Each step ends with a pull request you check first.", { size: 12 })], { gap: 9 }));
    }
  } else {
    blocks.push(col([text(v.request ? cut(v.request, 80) : "Your idea", { size: desk ? 19 : 16, weight: 700, tracking: -0.3, lineHeight: 24 })], { gap: 6 }));
    const latest = v.answered[v.answered.length - 1];
    for (const id of v.answered) {
      const a = v.answers[id];
      if (!a) continue;
      blocks.push(col([h2(SHORT[id] ?? id, id === latest ? text("just added", { size: 11, weight: 500, color: MOSS, lineHeight: 15 }) : undefined), line(cut(a.replace("(no preference: you decide)", "You decide"), 160))],
        { gap: 5, ...(id === latest ? { borderLeftWidth: 2, borderLeftColor: MOSS, paddingLeft: 10 } : {}) }));
    }
    if (!v.answered.length) blocks.push(line("I write the plan here as you answer.", C.meta));
  }
  if (v.questions.length) blocks.push(col([h2("Still to decide"), line(v.questions.map((q) => SHORT[q.id] ?? q.ask).join(" · "), C.meta)], { gap: 5 }));
  return blocks;
}

export function newProject(ctx: BotsCtx, d: NewData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!d) return unreachable(ctx, "that project");
  const fromHome = back();

  // No project yet, or no idea yet: the idea, and where it lives.
  if (d.kind === "pick" || !d.v.request) {
    const projectId = d.kind === "intake" ? d.v.project.id : null;
    const projects = d.kind === "pick" ? d.projects : [];
    const target = projectId ?? "$state.where";
    const plan: ActionRef = {
      kind: "condition", if: { falsy: "idea" }, then: toast("Say what you want to build first"),
      else: projectId ? call("POST", `/v1/bots/code/projects/${projectId}/intake/answer`, { request: "$state.idea" }, { ok: REFRESH, fail: toast("Couldn't plan that. Try again.") })
        : {
          kind: "condition", if: { falsy: "where" }, then: toast("Pick where it lives first"),
          else: call("POST", `/v1/bots/code/projects/${target}/intake/answer`, { request: "$state.idea" }, {
            ok: { kind: "navigate", screenId: SCREENS.newProject, params: { project: "$state.where" }, replace: true },
            fail: toast("Couldn't plan that. Try again."),
          }),
        },
    };
    // A new repo is made from here: GitHub only checks it's them (a blink when they already allowed X0 Bot), then makes it and it's added.
    const makeRepo: ActionRef = {
      kind: "condition", if: { falsy: "repoName" }, then: toast("Name the repo first"),
      else: call("POST", "/v1/code/repos/new", { name: "$state.repoName", visibility: "$state.repoVis" }, {
        assignTo: "newRepo", ok: openUrl("$state.newRepo.url"), fail: toast("Couldn't start that. Try again."),
      }),
    };
    const where: Node[] = projectId ? [] : [
      sectionLabel("Where it lives"),
      meta("A new repo on your GitHub, made from here. Or pick one you added.", { size: 13 }),
      boxedField("repoName", "my-new-project", { size: 15, label: "New repo name" }),
      row([
        chips([{ label: "Private", value: "private" }, { label: "Public", value: "public" }], "repoVis"),
        secondaryButton("Make the repo", makeRepo, { size: "md", icon: "plus" }),
        quietButton("Add one I have", open(SCREENS.codeStart, { step: "pick" }), { size: "md" }),
      ], { gap: 8, flexWrap: "wrap", alignItems: "center" }),
      ...(projects.length ? [chips(projects.slice(0, 12).map((p) => ({ label: short(p.fullName), value: p.id })), "where")] : []),
    ];
    const bodyNodes: Node[] = [
      ...(desk ? [row([backButton(fromHome), meta("Xode · New project", { size: 13 })], { gap: 6 })] : [backButton(fromHome)]),
      col([sectionLabel("Your idea"), title(projectId ? `A new project in ${short(d.kind === "intake" ? d.v.project.fullName : "")}` : "Start a new project", { size: desk ? 26 : 24 })], { gap: 6 }),
      meta("Tell me your idea in a sentence or two. I'll ask a few questions and write the plan with you. Nothing is built until you say so.", { size: 14, lineHeight: 19 }),
      boxedField("idea", "A booking app for my salon", { multiline: true, size: 16, minHeight: 90, label: "Your idea" }),
      ...where,
    ];
    return page(ctx, {
      nav: "code", title: "New project", state: { idea: "", where: "" }, gap: 16,
      body: bodyNodes, footer: [primaryButton("Plan it", plan, { wide: !desk })],
      ...(desk ? { maxWidth: 720 } : {}),
    });
  }

  const v = d.v;
  const id = v.project.id;
  const total = v.answered.length + v.questions.length;
  const q = v.questions[0];
  const k = v.answered.length + 1;

  // The plan is written: read it, then start building.
  if (!q) {
    const write = call("POST", `/v1/code/projects/${id}/intake`, { proceed: true }, { ok: REFRESH, fail: toast("Couldn't write the plan. Try again.") });
    const build = seq({ kind: "setState", path: "building", value: true }, call("POST", `/v1/bots/code/projects/${id}/build-new`, {}, {
      assignTo: "built",
      ok: seq({ kind: "setState", path: "building", value: false }, { kind: "navigate", screenId: SCREENS.codeJob, params: { id: "$state.built.job.id" }, replace: true }),
      fail: seq({ kind: "setState", path: "building", value: false }, toast("Couldn't start building. Try again.")),
    }));
    const hasPlan = !!v.spec;
    const article = col(planSoFar(ctx, v), { borderWidth: 1, borderColor: C.line, borderRadius: desk ? 18 : 20, padding: desk ? 20 : 16, gap: 14, backgroundColor: C.paper });
    const foot = [
      hasPlan ? primaryButton("Start building", build, { wide: !desk }) : primaryButton("Write the plan", write, { wide: !desk }),
      { ...row([statusMark("working", { color: MOSS }), meta("Starting…", { size: 13 })], { gap: 8 }), visibleIf: { truthy: "building" } },
    ];
    return page(ctx, {
      nav: "code", title: "New project", gap: 16, ...(desk ? { maxWidth: 760 } : {}),
      body: [
        ...(desk ? [row([backButton(fromHome), meta("Xode · New project", { size: 13 })], { gap: 6 })] : [backButton(fromHome)]),
        col([sectionLabel("Your idea"), title(cut(v.request, 90), { size: desk ? 26 : 24, lines: 3 })], { gap: 6 }),
        row([text("The plan", { size: 15, weight: 600, lineHeight: 20 }), grow(), meta("PLAN.md")]),
        article,
        meta(hasPlan ? "When you start, I add it to your project as PLAN.md and build step 0. Each step ends with a pull request you check first." : "All your answers are in. I write the plan from them.", { size: 12, lineHeight: 17 }),
      ],
      footer: foot,
    });
  }

  // A question: quick answers to pick, or words to type.
  const quick = QUICK[q.id];
  const send = call("POST", `/v1/bots/code/projects/${id}/intake/answer`, { id: q.id, picks: "$state.picks", text: "$state.answer" }, {
    ok: seq({ kind: "setState", path: "picks", value: {} }, { kind: "clearState", path: "answer" }, REFRESH),
    fail: toast("Pick or type an answer first."),
  });
  const skip = call("POST", `/v1/bots/code/projects/${id}/intake/answer`, { id: q.id, skip: true }, { ok: REFRESH, fail: toast("Couldn't skip that. Try again.") });
  const quickNodes: Node[] = quick ? [desk
    ? grid(quick.options.map((o) => {
      const p = `picks.${slugOf(o.label)}`;
      return col([
        row([tickBox(p, 20), text(o.label, { size: 15, weight: 600, lineHeight: 20 })], { gap: 10 }),
        ...(o.sub ? [text(o.sub, { size: 12.5, color: C.meta, lineHeight: 17 })] : []),
      ], { borderRadius: 16, padding: 14, gap: 8, borderWidth: { truthy: p, then: 1.5, else: 1 }, borderColor: { truthy: p, then: C.ink, else: C.outline } }, { kind: "toggleState", path: p });
    }), Math.min(4, quick.options.length), 10)
    : row(quick.options.map((o) => {
      const p = `picks.${slugOf(o.label)}`;
      return row([text(o.label, { size: 13, lineHeight: 17, style: { color: { truthy: p, then: C.paper, else: C.ink } } })], {
        paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
        borderColor: { truthy: p, then: C.ink, else: C.outline }, backgroundColor: { truthy: p, then: C.ink, else: C.paper },
      }, { kind: "toggleState", path: p });
    }), { gap: 8, flexWrap: "wrap" })] : [];
  const typed = boxedField("answer", quick ? "Or say it in your words" : "Type your answer", { size: 15, onSubmit: quick ? undefined : send, label: q.ask });
  const question = col([
    sectionLabel(`Question ${k} of ${total}`),
    text(q.ask, { size: desk ? 20 : 16, weight: desk ? 600 : 500, tracking: desk ? -0.3 : 0, lineHeight: desk ? 26 : 22 }),
    meta(quick?.multi ? "Pick all that fit." : q.why, { size: 13 }),
    ...quickNodes, typed,
  ], { gap: desk ? 12 : 10 });
  const buttons = row([box([primaryButton("Next question", send, { wide: true })], { flexGrow: 1 }), secondaryButton("Skip", skip)], { gap: 10 });
  const ideaTitle = title(cut(v.request, 90), { size: desk ? 26 : 24, lines: 2 });

  if (!desk) {
    return page(ctx, {
      nav: "code", title: "New project", state: { picks: {}, answer: "" }, gap: 14,
      body: [
        backButton(fromHome), ideaTitle, question,
        col([row([text("The plan so far", { size: 15, weight: 600, lineHeight: 20 }), grow(), meta("PLAN.md")]), ...planSoFar(ctx, v).slice(1)],
          { borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, gap: 12 }),
      ],
      footer: [buttons],
    });
  }
  const resp = page(ctx, {
    nav: "code", title: "New project", state: { picks: {}, answer: "" }, gap: 18,
    body: [
      row([backButton(fromHome), meta("Xode · New project", { size: 13 })], { gap: 6 }),
      col([sectionLabel("Your idea"), ideaTitle], { gap: 6 }),
      row(Array.from({ length: total }, (_, i) => box([], { height: 4, borderRadius: 2, flexGrow: 1, flexBasis: 0, backgroundColor: i < k - 1 ? C.ink : i === k - 1 ? MOSS : C.track })), { gap: 6 }),
      ...v.answered.filter((a) => v.answers[a]).slice(-3).map((a) => row([
        numberDot(v.answered.indexOf(a) + 1, "done"),
        row([meta(`${SHORT[a] ?? a}:`, { size: 13 }), text(cut(v.answers[a]!.replace("(no preference: you decide)", "You decide"), 80), { size: 13, weight: 500, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], { gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: C.surface, borderRadius: 14 })),
      question,
      ...(v.questions.length > 1 ? [row(v.questions.slice(1).map((x, i) => row([numberDot(k + i + 1, "todo"), text(SHORT[x.id] ?? x.ask, { size: 13, color: C.meta, lineHeight: 17, lines: 1 })], { gap: 8 })), { gap: 16, flexWrap: "wrap" })] : []),
    ],
    footer: [buttons],
  });
  return withAside(resp, [
    row([text("The plan so far", { size: 16, weight: 600, lineHeight: 21 }), grow(), meta("PLAN.md")]),
    col(planSoFar(ctx, v), { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 20, paddingHorizontal: 22, gap: 14 }),
    grow(),
    meta("I write this as you answer. It's saved in your new project when you start, and you can change it any time.", { size: 12, lineHeight: 17 }),
  ], 440);
}
