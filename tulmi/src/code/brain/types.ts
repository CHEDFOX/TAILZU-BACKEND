/**
 * THE WORDS THE BRAIN'S MODEL CALLS ARE MADE OF: MESSAGES, TOOLS, AND THE
 * KINDS OF REQUEST AND STEP THE CLASSIFIER AND THE ROUTER SHARE.
 *
 * Messages are the OpenAI chat shape, which is what OpenRouter takes. A user
 * message may carry a picture as parts (agent/llm.ts UserContent). Tools are
 * described by name, a line of what they do, and a JSON schema for their
 * arguments; a model's answer to them comes back as ToolCall, the arguments
 * still a string, exactly as written, because only the caller knows how far to
 * trust them.
 */
import type { UserContent } from "../../agent/llm.js";

export type { UserContent, UserPart } from "../../agent/llm.js";

export interface ToolCall {
  id: string;
  name: string;
  /** The JSON the model wrote for the arguments, unparsed. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: UserContent }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** A JSON schema object for the arguments. */
  parameters: Record<string, unknown>;
}

// ------------------------------------------------------- requests and steps

export const REQUEST_TYPES = [
  "question", "small_edit", "bug_fix", "feature", "refactor", "plan_project", "research", "find_resource", "web_task", "other",
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const LEVELS = ["low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];

export const LANGUAGES = ["en", "hinglish", "hi", "other"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Needs {
  /** The web is plausibly needed: docs, an error to look up, a site to act on. */
  web: boolean;
  /** Commands will plausibly need to run: install, build, test. */
  exec: boolean;
  /** A picture is part of the request. */
  vision: boolean;
  /** Wording in an Indian language is wanted, or the request is written in one. */
  indic: boolean;
}

export interface Classification {
  type: RequestType;
  difficulty: Level;
  risk: Level;
  needs: Needs;
  language: Language;
  /** 0 to 1: how sure the type is. */
  confidence: number;
  /** Why, as short ids ("kw:fix", "error_text", "script:devanagari"): the rules' hits, and the model's own reasons cut down to ids. Never the request itself. */
  signals: string[];
}

export const STEP_NAMES = [
  "classify", "search", "summarize", "index", "plan", "write_code", "review", "vision", "indic_text", "research",
] as const;
export type StepName = (typeof STEP_NAMES)[number];
