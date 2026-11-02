/**
 * The Bots area's sharePhone screen.
 */

import type { Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, box, text, C, meta, row, col, card, type LiveBot, seq, call, SCREENS, whenEq, page, emptyState, back, grow, sectionLabel,
  botAvatar, listCard, when, statusMark, primaryButton, quietButton,
} from "../../kit.js";
import { shareTo } from "../../shareAction.js";
import { plural, shortDate, lookOf, ifFilled, setState, A, toast, inputBox, field } from "./parts.js";

export const kb = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export interface MediaFile { id: string; name: string; mime: string; bytes: number; createdAt: number; pages?: number }

// bots.spaces and the rest of Spaces (members, invites, sharing, payments, tasks, chats): screens/spaces.ts

// ===================================================================== bots.share-in
export interface Attachment { id: string; name: string; mime: string; bytes: number; sha256: string; kind?: string }
export interface ShareData { file?: MediaFile; attachment?: Attachment; files?: MediaFile[]; attachments?: Attachment[]; pick?: string | null; ask?: string; line?: string }

export function sharedOf(ctx: BotsCtx, d: ShareData) {
  const text0 = String(ctx.params.text ?? "").slice(0, 2000);
  const url = String(ctx.params.url ?? "").slice(0, 2000);
  const files = d.files?.length ? d.files : d.file ? [d.file] : [];
  const file = files[0];
  const kind: "file" | "link" | "text" | null = file ? "file" : url ? "link" : text0 ? "text" : null;
  return { text: text0, url, file, files, kind };
}

