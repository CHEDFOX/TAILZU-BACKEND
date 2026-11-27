/**
 * ONE FILE, SEEN OR PLAYED IN THE APP (bots.media; docs/bots-app.md "Media"): a photo, a video, a sound or any other file someone shared,
 * opened from a space's chat, a conversation, or Kutt's pictures, instead of being thrown out to the browser.
 *
 *   a photo     the whole picture, on a dark ground; Save to Photos, Share
 *   a video     played in the app, with its controls (a client with the `media` block); else its frame with a play mark that opens it;
 *               Save to Photos, Share
 *   a sound     a voice note or a song: play and pause in the app, how far it is (AudioPlay); Download, Share
 *   any file    a PDF, a sheet: its name and size; Open, Download, Share
 *
 * SAVING. Save to Photos and Download are download's `then` (MEDIA_SAVE_CAPABILITY): the file comes down to the phone and is saved to
 * Photos, or handed to the share sheet (Save to Files, AirDrop, another app), in one tap. A build without it gets "Open in browser",
 * where the file can still be kept. The window downloads to its own folder.
 *
 * WHERE FROM. Only an address on this server (a signed file link, a Kutt picture): params are the screen's own, but a link to anywhere
 * else is not opened as if it were the person's file. Anything else is a plain "can't be opened here".
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import { AUDIO_PLAY_CAPABILITY, MEDIA_SAVE_CAPABILITY } from "../../../../../shared/types/sdui.js";
import { type BotsCtx, C, SCREENS, box, col, emptyState, hasBlock, icon, meta, page, picture, primaryButton, row, secondaryButton, quietButton, text } from "../kit.js";
import { playButton, playingLine } from "../media.js";
import { screen } from "../registry.js";
import { vocab2, video } from "../../sdui2/build.js";
import { shapes } from "../glyphs.js";

export type MediaKind = "image" | "video" | "audio" | "file";

export function mediaKind(mime: string, name = ""): MediaKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["mp3", "m4a", "aac", "wav", "ogg", "opus"].includes(ext)) return "audio";
  return "file";
}

/** This server's own origin: the only place a file the viewer opens may come from. */
const origin = (): string => (process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").replace(/\/+$/, "");

/** The file's address, if it is one of ours: a path on this server, or an https address on its host. Null otherwise. */
export function safeMediaUrl(raw: unknown): string | null {
  const u = typeof raw === "string" ? raw.trim() : "";
  if (!u || u.length > 2000) return null;
  if (/^\/v1\/[^\s]*$/.test(u) && !u.includes("..")) return `${origin()}${u}`;
  try {
    const p = new URL(u), o = new URL(origin());
    return p.protocol === "https:" && p.host === o.host ? p.toString() : null;
  } catch { return null; }
}

/** Opens a file in the viewer. `url` must be ours (safeMediaUrl), or the viewer says it can't be opened. */
export function openMedia(f: { url: string; name: string; mime: string; size?: string }): ActionSpec {
  return { kind: "navigate", screenId: SCREENS.media, params: { u: f.url, n: f.name.slice(0, 120), m: f.mime.slice(0, 80), ...(f.size ? { s: f.size } : {}) } };
}

const toast = (message: string, tone?: "error"): ActionSpec => ({ kind: "toast", message, ...(tone ? { tone } : {}) });
const safeName = (name: string, fallback: string): string => name.replace(/[^\w .()-]+/g, "").trim().slice(0, 80) || fallback;

/** Save or download, in one tap where the build can; else the browser, where the file can still be kept. */
function saveActions(ctx: BotsCtx, url: string, name: string, mime: string, kind: MediaKind): Node[] {
  const canSave = ctx.can.has(MEDIA_SAVE_CAPABILITY);
  const desk = ctx.client === "desktop";
  const share: ActionSpec = desk ? { kind: "copyText", text: url, message: "Link copied" } : { kind: "share", url, title: name };
  const down = (then: "photos" | "files"): ActionRef => ({
    kind: "download", url, filename: safeName(name, kind), then, mimeType: mime, onError: toast("Couldn't download that. Try again.", "error"),
  } as ActionSpec);
  const keep = kind === "image" || kind === "video";
  return [
    ...(canSave && !desk ? [primaryButton(keep ? "Save to Photos" : "Download", down(keep ? "photos" : "files"), { size: "md" })] : []),
    ...(canSave && !desk && keep ? [secondaryButton("Save to Files", down("files"), { size: "md" })] : []),
    ...(desk ? [primaryButton("Download", { kind: "download", url, filename: safeName(name, kind) } as ActionSpec, { size: "md" })] : []),
    secondaryButton(desk ? "Copy link" : "Share", share, { size: "md" }),
    ...(!canSave && !desk ? [quietButton("Open in browser", { kind: "openUrl", url, external: true } as ActionSpec, { size: "md" })] : []),
  ];
}

/** The play mark over a video's frame, for a build that cannot play it here: a tap opens it. */
const PLAY = shapes([{ circle: [24, 24, 24], fill: "#000000", opacity: 0.55 }, { d: "M19 15.5v17l14-8.5z", fill: "#ffffff" }], { size: 64, viewBox: "0 0 48 48", label: "Play" });

function viewerBody(ctx: BotsCtx, url: string, name: string, mime: string, size: string): { body: Node[]; v2: boolean } {
  const kind = mediaKind(mime, name);
  const desk = ctx.client === "desktop";
  const w = desk ? 640 : 350, h = desk ? 420 : 300;
  const title = col([text(name, { size: 17, weight: 600, lineHeight: 22, lines: 2 }), ...(size ? [meta(size, { size: 12 })] : [])], { gap: 2 });
  const actions = row(saveActions(ctx, url, name, mime, kind), { gap: 8, flexWrap: "wrap" });
  if (kind === "image") {
    return { v2: false, body: [box([picture(url, w, h + 120, { fit: "contain", label: name })], { backgroundColor: "#0a0a0a", borderRadius: 18, overflow: "hidden", alignItems: "center", alignSelf: "stretch" }), title, actions] };
  }
  if (kind === "video") {
    const frame = box([box([PLAY], { width: "100%", height: h, alignItems: "center", justifyContent: "center" })],
      { width: "100%", height: h, backgroundColor: "#0a0a0a", borderRadius: 18, overflow: "hidden" }, { kind: "openUrl", url, external: true } as ActionSpec);
    if (hasBlock(ctx, "media")) {
      // The player, and the frame that opens it for a phone that cannot draw it after all (the media block switched off).
      const player = { ...video({ source: url, controls: true, contentFit: "contain", autoplay: false }, { style: { width: "100%", height: h, backgroundColor: "#0a0a0a", borderRadius: 18 } }), fallback: frame };
      return { v2: true, body: [player, title, actions] };
    }
    return { v2: false, body: [frame, title, meta("Tap to play it.", { size: 12 }), actions] };
  }
  if (kind === "audio") {
    const playable = ctx.can.has(AUDIO_PLAY_CAPABILITY);
    const id = `media:${url.slice(-40)}`;
    const player = playable
      ? col([row([playButton(id, url, `Play ${name}`), col([text(name, { size: 15, weight: 600, lineHeight: 20, lines: 1 }), ...(size ? [meta(size, { size: 12 })] : [])], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12, alignItems: "center" }), playingLine(id, C.ink)], { gap: 10 })
      : row([box([icon("mic", { size: 22, color: C.ink })], { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center" }, { kind: "openUrl", url, external: true } as ActionSpec), title], { gap: 12, alignItems: "center" });
    return { v2: false, body: [col([player], { padding: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }), actions] };
  }
  return { v2: false, body: [
    col([box([icon("clip", { size: 28, color: C.ink })], { width: 64, height: 64, borderRadius: 16, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }), title], { gap: 14, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: "flex-start" }),
    row([primaryButton("Open", { kind: "openUrl", url, external: true } as ActionSpec, { size: "md" }), ...saveActions(ctx, url, name, mime, kind).slice(0)], { gap: 8, flexWrap: "wrap" }),
  ] };
}

export function mediaPage(ctx: BotsCtx) {
  const url = safeMediaUrl(ctx.params.u);
  const name = String(ctx.params.n ?? "").slice(0, 120) || "File";
  const mime = String(ctx.params.m ?? "").slice(0, 80);
  const size = String(ctx.params.s ?? "").slice(0, 20);
  if (!url) {
    return page(ctx, { back: true, title: "File", body: [emptyState({ pose: "think", title: "This file can't be opened here", body: "It isn't one of yours on X0. Ask whoever sent it to send it again." })] });
  }
  const v = viewerBody(ctx, url, name, mime, size);
  const p = page(ctx, { back: true, title: name, gap: 16, ...(ctx.client === "desktop" ? { maxWidth: 720 } : {}), body: v.body });
  return v.v2 ? vocab2(p) : p;
}

export const mediaScreens = [screen<undefined>({ id: SCREENS.media, build: (ctx) => mediaPage(ctx) })];
