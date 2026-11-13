// Starts the mail worker: the HTTP doors, and the scheduler that sends replies whose wait is over.
import { assertReady, config } from "./config.ts";
import { buildApp } from "./app.ts";
import { startScheduler } from "./ai/engine.ts";

const missing = assertReady();
if (missing.length) console.warn(`[mail-worker] not set up yet: ${missing.join(", ")}`);

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: config.port });
const stop = startScheduler();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stop();
    app.close().finally(() => process.exit(0));
  });
}
