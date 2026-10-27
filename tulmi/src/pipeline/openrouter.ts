/**
 * THE ONE OPENROUTER CLIENT.
 *
 * Split out of cleanup.ts (the voice-cleanup pipeline: prompts read from disk,
 * the speech scripts) so that the Code bot's model gateway and Ask's planner can
 * take the client without that whole pipeline, which the Cloudflare jobs Worker
 * must not bundle. cleanup.ts re-exports it, so every existing import keeps
 * working.
 */
import OpenAI from "openai";
import { getConfig } from "../config.js";

let client: OpenAI | null = null;
/** The one OpenRouter client. Exported for Ask's planner (agent/llm.ts), which
 *  shares the connection but sets its own timeout and retries per call. */
export function openrouter(): OpenAI {
  if (!client) {
    const cfg = getConfig();
    client = new OpenAI({
      apiKey: cfg.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      // Bound each call so a hung upstream can't pin a request/socket for the
      // SDK default (~10 min). 30s covers refine/draft; the SDK retries twice
      // on transient network/5xx.
      timeout: 30_000,
      maxRetries: 2,
      defaultHeaders: {
        "HTTP-Referer": cfg.OPENROUTER_APP_URL,
        "X-Title": cfg.OPENROUTER_APP_NAME,
      },
    });
  }
  return client;
}
