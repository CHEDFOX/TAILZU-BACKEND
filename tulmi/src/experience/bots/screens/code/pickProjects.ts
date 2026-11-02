/**
 * The Code bot's pickProjects screen.
 */

import type { ScreenResponse, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, call, SCREENS, row, meta, text, C, col, icon, title, emptyState, box, statusMark, open, page, primaryButton, sectionLabel,
  grow,
} from "../../kit.js";
import {
  type Github, type Project, str, toast, openUrl, field, plural, REFRESH, tickBox, short, setupBuddy, setupTop, backButton, enterTop,
} from "./parts.js";

interface Repo { id: number; fullName: string; private: boolean; defaultBranch: string }

export interface PickData { gh?: Github; repos?: { repos: Repo[]; truncated: boolean; needsSignin?: boolean }; projects?: Project[]; installUrl?: string }

/** Enter2 / DEnter2: which projects should I work on? */
export function pickProjects(ctx: BotsCtx, d: PickData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const login = d?.gh?.oauth?.login ?? d?.gh?.installations[0]?.account;
  const added = new Map((d?.projects ?? []).map((p) => [p.fullName, p.id]));
  const q = str(ctx.params.q).trim().toLowerCase();
  const vis = str(ctx.params.vis);
  const all = d?.repos?.repos ?? [];
  const shown = all.filter((r) => (!q || r.fullName.toLowerCase().includes(q)) && (vis === "private" ? r.private : vis === "public" ? !r.private : true));
  const add = call("POST", "/v1/bots/code/projects/add", { picks: "$state.pick" }, {
    assignTo: "made",
    ok: { kind: "navigate", screenId: SCREENS.codeStart, params: { step: "read", project: "$state.made.added.0.id" } },
    fail: toast("Pick a project first, or check X0 Bot can see it on GitHub."),
  });
  const search = (v: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.codeStart, params: { step: "pick", q: v, vis }, replace: true });
  const manage = d?.gh?.installations[0]?.manageUrl ?? d?.installUrl;
  const missing = row([
    meta("Missing one?", { size: desk ? 13 : 12 }),
    ...(manage ? [text("Give X0 Bot access to it on GitHub.", { size: desk ? 13 : 12, color: C.ink, weight: 500, lineHeight: 17, style: { textDecorationLine: "underline" } })] : []),
  ], { gap: 4, flexWrap: "wrap" }, manage ? openUrl(manage) : undefined);
  const heading = col([
    row([icon("check", { size: 16 }), text(login ? `GitHub connected · @${login}` : d?.gh?.connected ? "GitHub connected" : "GitHub not connected yet", { size: 13, weight: 500, lineHeight: 17 })], { gap: 8 }),
    title("Which projects should I work on?", { size: 26, tracking: -0.6, lineHeight: 32 }),
    meta("Pick one to start. You can add more any time.", { size: 14 }),
  ], { gap: 6 });
  const searchBox = row([icon("search", { size: 18, color: C.meta }), field("q", `Search ${plural(all.length, "repository", "repositories")}`, { onSubmit: search("$state.q"), size: 15, label: "Search your repositories" })],
    { gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingHorizontal: 14, height: 44, flexGrow: 1 });

  // Nothing to show: not connected, nothing GitHub let us see, or a search with no match.
  let empty: Node | null = null;
  if (!d?.repos) {
    empty = emptyState({
      pose: "listen", title: d?.gh?.connected ? "I couldn't reach GitHub" : "Connect GitHub first",
      body: d?.gh?.connected ? "Try again in a moment." : "Once you allow X0 Bot on GitHub, your repositories show here.",
      action: d?.gh?.connected || !d?.installUrl ? { label: "Try again", onPress: REFRESH } : { label: "Connect GitHub", onPress: openUrl(d.installUrl) },
    });
  } else if (!all.length) {
    empty = emptyState({ pose: "listen", title: "No repositories yet", body: "Give X0 Bot access to one on GitHub, then come back.", action: manage ? { label: "Open GitHub", onPress: openUrl(manage) } : { label: "Try again", onPress: REFRESH } });
  } else if (!shown.length) {
    empty = emptyState({ pose: "think", title: `Nothing called "${q}"`, action: { label: "Show all", onPress: search("") } });
  }

  const rowOf = (r: Repo, i: number, n: number): Node => {
    const have = added.get(r.fullName);
    const left = have ? box([statusMark("done", { size: 10 })], { width: 22, alignItems: "center" }) : tickBox(`pick.${r.id}`);
    return row([
      left,
      col([text(short(r.fullName), { size: 15, weight: 600, mono: true, lineHeight: 20, lines: 1 }), meta(`${r.private ? "Private" : "Public"} · ${have ? "added" : r.defaultBranch}`)], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 12, paddingVertical: 14, paddingHorizontal: 4, ...(i < n - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) },
    have ? open(SCREENS.code, { project: have }) : { kind: "toggleState", path: `pick.${r.id}` });
  };

  const stage = setupBuddy(ctx, "survey");
  if (!desk) {
    const list = shown.slice(0, 20);
    return page(ctx, {
      back: !stage, title: "Pick projects", nav: "code", state: { pick: {}, q: str(ctx.params.q) },
      body: [...(stage ? [setupTop(backButton(), stage)] : []), heading, searchBox, ...(empty ? [empty] : [col(list.map((r, i) => rowOf(r, i, list.length)))])],
      footer: [...(empty ? [] : [primaryButton("Add projects", add, { wide: true })]), missing], gap: 16,
    });
  }
  const counts = { all: all.length, private: all.filter((r) => r.private).length, public: all.filter((r) => !r.private).length };
  const tabs = row((["all", "private", "public"] as const).map((k) => box([
    text(`${k === "all" ? "All" : k === "private" ? "Private" : "Public"} ${counts[k]}`, { size: 13, weight: (vis || "all") === k ? 600 : 400, color: (vis || "all") === k ? C.ink : C.grey70, lineHeight: 17 }),
  ], { paddingHorizontal: 14, height: 36, justifyContent: "center", borderRadius: 10, ...((vis || "all") === k ? { backgroundColor: C.paper } : {}) },
  (vis || "all") === k ? undefined : { kind: "navigate", screenId: SCREENS.codeStart, params: { step: "pick", q: str(ctx.params.q), vis: k === "all" ? "" : k }, replace: true })),
  { backgroundColor: C.surface, borderRadius: 12, padding: 3 });
  const list = shown.slice(0, 30);
  const tableNode = col([
    row([box([], { width: 22 }), ...["Repository", "Visibility", "Default branch", ""].map((h, j) => box([sectionLabel(h)], j === 0 ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width: j === 3 ? 90 : 120 }))], { gap: 16, paddingVertical: 10, paddingHorizontal: 18 }),
    ...list.map((r) => {
      const have = added.get(r.fullName);
      return row([
        have ? box([statusMark("done", { size: 10 })], { width: 22, alignItems: "center" }) : tickBox(`pick.${r.id}`, 20),
        box([text(short(r.fullName), { size: 14, weight: 600, mono: true, lineHeight: 19, lines: 1 })], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        box([text(r.private ? "Private" : "Public", { size: 13, color: C.grey70, lineHeight: 17 })], { width: 120 }),
        box([text(r.defaultBranch, { size: 12.5, mono: true, color: C.grey70, lineHeight: 17 })], { width: 120 }),
        box([meta(have ? "Added" : "", { size: 13 })], { width: 90 }),
      ], { gap: 16, paddingHorizontal: 18, minHeight: 50, borderTopWidth: 1, borderTopColor: C.divider }, have ? open(SCREENS.code, { project: have }) : { kind: "toggleState", path: `pick.${r.id}` });
    }),
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" });
  const can = [["check", "Read the code and run its tests"], ["check", "Make a safe copy and open pull requests"], ["close", "Change main without you"], ["close", "See the projects you don't pick"]] as const;
  return page(ctx, {
    title: "Pick projects", nav: "code", maxWidth: 1100, gap: 18, state: { pick: {}, q: str(ctx.params.q) },
    body: [
      enterTop(open(SCREENS.codeStart, { step: "meet" }), 2),
      ...(stage ? [stage] : []),
      heading,
      row([
        col([
          row([searchBox, tabs], { gap: 12 }),
          ...(empty ? [empty] : [tableNode]),
          row([meta(`Showing ${list.length} of ${all.length}${d?.repos?.truncated ? "+" : ""}`, { size: 13 }), grow(), missing], { gap: 8, paddingHorizontal: 4 }),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 12 }),
        col([
          text("Your picks", { size: 15, weight: 600, lineHeight: 20 }),
          meta("Tick the ones I should work on. I read the first one straight away, about a minute; the rest wait their turn.", { size: 13, lineHeight: 18 }),
          sectionLabel("In those, I can"),
          col(can.map(([ic, w]) => row([icon(ic, { size: 16, color: ic === "check" ? C.ink : C.meta }), text(w, { size: 13, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8 })), { gap: 8 }),
          ...(empty ? [] : [primaryButton("Add projects", add, { wide: true })]),
        ], { width: 290, flexShrink: 0, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 18, gap: 14 }),
      ], { gap: 28, alignItems: "flex-start" }),
    ],
  });
}
