/**
 * THE AGENTS THE HARNESS KNOWS. To add one (OpenHands, Aider, opencode, Codex CLI): implement AgentUnderTest in its own file here, run headless inside
 * `input.checkout` with `input.model.slug` through OpenRouter, and register it below. Nothing else in the harness names an agent.
 */
import { patchAgent } from "./patch.js";
import { tailzuAgent } from "./tailzu.js";
import type { AgentUnderTest } from "./types.js";

export const AGENTS: Record<string, AgentUnderTest> = {
  [tailzuAgent.id]: tailzuAgent,
  [patchAgent.id]: patchAgent,
};

export function agentById(id: string): AgentUnderTest {
  const a = AGENTS[id];
  if (!a) throw new Error(`no agent called ${id}; registered: ${Object.keys(AGENTS).join(", ")}. An external agent is added by implementing AgentUnderTest in e2e/agents/ and registering it in e2e/agents/index.ts.`);
  return a;
}

export * from "./types.js";
