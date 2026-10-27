/**
 * dotenv, for the Worker: a stand-in that loads nothing.
 *
 * tulmi/src/config.ts loads a .env file when it is not under test and not on a Worker (isWorkerRuntime). The Worker has no files and
 * no .env: its settings are the bindings of wrangler.jsonc and `wrangler secret put` (src/env.ts copies them into process.env). So
 * Wrangler is told to bundle THIS wherever the code imports "dotenv" (wrangler.jsonc "alias"), and the real package (and the node:fs,
 * node:path, node:os it reads with) stays out of the bundle.
 */
export function config(): { parsed?: Record<string, string> } {
  return {};
}

export default { config };
