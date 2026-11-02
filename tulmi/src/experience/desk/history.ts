/**
 * History: everything written, newest first.
 */

import type { HistoryEntry } from "../../../../shared/types/api.js";
import type { Node, ActionRef, ScreenResponse } from "../../../../shared/types/sdui.js";
import { sw as say } from "../settingsWords.js";
import { appName } from "./charts.js";
import type { DeskContext } from "./context.js";
import { row, stack, text, link, emptyState, screen, page } from "./kit.js";
import { local, MONTHS, clock, dayHeading } from "./time.js";

// ---- TODAY -------------------------------------------------------------------------
interface EntryItem { id: string; time: string; app: string; said: string; written: string; deva: boolean; typed: boolean }

function entryItems(ctx: DeskContext, entries: HistoryEntry[], withDate = false): EntryItem[] {
  return entries.map((e) => {
    const d = local(ctx, Date.parse(e.createdAt));
    const voice = (e.kind ?? "voice") === "voice";
    const said = voice && e.input && e.input.trim() !== (e.output ?? "").trim() ? e.input.trim() : "";
    return {
      id: e.id,
      time: withDate ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}` : clock(d),
      app: appName(e.targetApp) || (voice ? "" : "Typed"),
      said,
      written: (e.output ?? "").trim(),
      deva: /[ऀ-ॿ]/.test(e.output ?? ""),
      typed: !voice,
    };
  });
}

// ---- HISTORY -------------------------------------------------------------------------
//
// Every cleanup the person has kept, newest first, by day — the window's answer
// to the phone's History screen. A row keeps its Copy, and can be removed; and
// removing one asks why, the way the phone does: it doesn't sound like them, or
// it was just a clean-up. Either reason deletes it, so it stops being learned
// from; the reason is sent on the delete so the first can be told from tidying.

/**
 * ONE ROW, with its own remove-and-reason.
 *
 * PER-ROW STATE, KEYED BY THE ENTRY'S ID. The id goes into a boolean state
 * path, `del.<id>` — the desktop renderer walks a dotted path (sdui.js
 * setStatePath/stateAt) and a history id carries no dots, so each row toggles
 * its own flag and opens its own card, one at a time. Its text and id are
 * written into each action the way the notes on Today carry theirs — a list's
 * item is gone by the time a click is read, so nothing is left to `$state`.
 */
function historyRow(it: EntryItem): Node {
  const id = it.id;
  const flag = "del." + id;
  const remove = (reason: string): ActionRef => ({
    kind: "callEndpoint", method: "DELETE", path: "/v1/history/" + id + "?reason=" + reason,
    onSuccess: { kind: "refresh" },
    onError: { kind: "toast", message: "Couldn't reach history. Try again." },
  });
  // THE CROSS. Always there, quiet until it is wanted — the hover-only
  // "Remove" was a delete nobody found. It opens the same reason card.
  const cross: Node = {
    type: "Button",
    props: { label: "✕", cls: "d-x" },
    on: { onPress: { kind: "setState", path: flag, value: true } },
    style: {
      border: 0, background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0,
      width: 30, height: 30, radius: 15, marginTop: -4,
      font: "400 15px/30px var(--f-ui)", color: "var(--d-ink3)", textAlign: "center",
    },
    visibleIf: { falsy: flag },
  };
  return row([
    stack([
      text(it.time, "d-margin-strong"),
      ...(it.app ? [text(it.app, "d-margin")] : []),
    ], { width: 96, flex: "none", paddingTop: 3 }),
    stack([
      ...(it.said ? [text(it.said, "d-said")] : []),
      text(it.written, it.deva ? "d-written d-deva" : "d-written"),
      {
        ...row([
          link("Copy", { kind: "copyText", text: it.written, message: "Copied" }),
        ], { gap: 18, marginTop: 10 }, "d-tools"),
        visibleIf: { falsy: flag },
      },
      {
        ...stack([
          text("Remove from history", "d-eyebrow"),
          text("Why should it go?", "d-written", { fontSize: 16, lineHeight: "22px", marginTop: 4 }),
          text("Either way it's gone for good, and X0 Bot stops learning from it.", "d-lede", { marginTop: 4 }),
          row([
            link("It doesn't sound like me", remove("not_me")),
            link("Just a clean-up", remove("cleanup")),
            link("Leave it", { kind: "setState", path: flag, value: false }),
          ], { gap: 20, marginTop: 14, align: "center", flexWrap: "wrap" }, "d-tools"),
        ], { marginTop: 12, paddingTop: 16, paddingBottom: 16, paddingLeft: 18, paddingRight: 18, borderRadius: 10, border: "1px solid var(--d-rule)", maxWidth: 520 }),
        visibleIf: { truthy: flag },
      },
    ], { flex: 1, minWidth: 0, gap: 4 }),
    cross,
  ], { gap: 24, paddingTop: 24, paddingBottom: 24 }, "d-entry");
}

export function deskHistory(ctx: DeskContext): ScreenResponse {
  const all = ctx.history ?? [];
  const items = entryItems(ctx, all, false);

  const body: Node[] = [];
  if (!all.length) {
    body.push(emptyState("listen-s", say("e.hist")));
  }
  let lastDay = "";
  all.forEach((e, i) => {
    const day = dayHeading(ctx, e.createdAt);
    if (day !== lastDay) {
      body.push(text(day, "d-eyebrow", { marginTop: lastDay ? 34 : 0, marginBottom: 4 }));
      lastDay = day;
    }
    body.push(historyRow(items[i]!));
  });

  return screen("desk_history", "History", [page([
    row([link("← Today", { kind: "switchTab", tabId: "desk_today" })], { marginBottom: 20 }),
    text("History", "d-eyebrow"),
    text("Everything you've kept", "d-h1", { marginTop: 6 }),
    text("Every cleanup you've kept, newest first.", "d-lede", { marginTop: 8 }),
    stack(body, { maxWidth: 760, marginTop: 24 }),
  ])], { del: {} });
}
