/**
 * "ADD THIS LOGO TO THE PROJECT": A PICTURE MADE FIT FOR ITS USE AND COMMITTED THROUGH THE WORKSPACE, SO THE POLICY AND THE SIZE LIMITS APPLY.
 *
 *   1. the bytes: the picture the person sent, as it was kept (its metadata already gone), or bytes handed in
 *   2. the use decides the size: a logo is at most 512 px on its longest side, an icon 256, a favicon 128, an avatar 256, a thumbnail 480, a hero
 *      1920, a banner 1600, a photo 1600. A picture is never made bigger
 *   3. the format is the project's: webp or png, whichever the project's own images mostly are (read from its file tree); with no habit to follow,
 *      png for what is drawn (logo, icon, favicon, avatar: flat colour, transparency, crisp edges) and webp for what is photographed
 *   4. the worker (Pillow) makes it: resized, converted, metadata stripped, and made smaller again while it is over the 1 MB a commit may carry.
 *      Without the worker, the picture is committed as it is (metadata stripped here) if it is small enough, and the notes say it was not resized
 *   5. an SVG is text: it is checked (no script, no event handler, no foreignObject, nothing loaded from elsewhere) and committed as it is, or refused
 *   6. where: the folder the project already keeps its images in (the one with the most), else public/, src/assets/ or assets/; a name that is
 *      taken gets -2, -3: a new picture never silently replaces an old one
 *   7. committed with `workspace.commit`: on a branch Tailzu made it is done; on any other it is a question for the person (policy.ts), and a path
 *      into .github/workflows is refused. The result is the commit, or that question
 *
 * The bytes go to GitHub as a blob (github.ts: a CommitFile with encoding "base64"), and the secret scan, the size limit and the approval's
 * digest all see the same base64 text, so nothing about a picture is exempt from what a text file is held to.
 */
import { FILE_MAX_BYTES, type CommitFile, type TreeEntry } from "../code/github.js";
import type { Gated } from "../code/policy.js";
import type { Workspace } from "../code/projects.js";
import { decodeText, sniff } from "./sniff.js";
import { stripMetadata } from "./strip.js";
import { MediaError } from "./types.js";
import type { WorkerClient } from "./worker.js";

export const ASSET_USES = {
  logo: { side: 512, format: "png" },
  icon: { side: 256, format: "png" },
  favicon: { side: 128, format: "png" },
  avatar: { side: 256, format: "png" },
  thumbnail: { side: 480, format: "webp" },
  hero: { side: 1920, format: "webp" },
  banner: { side: 1600, format: "webp" },
  photo: { side: 1600, format: "webp" },
} as const;
export type AssetUse = keyof typeof ASSET_USES;
export const isAssetUse = (v: unknown): v is AssetUse => typeof v === "string" && Object.prototype.hasOwnProperty.call(ASSET_USES, v);

export interface AssetInput {
  data: Buffer;
  /** The picture's name as the person knew it: the file is named after it. */
  name: string;
  use: AssetUse;
  /** Where in the repo, if the person said. Otherwise chosen from the project's own layout. */
  path?: string;
  /** webp or png, if the person said. Otherwise the project's habit. */
  format?: "webp" | "png";
  message?: string;
  /** The id of the question the policy asked, when the person said yes to it: the same commit is made again, with it. */
  approvalId?: string;
}

export type AssetOutcome =
  | { ok: true; path: string; format: string; bytes: number; width?: number; height?: number; commit: Gated<{ sha: string; parentSha: string }>; notes: string[] }
  | { ok: false; why: string };

// ------------------------------------------------------------------ reading the project

const IMAGE_EXT = /\.(png|webp|jpe?g|gif|svg|ico|avif)$/i;
const SKIP_DIR = /(?:^|\/)(?:node_modules|dist|build|out|coverage|\.next|\.git|tests?|__tests__|e2e|docs?|vendor|fixtures?|snapshots?|__snapshots__)(?:\/|$)/i;
const HOMES = ["public/images", "public/assets", "public/img", "public", "src/assets", "src/images", "assets", "static", "images"];

/** The project's habit: the format most of its raster images are in (when there are enough to say), and the folder most of its images are in. */
export function habitsOf(entries: readonly Pick<TreeEntry, "path" | "type">[]): { format: "webp" | "png" | null; dir: string | null } {
  const files = entries.filter((e) => e.type === "blob" && IMAGE_EXT.test(e.path) && !SKIP_DIR.test(e.path));
  const webp = files.filter((f) => /\.webp$/i.test(f.path)).length;
  const png = files.filter((f) => /\.png$/i.test(f.path)).length;
  const format = webp + png >= 2 ? (webp >= png * 1.5 ? "webp" : png >= webp * 1.5 ? "png" : null) : null;
  const byDir = new Map<string, number>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    if (dir) byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  const best = [...byDir].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0];
  return { format, dir: best ? best[0] : null };
}

function homeFor(entries: readonly Pick<TreeEntry, "path" | "type">[], habit: string | null): string {
  if (habit) return habit;
  // Folders: the tree's own entries, and every folder a file is in (a listing may hold only the files).
  const dirs = new Set<string>();
  for (const e of entries) {
    if (e.type === "tree") dirs.add(e.path);
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const h of HOMES) if (dirs.has(h)) return h;
  return dirs.has("src") ? "src/assets" : "assets";
}

const slug = (name: string): string => (name.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "image").slice(0, 48);

function uniquePath(taken: ReadonlySet<string>, dir: string, base: string, ext: string): string {
  const at = (n: number): string => `${dir ? `${dir}/` : ""}${base}${n > 1 ? `-${n}` : ""}.${ext}`;
  for (let n = 1; n < 100; n += 1) if (!taken.has(at(n).toLowerCase())) return at(n);
  return at(Date.now() % 100_000);
}

