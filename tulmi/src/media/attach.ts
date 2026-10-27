/**
 * THE FRONT DOOR'S WAY TO A FILE: A HANDLER FOR EVERY KIND THE REGISTRY USED TO ANSWER "COMING SOON" TO.
 *
 * `registerMedia(registry, media)` does two things to the attachment registry (front/attachments.ts):
 *
 *   1. gives it a TYPER, so the kind of a file is found from its bytes (sniff.ts) and not from the name or MIME the client sent: a zip called
 *      `photo.png` is an archive, and a PDF called `notes.txt` is a PDF;
 *   2. registers ONE handler for image, pdf, audio, video, document, data, archive, text, code and other. It has an `open`, so the registry
 *      hands it the whole reading:
 *
 *        the file comes with its bytes   ingest it (read once: media/service.ts), then find the part the question is about
 *        the file comes as a checksum    it was read before (POST /v1/files, or an earlier message): find the part from the database, with the
 *                                        bytes of nothing but the few chunks that match; no file is read again
 *        a picture                       described ONCE, for the question asked, by the vision tier through the existing image handler
 *                                        (role front_look); the description is kept as the picture's text, so the next question costs nothing
 *        a video                         its sound is already a transcript; a few of its key frames (3 at most) are looked at once the same way
 *        a small text or code file       (32 KB or less, sent with the message) stays with the front door's own reader, as before: nothing is stored
 *
 *      and what comes out is the few chunks that answer the question, wrapped as untrusted data (untrusted.ts), with the rows of any spreadsheet
 *      so a chart or a table can be offered.
 *
 * A refusal (a password, a bomb, a file too big, a kind we do not read) comes back as the sentence MediaError carries: nothing is guessed.
 */
import { imageHandler, RELEVANT_CHARS, type AttachmentHandler, type AttachmentRegistry, type OpenOutcome, type ReadCtx } from "../front/attachments.js";
import type { AttachmentKind, AttachmentRef } from "../front/types.js";
import { FRAMES_LOOKED_AT, MediaError, VISION_BYTES_MAX, attachmentKindOf, type MediaItem } from "./types.js";
import type { MediaService } from "./service.js";
import { sniff } from "./sniff.js";
import { stripMetadata } from "./strip.js";

/** Text and code this small, sent with the message, are read the front door's own way and not stored. */
export const SMALL_TEXT_BYTES = 32 * 1024;

/** The kind of a file from its bytes. A file that cannot be typed (a password, a bomb, a kind we do not read) is `other`, and `open` says why. */
export function retypeFromBytes(ref: Pick<AttachmentRef, "name">, data: Buffer): AttachmentKind {
  try {
    return attachmentKindOf(sniff(data, ref.name).kind);
  } catch {
    return "other";
  }
}

const KINDS: readonly AttachmentKind[] = ["image", "pdf", "audio", "video", "document", "data", "archive", "text", "code", "other"];

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function share(ctx: ReadCtx, parts: number): ReadCtx {
  const b = ctx.budget;
  return typeof b === "object" && b && "maxPaise" in b ? { ...ctx, budget: { maxPaise: Math.max(1, Math.floor(b.maxPaise / parts)) } } : ctx;
}

