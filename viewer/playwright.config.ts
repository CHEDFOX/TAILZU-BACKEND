import { defineConfig } from "@playwright/test";

// The viewer is served by the real thing: `wrangler dev` (workerd, Workers Static Assets, the same headers as production). ENV=development
// turns the /__host test page on, and the page's own origin is allowed to embed the viewer (src/index.ts adds it outside production).
// http://127.0.0.1:8801 is the "app" of e2e/security.spec.ts: a page that test serves itself (the browser refuses to frame a loopback viewer from any other address space).
const PORT = 8799;
// The second viewer is the one kept for screenshots (docs section 14): VIEWER_PARENT_ORIGINS=null, in production mode, so no test host and no frame-ancestors.
// e2e/shot.spec.ts puts tulmi's screenshot host page in front of it. It starts after the first one (Playwright starts the servers in order), so the build they share runs twice, not at once.
const SHOT_PORT = 8798;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: "chromium", trace: "off" },
  webServer: [
    {
      command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --var ENV:development --var VIEWER_PARENT_ORIGINS:http://127.0.0.1:8801 --show-interactive-dev-session=false`,
      url: `http://127.0.0.1:${PORT}/__host`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx wrangler dev --port ${SHOT_PORT} --ip 127.0.0.1 --var ENV:production --var VIEWER_PARENT_ORIGINS:null --show-interactive-dev-session=false`,
      url: `http://127.0.0.1:${SHOT_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
