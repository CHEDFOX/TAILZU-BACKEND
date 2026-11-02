/**
 * The Code bot's projectRules screen.
 */

import type { Node, ScreenResponse, ActionRef } from "../../../../../../shared/types/sdui.js";
import { type RuleId, type RuleValue, ruleWord, nextValue } from "../../../../botsCode/rules.js";
import {
  row, box, text, whenEq, C, seq, call, type BotsCtx, SCREENS, mono, meta, col, button, quietButton, icon, page, open, botAvatar,
  sectionLabel, listCard, spanOf, grow, listRow, segmented,
} from "../../kit.js";
import { toast, REFRESH, unreachable, short, head, subLine, CODE, cut } from "./parts.js";

export interface RulesView {
  project: { id: string; fullName: string; defaultBranch: string };
  rules: Record<RuleId, RuleValue>;
  capPaise: number; capSet: boolean; typical: [number, number] | null; checks: string[]; branchExample: string;
  computers: Array<{ name: string; on: boolean }>;
}

/**
 * How often a job checks with you before it uses more: three levels, each the share of this stretch (the free plan: this month) a job may use before it asks (ours,
 * kept as the project's cap: POST /v1/bots/code/projects/:id/cap). No amounts on the screen.
 */
const ASK_LEVELS = [{ label: "Often", paise: 1000 }, { label: "Sometimes", paise: 3000 }, { label: "Rarely", paise: 10_000 }] as const;
const askLevelOf = (capPaise: number): string => String(capPaise <= 1500 ? 1000 : capPaise <= 5000 ? 3000 : 10_000);
function askLevels(projectId: string): Node {
  return row(ASK_LEVELS.map((l) => box([text(l.label, { size: 13, weight: 500, lineHeight: 17, align: "center" })], {
    flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10,
    backgroundColor: whenEq("askLevel", String(l.paise), C.paper, "transparent"),
  }, seq({ kind: "setState", path: "askLevel", value: String(l.paise) },
    call("POST", `/v1/bots/code/projects/${projectId}/cap`, { paise: l.paise }, { ok: seq(toast("Saved."), REFRESH), fail: toast("Couldn't save that. Try again.") })))),
  { padding: 3, borderRadius: 12, backgroundColor: C.surface, gap: 2 });
}

const RULE_ROWS: Array<{ id: RuleId; label: string; sub: string }> = [
  { id: "prs", label: "Open pull requests", sub: "Opens one when its checks pass" },
  { id: "merge", label: "Merge", sub: "You press Merge, every time" },
  { id: "main", label: "Push to", sub: "only changes through a PR" },
];

