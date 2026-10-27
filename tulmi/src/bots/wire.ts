/**
 * THE SERVER'S SIDE OF THE SEAMS (ports.ts): THE REAL CONNECTORS, FILES, ARTIFACT CORE AND CODE BOT, HANDED TO THE BOTS PLATFORM.
 *
 *   botPorts({ connectors, media, artifacts, code, call, gateway }) -> BotPorts
 *
 * Nothing here is new behaviour: the connected apps are connectors/ (the same permission tiers), the files are media/ (read once, searched by
 * chunk), the artifacts are artifacts/ (the same checks), the web is code/webTools.ts, and a question about a person's project is the Code bot's own
 * chat (code/chat), read-only, on the cheap tier, as the front door asks it. Only server.ts imports this file, so the platform itself stays light.
 */
import type { Artifacts } from "../artifacts/index.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { CodeChat } from "../code/chat/index.js";
import type { Code } from "../code/index.js";
import type { ProjectDeps } from "../code/projects.js";
import type { CallFn } from "../code/work/model.js";
import type { Connectors } from "../connectors/index.js";
import type { MediaService } from "../media/service.js";
import { connectorsPort, type BotPorts, type CodeAsk } from "./ports.js";

export interface WireOptions {
  connectors?: Connectors | null;
  media?: MediaService | null;
  artifacts?: Artifacts | null;
  code?: Code | null;
  call?: CallFn;
  gateway?: GatewayDeps;
}

/** A question about a person's project, answered by the Code bot's chat: the cheap tier, a short answer, nothing kept. Null while the Code bot or its brain is off. */
export function codeAskPort(code: Code | null | undefined, o: Pick<WireOptions, "call" | "gateway"> = {}): CodeAsk | null {
  if (!code?.github || !code.brain) return null;
  const projects: ProjectDeps = { store: code.store, github: code.github, approvals: code.approvals, oauth: code.oauth };
  const chat = new CodeChat({ projects, brain: code.brain, ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}) });
  return async (a) => {
    const r = await chat.answer({ userId: a.userId, projectId: a.projectId, question: a.question, tier: "cheap", length: "medium", diagram: false, maxPaise: a.maxPaise, ...(a.signal ? { signal: a.signal } : {}) });
    return { text: r.text, paise: r.paise };
  };
}

export function botPorts(o: WireOptions): BotPorts {
  return {
    connectors: o.connectors ? connectorsPort(o.connectors) : null,
    media: o.media ?? null,
    artifacts: o.artifacts ?? null,
    code: codeAskPort(o.code, o),
  };
}
