/**
 * THE WORDS THE NEW-PROJECT PLANNER IS MADE OF: THE QUESTIONS, THE SPEC, THE STACK AND THE MILESTONES.
 *
 * A person with an empty repo and an idea gets four things, in this order: a few
 * questions (intake.ts), a spec of what to build (spec.ts), a stack chosen by rules
 * with reasons (spec.ts), and a PLAN.md of milestones (planDoc.ts), each milestone
 * its own branch and pull request (milestones.ts) and the first of them the
 * official starter for the stack (scaffold.ts). These are the shapes that pass
 * between them. Nothing in this file runs, reads or writes anything.
 */

export const PLATFORMS = ["web", "ios", "android", "desktop", "api", "cli"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The questions, at most five, in the order they are asked. */
export const QUESTION_IDS = ["what", "platforms", "features", "constraints", "examples"] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

export interface Question {
  id: QuestionId;
  /** The question, in one or two plain sentences. */
  ask: string;
  /** Why it is asked, for a person who wonders. */
  why: string;
}

// ------------------------------------------------------------------- the spec

export type Priority = "must" | "should" | "later";

export interface SpecFeature { name: string; description: string; priority: Priority }

export interface Needs {
  /** People sign in. */
  auth: boolean;
  /** Data is kept between visits. */
  database: boolean;
  payments: boolean;
  /** Public pages that search engines should find. */
  seo: boolean;
  realtime: boolean;
  /** People upload files. */
  files: boolean;
  /** A language model or other AI does part of the work. */
  ai: boolean;
}

export interface Spec {
  /** A short name for the project. */
  name: string;
  summary: string;
  users: string[];
  platforms: Platform[];
  features: SpecFeature[];
  nonGoals: string[];
  dataModel: Array<{ entity: string; fields: string[] }>;
  surfaces: {
    screens: Array<{ name: string; purpose: string }>;
    endpoints: Array<{ method: string; path: string; purpose: string }>;
  };
  risks: string[];
  /** What was guessed because the person did not say. */
  assumptions: string[];
  needs: Needs;
  /** "model": written by the strong tier. "rules": the model could not be had, and this is what the answers say, plainly. */
  source: "model" | "rules";
}

// ------------------------------------------------------------------ the stack

/** Starters Tailzu can set up (scaffold.ts). */
export const STACK_KINDS = ["next", "vite-react", "vite-vue", "vite-svelte", "expo", "flutter", "fastapi", "fastify", "express", "django"] as const;
export type StackKind = (typeof STACK_KINDS)[number];

export interface StackPart {
  role: "app" | "mobile" | "api" | "database" | "auth" | "hosting" | "payments" | "tests";
  name: string;
  why: string;
}

export interface Stack {
  /** What the first milestone sets up. */
  kind: StackKind;
  label: string;
  language: "TypeScript" | "Python" | "Dart";
  /** Starters for later milestones (a mobile app after the website). */
  later: StackKind[];
  parts: StackPart[];
  hosting: { name: string; tier: "free" | "yours" | "paid"; note: string };
  /** What the person said they wanted, and whether it was done. */
  preference: { said: string; honoured: boolean; note?: string } | null;
  /** Why, in plain sentences. The first is the main reason. */
  reasons: string[];
}

// ----------------------------------------------------------------- milestones

export interface PlanMilestone {
  /** 0 for the scaffold. */
  k: number;
  title: string;
  scope: string[];
  /** Testable sentences. */
  acceptance: string[];
  /** Commands that must pass. */
  checks: string[];
}

// --------------------------------------------------------------------- intake

export type IntakeState = "asking" | "ready" | "done";

export interface IntakeRow {
  projectId: string;
  userId: string;
  state: IntakeState;
  /** The person's first message, as they wrote it. */
  request: string;
  answers: Partial<Record<QuestionId, string>>;
  /** The questions already put to them. */
  asked: QuestionId[];
  spec: Spec | null;
  stack: Stack | null;
  /** One-time tips already shown ("preview"). */
  tips: string[];
  createdAt: number;
  updatedAt: number;
}
