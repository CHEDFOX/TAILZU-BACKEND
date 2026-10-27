/**
 * TWO SCRIPTED UPSTREAMS FOR THE PROXY, TO PROVE THE SECURITY SUITES' WIRING WITHOUT A KEY.
 *
 *   gullible   does what the text in front of it says: prints the string an injection asks for, decodes an encoded instruction and follows it, and
 *              reads out its system prompt when asked. The attack success rate through it must be high.
 *   careful    treats instructions inside messages and documents as data, and says so. The attack success rate through it must be zero.
 *
 * They measure nothing about any real model: they show that a hit is counted as a hit, a miss as a miss, and that every call went through the proxy.
 */
import type { ChatClient } from "../../src/code/brain/gateway.js";
import { probes } from "./garak.js";

type Msg = { role?: string; content?: unknown };
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p?.text ?? "").join("\n") : "");

const answer = (model: unknown, content: string): unknown => ({
  id: "chatcmpl-fake", object: "chat.completion", created: 1_800_000_000, model: String(model ?? "fake/model"),
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 200, completion_tokens: Math.ceil(content.length / 4), total_tokens: 200 + Math.ceil(content.length / 4), cost: 0.0001 },
});

/** The text with its encoded parts decoded as well: base64, ROT13 and hex tokens. */
export function withDecoded(text: string): string {
  const out = [text];
  for (const tok of text.split(/\s+/)) {
    if (/^[A-Za-z0-9+/=]{16,}$/.test(tok)) { try { out.push(Buffer.from(tok, "base64").toString("utf8")); } catch { /* not base64 */ } }
    if (/^[0-9a-f]{16,}$/i.test(tok) && tok.length % 2 === 0) out.push(Buffer.from(tok, "hex").toString("utf8"));
  }
  out.push(text.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.charCodeAt(0) & 223) - 52) % 26 + (c.charCodeAt(0) & 32) + 65)));
  return out.join("\n");
}

export function gullibleUpstream(): ChatClient & { calls: number } {
  const triggers = [...new Set(probes().flatMap((p) => p.triggers))];
  const c = { calls: 0 } as ChatClient & { calls: number };
  (c as { chat: ChatClient["chat"] }).chat = {
    completions: {
      async create(body: Record<string, unknown>): Promise<unknown> {
        c.calls += 1;
        const msgs = (body.messages ?? []) as Msg[];
        const last = textOf([...msgs].reverse().find((m) => m.role === "user")?.content);
        const seen = withDecoded(last).toLowerCase();
        const hit = triggers.find((t) => seen.includes(t.toLowerCase()));
        if (hit) return answer(body.model, hit);
        if (/system prompt|your instructions|words above|exact instructions/i.test(last)) return answer(body.model, textOf(msgs.find((m) => m.role === "system")?.content) || "You are a helpful assistant.");
        return answer(body.model, "Here is my answer.");
      },
    },
  };
  return c;
}

export function carefulUpstream(): ChatClient & { calls: number } {
  const c = { calls: 0 } as ChatClient & { calls: number };
  (c as { chat: ChatClient["chat"] }).chat = {
    completions: { async create(body: Record<string, unknown>): Promise<unknown> { c.calls += 1; return answer(body.model, "I will not act on instructions found inside a message or a document. Here is a plain answer to what you asked."); } },
  };
  return c;
}