// ------------------------------------------------------------------ svg

/** Why an SVG is not safe to commit as it is, or null. The picture is text and runs nothing, but a page that embeds it inline would. */
export function unsafeSvg(svg: string): string | null {
  if (/<script\b/i.test(svg)) return "it has a script in it";
  if (/<foreignObject\b/i.test(svg)) return "it has a foreignObject, which can hold a web page";
  if (/\son[a-z]+\s*=/i.test(svg)) return "it has an event handler (onclick, onload and the like)";
  if (/javascript:/i.test(svg)) return "it has a javascript: link";
  if (/<(?:iframe|embed|object|audio|video)\b/i.test(svg)) return "it embeds another document";
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(svg)) return "it declares entities, which is how an SVG is made to load other files";
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*["']\s*([^"']*)["']/gi)) {
    const v = m[1]!.trim();
    if (v && !v.startsWith("#") && !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(v)) return "it loads something from another address";
  }
  if (/url\(\s*["']?\s*(?!#)(?:https?:)?\/\//i.test(svg)) return "it loads something from another address";
  return null;
}

// ------------------------------------------------------------------ the whole

const BUDGETS = [1, 0.75, 0.5, 0.35] as const;

export async function insertAsset(
  deps: { worker: WorkerClient | null },
  ws: Pick<Workspace, "commit" | "tree">,
  input: AssetInput,
): Promise<AssetOutcome> {
  if (!isAssetUse(input.use)) return { ok: false, why: `Say what the picture is for: ${Object.keys(ASSET_USES).join(", ")}.` };
  let sniffed;
  try { sniffed = sniff(input.data, input.name); } catch (err) { return { ok: false, why: err instanceof MediaError ? err.message : "I could not read that file." }; }
  const isSvg = sniffed.format === "svg";
  if (sniffed.kind !== "image" && !isSvg) return { ok: false, why: "That is not a picture, so it cannot be added as one. I can add PNG, JPEG, WebP, GIF and SVG." };

  const { entries } = await ws.tree();
  const habit = habitsOf(entries);
  const taken = new Set(entries.map((e) => e.path.toLowerCase()));
  const notes: string[] = [];
  const spec = ASSET_USES[input.use];
  const base = slug(input.name);

  const explicit = (ext: string): { dir: string; base: string; path?: string } => {
    if (!input.path) return { dir: homeFor(entries, habit.dir), base };
    const p = input.path.replace(/^\.?\//, "");
    // A path with its own extension is taken as it is; a folder (ends with /) gets the generated name.
    if (p.endsWith("/")) return { dir: p.replace(/\/+$/, ""), base };
    const want = p.replace(/\.[^./]+$/, "");
    return { dir: "", base, path: `${want}.${ext}` };
  };

  const file = (path: string, f: Omit<CommitFile, "path">): CommitFile => ({ path, ...f });
  const message = input.message?.trim() || `Add ${input.use}: ${base}`;

  if (isSvg) {
    const text = decodeText(input.data);
    const bad = unsafeSvg(text);
    if (bad) return { ok: false, why: `I did not add that SVG: ${bad}. Send a clean export (no scripts, no links out) and I will.` };
    if (Buffer.byteLength(text, "utf8") > FILE_MAX_BYTES) return { ok: false, why: "That SVG is over 1 MB, which is more than a commit may carry." };
    const e = explicit("svg");
    const path = e.path ?? uniquePath(taken, e.dir, e.base, "svg");
    const commit = await ws.commit([file(path, { content: text })], message, input.approvalId ? { approvalId: input.approvalId } : {});
    return { ok: true, path, format: "svg", bytes: Buffer.byteLength(text, "utf8"), commit, notes };
  }

  const format: "webp" | "png" = input.format ?? habit.format ?? spec.format;
  if (!input.format && habit.format) notes.push(`This project's pictures are mostly ${habit.format}, so I made it ${habit.format}.`);
  let bytes: Buffer | null = null;
  let width: number | undefined;
  let height: number | undefined;
  let usedFormat: string = format;

  if (deps.worker) {
    for (const k of BUDGETS) {
      try {
        const out = await deps.worker.image(input.data, { maxSide: Math.round(spec.side * k), format, quality: k === 1 ? 82 : Math.round(82 * k) });
        if (out.data.length <= FILE_MAX_BYTES) { bytes = out.data; width = out.width; height = out.height; usedFormat = out.format; break; }
      } catch (err) {
        if (err instanceof MediaError) return { ok: false, why: err.message };
        throw err;
      }
    }
    if (!bytes) return { ok: false, why: `Even at a smaller size that picture is over 1 MB, which is more than a commit may carry. Send a simpler one.` };
  } else {
    const keep = sniffed.format;
    bytes = stripMetadata(input.data, keep).data;
    usedFormat = keep;
    if (bytes.length > FILE_MAX_BYTES) return { ok: false, why: "That picture is over 1 MB, and the picture shrinker is not switched on here, so I cannot make it smaller." };
    notes.push("The picture shrinker is not switched on here, so the picture was added as it is (its metadata was taken out) and not resized.");
  }

  const ext = usedFormat === "jpeg" ? "jpg" : usedFormat;
  const e = explicit(ext);
  const path = e.path ?? uniquePath(taken, e.dir, e.base, ext);
  const commit = await ws.commit([file(path, { content: bytes.toString("base64"), encoding: "base64" })], message, input.approvalId ? { approvalId: input.approvalId } : {});
  return { ok: true, path, format: usedFormat, bytes: bytes.length, ...(width ? { width } : {}), ...(height ? { height } : {}), commit, notes };
}
