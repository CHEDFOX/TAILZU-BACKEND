import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects.
//
//   unit    the DOM-free logic (lib/): the id scanner, the markdown renderer, the SVG sanitiser, origins, source maps.
//           Plain Node; the scanner is also checked against Sucrase's own tokenizer.
//   worker  the Worker itself, inside workerd (Miniflare) with the real Workers Static Assets: headers, CSP, the __host gate,
//           the immutable cache on assets. The browser behaviour is in e2e/ (Playwright).
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", environment: "node", include: ["unit/**/*.test.ts"] },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { ENV: "development", VIEWER_PARENT_ORIGINS: "https://app.example,https://*.preview.example,http://localhost:3000" } },
          }),
        ],
        test: { name: "worker", include: ["test/**/*.test.ts"] },
      },
    ],
  },
});
