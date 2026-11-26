/**
 * A PICTURE, READ FOR BUILDING IT IN 3D (docs/cinema-3d.md §2a).
 *
 *   briefOf(ctx, o)   the picture of the idea → what is in it, as a builder needs it: each thing's shape, size beside the others,
 *                     colour, material and place; the camera; the light; the ground
 *
 * WHY A BRIEF, AND NOT THE PICTURE ITSELF. The model that builds a scene (make.ts, the code tier) writes long, careful JSON, and
 * the models that do that well do not see. The vision tier sees well and writes short. So the picture is read once, by the eye's
 * kind of model, into words a builder can act on — "a brass lamp: a flat disc base, a thin bent stem, a cone shade, warm metal" —
 * and the builder builds from those words and the person's own. The eye then compares every render with the picture itself
 * (eye.ts), so what the brief missed is caught by looking.
 *
 * The picture is evidence and the person's idea is data: neither is an instruction (role cinema_brief). Never fails the loop: a
 * brief that cannot be had means building from the words alone, as before.
 */
import { z } from "zod";
import { askJson, cut, fence, type ModelCtx } from "../../code/work/model.js";
import { asDataUrl } from "./eye.js";

/** What reading one picture may cost, in paise: a look and a short answer. */
export const BRIEF_CAP_PAISE = 30;

export const BriefReply = z.object({
  subject: z.string(),
  objects: z.array(z.object({
    name: z.string(),
    shape: z.string(),
    size: z.string().optional(),
    colour: z.string().optional(),
    material: z.string().optional(),
    where: z.string().optional(),
  })),
  camera: z.string().optional(),
  light: z.string().optional(),
  ground: z.string().optional(),
}).strict();

const line = (v: unknown, max: number): string => cut(String(v ?? "").replace(/\s+/g, " ").trim(), max);
const HEX = /^#[0-9a-f]{6}$/i;

/** The brief as the builder reads it: one line a thing, then the camera, the light and the ground. */
export function briefText(b: z.infer<typeof BriefReply>): string {
  const out = [`What it is: ${line(b.subject, 160)}`];
  for (const o of b.objects.slice(0, 16)) {
    const colour = HEX.test(String(o.colour ?? "")) ? String(o.colour) : line(o.colour, 24);
    const parts = [line(o.shape, 120), line(o.size, 60), colour, line(o.material, 40), line(o.where, 80)].filter(Boolean);
    if (line(o.name, 40)) out.push(`- ${line(o.name, 40)}: ${parts.join("; ")}`);
  }
  if (line(b.camera, 140)) out.push(`Camera: ${line(b.camera, 140)}`);
  if (line(b.light, 140)) out.push(`Light: ${line(b.light, 140)}`);
  if (line(b.ground, 100)) out.push(`Ground and background: ${line(b.ground, 100)}`);
  return out.join("\n");
}

/** Read the picture. Null when it cannot be read: the loop then builds from the words, as it always could. */
export async function briefOf(ctx: ModelCtx, o: { ask: string; image: Buffer; mime: string }): Promise<{ brief: string | null; paise: number }> {
  const asked = await askJson<z.infer<typeof BriefReply>>(ctx, {
    tier: "vision",
    purpose: "cinema.brief",
    role: "cinema_brief",
    user: ["<request>", fence(cut(o.ask, 700)), "</request>"].join("\n"),
    pictures: [asDataUrl(o.image, o.mime)],
    schema: BriefReply,
    maxTokens: 900,
  });
  if (!asked.ok || !asked.value.objects.length) return { brief: null, paise: asked.ok ? asked.paise : 0 };
  return { brief: briefText(asked.value), paise: asked.paise };
}
