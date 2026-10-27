/**
 * A SCRIPTED MODEL FOR THE EXTERNAL AGENTS: PROVES THE WIRING (THE COMMAND, THE PROXY, THE CASSETTE, THE DIFF, THE SCORE) WITHOUT A KEY AND WITHOUT A CENT.
 *
 * It plays the part of the upstream behind the recording proxy. It knows the task's oracle patch, and answers the way a competent model would in each agent's
 * own protocol, whichever agent is asking:
 *
 *   a shell tool in the request (bash, exec_command, terminal)   step 1: one call that writes the oracle's files with here-documents (and removes the
 *                                                                ones it deletes); step 2, once a tool result is in the conversation: finish
 *   aider (no tools, "expert software developer")               the edit-format "whole" reply: each file as a path line and a fenced block
 *   anything else without tools (opencode's title call)         a short line
 *
 * It measures nothing about the agents' quality: the same patch is applied by all of them. What it shows is that each agent starts, reaches the proxy, acts on
 * its answer in the checkout, stops, and leaves a diff the hidden checks can score, and that a second run replays from the cassette with no miss.
 */
import type { ChatClient } from "../../src/code/brain/gateway.js";
import type { Task } from "../tasks/schema.js";

type Msg = { role?: string; content?: unknown; tool_calls?: unknown };
type Tool = { function?: { name?: string } };

const EOF = "TAILZU_FAKE_EOF";

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p?.text ?? "").join("\n") : "");
const approxTokens = (s: string): number => Math.ceil(s.length / 4);

/** The shell command that makes the oracle's change. */
export function patchCommand(files: Record<string, string | null>): string {
  const parts: string[] = [];
  for (const [p, text] of Object.entries(files)) {
    const q = `'${p.replace(/'/g, `'\\''`)}'`;
    if (text === null) { parts.push(`rm -f ${q}`); continue; }
    const dir = p.includes("/") ? `mkdir -p '${p.slice(0, p.lastIndexOf("/")).replace(/'/g, `'\\''`)}' && ` : "";
    parts.push(`${dir}cat > ${q} <<'${EOF}'\n${text.endsWith("\n") ? text : `${text}\n`}${EOF}`);
  }
  return parts.join("\n");
}

/** The "whole file" edit-format reply of aider. */
export function wholeFileReply(files: Record<string, string | null>, say: string): string {
  const blocks = Object.entries(files).filter(([, t]) => t !== null).map(([p, t]) => `${p}\n\`\`\`\n${(t as string).endsWith("\n") ? t : `${t}\n`}\`\`\``);
  return `${say}\n\n${blocks.join("\n\n")}\n`;
}

interface Shell { tool: string; args: (command: string) => Record<string, unknown> }
const SHELLS: Shell[] = [
  { tool: "exec_command", args: (command) => ({ cmd: command }) },
  { tool: "terminal", args: (command) => ({ command, summary: "apply the change", security_risk: "LOW" }) },
  { tool: "bash", args: (command) => ({ command, description: "apply the change" }) },
];

export function fakeAgentModel(task: Task, opts: { costPerMTokUsd?: number } = {}): ChatClient & { calls: number } {
  const rate = opts.costPerMTokUsd ?? 0.4;
  const files = task.oracle.files ?? {};
  const answer = task.oracle.answer ?? (Object.keys(files).length ? `Done: changed ${Object.keys(files).join(", ")}.` : "Nothing to change.");
  const client = { calls: 0 } as ChatClient & { calls: number };
  (client as { chat: ChatClient["chat"] }).chat = {
    completions: {
      async create(body: Record<string, unknown>): Promise<unknown> {
        client.calls += 1;
        const messages = (body.messages ?? []) as Msg[];
        const tools = ((body.tools ?? []) as Tool[]).map((t) => t.function?.name ?? "");
        const toolResults = messages.filter((m) => m.role === "tool").length;
        const system = textOf(messages.find((m) => m.role === "system")?.content);
        let message: Record<string, unknown>;
        let finish = "stop";
        const shell = SHELLS.find((s) => tools.includes(s.tool));
        if (shell) {
          if (toolResults === 0 && Object.keys(files).length) {
            const isMini = tools.includes("bash") && !tools.includes("edit") && !tools.includes("read");
            finish = "tool_calls";
            message = { role: "assistant", content: isMini ? "I will apply the change." : null, tool_calls: [{ id: "call_fake_1", type: "function", function: { name: shell.tool, arguments: JSON.stringify(shell.args(patchCommand(files))) } }] };
          } else if (tools.includes("bash") && !tools.includes("edit") && !tools.includes("read")) {
            // mini-swe-agent: the submit command ends the run.
            finish = "tool_calls";
            message = { role: "assistant", content: answer, tool_calls: [{ id: "call_fake_2", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" }) } }] };
          } else if (tools.includes("finish")) {
            finish = "tool_calls";
            message = { role: "assistant", content: null, tool_calls: [{ id: "call_fake_2", type: "function", function: { name: "finish", arguments: JSON.stringify({ message: answer }) } }] };
          } else {
            message = { role: "assistant", content: answer };
          }
        } else if (!tools.length && /expert software developer/i.test(system)) {
          message = { role: "assistant", content: Object.keys(files).length ? wholeFileReply(files, "Here is the change.") : answer };
        } else {
          message = { role: "assistant", content: "Fix the task" };
        }
        const promptTokens = approxTokens(JSON.stringify(messages) + JSON.stringify(body.tools ?? ""));
        const completionTokens = approxTokens(JSON.stringify(message));
        return {
          id: `chatcmpl-fake-${client.calls}`, object: "chat.completion", created: 1_800_000_000, model: String(body.model ?? "fake/model"),
          choices: [{ index: 0, finish_reason: finish, message }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens, cost: ((promptTokens + completionTokens) * rate) / 1e6 },
        };
      },
    },
  };
  return client;
}
