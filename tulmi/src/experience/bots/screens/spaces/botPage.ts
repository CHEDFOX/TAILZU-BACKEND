/**
 * ONE OF A GROUP'S SUB-BOTS (bots.space.bot, params: id, bot): Plan, Notes, Travel or Xode inside a group. Each person's own part of
 * it, as much as they share (everything, or the items they picked), and what you share there yourself. Only you change yours.
 * Reads GET .../spaces/:id/bots/:bot/shared and .../mine; writes PUT .../mine (botsBots/spaceShares.ts).
 */
import type { ActionRef, ActionSpec, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botAvatar, botLook, call, chips, col, meta, page, row, seq, statusMark, switchMark, text, when } from "../../kit.js";
import { A, enc, names, rowPad, rowsCard, section, subBotName, SUB_BOTS, toast } from "./parts.js";
import { ago, clockOf, dayWords } from "./spaceDetail.js";

export type ShareMode = "all" | "some" | "none";
export interface ShareItem { id: string; title: string; line: string; at: number | null }
export interface SharedView {
  bot: string; space: { id: string; name: string };
  people: Array<{ userId: string; name: string; you: boolean; mode: ShareMode; items: ShareItem[] }>;
}
export interface MineView { bot: string; mode: ShareMode; items: string[]; own: ShareItem[] }
export interface BotPageData { shared?: SharedView; mine?: MineView }

const pickKey = (id: string) => `pick_${id.replace(/[^a-z0-9]/gi, "")}`;

/** When an item is: a day and time ahead, else how long ago. */
function whenOf(ctx: BotsCtx, it: ShareItem): string {
  if (it.at === null) return "";
  if (it.at > ctx.live.now) return it.line === "All day" || it.line === "To-do" ? dayWords(ctx, it.at) : `${dayWords(ctx, it.at)}, ${clockOf(ctx, it.at)}`;
  return ago(ctx, it.at);
}

/** One shared item: its title, its line and when. Xode's projects carry what Xode is doing on them. */
function itemRow(ctx: BotsCtx, bot: string, it: ShareItem, o: { inRow?: boolean } = {}): Node {
  const working = bot === "code" && it.line.startsWith("Working");
  const waiting = bot === "code" && it.line.startsWith("Waiting");
  return row([
    ...(working ? [statusMark("working", { size: 10, color: botLook(bot).color })] : waiting ? [statusMark("needs", { size: 10 })] : []),
    col([text(it.title, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta([it.line, whenOf(ctx, it)].filter(Boolean).join(" · "), { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ], { ...(o.inRow ? { paddingVertical: 14, paddingLeft: 16 } : rowPad), gap: 12, alignItems: "center", flexGrow: 1, flexShrink: 1, minWidth: 0 });
}

export function botPage(ctx: BotsCtx, d: BotPageData | undefined): ScreenResponse {
  const bot = String(ctx.params.bot ?? d?.shared?.bot ?? "");
  const spaceId = String(ctx.params.id ?? d?.shared?.space.id ?? "");
  const space = d?.shared?.space.name ?? "this space";
  const name = subBotName(ctx, bot);
  const what = SUB_BOTS[bot]?.what ?? "things";
  const others = (d?.shared?.people ?? []).filter((p) => !p.you);
  const sharing = others.filter((p) => p.mode !== "none");
  const quiet = others.filter((p) => p.mode === "none");
  const mine = d?.mine;
  const base = `${A}/spaces/${enc(spaceId)}/bots/${enc(bot)}/mine`;
  const put = (body: Record<string, unknown>, ok: string): ActionRef => call("PUT", base, body, { ok: seq(toast(ok), { kind: "refresh" } as ActionSpec), fail: toast("Couldn't change that. Try again.", true) });

  const head = row([
    botAvatar(botLook(bot), 44),
    col([text(`${name} in ${space}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`Each person's own ${what}, as much as they share. Only they can change it.`, { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 14, alignItems: "center" });

  const theirs: Node[] = sharing.map((p) => section(
    `${p.name} · ${p.mode === "all" ? "shares everything" : "shares some"}`,
    [p.items.length ? rowsCard(p.items.map((it) => itemRow(ctx, bot, it))) : meta(`Nothing in ${p.name}'s ${name} right now.`, { size: 13 })],
  ));
  const none = sharing.length ? [] : [meta(others.length ? `Nobody here shares their ${name} yet.` : `You're the only one in ${space} so far.`, { size: 13 })];
  const notYet = quiet.length && sharing.length ? [meta(`Not sharing: ${names(quiet.map((p) => p.name))}.`, { size: 12 })] : [];

  // What you share: everything, some (picked one by one) or nothing. Nothing until you choose.
  const own = mine?.own ?? [];
  const picked = new Set(mine?.items ?? []);
  const yours = mine ? section("What you share here", [
    chips([{ label: "Everything", value: "all" }, { label: "Pick some", value: "some" }, { label: "Nothing", value: "none" }], "shareMode", {
      onChange: put({ mode: "$state.shareMode" }, "Saved"),
    }),
    when({ eq: ["shareMode", "all"] }, meta(`Everyone in ${space} sees your ${name}: ${own.length === 1 ? "1 item" : `${own.length} items`}, and new ones as you add them. They can't change them.`, { size: 12 })),
    when({ eq: ["shareMode", "none"] }, meta(`Nobody in ${space} sees your ${name}.`, { size: 12 })),
    when({ eq: ["shareMode", "some"] }, own.length
      ? rowsCard(own.map((it) => {
        const k = pickKey(it.id);
        const flip = { kind: "condition", if: { truthy: k }, then: put({ item: it.id, on: false }, "Not shared"), else: put({ item: it.id, on: true }, "Shared") } as ActionSpec;
        return row([itemRow(ctx, bot, it, { inRow: true }), switchMark(k)], { alignItems: "center", gap: 12, paddingRight: 16 }, flip);
      }))
      : meta(`You have no ${what} in ${name} yet.`, { size: 12 })),
  ]) : null;

  const state: Record<string, unknown> = { shareMode: mine?.mode ?? "none", ...Object.fromEntries(own.map((it) => [pickKey(it.id), picked.has(it.id)])) };
  return page(ctx, {
    back: true, title: `${name} in ${space}`, nav: "you", state,
    body: [head, ...none, ...theirs, ...notYet, ...(yours ? [yours] : [])],
  });
}
