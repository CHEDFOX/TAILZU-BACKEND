/**
 * The Bots area's keysDesk screen.
 */

import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, box, text, C, seq, call, when, card, row, statusMark, button, grid, col, meta, sectionLabel, grow, divider, mono,
  segmented, page, botAvatar, back, title,
} from "../../kit.js";
import { MIN, dayKeyOf, DAY, shortDate, type BotView, isDesk, enc, toast, clearState, write, inputBox, field, lookOf, MONTHS } from "./parts.js";

/** "4 min ago", "Yesterday", "2 Oct". */
function ago(ctx: BotsCtx, ms: number): string {
  const now = ctx.live.now;
  const m = Math.max(0, Math.round((now - ms) / MIN));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, now)) return `${Math.round(m / 60)} h ago`;
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, now - DAY)) return "yesterday";
  return shortDate(ctx, ms);
}

// ===================================================================== bots.keys
export interface KeyView { id: string; label: string; masked: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null; active: boolean }
export interface Usage { usage: { month: string; requests: number; paise: number; byKey: Record<string, { requests: number; paise: number; lastAt: number }>; days: Array<{ day: string; requests: number }> }; ratePerMin: number; dayCapPaise: number; endpoint: string }
export interface KeysData { bot?: BotView; keys?: KeyView[]; usage?: Usage }

export const snippets = (endpoint: string, ask: string) => ({
  curl: `curl -X POST \\\n  ${endpoint} \\\n  -H "Authorization: Bearer $TZ_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message":"${ask}"}'`,
  js: `const r = await fetch("${endpoint}", {\n  method: "POST",\n  headers: { Authorization: \`Bearer \${process.env.TZ_KEY}\`,\n    "Content-Type": "application/json" },\n  body: JSON.stringify({ message: "${ask}" }),\n});\nconst { text } = await r.json();`,
  py: `import os, requests\nr = requests.post("${endpoint}",\n  headers={"Authorization": f"Bearer {os.environ['TZ_KEY']}"},\n  json={"message": "${ask}"})\nprint(r.json()["text"])`,
});
export const copyAction = (ctx: BotsCtx, s: string): ActionSpec => (isDesk(ctx) ? { kind: "copyText", text: s, message: "Copied" } : { kind: "copyToClipboard", text: s, toastMessage: "Copied" });
export const codeBlock = (s: string): Node => box([text(s, { size: 11.5, mono: true, color: C.grey70, lineHeight: 18 })], { backgroundColor: C.surface, borderRadius: 12, padding: 14 });

export function keysParts(ctx: BotsCtx, d: KeysData) {
  const bot = d.bot!;
  const u = d.usage?.usage;
  const keys = (d.keys ?? []).filter((k) => k.active);
  const endpoint = d.usage?.endpoint ?? `/v1/bots/${bot.slug}/ask`;
  const create = seq(
    call("POST", `/v1/bots/${enc(bot.slug)}/keys`, { label: "$state.label" }, { assignTo: "made", ok: seq(toast("Key made. Copy it now."), clearState("label")), fail: toast("Couldn't make a key. Try again.", true) }),
  );
  const revoke = (k: KeyView) => write("DELETE", `/v1/bots/${enc(bot.slug)}/keys/${enc(k.id)}`, undefined, { ok: `${k.label || "Key"} revoked` });
  const keyUse = (k: KeyView) => u?.byKey[k.masked];
  const keyMeta = (k: KeyView) => `Made ${shortDate(ctx, k.createdAt)} · ${k.lastUsedAt ? `used ${ago(ctx, k.lastUsedAt)}` : "not used yet"}`;
  const made = when({ truthy: "made.key" }, card([
    row([statusMark("done"), text("Your new key. It's shown this once.", { size: 13, weight: 600, lineHeight: 18 })], { gap: 8 }),
    box([text("", { size: 12, mono: true, lineHeight: 18, bind: "made.key" })], { backgroundColor: C.surface, borderRadius: 10, padding: 12 }),
    button("Copy key", copyAction(ctx, "$state.made.key"), { kind: "secondary", size: "md", icon: "check" }),
  ], { gap: 10 }));
  const labelField = inputBox([field("label", "label", "Name it: Website, Testing…", { onSubmit: create })], { radius: 14 });
  return { bot, u, keys, endpoint, create, revoke, keyUse, keyMeta, made, labelField };
}

