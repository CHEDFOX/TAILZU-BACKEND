/**
 * THE BOT'S ARTIFACT TOOLS: THREE, IN THE BRAIN'S ToolDef FORMAT, FOR ANY BOT.
 *
 *   artifact_create {type, title, content, projectId?}   make an artifact (a page, a React component, SVG, a diagram, markdown)
 *   artifact_update {id, edits: [{old, new}]}            change it with exact replacements: each old occurs once, all or nothing
 *   artifact_rewrite {id, content}                       the whole new text, only when most of it changes
 *
 * The tools are the cheap way to work, and the descriptions say so to the model: an update sends only the
 * lines that change (a fraction of a rewrite's tokens, and the stored version is just that patch), and a
 * failed update names the edit that missed, so the next call can be right. A tool never throws at the model:
 * a refusal (a secret, an import that is not available, a text that is not unique) comes back as a result that
 * says what to do instead, and a failure of ours as one plain sentence. Every result says what the change cost.
 *
 * Any bot can use them: `runArtifactTool(service, ctx, call)` takes the person the bot works for. The Code
 * bot's agent loop and the other bots add ARTIFACT_TOOLS to their own and route these names here.
 */
import type { ToolCall, ToolDef } from "../code/brain/types.js";
import type { ArtifactService } from "./service.js";
import { ARTIFACT_LIBS } from "./protocol.js";
import { ARTIFACT_TYPES, isArtifactError, type Change } from "./types.js";
import { diffSpan } from "./versions.js";

export const ARTIFACT_TOOL_NAMES = ["artifact_create", "artifact_update", "artifact_rewrite"] as const;
export type ArtifactToolName = (typeof ARTIFACT_TOOL_NAMES)[number];

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, required, properties });

export const ARTIFACT_TOOLS: readonly ToolDef[] = [
  {
    name: "artifact_create",
    description:
      "Make an artifact: a small live thing the person sees and clicks in the app, shown beside the chat. `type` is html (one self-contained page), react (one default-exported component), svg, mermaid (diagram text) or markdown. "
      + `It runs in a sandbox with NO network and no secrets: no fetch, no external script, stylesheet, font or image (inline SVG, CSS and data: URIs instead). A react artifact may import only ${ARTIFACT_LIBS.join(", ")}. `
      + "`content` is the whole source. Pass projectId when it is about one of the person's projects, so it can look like that project. Returns the artifact's id.",
    parameters: obj({
      type: { type: "string", enum: [...ARTIFACT_TYPES] }, title: { type: "string", minLength: 1, maxLength: 120 }, content: { type: "string", minLength: 1 },
      projectId: { type: "string", maxLength: 64 },
    }, ["type", "title", "content"]),
  },
  {
    name: "artifact_update",
    description:
      "Change an artifact you made, with exact replacements. PREFER THIS to artifact_rewrite: you send only the lines that change, so it costs a fraction of a rewrite. "
      + "Each edit's `old` is copied EXACTLY from the artifact (spaces and all) and occurs ONCE in it: include a line or two around it when needed. Every edit is matched against the artifact as it is now, not against the edits before it, and edits must not overlap. "
      + "All the edits apply or none does; if one misses, the answer names it and nothing is changed.",
    parameters: obj({
      id: { type: "string", maxLength: 64 },
      edits: { type: "array", minItems: 1, maxItems: 40, items: obj({ old: { type: "string", minLength: 1 }, new: { type: "string" } }, ["old", "new"]) },
    }, ["id", "edits"]),
  },
  {
    name: "artifact_rewrite",
    description:
      "Replace an artifact's whole text. ONLY when most of it changes (a different design, a new structure): it costs the whole artifact in tokens, where artifact_update costs only what changed. `content` is the whole new source.",
    parameters: obj({ id: { type: "string", maxLength: 64 }, content: { type: "string", minLength: 1 } }, ["id", "content"]),
  },
];

/** Whose tools these are: the person the bot works for, and the project it is in, if any. */
export interface ArtifactToolContext {
  userId: string;
  projectId?: string;
}

export interface ArtifactToolResult {
  ok: boolean;
  /** Words for the model: what happened, or what to do instead. */
  content: string;
  /** The artifact the call made or changed, for the app to show. */
  artifactId?: string;
  version?: number;
}

/** A rewrite that changed less than this share of the artifact should have been an update. */
export const REWRITE_SMALL_SHARE = 0.25;

const receipt = (c: Change, what: string): string => {
  const kb = c.how.artifactChars !== undefined ? ` (${(c.how.artifactChars / 1024).toFixed(1)} KB)` : "";
  const warn = c.how.warnings.length ? ` Warning: ${c.how.warnings.join(" ")}` : "";
  // No cost in it: what the model reads it may say to the person, and the app shows no money.
  return `${what} "${c.artifact.title}"${kb}: artifact ${c.artifact.id}, now version ${c.version}.${warn}`;
};

const parsed = (raw: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
};

export async function runArtifactTool(service: ArtifactService, ctx: ArtifactToolContext, call: Pick<ToolCall, "name" | "arguments">): Promise<ArtifactToolResult> {
  const a = parsed(call.arguments);
  if (!a) return { ok: false, content: "The arguments were not a JSON object. Call the tool again with valid JSON." };
  try {
    switch (call.name) {
      case "artifact_create": {
        const c = await service.create(ctx.userId, { type: a.type, title: a.title, content: a.content, projectId: a.projectId ?? ctx.projectId ?? null, madeBy: "bot", note: "Created" });
        return { ok: true, content: receipt(c, "Made"), artifactId: c.artifact.id, version: c.version };
      }
      case "artifact_update": {
        const c = await service.update(ctx.userId, String(a.id ?? ""), a.edits);
        return { ok: true, content: receipt(c, "Changed"), artifactId: c.artifact.id, version: c.version };
      }
      case "artifact_rewrite": {
        if (typeof a.content !== "string") return { ok: false, content: "content is the artifact's whole new source, as text." };
        const before = await service.load(ctx.userId, String(a.id ?? ""));
        const c = await service.rewrite(ctx.userId, before.artifact.id, a.content);
        // The text is already written, so it is kept; but if little of it changed, say what would have been cheaper.
        const hunk = diffSpan(before.content, a.content)[0];
        const changed = hunk ? Math.max(hunk[1], hunk[2].length) / Math.max(1, Math.max(before.content.length, a.content.length)) : 0;
        const nudge = changed < REWRITE_SMALL_SHARE
          ? ` Only about ${Math.max(1, Math.round(changed * 100))}% of it changed: next time use artifact_update with just the lines that change, which costs a fraction of this.`
          : "";
        return { ok: true, content: receipt(c, "Rewrote") + nudge, artifactId: c.artifact.id, version: c.version };
      }
      default:
        return { ok: false, content: `There is no tool called ${call.name}.` };
    }
  } catch (err) {
    if (isArtifactError(err)) return { ok: false, content: err.message };
    if (err instanceof Error && /artifact store/.test(err.message)) return { ok: false, content: "The artifact could not be saved just now. Try again in a moment." };
    throw err;
  }
}

/** Whether a tool call is one of these. */
export const isArtifactTool = (name: string): name is ArtifactToolName => (ARTIFACT_TOOL_NAMES as readonly string[]).includes(name);

