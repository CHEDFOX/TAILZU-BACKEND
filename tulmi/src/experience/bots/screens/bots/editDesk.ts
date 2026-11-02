/**
 * The Bots area's editDesk screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, call, seq, col, row, text, grow, roundButton, listCard, listRow, switchRow, quietButton, card, meta, toTab, sectionLabel,
  box, C, botAvatar, button, open, SCREENS, notice, page, back, title,
} from "../../kit.js";
import {
  type BotPageData, write, enc, ifFilled, toast, refresh, A, clearState, inputBox, field, colourDot, labelledIcon, lookOf, chatTurns,
} from "./parts.js";

const ALL_COLOURS = ["moss", "clay", "ochre", "sea", "pine", "plum", "sand", "stone"] as const;
/** The design gives the built-ins these colours (palette.ts), whatever src/bots calls them. */
const BUILTIN_COLOUR: Record<string, string> = { moss: "Code", clay: "Keylessbord", ochre: "Plan", sea: "Travel" };

export interface App { id: string; name: string; oneLine?: string; connected: boolean }

/** Tailzu's own calendar and to-dos, as a bot's apps (src/calendar/bots.ts); the old Google ids mean them now. */
const OWN_APP_LINE: Record<string, string> = {
  calendar: "Your days in X0 Bot", tasks: "Your to-dos in X0 Bot", "google-calendar": "Your days in X0 Bot", "google-tasks": "Your to-dos in X0 Bot",
};
/** Not offered in the Bots app: Tailzu keeps its own (routes/bots/botsYou.ts). */
const NOT_OFFERED_APPS = new Set(["google-calendar", "google-tasks"]);

// ===================================================================== bots.edit
export interface EditData extends BotPageData { apps?: App[]; mine?: Array<{ slug: string; colour: string; name: string; builtin: boolean }>; listed?: boolean }

const botPut = (slug: string, b: Record<string, unknown>, ok?: string) => write("PUT", `/v1/bots/${enc(slug)}`, b, { ok, fail: "Couldn't save that. Try again." });