export function keysDesk(ctx: BotsCtx, d: KeysData) {
  const k = keysParts(ctx, d);
  const look = lookOf(k.bot.slug, k.bot.colour);
  const days = k.u?.days ?? [];
  const top = Math.max(1, ...days.map((x) => x.requests));
  const busiest = days.reduce<{ day: string; requests: number } | null>((b, x) => (x.requests > (b?.requests ?? 0) ? x : b), null);
  const bars = row(days.map((x, i) => box([], {
    flexGrow: 1, flexBasis: 0, minWidth: 0, height: Math.max(4, Math.round((x.requests / top) * 100)), borderRadius: 2,
    backgroundColor: i === days.length - 1 ? look.color : C.outline,
  })), { gap: 3, alignItems: "flex-end", height: 104, borderBottomWidth: 1, borderBottomColor: C.line });
  const snip = snippets(k.endpoint, "Plan my next week");
  const usage = card([
    grid([
      col([text(k.u ? k.u.requests.toLocaleString("en-IN") : "—", { size: 34, weight: 700, lineHeight: 38, tracking: -0.5 }), meta(k.u ? `requests in ${k.u.month}` : "couldn't read usage", { size: 12 })], { gap: 2 }),
      col([text("Rate limit", { size: 14, weight: 600, lineHeight: 19 }), text(d.usage ? `${d.usage.ratePerMin} a minute` : "—", { size: 13, color: C.grey70, lineHeight: 18 }), meta("And a daily limit for each key", { size: 12 })], { gap: 4 }),
      col([text("What it uses", { size: 14, weight: 600, lineHeight: 19 }), text("Your plan", { size: 13, color: C.grey70, lineHeight: 18 }), meta("It counts toward Usage, in You", { size: 12 })], { gap: 4 }),
    ], 3, 16),
    col([
      row([sectionLabel("Requests a day"), grow(), meta(busiest ? `Busiest: ${Number(busiest.day.slice(8))} ${MONTHS[Number(busiest.day.slice(5, 7)) - 1]}, ${busiest.requests}` : "None yet this month", { size: 12 })]),
      days.length ? bars : meta("—", { size: 12 }),
      ...(days.length ? [row([meta(`1 ${MONTHS[Number(days[0]!.day.slice(5, 7)) - 1]}`, { size: 11 }), grow(), text("Today", { size: 11, weight: 500, lineHeight: 14 })])] : []),
    ], { gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.divider }),
  ], { gap: 16 });
  const keyTable = k.keys.length ? col([
    row([sectionLabel("Name", { style: { flexGrow: 1, flexBasis: 0 } }), sectionLabel("Key", { style: { width: 128 } }), sectionLabel("Last used", { style: { width: 80 } }), sectionLabel(k.u?.month ?? "This month", { style: { width: 100 } }), box([], { width: 52 })], { paddingVertical: 10, paddingHorizontal: 16, gap: 12 }),
    ...k.keys.flatMap((key) => {
      const use = k.keyUse(key);
      return [divider(), row([
        col([text(key.label || "Key", { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(`Made ${shortDate(ctx, key.createdAt)}`, { size: 12, lines: 1 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 }),
        box([mono(key.masked, { size: 11.5 })], { width: 128 }),
        text(key.lastUsedAt ? ago(ctx, key.lastUsedAt) : "Not yet", { size: 13, color: C.grey70, lineHeight: 18, style: { width: 80 } }),
        text(use ? use.requests.toLocaleString("en-IN") : "0", { size: 13, color: C.grey70, lineHeight: 18, style: { width: 100 } }),
        row([text("Revoke", { size: 13, color: C.grey70, lineHeight: 18 })], { width: 52, minHeight: 32 }, k.revoke(key)),
      ], { paddingVertical: 12, paddingHorizontal: 16, gap: 12 })];
    }),
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" }) : card([meta("No keys yet. Make one to call this bot from your own site or app.", { size: 13 })], { dashed: true });
  const tryIt = card([
    col([sectionLabel("Endpoint"), box([row([text("POST", { size: 11.5, mono: true, weight: 500, lineHeight: 17 }), text(k.endpoint, { size: 11.5, mono: true, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" })], { backgroundColor: C.surface, borderRadius: 8, padding: 10 })], { gap: 8 }),
    row([box([segmented([{ label: "curl", value: "curl" }, { label: "JavaScript", value: "js" }, { label: "Python", value: "py" }], "lang")], { flexGrow: 1 }),
      when({ eq: ["lang", "curl"] }, button("Copy", copyAction(ctx, snip.curl), { kind: "secondary", size: "md" })),
      when({ eq: ["lang", "js"] }, button("Copy", copyAction(ctx, snip.js), { kind: "secondary", size: "md" })),
      when({ eq: ["lang", "py"] }, button("Copy", copyAction(ctx, snip.py), { kind: "secondary", size: "md" }))], { gap: 10 }),
    when({ eq: ["lang", "curl"] }, codeBlock(snip.curl)),
    when({ eq: ["lang", "js"] }, codeBlock(snip.js)),
    when({ eq: ["lang", "py"] }, codeBlock(snip.py)),
    col([row([sectionLabel("Reply"), grow(), meta("JSON", { size: 12 })]), codeBlock(`{\n  "bot": "${k.bot.slug}",\n  "text": "…its answer…"\n}`)], { gap: 8 }),
  ], { gap: 14, style: { width: 390, flexShrink: 0 } });
  return page(ctx, {
    title: "Use it from your app", nav: k.bot.slug, maxWidth: 1120, state: { label: "", lang: "curl" },
    body: [
      row([
        col([
          row([botAvatar(look, 22), text(k.bot.name, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8, minHeight: 32 }, back()),
          title("Use it from your app", { size: 26 }), meta(`Your site or app asks ${k.bot.name}. Same rules as here.`, { size: 14 }),
        ], { gap: 4, flexGrow: 1, flexShrink: 1 }),
        col([row([box([k.labelField], { width: 240 }), button("Create key", k.create, { size: "md" })], { gap: 10 }), meta("You see a new key once. Each key has a daily limit.", { size: 12 })], { gap: 6, alignItems: "flex-end" }),
      ], { gap: 20, alignItems: "flex-end" }),
      k.made,
      row([col([usage, col([sectionLabel(`Keys · ${k.keys.length}`), keyTable], { gap: 8 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 24 }), tryIt], { gap: 24, alignItems: "flex-start" }),
    ],
  });
}
