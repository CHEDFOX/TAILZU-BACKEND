/**
 * THE EYE ON A RENDER. A model that cannot see what it built will confidently hand back a black frame.
 *
 *   lookAt(ctx, o)   the ask and the picture → whether it is what was wanted, what is wrong, and the one change to make
 *
 * This is the half of the loop that makes the other half work. Building a scene blind is guesswork; building one, looking at
 * it and fixing the two things that are wrong is how a person does it. It runs on the vision tier, costs about as much as a
 * short answer, and never fails the job: an eye that is down or over budget simply means the round passes unjudged.
 */
import { z } from "zod";
import { askJson, cut, fence, type ModelCtx } from "../../code/work/model.js";

export interface Verdict {
  ok: boolean;
  /** What is wrong, shortest first. Empty when nothing is. */
  issues: string[];
  /** The one change that would help most. */
  fix: string;
}

export const EyeReply = z.object({
  ok: z.boolean(),
  issues: z.array(z.string()).max(6).optional(),
  fix: z.string().optional(),
});

/** What one look may cost, in paise. */
export const EYE_CAP_PAISE = 25;
const ASK_CHARS = 700;

/** The picture, as a model is given one. */
export const asDataUrl = (png: Buffer, mime = "image/png"): string => `data:${mime};base64,${png.toString("base64")}`;

/**
 * One look at one render. `ask` is what the person wanted, in their words; `png` is the preview just made. A verdict comes
 * back for the next round to read, or null when the eye could not be asked.
 */
export async function lookAt(ctx: ModelCtx, o: { ask: string; png: Buffer; round: number; reference?: { bytes: Buffer; mime: string } }): Promise<{ verdict: Verdict | null; paise: number }> {
  // Built from a picture of the idea (brief.ts): the eye sees that picture first and the render second, and judges how close
  // the one is to the other, which is the whole point of starting from a picture.
  const user = [
    `<request>`, fence(cut(o.ask, ASK_CHARS)), `</request>`,
    ...(o.reference ? ["", "The first picture is the idea they want built. The second is the render to judge against it."] : []),
  ].join("\n");
  const asked = await askJson<z.infer<typeof EyeReply>>(ctx, {
    tier: "vision",
    purpose: "cinema.eye",
    role: "cinema_eye",
    user,
    pictures: [...(o.reference ? [asDataUrl(o.reference.bytes, o.reference.mime)] : []), asDataUrl(o.png)],
    schema: EyeReply,
    maxTokens: 400,
    step: o.round,
  });
  if (!asked.ok) return { verdict: null, paise: 0 };
  const v = asked.value;
  return {
    verdict: {
      ok: v.ok === true,
      issues: (v.issues ?? []).map((s) => cut(String(s).replace(/\s+/g, " ").trim(), 140)).filter(Boolean).slice(0, 2),
      fix: cut(String(v.fix ?? "").replace(/\s+/g, " ").trim(), 200),
    },
    paise: asked.paise,
  };
}
