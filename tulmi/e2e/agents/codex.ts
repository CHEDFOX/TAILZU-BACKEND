/**
 * OpenAI Codex CLI (Apache-2.0, npm @openai/codex 0.161.0, the prebuilt Rust binary) AS A CONTESTANT: `codex exec --json`, an OpenAI-compatible provider whose
 * base URL is our proxy.
 *
 * Codex speaks the Responses API only (`wire_api = "chat"` is refused), so the proxy takes POST /v1/responses and answers from the same chat cassettes
 * (adapters/responses.ts). The provider is declared in a config.toml in the throwaway CODEX_HOME; it names the environment variable that holds the (fake) key.
 * Its own sandbox (workspace-write, no network) stays on; approvals are off, as in any headless run. Telemetry and update checks are off.
 */
import fs from "node:fs";
import path from "node:path";
import { externalAgent, type Digest, type ExternalSpec } from "./external.js";

const toml = (s: string): string => JSON.stringify(s);

export const codexSpec: ExternalSpec = {
  id: "codex",
  describe: "OpenAI Codex CLI 0.161.0: exec mode, Responses API through the proxy, workspace-write sandbox",
  tool: "codex",
  plan(i) {
    const cfg = path.join(i.home, "config.toml");
    const last = path.join(i.home, "last-message.txt");
    return {
      cmd: i.bin,
      args: ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-C", i.checkout, "-s", i.options.sandbox ?? "workspace-write", "-o", last, i.request],
      env: { CODEX_HOME: i.home, E2E_API_KEY: i.apiKey },
      files: {
        [cfg]: [
          `model = ${toml(i.model)}`, `model_provider = "e2e"`, `approval_policy = "never"`, `check_for_update_on_startup = false`, ``,
          `[analytics]`, `enabled = false`, ``, `[feedback]`, `enabled = false`, ``,
          `[model_providers.e2e]`, `name = "e2e proxy"`, `base_url = ${toml(i.baseUrl)}`, `env_key = "E2E_API_KEY"`, `wire_api = "responses"`, `request_max_retries = 0`, `stream_max_retries = 0`, ``,
        ].join("\n"),
      },
      exclude: [".codex/"],
    };
  },
  digest({ stdout, home }): Digest {
    let commands = 0, failed = 0, messages = 0, turns = 0;
    let lastMessage = "";
    let errorText = "";
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "turn.completed") turns += 1;
      if (e.type === "turn.failed" || e.type === "error") errorText = String(e.error?.message ?? e.message ?? "error");
      if (e.type === "item.completed" && e.item) {
        if (e.item.type === "command_execution") { commands += 1; if (typeof e.item.exit_code === "number" && e.item.exit_code !== 0) failed += 1; }
        if (e.item.type === "agent_message") { messages += 1; lastMessage = String(e.item.text ?? ""); }
      }
    }
    try { lastMessage = fs.readFileSync(path.join(home, "last-message.txt"), "utf8").trim() || lastMessage; } catch { /* no file: the stream's last message */ }
    return { steps: Math.max(turns, messages), toolCalls: commands, toolErrors: failed, answer: lastMessage.slice(0, 8000), ...(errorText && !lastMessage ? { verdict: { status: "failed" as const, reason: errorText.slice(0, 200) } } : {}) };
  },
};

export const codexAgent = externalAgent(codexSpec);
