/**
 * opencode (MIT, npm opencode-ai 1.19.0, the prebuilt binary) AS A CONTESTANT: `opencode run --pure --format json -m e2e/<slug> <task>`.
 *
 * The provider is declared in one config file (OPENCODE_CONFIG): the bundled `@ai-sdk/openai-compatible` provider with our proxy as baseURL. `--pure` keeps it from
 * installing plugins at run time; edits and shell commands are allowed, web fetches are not; auto-update, the model catalog download and the session share are
 * off; the XDG folders are inside the throwaway home.
 */
import path from "node:path";
import { externalAgent, type Digest, type ExternalSpec } from "./external.js";

export const opencodeSpec: ExternalSpec = {
  id: "opencode",
  describe: "opencode 1.19.0: non-interactive run, openai-compatible provider on the proxy, --pure",
  tool: "opencode",
  plan(i) {
    const cfg = path.join(i.home, "opencode.json");
    return {
      cmd: i.bin,
      args: ["run", "--pure", "--format", "json", "-m", `e2e/${i.model}`, i.request],
      env: {
        OPENCODE_CONFIG: cfg, XDG_CONFIG_HOME: path.join(i.home, ".config"), XDG_DATA_HOME: path.join(i.home, ".local", "share"), XDG_CACHE_HOME: path.join(i.home, ".cache"), XDG_STATE_HOME: path.join(i.home, ".state"),
        OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      },
      files: {
        [cfg]: JSON.stringify({
          $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled",
          provider: { e2e: { npm: "@ai-sdk/openai-compatible", name: "e2e proxy", options: { baseURL: i.baseUrl, apiKey: i.apiKey }, models: { [i.model]: { name: i.model, limit: { context: 128000, output: 8000 }, tool_call: true } } } },
          model: `e2e/${i.model}`, small_model: `e2e/${i.model}`,
          permission: { edit: "allow", bash: "allow", webfetch: "deny" },
          // The session-title call is a model call that does no work: off, so that the bill is the task's.
          agent: { title: { disable: true } },
        }, null, 2),
      },
      exclude: [".opencode/"],
      dirs: [".config", ".local/share", ".cache", ".state"],
    };
  },
  digest({ stdout, stderr }): Digest {
    let steps = 0, tools = 0, failed = 0;
    let said = "";
    let errorText = "";
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "step_finish") steps += 1;
      if (e.type === "tool_use") { tools += 1; if (e.part?.state?.status === "error") failed += 1; }
      if (e.type === "text" && typeof e.part?.text === "string") said = e.part.text;
      if (e.type === "error") errorText = String(e.error?.data?.message ?? e.error?.message ?? e.message ?? "error");
    }
    const stderrErr = /(\bError\b|ECONNREFUSED|ENOTFOUND|\b402\b|\b401\b)[^\n]*/.exec(stderr)?.[0] ?? "";
    return { steps, toolCalls: tools, toolErrors: failed, answer: said.slice(0, 8000), ...((errorText || (!steps && stderrErr)) ? { verdict: { status: "failed" as const, reason: (errorText || stderrErr).slice(0, 200) } } : {}) };
  },
};

export const opencodeAgent = externalAgent(opencodeSpec);
