/**
 * LOCATE WITH AND WITHOUT THE REPO MAP, FROM THE COMMAND LINE.   npm run bench:locate [-- --grid]
 *
 * Builds the Acme Shop brain and a brain of tulmi/src (the real build, tree-sitter on, no model), runs evals/locate/bench.ts's tasks through locate's
 * signals with the map off and on, and prints top-1, top-3, top-5 and MRR. `--grid` also tries the map's settings on the DEV tasks and prints them.
 */
import { fileURLToPath } from "node:url";

process.env.OPENROUTER_API_KEY ??= "k";
process.env.OPENAI_API_KEY ??= "k";
process.env.GROQ_API_KEY ??= "k";
process.env.STT_PROVIDER ??= "groq";
process.env.DEV_SKIP_AUTH ??= "true";
process.env.NODE_ENV ??= "test";
process.env.MEDIA_DIR ??= "/tmp/tailzu-bench-media";
process.env.CONNECTOR_TOKEN_KEY ??= Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
process.env.CODE_TREE_SITTER ??= "true";
process.env.FREE_FOR_ALL ??= "false";

export async function main(argv = process.argv): Promise<void> {
  const { runLocateBench, printLocateBench } = await import("./harness.js");
  const res = await runLocateBench({ grid: argv.includes("--grid") });
  printLocateBench(res);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
