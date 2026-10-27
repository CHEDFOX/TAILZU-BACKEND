/**
 * THE FRONT DOOR TESTS' RIG: A CONTEXT, A SCRIPTED SMALL MODEL, FAKE ROADS, AND FAKE FILES.
 *
 * Nothing here reaches a network, a model or a database. `fakeHandlers()` stands in for the roads (reply, code answer, job, research,
 * plan, artifact) and writes down what each was given; `model()` is the scripted callModel of the artifact tests, answering the small
 * model's JSON and the replies. Import it after the test file's environment is set (it loads src/).
 */
import { scripted, type Answer, type Sent } from "./artifacts-rig.js";
import type { Handlers, RouteCall } from "../src/front/handlers.js";
import type { ArtifactRef, FrontCtx } from "../src/front/types.js";

export const PROJECT = "55555555-5555-4555-8555-555555555555";

export const ctx = (over: Partial<FrontCtx> = {}): FrontCtx => ({
  userId: "alice", plan: "paid", device: "web", mode: "text", visuals: "auto", recent: [], attachments: [], ...over,
});

export const inProject = (over: Partial<FrontCtx> = {}): FrontCtx => ctx({ projectId: PROJECT, ...over });

/** The small model's answer to "what is this message", as JSON. */
export const decideJson = (o: Partial<{ intent: string; length: string; visual: string; confidence: number; clarify: { question: string; options: string[] } | null }> = {}) => ({
  json: { intent: "answer", length: "medium", visual: "none", confidence: 0.8, clarify: null, ...o },
});

/** A scripted model: `answer` gets what was sent and says what comes back. */
export function model(answer: (s: Sent, n: number) => Answer = () => "ok", o: { paise?: number } = {}) {
  return scripted(answer, o);
}

/** A model that must not be asked. */
export const noModel = () => model((s) => { throw new Error(`the model was asked (${s.purpose})`); });

export interface Calls {
  reply: Array<RouteCall & { files: unknown[] }>;
  codeAnswer: RouteCall[];
  codeJob: RouteCall[];
  research: Array<RouteCall & { depth: string }>;
  plan: RouteCall[];
  artifact: Array<RouteCall & { visual: { kind: string }; basis?: string; mermaid?: string }>;
}

export function artifactRef(kind: ArtifactRef["kind"] = "diagram", over: Partial<ArtifactRef> = {}): ArtifactRef {
  const type = kind === "diagram" ? "mermaid" : kind === "chart" ? "react" : kind === "component" ? "react" : "html";
  return { id: `art-${kind}`, type, title: `A ${kind}`, version: 1, kind, paise: 0, ...over };
}

/** Roads that answer from canned results and write down what they were handed. `over` replaces any of them. */
export function fakeHandlers(over: Partial<Handlers> = {}) {
  const calls: Calls = { reply: [], codeAnswer: [], codeJob: [], research: [], plan: [], artifact: [] };
  const handlers: Handlers = {
    async reply(c) { calls.reply.push(c); return { text: "A reply.", paise: 3 }; },
    async codeAnswer(c) { calls.codeAnswer.push(c); return { text: "It lives in src/auth/login.ts:12.", paise: 5 }; },
    async codeJob(c) { calls.codeJob.push(c); return { job: { id: "job-1", branch: "tailzu/fix-1a2b", state: "queued", budgetPaise: c.maxPaise }, paise: 0 }; },
    async research(c) { calls.research.push(c); return { text: "Researched [1].", paise: 40, sources: [{ n: 1, title: "Docs", url: "https://docs.example/x" }], confidence: 0.8, gaps: [] }; },
    async plan(c) { calls.plan.push(c); return { text: "1. Start\n2. Finish", paise: 6, diagram: "flowchart TD\n  S1[\"1. Start\"]\n  S2[\"2. Finish\"]\n  S1 --> S2" }; },
    async artifact(c) { calls.artifact.push(c); return { artifact: artifactRef(c.visual.kind as ArtifactRef["kind"]), paise: c.visual.kind === "diagram" && c.mermaid ? 0 : 20 }; },
    ...over,
  };
  return { handlers, calls };
}

// ------------------------------------------------------------- fake files

import { createHash } from "node:crypto";
import type { AttachmentInput } from "../src/front/attachments.js";

export const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export function fileInput(name: string, content: string | Buffer, over: { mime?: string; kind?: AttachmentInput["ref"]["kind"]; withData?: boolean } = {}): AttachmentInput {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const mime = over.mime ?? (/\.png$/.test(name) ? "image/png" : /\.pdf$/.test(name) ? "application/pdf" : /\.(ts|py|js)$/.test(name) ? "text/plain" : "text/plain");
  const kind = over.kind ?? (/\.png$/.test(name) ? "image" : /\.pdf$/.test(name) ? "pdf" : /\.(ts|py|js)$/.test(name) ? "code" : "text");
  return { ref: { id: `f-${name}`, kind, mime, bytes: data.length, sha256: sha(data), name }, ...(over.withData === false ? {} : { data }) };
}

/** A tiny PNG's bytes (the signature and a little more): enough for the vision path, which a fake model answers. */
export const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32, 7)]);
