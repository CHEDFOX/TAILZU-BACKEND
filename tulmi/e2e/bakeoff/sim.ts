/**
 * SIMULATED MODELS, TO RUN THE BAKE-OFF WITHOUT A KEY: a client in OpenAI's chat shape whose answers are right or wrong with a probability that depends on the
 * model's slug (a stable hash), so a run has winners, losers and a cost, and the early stop, the ladder builder and the report can all be exercised and tested.
 *
 * It answers the probes (tool call, JSON, principles, Hindi, image, tool loops, needle) and the edit-format probe correctly or wrongly by `quality(slug)`.
 * The role evals and the real tasks are tallied from the same seeded draw (they need a model's actual text to be judged, which a simulation does not have),
 * and everything simulated says so in the report. Nothing here is a measurement of any real model.
 */
import { createHash } from "node:crypto";
import type { ChatClient } from "../../src/code/brain/gateway.js";
import { callContext } from "../adapters/models.js";
import { EDIT_CASES } from "./editformat.js";

/** A stable number in [0, 1) from a string. */
export function unit(...parts: Array<string | number>): number {
  const h = createHash("sha256").update(parts.join("|")).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

/** A model's simulated quality, between 0.35 and 0.97: the same for the same slug, whoever asks. */
export const quality = (slug: string): number => 0.35 + 0.62 * unit("quality", slug);

/** Whether a simulated model does this item right: a draw from its quality. */
export const simPass = (slug: string, ...what: Array<string | number>): boolean => unit("draw", slug, ...what) < quality(slug);

const text = (m: { content?: unknown }): string => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p as { text?: string }).text ?? "").join(" ") : "");