export function sharedCard(ctx: BotsCtx, s: ReturnType<typeof sharedOf>): Node {
  const badge = (label: string) => box([text(label, { size: 10, weight: 600, color: C.grey70, lineHeight: 12 })], { width: 40, height: 48, borderRadius: 8, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });
  // Words that came with a file or a link (a caption, a page's title), under it.
  const said = s.text && s.text !== s.url && (s.file || s.url) ? [meta(s.text, { size: 12, lines: 2 })] : [];
  if (s.file) {
    const fileRow = (f: MediaFile, i: number) => row([
      badge((f.name.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase()),
      col([text(f.name, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta([kb(f.bytes), ...(f.pages ? [plural(f.pages, "page")] : []), shortDate(ctx, f.createdAt)].join(" · "), { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 }),
    ], { gap: 12, ...(i ? { paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider } : {}) });
    return card([...s.files.map(fileRow), ...said], { padding: 14, gap: 10 });
  }
  if (s.url) return card([row([badge("LINK"), col([text(s.url.replace(/^https?:\/\//, "").slice(0, 80), { size: 14, weight: 600, lineHeight: 19, lines: 2 }), meta("A link", { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12 }), ...said], { padding: 14, gap: 10 });
  return card([row([badge("TEXT"), text(s.text, { size: 14, lineHeight: 20, lines: 4, style: { flexShrink: 1 } })], { gap: 12, alignItems: "flex-start" })], { padding: 14 });
}

/** What came in, to a space or a person instead of a bot (screens/spaces.ts bots.share): the file (theirs), the link, or the words. */
export function sharePeople(s: ReturnType<typeof sharedOf>): ActionRef {
  if (s.file) return shareTo({ kind: "file", ref: s.file.id, title: s.file.name });
  if (s.url) return shareTo({ kind: "link", url: s.url, title: s.text && s.text !== s.url ? s.text.slice(0, 120) : s.url.replace(/^https?:\/\//, "").slice(0, 120) });
  return shareTo({ kind: "text", title: s.text.split("\n")[0]!.slice(0, 60) || "A note", text: s.text });
}

/** "Ask any bot": the front door gives it to the bot that fits (POST /v1/ask with bot "any"). Always on the list, last unless it is the pick. */
export const ASK_ANY = "any";
const askAny = (): LiveBot => ({ ...lookOf("tailzu"), slug: ASK_ANY, name: "Ask any bot", builtin: true, state: "idle", working: false, needs: 0, purpose: "X0 Bot picks the bot that fits" });

export const shareLineFor = (slug: string, name: string) => {
  switch (slug) {
    case ASK_ANY: return "X0 Bot gives it to the bot that fits best. It asks before it changes anything or spends money.";
    case "travel": return "Travel bot adds the times and booking details to your trip. It won't book or pay for anything.";
    case "plan": return "Plan Ease puts it on your calendar in X0 Bot. You can change it or take it out any time.";
    case "code": return "Xode reads it and answers. It changes code only through a pull request you approve.";
    case "keybot": return "Keylessbord writes it in your voice. You send it yourself.";
    default: return `${name} reads it and answers here. It asks before it changes anything or spends money.`;
  }
};
export const SHARE_LINE: Record<string, string> = { [ASK_ANY]: "X0 Bot picks the bot that fits", travel: "Reads tickets, keeps your trips in order", plan: "Calendar and reminders", code: "Projects and code", keybot: "Writes and replies in your voice" };

export function shareSend(ctx: BotsCtx, s: ReturnType<typeof sharedOf>, d: ShareData): ActionRef {
  const names = s.files.map((f) => f.name).join(", ").slice(0, 200);
  const attachments = d.attachments?.length ? d.attachments : d.attachment ? [d.attachment] : [];
  return ifFilled("what", seq(
    setState("sendingShare", true),
    call("POST", `${A}/share/compose`, { what: "$state.what", ...(names ? { name: names } : {}), ...(s.text ? { text: s.text } : {}), ...(s.url ? { url: s.url } : {}) }, {
      assignTo: "composed",
      ok: call("POST", "/v1/ask", { message: "$state.composed.message", bot: "$state.bot", device: ctx.client, mode: "text", ...(attachments.length ? { attachments } : {}) }, {
        assignTo: "asked",
        ok: seq(setState("sendingShare", false), { kind: "navigate", screenId: SCREENS.ask, params: { message: "$state.what", answer: "$state.asked.result.text", id: "$state.asked.id" }, replace: true }),
        fail: seq(setState("sendingShare", false), toast("Couldn't send it. Try again.", true)),
      }),
      fail: seq(setState("sendingShare", false), toast("Couldn't send it. Try again.", true)),
    }),
  ), "Say what it should do");
}

/** The person's bots and "Ask any bot", the pick first. */
export function shareBots(ctx: BotsCtx, pick: string | null | undefined): LiveBot[] {
  const list = [...ctx.live.bots, askAny()];
  return list.sort((a, b) => Number(b.slug === pick) - Number(a.slug === pick));
}

/** The front door's pick when it made one, else "Ask any bot". */
export const sharePick = (ctx: BotsCtx, d: ShareData): string => (d.pick && ctx.live.bots.some((b) => b.slug === d.pick) ? d.pick : ASK_ANY);

export function sharePhone(ctx: BotsCtx, d: ShareData) {
  const s = sharedOf(ctx, d);
  const pick = sharePick(ctx, d);
  const bots = shareBots(ctx, pick);
  const top = bots[0];
  const others = bots.slice(1).filter((b) => b.slug !== ASK_ANY);
  const rest = top?.slug === ASK_ANY ? others.slice(0, 4) : [...others.slice(0, 3), askAny()];
  const radio = (slug: string) => box([box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: C.paper })], {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: whenEq("bot", slug, C.ink, C.paper), borderWidth: 1.5, borderColor: whenEq("bot", slug, C.ink, C.outline),
  });
  const choose = (b: LiveBot) => seq(setState("bot", b.slug), setState("what", "$state.asks." + b.slug));
  if (!s.kind) {
    return page(ctx, { back: true, title: "Send to X0 Bot", nav: "bots", body: [emptyState({ pose: "hello", title: "Nothing to send yet", body: "From any app's Share menu, pick X0 Bot, and it lands here with the bot that fits best." })] });
  }
  const asks: Record<string, string> = {};
  for (const b of bots) asks[b.slug] = b.slug === pick && d.ask ? d.ask : defaultAsk(b.slug, s.kind);
  return page(ctx, {
    title: "Send to X0 Bot", nav: "bots", state: { bot: pick, what: asks[pick] ?? "", asks },
    body: [
      row([row([text("Cancel", { size: 15, color: C.grey70, lineHeight: 20 })], { minHeight: 44, paddingRight: 8 }, back()), grow(), text("Send to X0 Bot", { size: 16, weight: 600, lineHeight: 21 }), grow(), box([], { width: 50 })]),
      sharedCard(ctx, s),
      col([
        sectionLabel("Send to a bot"),
        ...(top ? [row([
          botAvatar(top, 30),
          col([row([text(top.name, { size: 15, weight: 600, lineHeight: 20 }), ...(top.slug === d.pick ? [box([text("Suggested", { size: 11, weight: 600, color: C.grey70, lineHeight: 14 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7 })] : [])], { gap: 8 }), meta(SHARE_LINE[top.slug] ?? top.purpose, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          radio(top.slug),
        ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: whenEq("bot", top.slug, top.color, C.line) }, choose(top))] : []),
        ...(rest.length ? [listCard(rest.map((b) => row([
          botAvatar(b, 30), col([text(b.name, { size: 15, lineHeight: 20 }), meta(SHARE_LINE[b.slug] ?? b.purpose, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }), radio(b.slug),
        ], { gap: 12, paddingVertical: 12, paddingHorizontal: 14 }, choose(b))))] : []),
      ], { gap: 8 }),
      col([
        sectionLabel("What should it do?"),
        inputBox([field("what", "what", "Say what it should do")], { radius: 14 }),
        ...bots.map((b) => when({ eq: ["bot", b.slug] }, meta(shareLineFor(b.slug, b.name), { size: 12, lineHeight: 17 }))),
        when({ truthy: "sendingShare" }, row([statusMark("working", { color: C.ink }), meta("Sending…", { size: 13 })], { gap: 8 })),
      ], { gap: 8 }),
    ],
    footer: [primaryButton("Send", shareSend(ctx, s, d), { wide: true }), quietButton("Share with a space or person", sharePeople(s), { wide: true, size: "md" })],
  });
}

export function defaultAsk(slug: string, kind: "file" | "link" | "text"): string {
  switch (slug) {
    case "travel": return kind === "file" ? "Add this trip to my plan" : "Keep this with my trip";
    case "plan": return "Put this on my calendar";
    case "code": return kind === "link" ? "Look at this and tell me what to change" : "Look at this";
    case "keybot": return "Write a reply to this";
    default: return kind === "file" ? "What's in this?" : "What should I do with this?";
  }
}
