/**
 * THE ASSISTANT ON THE PHONE: Connected apps, Tasks, and the confirm sheet.
 *
 * Built here and only drawn by the app, like every other screen: the tiles,
 * their states, the sheets, the words and the route each button calls are the
 * server's. The app has no screen of its own for any of it, only the generic
 * pieces these use (Grid, BottomSheet, Stack, Text, TextField, and the
 * actions callEndpoint, biometricPrompt, openUrl, setState, navigate).
 *
 *   assistant_apps      the tile grid: Suggested for you first, each tile's
 *                       state, a sheet per app with Can look / Can draft /
 *                       Can send and Disconnect (or the link to paste, for an
 *                       app that takes one)
 *   assistant_tasks     Waiting for you / Running / Done, in plain words
 *   assistant_approve   the confirm card as a bottom sheet; where the
 *                       "approval" push lands (push.approval.screenId)
 *   assistant_app_tools an app the person added by link: what it can do,
 *                       tool by tool, as Allow / Ask first / Off, and the
 *                       "This app changed" banner (params.id)
 *   (You tab)           youCard: "Hand it to me", the same Ask in a card on
 *                       the You tab, with the next three tasks and the apps,
 *                       and Activity: the last runs and how each ended
 *   assistant_ask       Ask on the phone: a field, the mic, Do it, and a few
 *                       examples to tap. The answer comes from
 *                       POST /v1/assistant/ask and is acted on with the
 *                       actions every build runs: its line is shown, a
 *                       hand-off is opened, an approval goes to the sheet
 *
 * APPS ADDED BY LINK (only while CUSTOM_CONNECTORS is on: assistant.custom).
 * Connected apps then also has an "Add by link" tile and its sheet (Name,
 * Link, a folded Advanced with the person's own client ID and secret, and the
 * trust line), and under More apps a search over the MCP Registry
 * (connectors/registry.ts), every result outside our catalog marked
 * Unverified with its host. Nobody is sent to sign in without first reading
 * "You'll sign in at {host}": after Add, the sheet turns to that line and a
 * Continue; an added app's own sheet says it above its Connect. Search
 * results arrive by a GET into state (`dir`) and are drawn into twenty slots
 * already on the screen, since a screen cannot grow nodes of its own.
 *
 * WORDS. One table with the desk and the agent's confirm card
 * (connectors/words.ts), in English; a Hinglish profile gets the design's own
 * Hinglish for every line through the translator's seeds (experience/i18n.ts).
 * That only works while a string reaches the translator as the table wrote it,
 * so these screens opt out of the catalog's capitalising pass (props.keepCase
 * on the root, titleCase.ts) and ask the phone to capitalise instead
 * (textTransform), which gives the app's every-word-capitalised look without
 * changing a letter of the words.
 *
 * WHAT IS THE PERSON'S OR THE APP'S, NOT OURS: an app's name, a task's title,
 * its steps and above all the exact preview. They are put in the screen's
 * state and drawn from there, never written into a node: the translator only
 * ever sees nodes, so what the person is about to approve cannot be reworded,
 * and a stranger's text is never mistaken for a word of ours.
 *
 * NOTHING IS APPROVED WITHOUT THE PERSON'S OWN CHECK. Approve runs
 * biometricPrompt first (Face ID or fingerprint, or the phone's passcode).
 * A phone with none of them asks once more with a plain tap and says why; a
 * bundle too old to know that case ends the prompt as an error and nothing is
 * sent.
 *
 * This file is the entry (the screen ids and buildAssistantScreen); each screen is a
 * file of its own beside it, and kit.ts holds the parts they share.
 */

import type { ScreenResponse } from "../../../../shared/types/sdui.js";
import type { AssistantView } from "../../connectors/list.js";
import { approveScreen } from "./approve.js";
import { appsScreen } from "./apps.js";
import { askScreen } from "./ask.js";
import { type You, ASK } from "./kit.js";
import { tasksScreen } from "./tasks.js";
import { toolsScreen } from "./tools.js";

export const ASSISTANT_SCREENS: ReadonlySet<string> = new Set(["assistant_apps", "assistant_tasks", "assistant_approve", "assistant_app_tools", "assistant_ask"]);

export interface AssistantScreenCtx {
  /** The apps and tasks, read for this screen. Absent: off, or the read failed. */
  assistant?: AssistantView;
  params?: Record<string, unknown>;
  /** What this build of the app says it can draw and do. */
  can?: ReadonlySet<string>;
  /** Connected apps are switched on (CONNECTORS): Ask has something to answer with. */
  connectorsOn?: boolean;
  /** Their app language: Ask's examples are in their voice. */
  language?: string;
  /** The phone asking, sent on with each ask. */
  platform?: "ios" | "android";
  /** The phone's UTC offset when the screen was asked for, sent on with each ask so "tomorrow" is its tomorrow. */
  tzOffsetMinutes?: number;
}

/** The ctx each builder gets: `lone` = the stack under this screen is empty (a push or a link opened it), so a back arrow would go nowhere. */
export type Ctx = AssistantScreenCtx & { lone: boolean };
const LONE_KEYS = ["pushId", "entry", "alone"];

export function buildAssistantScreen(screenId: string, ctx: AssistantScreenCtx, ui: You): ScreenResponse | null {
  const c: Ctx = { ...ctx, lone: LONE_KEYS.some((k) => ctx.params?.[k] !== undefined) };
  switch (screenId) {
    case "assistant_apps": return appsScreen(c, ui);
    case "assistant_tasks": return tasksScreen(c, ui);
    case "assistant_approve": return approveScreen(c, ui);
    case "assistant_app_tools": return toolsScreen(c, ui);
    case ASK: return askScreen(c, ui);
    default: return null;
  }
}