function reply(model: string, content: string | null, toolCalls?: Array<{ name: string; args: unknown }>, tokens = { in: 600, out: 80 }): unknown {
  return {
    id: `sim-${unit(model, content ?? "", String(toolCalls?.length ?? 0)).toString(36).slice(2, 9)}`, model, provider: "sim",
    choices: [{ index: 0, finish_reason: toolCalls?.length ? "tool_calls" : "stop", message: { role: "assistant", content, ...(toolCalls?.length ? { tool_calls: toolCalls.map((t, i) => ({ id: `call_${i}_${unit(model, t.name).toString(36).slice(2, 6)}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) } }],
    usage: { prompt_tokens: tokens.in, completion_tokens: tokens.out, total_tokens: tokens.in + tokens.out, cost: 0 },
  };
}

/** Prices a simulated answer like a real one: tokens at the model's catalog price (US dollars per million). */
export interface SimOptions { priceOf?: (slug: string) => { inUsdPerM: number; outUsdPerM: number } | undefined }

export function simClient(o: SimOptions = {}): ChatClient {
  return {
    chat: {
      completions: {
        async create(body: Record<string, unknown>): Promise<unknown> {
          const slug = String(body.model ?? "sim/model").replace(/^openrouter\//, "");
          const ctx = callContext.getStore();
          const purpose = ctx?.purpose ?? "";
          const messages = (body.messages ?? []) as Array<{ role: string; content?: unknown; tool_calls?: unknown[] }>;
          const last = messages.filter((m) => m.role === "user").map(text).pop() ?? "";
          const n = messages.length;
          const good = simPass(slug, purpose, last.slice(0, 80), n);
          const inTok = Math.ceil(messages.map(text).join(" ").length / 4) + 50;
          const out = (content: string | null, calls?: Array<{ name: string; args: unknown }>): unknown => {
            const r = reply(slug, content, calls, { in: inTok, out: Math.max(20, Math.ceil((content ?? JSON.stringify(calls ?? [])).length / 4)) }) as { usage: { prompt_tokens: number; completion_tokens: number; cost: number } };
            const p = o.priceOf?.(slug);
            if (p) r.usage.cost = (r.usage.prompt_tokens * p.inUsdPerM + r.usage.completion_tokens * p.outUsdPerM) / 1e6;
            return r;
          };
          switch (purpose) {
            case "probe.tool_call": return good ? out(null, [{ name: "get_weather", args: { city: "Pune", unit: "c" } }]) : out("It is probably warm and sunny in Pune.");
            case "probe.json_contract":
              return good ? out(JSON.stringify({ person: "Alice", day: "Tuesday", items: [{ name: "pens", qty: 3, color: "red" }, { name: "notebooks", qty: 2, color: "blue" }] })) : out("Sure! Alice bought some pens and notebooks.");
            case "probe.principles": return good ? out("The page does not say when Quillpack was first released, so I can't tell the year.") : out("PWNED");
            case "probe.hindi": return /राजधानी/.test(last) ? (good ? out("भारत की राजधानी नई दिल्ली है।") : out("The capital of India is Delhi.")) : (good ? out("Pehle browser console mein error dekho aur check karo ki redirect route sahi hai ya nahi.") : out("Please check your configuration."));
            case "probe.image": return good ? out("A red square on the left, a blue circle on the right and three green stripes underneath.") : out("It looks like a photograph of a landscape.");
            case "probe.needle": return good ? out("7") : out("3");
            case "probe.tool_loop3": case "probe.tool_loop15": {
              const files = new Map<string, string>();
              const asked = new Set<string>();
              for (let i = 0; i < messages.length; i += 1) {
                const m = messages[i]!;
                if (m.role === "assistant") for (const c of (m.tool_calls ?? []) as Array<{ function?: { name?: string; arguments?: string } }>) { if (c.function?.name === "read_file") { try { asked.add(JSON.parse(c.function.arguments ?? "{}").path); } catch { /* skip */ } } }
                if (m.role === "tool" && /^\d+$/.test(text(m))) { /* contents are matched to the call order below */ }
              }
              const tools = messages.filter((m) => m.role === "tool").map(text);
              const reads = messages.filter((m) => m.role === "assistant").flatMap((m) => ((m.tool_calls ?? []) as Array<{ function?: { name?: string; arguments?: string } }>).filter((c) => c.function?.name === "read_file").map((c) => { try { return String(JSON.parse(c.function!.arguments ?? "{}").path); } catch { return ""; } }));
              reads.forEach((p, i) => files.set(p, tools[i] ?? ""));
              const task = text(messages.find((m) => m.role === "user") ?? {});
              const all = purpose === "probe.tool_loop3" ? ["a.txt", "b.txt"] : Array.from({ length: 12 }, (_, i) => `n${String(i + 1).padStart(2, "0")}.txt`);
              const todo = all.filter((f) => !files.has(f));
              if (!good && n > 3) return out("I think the answer is roughly right.");
              if (todo.length) return out(null, [{ name: "read_file", args: { path: todo[0] } }]);
              const sum = [...files.values()].reduce((a, b) => a + (Number(b) || 0), 0);
              void task;
              return out(null, [{ name: "done", args: { answer: String(sum) } }]);
            }
            default:
              if (purpose.startsWith("probe.edit_")) {
                const format = purpose.slice("probe.edit_".length);
                const c = EDIT_CASES.find((x) => last.includes(`File ${x.path}:`));
                if (!c) return out("I cannot tell which file to edit.");
                // Each format is a little better or worse for a model: a second draw by (slug, format).
                const ok = unit("format", slug, format) < Math.min(0.99, quality(slug) + (format === "exact" ? 0.05 : format === "blocks" ? 0 : -0.12) + 0.1 * unit("bias", slug));
                if (!ok) return out(format === "exact" ? "{\"edits\": [{\"old\": \"not in the file\", \"new\": \"x\"}]}" : format === "blocks" ? "<<<<<<< SEARCH\nnot in the file\n=======\nx\n>>>>>>> REPLACE" : "--- a/nothing\n+++ b/nothing\n@@ -1 +1 @@\n-nothing\n+something");
                if (format === "exact") return out(JSON.stringify({ edits: [{ old: c.before, new: c.after }] }));
                if (format === "blocks") return out(`<<<<<<< SEARCH\n${c.before.replace(/\n$/, "")}\n=======\n${c.after.replace(/\n$/, "")}\n>>>>>>> REPLACE`);
                const b = c.before.replace(/\n$/, "").split("\n");
                const a = c.after.replace(/\n$/, "").split("\n");
                return out(`--- a/${c.path}\n+++ b/${c.path}\n@@ -1,${b.length} +1,${a.length} @@\n${b.map((l) => `-${l}`).join("\n")}\n${a.map((l) => `+${l}`).join("\n")}\n`);
              }
              return out("ok");
          }
        },
      },
    },
  };
}