export function editParts(_ctx: BotsCtx, d: EditData) {
  const bot = d.bot!;
  const slug = bot.slug;
  const takenBy = new Map<string, string>(Object.entries(BUILTIN_COLOUR));
  for (const b of d.mine ?? []) if (!b.builtin && b.slug !== slug) takenBy.set(b.colour, b.name.replace(/ bot$/i, ""));
  const facts = d.memory?.facts ?? [];
  const saveName = ifFilled("name", call("PUT", `/v1/bots/${enc(slug)}`, { name: "$state.name" }, { ok: seq(toast("Saved"), refresh), fail: toast("Couldn't save the name. Try again.", true) }), "A bot needs a name");
  const addRule = ifFilled("rule", seq(call("POST", `${A}/rules/${enc(slug)}`, { rule: "$state.rule" }, { ok: seq(clearState("rule"), refresh), fail: toast("Couldn't add that rule. Keep it to one short line.", true) })), "Write the rule first");

  const nameField = inputBox([field("name", "name", bot.name, { onSubmit: saveName })], { radius: 14 });
  const colours = col([
    row(ALL_COLOURS.map((c) => colourDot(c, { chosen: bot.colour === c, taken: takenBy.get(c), onPress: botPut(slug, { colour: c }) })), { gap: 4, flexWrap: "wrap" }),
  ], { gap: 6 });
  const takenLine = `Crossed out: another bot has it (${[...new Set(takenBy.values())].join(", ")})`;

  const ruleRows: Node[] = [
    ...bot.principles.map((p, i) => row([text(p, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), ...(bot.builtin ? [] : [labelledIcon("close", write("DELETE", `${A}/rules/${enc(slug)}/${i}`, undefined, { ok: "Rule removed" }), "Remove this rule")])], { gap: 8, paddingVertical: 10, paddingLeft: 16, paddingRight: 8, minHeight: 44 })),
    ...(bot.builtin ? [] : [row([field("rule", "rule", "Add a rule", { onSubmit: addRule }), roundButton("plus", addRule, { size: 34, label: "Add rule", light: true })], { gap: 8, paddingLeft: 16, paddingRight: 8, minHeight: 48 })]),
  ];
  const rules = listCard(ruleRows.length ? ruleRows : [listRow({ label: "No rules" })]);

  const linkedIds = new Set(bot.skills.connectors);
  const apps = new Map<string, { name: string; sub: string; on: boolean; connected: boolean }>();
  for (const l of d.linked ?? []) apps.set(l.id, { name: l.name, sub: OWN_APP_LINE[l.id] ?? (l.status === "connected" ? "Connected" : l.status === "not_connected" ? "Not connected yet" : "Not on this server"), on: true, connected: l.status === "connected" });
  // Tailzu's own calendar and to-dos: always there, nothing to connect (the Google ones are no longer offered).
  for (const id of ["calendar", "tasks"]) if (!apps.has(id) && !apps.has(`google-${id}`)) apps.set(id, { name: id === "calendar" ? "Calendar" : "Tasks", sub: OWN_APP_LINE[id]!, on: false, connected: true });
  for (const a of d.apps ?? []) if (a.connected && !apps.has(a.id) && !NOT_OFFERED_APPS.has(a.id)) apps.set(a.id, { name: a.name, sub: a.oneLine ?? "Connected", on: linkedIds.has(a.id), connected: true });
  const state: Record<string, unknown> = { name: bot.name, rule: "", s_web: bot.skills.web, s_files: bot.skills.files, s_listed: d.listed === true };
  const toolRows: Node[] = [
    switchRow("Search the web", "s_web", { sub: bot.skills.web ? "Finds and reads pages for you" : "Off · it never goes online", onChange: botPut(slug, { skills: { web: !bot.skills.web } }) }),
    switchRow("Your files", "s_files", { sub: bot.skills.files ? "Reads files you give it" : "Off · it never reads your files", onChange: botPut(slug, { skills: { files: !bot.skills.files } }) }),
    ...[...apps.entries()].map(([id, a], i) => {
      state[`a_${i}`] = a.on;
      return switchRow(a.name, `a_${i}`, { sub: a.sub, onChange: write(a.on ? "DELETE" : "PUT", `/v1/bots/${enc(slug)}/connectors/${enc(id)}`, undefined, { fail: "Couldn't change that app. Try again." }) });
    }),
  ];
  const memRows: Node[] = facts.map((f) => row([text(f.text, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), labelledIcon("close", write("DELETE", `/v1/bots/${enc(slug)}/memory/${enc(f.id)}`, undefined, { ok: "Forgotten" }), "Forget this")], { gap: 8, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, minHeight: 44 }));
  const memory = memRows.length
    ? listCard([...memRows, row([quietButton("Forget everything", write("DELETE", `/v1/bots/${enc(slug)}/memory`, undefined, { ok: "Forgotten" }), { size: "md" })], { paddingHorizontal: 4 })])
    : card([meta(d.memory ? `Nothing yet. ${bot.name} learns what you tell it about you, and you can forget any of it here.` : "Couldn't read what it remembers just now.", { size: 13 })], { dashed: true });
  const listing = bot.builtin ? null : switchRow("In Find a bot", "s_listed", {
    sub: d.listed ? "Listed · people can add a copy of it" : "People could add a copy: its name, rules and apps. Never your memory, files or keys.",
    onChange: write(d.listed ? "DELETE" : "PUT", `${A}/listing/${enc(slug)}`, undefined, { ok: d.listed ? "Taken off Find a bot" : "Listed in Find a bot" }),
  });
  const del = quietButton("Delete this bot", call("DELETE", `/v1/bots/${enc(slug)}`, undefined, { ok: seq(toast(`${bot.name} deleted`), toTab("bots")), fail: toast("Couldn't delete it. Try again.", true) }), { size: "md" });
  return { saveName, nameField, colours, takenLine, rules, toolRows, memory, listing, del, state, facts };
}

