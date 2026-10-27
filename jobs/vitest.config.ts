import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const dotenvShim = fileURLToPath(new URL("./src/shims/dotenv.ts", import.meta.url));

// Two projects.
//
//   worker  runs inside workerd (Miniflare), fully offline: the Workflows, the Durable Object and the Cron handler are the real
//           ones; Supabase, GitHub and the model are replaced at the seams in src/world.ts (test/).
//   bundle  runs in Node: builds the Worker the way `wrangler deploy` does, reads the bundle, and loads THAT in workerd
//           through wrangler's own dev server (bundle-test/).
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { dotenv: dotenvShim } },
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { CODE_JOBS_SECRET: "test-secret-for-hmac-0123456789abcdef0123456789abcdef" } },
          }),
        ],
        test: { name: "worker", include: ["test/**/*.test.ts"] },
      },
      {
        test: { name: "bundle", environment: "node", include: ["bundle-test/**/*.test.ts"], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
      },
    ],
  },
});