export function projectRules(ctx: BotsCtx, v: RulesView | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!v) return unreachable(ctx, "that project's rules");
  const id = v.project.id;
  const name = short(v.project.fullName);
  const main = v.project.defaultBranch;
  const set = (rule: RuleId, to: string): ActionRef => call("POST", `/v1/bots/code/projects/${id}/rules`, { rule, to }, { ok: seq(toast("Saved."), REFRESH), fail: toast("Couldn't save that. Try again.") });
  const comp = v.computers[0];
  const compSub = comp ? `Runs checks on ${comp.name} when awake` : "Runs checks on your computer when the X0 Bot app is open";
  const disconnect = call("POST", `/v1/bots/code/projects/${id}/disconnect`, {}, {
    ok: seq(toast(`Disconnected ${name}.`), { kind: "navigate", screenId: SCREENS.code, replace: true }),
    fail: toast("Couldn't disconnect it. Try again."),
  });
  const ruleLabel = (r: typeof RULE_ROWS[number]): Node => r.id === "main"
    ? row([text("Push to", { size: 15, lineHeight: 20 }), mono(main, { size: 12 })], { gap: 6 })
    : text(r.label, { size: 15, lineHeight: 20 });
  const checks = v.checks.length
    ? row(v.checks.slice(0, 8).map((c) => box([text(c, { size: 12, mono: true, lineHeight: 16 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: desk ? 6 : 5, paddingHorizontal: desk ? 9 : 8 })), { gap: 6, flexWrap: "wrap" })
    : meta("None found yet. I look for lint, typecheck, test and build scripts.", { size: 12 });
  const confirm = { ...col([
    text(`Disconnect ${name}?`, { size: 15, weight: 600, lineHeight: 20 }),
    meta("I stop its jobs and forget it here. Nothing on GitHub changes.", { size: 12 }),
    row([button("Yes, disconnect", disconnect, { kind: "secondary", size: "md" }), quietButton("Keep it", { kind: "setState", path: "confirm", value: false }, { size: "md" })], { gap: 8 }),
  ], { gap: 8, paddingTop: 4 }), visibleIf: { truthy: "confirm" } };
  const dangerCard = col([
    row([
      col([text("Disconnect project", { size: 15, weight: 600, lineHeight: 20 }), meta("Stops all jobs here. Your code stays on GitHub.")], { gap: 3, flexGrow: 1, flexShrink: 1 }),
      { ...button("Disconnect", { kind: "setState", path: "confirm", value: true }, { kind: "secondary", size: "md" }), visibleIf: { falsy: "confirm" } },
    ], { gap: 12 }),
    confirm,
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: desk ? 11 : 14, paddingHorizontal: desk ? 18 : 16, gap: 8 });

  if (!desk) {
    const ruleRows = RULE_ROWS.map((r) => row([
      box([ruleLabel(r)], { flexGrow: 1, flexShrink: 1 }), text(ruleWord(v.rules[r.id]), { size: 14, color: C.meta, lineHeight: 19 }), icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 8, paddingVertical: 13, paddingHorizontal: 16, minHeight: 48 }, set(r.id, nextValue(r.id, v.rules[r.id]))));
    return page(ctx, {
      nav: "code", title: "Project rules", state: { confirm: false, askLevel: askLevelOf(v.capPaise) }, gap: 14,
      body: [
        head(ctx, { title: "Project rules", sub: subLine([{ code: name }, "· what Xode may do"]), to: open(SCREENS.code, { project: id }), right: [botAvatar(CODE, 30)] }),
        col([sectionLabel("On its own"), listCard(ruleRows)], { gap: 8 }),
        col([sectionLabel("Checking with you"), listCard([
          col([col([text("Checks with you", { size: 15, lineHeight: 20 }), meta(`Before a job uses a lot of ${spanOf(ctx)}`)], { gap: 2 }), askLevels(id)], { gap: 10, paddingVertical: 12, paddingHorizontal: 16 }),
          col([row([text("Checks it runs before each PR", { size: 15, lineHeight: 20 }), grow(), meta(String(v.checks.length), { size: 13 })]), checks], { gap: 10, paddingVertical: 14, paddingHorizontal: 16 }),
        ])], { gap: 8 }),
        col([sectionLabel("How it works"), listCard([
          row([text("Branch names", { size: 15, lineHeight: 20 }), grow(), text(cut(v.branchExample, 28), { size: 12, mono: true, color: C.meta, lineHeight: 16 })], { gap: 8, paddingVertical: 13, paddingHorizontal: 16 }),
          listRow({ label: "This computer helps", sub: compSub, value: comp ? (comp.on ? "On" : "Off") : "", onPress: open(SCREENS.computer) }),
        ])], { gap: 8 }),
        col([sectionLabel("Danger area"), dangerCard], { gap: 8 }),
      ],
    });
  }
  const section = (h: string, words: string, content: Node): Node => row([
    col([text(h, { size: 15, weight: 600, lineHeight: 20 }), meta(words, { size: 13, lineHeight: 18 })], { width: 250, flexShrink: 0, gap: 6 }),
    box([content], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
  ], { gap: 32, alignItems: "flex-start" });
  const opts = (r: RuleId) => (r === "prs" ? [{ label: "Yes", value: "yes" }, { label: "Never", value: "never" }] : [{ label: "Yes", value: "yes" }, { label: "Asks you", value: "ask" }, { label: "Never", value: "never" }]);
  const ruleRows = RULE_ROWS.map((r, i) => row([
    col([ruleLabel(r), r.id === "main" ? row([mono(main, { size: 12 }), meta(r.sub)], { gap: 4 }) : meta(r.sub)], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    box([segmented(opts(r.id), `rule.${r.id}`, { onChange: set(r.id, `$state.rule.${r.id}`) })], { width: r.id === "prs" ? 170 : 250, flexShrink: 0 }),
  ], { gap: 16, paddingVertical: 11, paddingHorizontal: 18, minHeight: 46, ...(i < RULE_ROWS.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) }));
  const cardOf = (kids: Node[]) => col(kids, { borderWidth: 1, borderColor: C.line, borderRadius: 18 });
  return page(ctx, {
    nav: "code", title: "Project rules", maxWidth: 1000, gap: 22, state: { confirm: false, rule: v.rules, askLevel: askLevelOf(v.capPaise) },
    body: [
      head(ctx, { title: "Project rules", sub: subLine([{ code: name }, "· what Xode may do"], 13), to: open(SCREENS.code, { project: id }),
        right: [row([botAvatar(CODE, 26), meta("Saved · applies from the next job", { size: 13 })], { gap: 8 })] }),
      section("On its own", "What Xode may do without asking. It always works on its own branch, so your code only changes when you say.", cardOf(ruleRows)),
      section("Checking with you", `A job checks with you before it uses a lot of ${spanOf(ctx)}. Checks run before every PR, so you only review work that passes.`, cardOf([
        row([col([text("Checks with you", { size: 15, lineHeight: 20 }), meta(`Before a job uses a lot of ${spanOf(ctx)}`)], { gap: 2, flexGrow: 1 }),
          box([askLevels(id)], { width: 270, flexShrink: 0 })], { gap: 14, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.divider }),
        col([row([text("Checks it runs before each PR", { size: 15, lineHeight: 20 }), grow(), meta(String(v.checks.length), { size: 13 })]), checks], { gap: 10, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 18 }),
      ])),
      section("How it works", "Where the work runs, and how branches are named so you can find them on GitHub.", cardOf([
        row([col([text("Branch names", { size: 15, lineHeight: 20 }), meta("tailzu/ and the job name")], { gap: 2, flexGrow: 1 }), mono(v.branchExample, { size: 12 })], { gap: 16, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.divider }),
        row([col([text("This computer helps", { size: 15, lineHeight: 20 }), meta(compSub)], { gap: 2, flexGrow: 1 }), meta(comp ? (comp.on ? "On" : "Off") : "Set up", { size: 13 }), icon("chevron", { size: 16, color: C.meta })],
          { gap: 12, paddingVertical: 11, paddingHorizontal: 18 }, open(SCREENS.computer)),
      ])),
      section("Danger area", "Nothing here is deleted. You can connect the project again any time.", dangerCard),
    ],
  });
}
