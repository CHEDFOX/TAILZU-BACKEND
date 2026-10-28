/**
 * THE OUTBOX ON SCREEN (Offline / DOffline, and a small card on Home once the connection is back): the asks a person typed while
 * offline, kept on the device in order with when they were typed, and their state as the app sends them (docs/bots-app.md "Offline").
 *
 * A build that keeps an outbox (hasOutbox; shared/types/sdui.ts 3e) puts it in every screen's state: `outbox` (the asks, oldest first,
 * each { id, label, sub, state, typedAt }), `outboxWaiting` (how many are still to go) and `online`. These parts read it from there, so
 * nothing here knows what was typed: a slot per ask (five at most), each shown only while there is an ask in it. Adding one is the
 * `outbox` action (kit keepAsk): POST /v1/shell/ask, once, with the id the ask got when it was typed. A build without an outbox gets the
 * Offline screen as it was (shell.ts).
 */
import type { ActionSpec, Condition, Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import {
  botAvatar, botLook, box, C, col, FACE, hasOutbox, icon, keepAsk, labelled, meta, roundButton, row, SCREENS, seq, statusMark, text, when, type BotsCtx,
} from "../kit.js";

/**
 * The Offline screen is the one page a build shows WITHOUT a connection, so a build with an outbox may keep it (a Bots page is otherwise
 * never kept: cacheTtlSeconds 0). It is fetched while online and shown from what was kept; its "Last online" is when that was.
 */
export const OFFLINE_KEEP_SECONDS = 24 * 3600;
export const offlineKept = (ctx: BotsCtx, s: ScreenResponse): ScreenResponse => (hasOutbox(ctx) ? { ...s, cacheTtlSeconds: OFFLINE_KEEP_SECONDS } : s);

/** How many asks are drawn: the rest still go, in order. */
export const OUTBOX_SLOTS = 5;

/**
 * What the Bots app's bootstrap tells a build with an outbox about going offline (catalog.ts, beside "bots.app"): Home is shown as the
 * Offline screen while the connection is down (and back when it returns); any other screen gets the line over it; and once the asks kept
 * offline went, the line that says so. A build without an outbox ignores them.
 */
export const BOTS_OFFLINE_FLAGS: Readonly<Record<string, unknown>> = {
  "offline.screenId": SCREENS.offline,
  "offline.roots": [SCREENS.home],
  "offline.bar": "You're offline · I'll keep working and catch you up",
  "offline.bar.font": FACE.regular,
  "offline.sentToast": "Sent. The answers are in Activity.",
};

const toast = (message: string): ActionSpec => ({ kind: "toast", message });
const slot = (i: number, key: string) => `outbox.${i}.${key}`;
const isState = (i: number, state: string): Condition => ({ eq: [slot(i, "state"), state] });

/** The state of one ask, in words and as its mark: waiting (dashed), sending, sent, couldn't send. */
function stateOf(i: number): { words: Node[]; mark: Node[] } {
  const said = (state: string, words: string) => when(isState(i, state), meta(words, { size: 12 }));
  return {
    words: [said("waiting", "Waiting to send"), said("sending", "Sending…"), said("sent", "Sent"), said("failed", "Couldn't send")],
    mark: [
      when(isState(i, "waiting"), statusMark("waiting", { size: 10 })),
      when(isState(i, "sending"), statusMark("working", { color: C.ink, size: 10 })),
      when(isState(i, "sent"), statusMark("done", { size: 10 })),
      when(isState(i, "failed"), statusMark("failed", { size: 10 })),
    ],
  };
}

/** A quiet word that does something (DOffline's Edit and Cancel). */
const link = (words: string, onPress: ActionSpec, label: string): Node =>
  labelled(box([text(words, { size: 13, color: C.grey70, lineHeight: 18, lines: 1 })], { paddingVertical: 6, paddingHorizontal: 2, flexShrink: 0 }, onPress), label);

/** One ask's row: who it is for, what was typed, when, its state; on the window, Edit and Cancel while it waits. */
function askRow(ctx: BotsCtx, i: number, o: { edit: boolean; last: boolean }): Node {
  const s = stateOf(i);
  const id = `$state.${slot(i, "id")}`;
  const cancel: ActionSpec = { kind: "outbox", op: "remove", id };
  const retry: ActionSpec = { kind: "outbox", op: "retry", id };
  const tailzu = ctx.live.bots.find((b) => b.slug === "tailzu") ?? botLook("tailzu");
  return when({ truthy: slot(i, "id") }, row([
    botAvatar(tailzu, 30),
    col([
      text("", { size: 14, lineHeight: 19, bind: slot(i, "label"), lines: 2 }),
      row([meta("", { size: 12, bind: slot(i, "sub"), lines: 1 }), meta("·", { size: 12 }), ...s.words], { gap: 4, flexWrap: "wrap" }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    // The window's Edit and Cancel while it waits (DOffline); a failed one can go again, or be dropped there.
    ...(o.edit ? [when(isState(i, "waiting"), row([
      link("Edit", seq({ kind: "setState", path: "later", value: `$state.${slot(i, "label")}` }, cancel) as ActionSpec, "Edit this ask"),
      link("Cancel", cancel, "Don't send this ask"),
    ], { gap: 14, flexShrink: 0 }))] : []),
    when(isState(i, "failed"), row([
      link("Try again", retry, "Send this ask again"),
      ...(o.edit ? [link("Cancel", cancel, "Don't send this ask")] : []),
    ], { gap: 14, flexShrink: 0 })),
    ...s.mark,
  ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, ...(o.last ? {} : { borderBottomWidth: 1, borderColor: C.line }) }));
}

/** The asks, in a bordered list, shown while there is one. */
export function outboxList(ctx: BotsCtx, o: { slots?: number; edit?: boolean } = {}): Node {
  const n = Math.min(o.slots ?? OUTBOX_SLOTS, OUTBOX_SLOTS);
  return when({ truthy: "outbox.0.id" }, col(Array.from({ length: n }, (_, i) => askRow(ctx, i, { edit: o.edit === true, last: i === n - 1 })), {
    borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden",
  }));
}

/** The line over the list: how many will go when the connection is back; that they went; or that asks can wait here. */
export function outboxHeading(o: { idle?: string } = {}): Node {
  const line = (words: string, size = 15) => text(words, { size, weight: 600, lineHeight: 20 });
  const waitMark = box([statusMark("waiting", { size: 12 })], { width: 16, alignItems: "center" });
  return col([
    when({ gt: ["outboxWaiting", 1] }, row([waitMark, row([text("", { size: 15, weight: 600, lineHeight: 20, bind: "outboxWaiting" }), line("asks will send when you're back")], { gap: 4 })], { gap: 8 })),
    when({ eq: ["outboxWaiting", 1] }, row([waitMark, line("1 ask will send when you're back")], { gap: 8 })),
    when({ all: [{ falsy: "outboxWaiting" }, { truthy: "outbox.0.id" }] }, row([box([statusMark("done", { size: 12 })], { width: 16, alignItems: "center" }), line("Sent. The answers are in Activity.")], { gap: 8 })),
    when({ all: [{ falsy: "outboxWaiting" }, { falsy: "outbox.0.id" }] }, row([icon("send", { size: 16 }), line(o.idle ?? "Asks wait here until you're back")], { gap: 8 })),
  ]);
}

/** The field to keep an ask in: Enter or + keeps it, for any bot, and it goes out on its own when the connection is back. */
export function outboxField(ctx: BotsCtx, placeholder: string): Node {
  const keep: ActionSpec = {
    kind: "condition", if: { falsy: "later" }, then: toast("Type the ask first"),
    else: seq(keepAsk(ctx.client, { message: "$state.later", label: "$state.later", sub: "Any bot · asked {time}" }), { kind: "clearState", path: "later" }) as ActionSpec,
  };
  const input: Node = {
    type: "TextField", id: "later", bind: { value: "later" },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, returnKeyType: "done", accessibilityLabel: "Add an ask",
    },
    on: { onSubmit: keep },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  return row([input, roundButton("plus", keep, { size: 40, label: "Keep this ask" })], {
    gap: 10, borderRadius: 26, borderWidth: 1, borderColor: C.line, paddingVertical: 5, paddingRight: 5, paddingLeft: 18,
  });
}

/** Offline's "waiting to send" column: the line, the asks, the field. */
export function outboxSection(ctx: BotsCtx): Node {
  return col([
    outboxHeading(),
    outboxList(ctx, { edit: ctx.client === "desktop" }),
    outboxField(ctx, "Ask a bot. It goes out when you are back."),
  ], { gap: 10 });
}

/**
 * Home, once there are asks from the outbox: the same line and list (three), so the person sees them go out when the connection is back,
 * and "Clear" once they all went. Nothing while the outbox is empty.
 */
export function outboxCard(ctx: BotsCtx): Node[] {
  return [when({ truthy: "outbox.0.id" }, col([
    row([outboxHeading(), box([], { flexGrow: 1 }), when({ falsy: "outboxWaiting" }, link("Clear", { kind: "outbox", op: "clear" }, "Clear the sent asks"))], { gap: 8 }),
    outboxList(ctx, { slots: 3 }),
  ], { gap: 10 }))];
}
