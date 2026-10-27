/**
 * THE WORDS THE ARTIFACT CORE IS MADE OF: WHAT IS KEPT, WHAT A CHANGE COSTS, AND THE NUMBERS THAT BOUND IT.
 *
 * An artifact is a small live thing a bot makes (a page, a React component, SVG, a diagram,
 * markdown) that the person sees and clicks in the app. The contract with the viewer is
 * protocol.ts and is not repeated here; this is the server's side of it, and docs/artifacts.md
 * is the story.
 *
 * WHAT IS KEPT. An artifact is a row (who, what kind, its title, which version is the head) and
 * a run of VERSIONS. Version 1 is a snapshot (the whole text); after it, a version is a PATCH
 * against the one before it (the few spans that changed), and every tenth version is a snapshot
 * again, so no version is more than nine patches from a whole text. Storage stays tiny however
 * often a bot edits, and any version can be rebuilt (versions.ts). Saved DATA (what the artifact
 * itself stores while it runs) is separate: a key and a value per scope, shared or one person's.
 *
 * Nothing in this file reaches a network or a store.
 */
import type { ArtifactType } from "./protocol.js";

export type { ArtifactType } from "./protocol.js";
export const ARTIFACT_TYPES: readonly ArtifactType[] = ["html", "react", "svg", "mermaid", "markdown"];

// ------------------------------------------------------------------ numbers

/** A snapshot is stored for version 1 and every this-many versions after it; the versions between are patches. */
export const SNAPSHOT_EVERY = 10;
/** A patch bigger than this share of the text it makes is stored as a snapshot instead: it is no cheaper, and it is simpler to rebuild. */
export const PATCH_MAX_SHARE = 0.6;
/** The longest title, the longest note on a version. */
export const TITLE_MAX = 120;
export const NOTE_MAX = 300;
/** Edits in one artifact_update, and the most of an `old` or `new` string one edit may carry. */
export const EDITS_MAX = 40;
/** Versions a list returns at most. */
export const VERSIONS_LIST_MAX = 200;
/** A person's artifacts a list returns at most. */
export const LIST_MAX = 100;
/** Artifacts one person may keep. */
export const ARTIFACTS_PER_PERSON = 500;
/** The longest saved-data key. */
export const KEY_MAX = 128;
/** How many contents the service keeps in memory (the heads being edited), so a repeat edit reads no rows. */
export const CONTENT_CACHE = 64;

/** What one call to a model for an artifact may cost, in paise, in the worst case (the gateway refuses a call that could pass it). */
export const CAP_PAISE = { cheap: 150, code: 500, strong: 2500, vision: 100, ask: 200 } as const;

// ------------------------------------------------------------------ what is kept

export interface Artifact {
  id: string;
  userId: string;
  /** A Code project's id, when the artifact is about one. */
  projectId: string | null;
  type: ArtifactType;
  title: string;
  headVersion: number;
  /** The secret in the share link, or null while it is private. */
  shareToken: string | null;
  /** People who open the share link may save data too (their own, and the shared data). Off by default. */
  othersCanSave: boolean;
  /** Everything models have cost for this artifact, in paise: edits, fixes, a component's making. */
  spentPaise: number;
  createdAt: number;
  updatedAt: number;
}

export type VersionKind = "snapshot" | "patch";
export type MadeBy = "bot" | "person";

export interface VersionRow {
  artifactId: string;
  version: number;
  kind: VersionKind;
  /** The whole text for a snapshot; for a patch, the JSON of its edits (versions.ts). */
  body: string;
  madeBy: MadeBy;
  note: string;
  createdAt: number;
}

/** A version as a list shows it: no body, but how big it is and what it was. */
export interface VersionInfo {
  version: number;
  kind: VersionKind;
  madeBy: MadeBy;
  note: string;
  createdAt: number;
  /** Bytes the version is stored in. */
  storedBytes: number;
}

export interface NewArtifact {
  userId: string;
  projectId?: string | null;
  type: ArtifactType;
  title: string;
}

export interface NewVersion {
  kind: VersionKind;
  body: string;
  madeBy: MadeBy;
  note: string;
}

/** An exact replacement a bot asks for: `old` occurs once in the artifact. */
export interface Edit {
  old: string;
  new: string;
}

/** One saved-data scope: everyone's ("shared"), or one person's (their user id). */
export type Scope = "shared" | (string & {});

export interface DataEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

// ------------------------------------------------------------------ what a change returns

/** What every change returns: the new head, and what it cost. */
export interface Change {
  artifact: Artifact;
  version: number;
  /** What THIS change cost in models, in paise (0 when the bot wrote the text itself). */
  paise: number;
  /** All the artifact has cost so far. */
  totalPaise: number;
  /** How the change was made, for the person's receipt and the docs' numbers. */
  how: ChangeHow;
}

export interface ChangeHow {
  /** "edits": exact replacements. "element": a model rewrote one element. "fix": a model patched a failing span. "whole": a model edited the artifact by instruction. "rewrite", "create", "revert", "generate": the whole text. */
  mode: "create" | "edits" | "rewrite" | "element" | "fix" | "whole" | "revert" | "generate";
  /** Tier and model, when a model made the change. */
  tier?: string;
  model?: string;
  /** Tokens a model was sent and wrote. */
  promptTokens?: number;
  completionTokens?: number;
  /** Characters of the artifact the model was sent, against the artifact's size: how much was saved. */
  sentChars?: number;
  artifactChars?: number;
  /** Warnings from the check (the viewer would block a network call anyway). */
  warnings: string[];
}

/** A refusal or a failure, with a code the app can act on and words the bot or the person can read. */
export class ArtifactError extends Error {
  constructor(readonly code: ArtifactErrorCode, message: string, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = "ArtifactError";
  }

  get status(): number { return STATUS[this.code]; }
}

export type ArtifactErrorCode =
  | "bad_request" | "not_found" | "forbidden" | "needs_login" | "too_large" | "invalid" | "secret" | "edit_failed" | "head_moved"
  | "rate_limited" | "limit_reached" | "model_down" | "too_many" | "no_element" | "not_fixable" | "not_shared" | "not_configured";

const STATUS: Record<ArtifactErrorCode, number> = {
  bad_request: 400, not_found: 404, forbidden: 403, needs_login: 401, too_large: 413, invalid: 422, secret: 422, edit_failed: 422, head_moved: 409,
  rate_limited: 429, limit_reached: 429, model_down: 503, too_many: 409, no_element: 422, not_fixable: 422, not_shared: 404, not_configured: 503,
};

export const isArtifactError = (e: unknown): e is ArtifactError => e instanceof ArtifactError;
