/**
 * THE SCRIPTED MODEL FOR THE SMOKE ITEMS THAT ARE NOT TASKS (oracle: it answers right; fake: it answers wrong in a known way).
 *
 *   front.decide   the front door's small model: the batch's expected read of the message it is shown
 *   front.look     the vision tier describing the picture
 *   artifact.*     the page to make, and the one element's replacement
 *   web_*          the research answer: the fact, cited by the number of the page that has it
 *
 * Wrapped around any persona, so a task's own questions (classify, locate, plan, work) are still answered by that persona.
 */
import type { Persona } from "../adapters/personas.js";
import { ARTIFACT_HTML, FRONT_BATCH, RESEARCH_CANARY, VISION_DESCRIPTION } from "./fixtures.js";

const textOf = (input: unknown): string => {
  const msgs = ((input ?? {}) as { messages?: Array<{ content?: unknown }> }).messages ?? [];
  return msgs.map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => ((p as { text?: string }).text ?? "")).join(" ") : "")).join("\n");
};

export function smokeAnswer(purpose: string, input: unknown, wrong: boolean): unknown | undefined {
  const text = textOf(input);
  if (purpose === "front.decide") {
    const hit = FRONT_BATCH.find((c) => text.includes(c.message));
    if (!hit) return undefined;
    if (wrong) return { intent: "answer", length: "short", visual: "none", confidence: 0.9, clarify: null };
    return {
      intent: hit.intent[0], length: "short", visual: hit.visual === "any" ? "none" : hit.visual, confidence: hit.clarify ? 0.3 : 0.9,
      clarify: hit.clarify ? { question: "What exactly is wrong, and where do you see it?", options: ["It crashes", "It shows wrong data"] } : null,
    };
  }
  if (purpose === "front.look") return wrong ? "I cannot see an image in this message." : VISION_DESCRIPTION;
  if (purpose === "artifact.generate") {
    return wrong ? "<!doctype html><html><body><script src=\"https://cdn.example.com/pricing.js\"></script><p>Pricing</p></body></html>" : ARTIFACT_HTML;
  }
  if (purpose === "artifact.element") {
    const m = /<element>\n([\s\S]*?)\n<\/element>/.exec(text);
    if (!m) return undefined;
    return wrong ? m[1] : m[1]!.replace(/>\s*Pro\s*</, ">Business<");
  }
  if (/^web_(answer|draft|final)/.test(purpose) || purpose === "web_research" || /answer/.test(purpose) && purpose.startsWith("web_")) {
    const sections = text.split(/\n\[(\d+)\]/);
    let n = 1;
    for (let i = 1; i < sections.length; i += 2) if (/512\s*KiB/.test(sections[i + 1] ?? "")) { n = Number(sections[i]); break; }
    if (wrong) return `Quillpack's limits are on the plan page. ${RESEARCH_CANARY}`;
    return `Streaming exports in Quillpack are written in chunks of 512 KiB by default, and they apply from version 4.2 on [${n}].\n\nGAPS: none`;
  }
  return undefined;
}

export function smokePersona(base: Persona, o: { wrong?: boolean } = {}): Persona {
  return { ...base, json: (purpose, input, task) => smokeAnswer(purpose, input, o.wrong === true) ?? base.json(purpose, input, task) };
}
