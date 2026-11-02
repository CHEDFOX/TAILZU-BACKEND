/**
 * THE DESK — Tailzu's own pages for a desktop window.
 *
 * The phone's screens are drawn for a column and a thumb, and a window framed
 * around them looked like a phone app on a monitor. These are drawn for the
 * window: a masthead with the tabs across the top, pages that run its width,
 * and one idea on every page — what was SAID, in a hand, above what was
 * WRITTEN, in type. That picture is the product's whole claim, and no other
 * dictation app shows it.
 *
 * Sent only to a desktop that declares DeskShell (desktop/sdui.js), so an
 * older installer keeps the rail and the phone's screens. Everything here is
 * composed from the renderer's plain nodes and its named `d-` styles
 * (desktop/app.html); a page changes with a deploy, never an installer.
 *
 * Honest by construction. Every number is one the server holds: words and
 * speaking time from the usage meter, notes from history, the languages read
 * from the written text itself (history/writtenIn.ts). Typing time is the
 * product's standing assumption of 40 words a minute, and the page says so.
 *
 * This file is the desk's entry: its screen ids, its tabs, and buildDeskScreen,
 * which picks the page; each page is a file of its own beside it.
 */

import type { NavigationShell, Node, ActionRef, ScreenResponse } from "../../../../shared/types/sdui.js";
import { en as w } from "../../connectors/words.js";
import { sw as say } from "../settingsWords.js";
import { HEADING_FACE } from "../touches.js";
import { deskApp } from "./app.js";
import { deskAssistantName } from "./assistantName.js";
import { deskConnector } from "./connector.js";
import type { DeskContext } from "./context.js";
import { deskDay } from "./day.js";
import { deskHistory } from "./history.js";
import { deskInsights } from "./insights.js";
import { stack, row, text, link } from "./kit.js";
import { deskNote } from "./note.js";
import { deskNotes } from "./notes.js";
import { deskPlan } from "./plan.js";
import { deskSettings } from "./settings.js";
import { deskTasks } from "./tasks.js";
import { deskToday } from "./today.js";
import { deskTrain } from "./train.js";
import { deskVoiceRead } from "./voiceRead.js";
import { deskVoices } from "./voices.js";
import { deskWords } from "./words.js";

export const DESK_SCREENS = new Set(["desk_today", "desk_history", "desk_notes", "desk_note", "desk_insights", "desk_day", "desk_app", "desk_words", "desk_voices", "desk_train", "desk_settings", "desk_voice_read", "desk_assistant_name", "desk_plan", "desk_tasks", "desk_connector"]);

/** The desk's tabs, in the masthead. Settings and Plan are reached from its
 *  right-hand side, not from a tab. */
export const DESK_NAV: NavigationShell = {
  kind: "tabs",
  tabs: [
    { id: "desk_today", title: "Today", screenId: "desk_today" },
    { id: "desk_insights", title: "Insights", screenId: "desk_insights" },
    { id: "desk_words", title: "Words", screenId: "desk_words" },
    { id: "desk_voices", title: "Voices", screenId: "desk_voices" },
    { id: "desk_train", title: say("tab.train"), screenId: "desk_train" },
  ],
  initialTabId: "desk_today",
};

/** The tabs for a window, with Notes after Today for one that can take them
 *  (it declared "DeskNotes" and has the hotkey), and Tasks after that for one
 *  that can show the assistant's (it declared "DeskConnectors"). */
export function deskNav(notes: boolean, tasks = false): NavigationShell {
  if ((!notes && !tasks) || DESK_NAV.kind !== "tabs") return DESK_NAV;
  const [today, ...rest] = DESK_NAV.tabs;
  return { ...DESK_NAV, tabs: [
    today!,
    ...(notes ? [{ id: "desk_notes", title: "Notes", screenId: "desk_notes" }] : []),
    ...(tasks ? [{ id: "desk_tasks", title: w("a4.h"), screenId: "desk_tasks" }] : []),
    ...rest,
  ] };
}

/** The desk's page for an id, or null for an id that is not one of them. */
/**
 * A NEWER TAILZU, SAID IN THE WINDOW.
 *
 * The tray's notification was the only notice, and a notification is gone in
 * five seconds and off entirely for anyone who silenced the app. This sits at
 * the top of every page until the new build is installed, and its one button
 * downloads the installer itself — not a page to find it on.
 */
