/**
 * THE AGENTS THE HARNESS KNOWS. Tailzu's own flow, the patch agent (no model: proves the scoring) and the open-source contestants (aider, opencode, Codex CLI,
 * mini-swe-agent, OpenHands), each a small spec over agents/external.ts: headless inside `input.checkout`, `input.model.slug` through the recording proxy, the
 * versions pinned in versions.json. To add one: write its spec in its own file here and register it below. Nothing else in the harness names an agent.
 */
import { aiderAgent } from "./aider.js";
import { codexAgent } from "./codex.js";
import { miniAgent } from "./miniswe.js";
import { opencodeAgent } from "./opencode.js";
import { openhandsAgent } from "./openhands.js";
import { patchAgent } from "./patch.js";
import { tailzuAgent, tailzuPhasedAgent } from "./tailzu.js";
import type { AgentUnderTest } from "./types.js";

export const AGENTS: Record<string, AgentUnderTest> = {
  [tailzuAgent.id]: tailzuAgent,
  [tailzuPhasedAgent.id]: tailzuPhasedAgent,
  [patchAgent.id]: patchAgent,
  [aiderAgent.id]: aiderAgent,
  [opencodeAgent.id]: opencodeAgent,
  [codexAgent.id]: codexAgent,
  [miniAgent.id]: miniAgent,
  [openhandsAgent.id]: openhandsAgent,
};

/** The open-source contestants (external processes, behind the recording proxy), in the order the grid shows them. */
export const CONTESTANTS = ["tailzu", "aider", "opencode", "codex", "mini-swe-agent", "openhands"] as const;

export function agentById(id: string): AgentUnderTest {
  const a = AGENTS[id];
  if (!a) throw new Error(`no agent called ${id}; registered: ${Object.keys(AGENTS).join(", ")}. An external agent is added by implementing AgentUnderTest in e2e/agents/ and registering it in e2e/agents/index.ts.`);
  return a;
}

export * from "./types.js";