export function mediaHandler(media: MediaService): AttachmentHandler {
  /** A picture looked at by the vision tier, through the front door's own image handler. The copy it is sent has no metadata. */
  async function look(ref: AttachmentRef, data: Buffer, ctx: ReadCtx): Promise<{ text: string; paise: number }> {
    const got = await imageHandler.extract({ ref: { ...ref, kind: "image" }, data }, ctx);
    return { text: got.text, paise: got.paise };
  }

  /** The bytes of a picture as the vision tier can take them: no metadata, and shrunk when over the limit. Or why not, in words. */
  async function forVision(item: MediaItem, data: Buffer | undefined): Promise<{ data: Buffer; mime: string } | string> {
    let bytes = data ? (item.format === "jpeg" || item.format === "png" || item.format === "webp" || item.format === "gif" ? stripMetadata(data, item.format).data : data) : await media.bytesOf(item);
    if (!bytes) return "I no longer have that picture. Attach it again.";
    let mime = item.mime;
    if (bytes.length > VISION_BYTES_MAX) {
      if (!media.worker) return "That picture is over 4 MB, which is more than I can look at, and the picture shrinker is not switched on here.";
      const small = await media.worker.image(bytes, { maxSide: 1568, format: "jpeg", quality: 85 });
      bytes = small.data;
      mime = small.mime;
    }
    return bytes.length <= VISION_BYTES_MAX ? { data: bytes, mime } : "That picture is still over 4 MB after it was made smaller, so I cannot look at it.";
  }

  async function describePicture(userId: string, item: MediaItem, ref: AttachmentRef, data: Buffer | undefined, ctx: ReadCtx): Promise<{ item: MediaItem; paise: number } | string> {
    const pic = await forVision(item, data);
    if (typeof pic === "string") return pic;
    const seen = await look({ ...ref, mime: pic.mime }, pic.data, ctx);
    if (!seen.text.trim()) return "I could not make out that picture.";
    const next = await media.attachText(userId, item.id, seen.text);
    return { item: next ?? { ...item, text: seen.text, chars: seen.text.length, meta: { ...item.meta, chunks: 1 } }, paise: seen.paise };
  }

  async function describeFrames(userId: string, item: MediaItem, ref: AttachmentRef, ctx: ReadCtx): Promise<{ item: MediaItem; paise: number }> {
    const frames = item.meta.frames ?? [];
    // First, middle and last: the scene changes are already spread through the video.
    const picks = frames.length <= FRAMES_LOOKED_AT ? frames : [frames[0]!, frames[Math.floor(frames.length / 2)]!, frames[frames.length - 1]!];
    const lines: string[] = [];
    let paise = 0;
    for (const f of picks) {
      const bytes = await media.bytesOf(item, f.key);
      if (!bytes) continue;
      try {
        const seen = await look({ ...ref, name: `${ref.name} at ${clock(f.t)}`, mime: "image/jpeg" }, bytes, share(ctx, picks.length));
        paise += seen.paise;
        if (seen.text.trim()) lines.push(`Frame at ${clock(f.t)}: ${seen.text.trim()}`);
      } catch {
        // A frame the vision tier cannot read is skipped; the transcript still stands.
      }
    }
    const whole = (await media.store.get(userId, item.id))?.text ?? "";
    const text = [whole, lines.length ? `## What a few frames show\n\n${lines.join("\n\n")}` : ""].filter(Boolean).join("\n\n");
    const next = lines.length ? await media.attachText(userId, item.id, text, { framesDescribed: true }) : await media.store.update(userId, item.id, { meta: { ...item.meta, framesDescribed: true } });
    return { item: next ?? item, paise };
  }

  return {
    kinds: KINDS,

    // The registry hands the whole reading to `open`; extract is only here because the interface asks for it.
    async extract() { return { text: "", status: "unreadable" as const, paise: 0 }; },

    // A small text or code file sent with the message stays with the front door's own reader (nothing stored, lines numbered, kept in memory).
    takes: (ref, data) => !((ref.kind === "text" || ref.kind === "code") && data.length <= SMALL_TEXT_BYTES),

    async open({ userId, ref, data, question }, ctx): Promise<OpenOutcome> {
      let item: MediaItem | null;
      let cached: boolean;
      try {
        if (data) {
          const r = await media.ingest(userId, { name: ref.name, data });
          item = r.item;
          cached = r.cached;
        } else {
          item = await media.store.find(userId, ref.sha256, { light: true });
          cached = true;
        }
      } catch (err) {
        if (err instanceof MediaError) return { ok: false, status: err.code === "too_big" ? "too_big" : "unreadable", note: err.message };
        throw err;
      }
      if (!item) return { ok: false, status: "missing", note: "I no longer have that file. Attach it again." };

      let paise = 0;
      let described = false;
      const notes: string[] = [];
      if (item.kind === "image" && item.chars === 0) {
        const r = await describePicture(userId, item, ref, data, ctx);
        if (typeof r === "string") return { ok: false, status: "unreadable", note: r };
        item = r.item;
        paise += r.paise;
        described = true;
      } else if (item.kind === "video" && item.meta.frames?.length && !item.meta.framesDescribed) {
        const r = await describeFrames(userId, item, ref, ctx);
        item = r.item;
        paise += r.paise;
        described = true;
      }

      const text = await media.excerpt(userId, item, question, RELEVANT_CHARS);
      if (!text) return { ok: false, status: "unreadable", note: [...(item.meta.notes ?? [])].join(" ") || "I could not read that file as text." };
      notes.push(...(item.meta.notes ?? []));
      return {
        ok: true,
        opened: {
          text, status: described ? "described" : cached ? "cached" : "read", paise,
          ...(notes.length ? { note: notes.join(" ") } : {}), ...(item.meta.tables?.length ? { tables: item.meta.tables } : {}),
        },
      };
    },
  };
}

/** Switches the attachment registry over to the media feature: bytes decide the kind, and every kind has a handler. */
export function registerMedia(registry: AttachmentRegistry, media: MediaService): AttachmentHandler {
  const h = mediaHandler(media);
  registry.register(h);
  registry.useRetype(retypeFromBytes);
  return h;
}
