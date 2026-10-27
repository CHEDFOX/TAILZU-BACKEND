/**
 * THE WORDS THE FRONT DOOR IS MADE OF: WHAT A MESSAGE IS, WHAT SHAPE ITS ANSWER TAKES, AND WHAT BECAME OF IT.
 *
 * Plain shapes and the lists the rest of the module (and the role contracts in principles/roles.ts) share. Nothing here reads the
 * environment, a store or a model. The story is in docs/front-door.md.
 */
import type { ModelTier } from "../code/brain/tiers.js";
import type { ArtifactType } from "../artifacts/protocol.js";
import type { Plan } from "../guard/limiter.js";

export type { Plan };

export const INTENTS = ["chat", "answer", "code_question", "code_task", "design", "research", "plan", "file_question", "unclear"] as const;
export type Intent = (typeof INTENTS)[number];

export const LENGTHS = ["short", "medium", "long"] as const;
export type Length = (typeof LENGTHS)[number];

/** The ladder of visuals, cheapest first. */
export const VISUAL_KINDS = ["table", "diagram", "chart", "component", "page"] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const DEVICES = ["phone", "desktop", "web"] as const;
export type Device = (typeof DEVICES)[number];
export const MODES = ["voice", "text"] as const;
export type Mode = (typeof MODES)[number];
export const VISUAL_PREFS = ["auto", "ask", "off"] as const;
export type VisualPref = (typeof VISUAL_PREFS)[number];

/** Where a decision sends a message. */
export const ROUTES = ["reply", "file", "code_answer", "code_job", "artifact", "research", "plan"] as const;
export type RouteName = (typeof ROUTES)[number];

export type ResearchDepth = "quick" | "standard" | "deep";

export const OUTCOMES = ["ok", "rephrased", "visual_closed", "visual_kept", "thumbs_up", "thumbs_down"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** How a decision was made: by the free rules alone, or with the small model's help. */
export type Via = "rules" | "model";

// ------------------------------------------------------------------ attachments

export const ATTACHMENT_KINDS = ["image", "text", "code", "audio", "video", "pdf", "document", "data", "archive", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface AttachmentRef {
  id: string;
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  /** Lower-case hex SHA-256 of the file: what a read is kept under. */
  sha256: string;
  name: string;
}

/** A turn of the conversation so far, summarised by the client: what they said and what was done about it. */
export interface Turn {
  said: string;
  did?: string;
}

/** Everything about the person and the moment that is not in the message. */
export interface FrontCtx {
  userId: string;
  plan: Plan;
  device: Device;
  mode: Mode;
  visuals: VisualPref;
  projectId?: string;
  /** The conversation about the project's code this message belongs to (a uuid the app makes): its short rolling summary is what a follow-up leans on (code/chat). */
  threadId?: string;
  /** The last three turns at most, summarised. */
  recent: Turn[];
  attachments: AttachmentRef[];
  /** A visual the person took an offer of ("show this as a table"): made whatever their preference. */
  takeOffer?: VisualKind;
}

// ------------------------------------------------------------------ the decision

export interface VisualPlan {
  kind: VisualKind;
  /** inline: part of the reply (a table). artifact: made by the artifact core and shown beside the reply. */
  via: "inline" | "artifact";
  artifactType?: ArtifactType;
  /** An offer to make it, not the thing itself: voice mode, or the person's preference is to be asked. */
  offer: boolean;
  /** The visual is the answer (a design), not an addition to one. */
  isAnswer: boolean;
  /** The person asked for it in so many words. */
  asked: boolean;
  /** Why, in a few words a person can read. */
  why: string;
  /** About what it adds to the cost, in paise. */
  estPaise: number;
}

export interface Clarify {
  question: string;
  options: string[];
}

export interface Shape {
  length: Length;
  visual: VisualPlan | null;
}

export interface Decision {
  intent: Intent;
  shape: Shape;
  route: RouteName;
  tier: ModelTier;
  /** The most the route's work may cost, in paise, in the worst case. */
  budgetPaise: number;
  /** 0 to 1: how sure the intent is. */
  confidence: number;
  clarify?: Clarify;
  via: Via;
  /** For a research route: how deep. */
  depth?: ResearchDepth;
  /** The language the message is in, as the classifier reads it. */
  language: "en" | "hinglish" | "hi" | "other";
  /** A short follow-up to an earlier turn: that turn's words, to be put in front of this message when it is made into something. */
  followUp?: string;
  /** "Ok, change it" after a question about the code: the job is handed what the conversation found, and does not look for the place again (code/chat/handoff.ts). */
  handoff?: boolean;
  /** A code task that is open-ended (debugging, investigating, exploring): worked in the free-form mode, where the model decides the order of explore, change and run (code/agent). */
  mode?: "freeform";
  /** Short ids of why: the rules' hits, and the learning's adjustments. Never the message. */
  reasons: string[];
}

// ------------------------------------------------------------------ the result

export interface ArtifactRef {
  id: string;
  type: ArtifactType;
  title: string;
  version: number;
  kind: VisualKind;
  paise: number;
}

export interface Offer {
  kind: VisualKind;
  /** What the one-tap button says. */
  label: string;
  /** Sent back with the same message to take the offer: { visual: kind }. */
  request: { visual: VisualKind };
}

export interface FileNote {
  id: string;
  name: string;
  kind: AttachmentKind;
  status: "read" | "described" | "cached" | "coming_soon" | "too_big" | "unreadable" | "missing";
  note?: string;
}

export interface FrontResult {
  /** The reply, as Markdown (it may hold a table). */
  text?: string;
  artifacts: ArtifactRef[];
  offers: Offer[];
  clarify?: Clarify;
  job?: { id: string; branch: string; state: string; budgetPaise: number };
  sources?: Array<{ n: number; title: string; url: string }>;
  files?: FileNote[];
  /** Plain words about anything that was skipped, cut short or failed: nothing is dropped silently. */
  notes: string[];
  /** What the message cost, all calls together, in paise. */
  paise: number;
  ms: number;
}

/** What a streaming ask sends, one per line. */
export type FrontEvent =
  | { t: "decision"; decision: Decision }
  | { t: "status"; stage: string }
  | { t: "text"; text: string }
  | { t: "artifact"; artifact: ArtifactRef }
  | { t: "result"; decisionId: string | null; decision: Decision; result: FrontResult }
  | { t: "error"; code: string; message: string };

/** The front door could not do what the decision said, and says why in words a person can read. */
export class FrontError extends Error {
  constructor(readonly code: string, message: string, readonly status: number = 502) {
    super(message);
    this.name = "FrontError";
  }
}