/**
 * THE UPDATE, INSTALLED FROM HERE.
 *
 * A build that says it can ("DeskSelfUpdate") gets one button: it downloads
 * the new build, checks it against the SHA-512 recorded when it was
 * published, puts it in place of this one and restarts on it. No browser, no
 * installer to click through, still signed in. The words for each step are
 * sent with the action; the window only fills in the percentage.
 *
 * Anything else — an older build, or a publish with no checksum recorded —
 * gets the link, which is all it could do before.
 */
function updateCard(u: { version: string; url: string; sha512?: string }, selfUpdate = false): Node {
  if (selfUpdate && u.sha512) {
    const install: ActionRef = {
      kind: "installUpdate", version: u.version, url: u.url, sha512: u.sha512,
      words: {
        downloading: "Downloading. {pct}%",
        installing: "Installing. X0 Bot restarts in a moment.",
        failed: "The update didn't finish. Try again.",
        manual: "This copy can't update itself. The download is opening in your browser.",
      },
    };
    return stack([
      row([
        stack([
          text("Update", "d-eyebrow"),
          text(`X0 Bot ${u.version} is ready.`, "d-written", { marginTop: 4 }),
          { ...text("It installs itself and restarts. You stay signed in.", "d-lede", { marginTop: 2 }), bind: { content: "upd.line" } },
        ], { flex: 1, minWidth: 0 }),
        { ...link("Update now", install, "d-btn"), visibleIf: { falsy: "upd.busy" } },
      ], { align: "center", gap: 24, justify: "between", flexWrap: "wrap", paddingTop: 18, paddingBottom: 18 }, "d-room-inner"),
    ], { borderBottom: "1px solid var(--d-rule)" });
  }
  return stack([
    row([
      stack([
        text("Update", "d-eyebrow"),
        text(`X0 Bot ${u.version} is ready.`, "d-written", { marginTop: 4 }),
        text("Download it, open it, and this window restarts on the new version.", "d-lede", { marginTop: 2 }),
      ], { flex: 1, minWidth: 0 }),
      link("Download update", { kind: "openUrl", url: u.url }, "d-btn"),
    ], { align: "center", gap: 24, justify: "between", flexWrap: "wrap", paddingTop: 18, paddingBottom: 18 }, "d-room-inner"),
  ], { borderBottom: "1px solid var(--d-rule)" });
}

function deskPage(screenId: string, ctx: DeskContext): ScreenResponse | null {
  switch (screenId) {
    case "desk_today": return deskToday(ctx);
    case "desk_history": return deskHistory(ctx);
    case "desk_notes": return deskNotes(ctx);
    case "desk_note": return deskNote(ctx);
    case "desk_insights": return deskInsights(ctx);
    case "desk_day": return deskDay(ctx);
    case "desk_app": return deskApp(ctx);
    case "desk_words": return deskWords(ctx);
    case "desk_voices": return deskVoices(ctx);
    case "desk_train": return deskTrain(ctx);
    case "desk_settings": return deskSettings(ctx);
    case "desk_voice_read": return deskVoiceRead(ctx);
    case "desk_assistant_name": return deskAssistantName(ctx);
    case "desk_plan": return deskPlan(ctx);
    case "desk_tasks": return deskTasks(ctx);
    case "desk_connector": return deskConnector(ctx);
    default: return null;
  }
}

/**
 * THE PAGE TITLES IN THE ONBOARDING'S HEADING FACE. Every page's big title is a
 * d-h1; for a window that draws the new onboarding (and so has its typefaces)
 * they are set in Bricolage Grotesque at 800, a step smaller to carry its
 * weight. The Devanagari face follows for a title in Hindi. A window that does
 * not say it draws the onboarding keeps the book face it has always had.
 */
function headingFace(node: Node | undefined): void {
  if (!node) return;
  if (node.type === "Text" && String(node.props?.cls ?? "").split(/\s+/).includes("d-h1")) {
    node.style = {
      ...(node.style ?? {}),
      fontFamily: `'${HEADING_FACE}',var(--f-deva),var(--f-written),serif`,
      fontWeight: 800, fontSize: 28, lineHeight: "34px", letterSpacing: "-.02em",
    };
  }
  for (const c of node.children ?? []) headingFace(c);
}

export function buildDeskScreen(screenId: string, ctx: DeskContext): ScreenResponse | null {
  const s = deskPage(screenId, ctx);
  if (s && ctx.onboard) headingFace(s.root);
  if (s?.root && ctx.update) s.root.children = [updateCard(ctx.update, !!ctx.selfUpdate), ...(s.root.children ?? [])];
  return s;
}
