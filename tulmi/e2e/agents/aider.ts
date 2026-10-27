/**
 * AIDER (Apache-2.0, pip aider-chat 0.86.2) AS A CONTESTANT: `aider --message <task> --yes-always --no-auto-commits`, the model through our proxy.
 *
 * The model is reached as litellm's `openai/<slug>` with OPENAI_API_BASE set to the proxy, so every call is recorded and counted. Aider is told not to touch the
 * network for anything else (no analytics, no update check, no model-price download: a metadata file and a seeded price cache stand in), to keep its history
 * files in its throwaway home instead of the checkout, and not to commit (the harness reads the diff). Its edit format is `diff` (search/replace blocks), the
 * format it uses for capable models; `E2E_AIDER_EDIT_FORMAT=whole|udiff|diff-fenced` changes it, which is also what the edit-format bake-off varies.
 *
 * Aider's repo map is one of the locate contestants too (bakeoff/locate.ts).
 */
import path from "node:path";
import { externalAgent, type Digest, type ExternalSpec } from "./external.js";

export const AIDER_EDIT_FORMATS = ["diff", "whole", "udiff", "diff-fenced"] as const;

export const aiderSpec: ExternalSpec = {
  id: "aider",
  describe: "Aider 0.86.2: repo map + search/replace edits, one message, no commits (headless, --yes-always)",
  tool: "aider",
  plan(i) {
    const fmt = i.options.edit_format ?? "diff";
    if (!(AIDER_EDIT_FORMATS as readonly string[]).includes(fmt)) throw new Error(`aider's edit format ${fmt} is not one of ${AIDER_EDIT_FORMATS.join(", ")}`);
    const model = `openai/${i.model}`;
    const meta = path.join(i.home, "model-metadata.json");
    return {
      cmd: i.bin,
      args: [
        "--model", model, "--edit-format", fmt, "--yes-always", "--no-auto-commits", "--no-dirty-commits", "--no-stream", "--no-pretty", "--no-fancy-input",
        "--no-check-update", "--analytics-disable", "--no-show-model-warnings", "--no-gitignore", "--no-detect-urls", "--no-suggest-shell-commands", "--no-show-release-notes",
        "--timeout", String(Math.max(30, Math.min(600, i.timeoutSec))),
        "--model-metadata-file", meta,
        "--chat-history-file", path.join(i.home, "aider.chat.history.md"), "--input-history-file", path.join(i.home, "aider.input.history"), "--llm-history-file", path.join(i.home, "aider.llm.history"),
        "--message", i.request,
      ],
      env: { OPENAI_API_KEY: i.apiKey, OPENAI_API_BASE: i.baseUrl, LITELLM_LOCAL_MODEL_COST_MAP: "True", AIDER_ANALYTICS: "false", GIT_TERMINAL_PROMPT: "0" },
      files: {
        [meta]: JSON.stringify({ [model]: { max_input_tokens: 128000, max_output_tokens: 16000, input_cost_per_token: 0, output_cost_per_token: 0, litellm_provider: "openai", mode: "chat" } }),
        // A fresh (empty) price cache: aider then does not try to download litellm's price list.
        [path.join(i.home, ".aider", "caches", "model_prices_and_context_window.json")]: "{}",
      },
      exclude: [".aider*"],
    };
  },
  digest({ stdout, stderr }): Digest {
    const lines = stdout.split("\n");
    const tokenLines = lines.filter((l) => /^Tokens: /.test(l)).length;
    const applied = lines.filter((l) => /^Applied edit to /.test(l)).length;
    const editErrors = lines.filter((l) => /did not match|SearchReplaceNoExactMatch|Failed to apply|The SEARCH block/.test(l)).length;
    // The model's words: after the header (the last "Repo-map:" or "Git repo:" line) and before the first token count.
    const headerEnd = Math.max(-1, ...lines.map((l, k) => (/^(Repo-map:|Git repo:|Model:)/.test(l) ? k : -1)));
    const stop = lines.findIndex((l, k) => k > headerEnd && /^Tokens: /.test(l));
    const said = lines.slice(headerEnd + 1, stop < 0 ? undefined : stop).join("\n").trim();
    const err = [...stdout.split("\n"), ...stderr.split("\n")].find((l) => /(AuthenticationError|BadRequestError|APIConnectionError|RateLimitError|litellm\.\w*Error|BudgetExceeded|budget_exceeded)/.test(l));
    return {
      steps: tokenLines, toolCalls: applied, toolErrors: editErrors, answer: said.slice(0, 8000),
      ...(tokenLines === 0 && err ? { verdict: { status: "failed" as const, reason: `the model call failed: ${err.trim().slice(0, 200)}` } } : {}),
    };
  },
};

export const aiderAgent = externalAgent(aiderSpec);