function settingRow(label: string, sub: string, control: Node, last = false): Node {
  return row([
    col([sectionLabel(label), meta(sub, { size: 12, lineHeight: 17 })], { width: 172, flexShrink: 0, gap: 6 }),
    box([control], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 24, alignItems: "flex-start", paddingVertical: 20, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: C.divider }) });
}

export function editDesk(ctx: BotsCtx, d: EditData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const p = editParts(ctx, d);
  const last = (d.turns ?? []).slice(-2);
  const preview = col([
    row([sectionLabel("Live preview"), grow(), meta("Its latest answer", { size: 12 })]),
    card([
      row([botAvatar(look, 40), col([text(bot.name, { size: 15, weight: 600, lineHeight: 20 }), text(bot.purpose, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })], { gap: 2, flexShrink: 1 })], { gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.divider }),
      ...(last.length ? chatTurns(ctx, bot, last) : [meta(`Ask ${bot.name} something and its answer shows here, with your rules in it.`, { size: 13 }), button(`Talk to ${bot.name}`, open(SCREENS.chat, { slug: bot.slug }), { kind: "secondary", size: "md" })]),
      ...(last.length ? [row(bot.principles.slice(0, 4).map((r) => box([text(r.length > 24 ? `${r.slice(0, 23)}…` : r, { size: 11.5, color: C.grey70, lineHeight: 15 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 })), { gap: 6, flexWrap: "wrap", paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider })] : []),
    ], { gap: 12 }),
    ...(bot.builtin ? [] : [col([p.del, meta(`Removes its rules and what it remembers. Your apps stay as they are.`, { size: 12 })], { gap: 2, alignItems: "flex-start" })]),
  ], { width: 330, flexShrink: 0, gap: 12 });
  const settings = col([
    ...(bot.builtin ? [notice("One of X0 Bot's own bots: its rules are fixed. What it remembers is yours to forget.")] : [
      settingRow("Name", "Shown in your bot list and in Spaces.", p.nameField),
      settingRow("Colour", p.takenLine, p.colours),
    ]),
    settingRow(`Rules · ${bot.principles.length}`, `${bot.name} follows these every time. Plain words work.`, p.rules),
    ...(bot.builtin ? [] : [settingRow("Tools and apps", "It asks before it uses an app for the first time.", listCard(p.toolRows))]),
    ...(p.listing ? [settingRow("Find a bot", "Share a copy with everyone. Turn it off any time.", listCard([p.listing]))] : []),
    settingRow(d.memory ? `It remembers · ${p.facts.length}` : "It remembers", "Learned from your chats. Forget anything, any time.", p.memory, true),
  ], { flexGrow: 1, flexShrink: 1, minWidth: 0 });
  return page(ctx, {
    title: `Edit ${bot.name}`, nav: bot.slug, maxWidth: 1080, state: p.state,
    body: [
      row([
        col([
          row([botAvatar(look, 22), text(bot.name, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8, minHeight: 32 }, back()),
          row([botAvatar(look, 36), title(bot.builtin ? bot.name : `Edit ${bot.name}`, { size: 26 })], { gap: 12 }),
        ], { gap: 4 }),
        grow(),
        meta(bot.builtin ? "Read only" : "Changes save as you go", { size: 12 }),
        button("Done", bot.builtin ? back() : call("PUT", `/v1/bots/${enc(bot.slug)}`, { name: "$state.name" }, { ok: back(), fail: toast("Couldn't save the name. Try again.", true) }), { size: "md" }),
      ], { gap: 14, alignItems: "flex-end" }),
      row([settings, preview], { gap: 32, alignItems: "flex-start" }),
    ],
  });
}
