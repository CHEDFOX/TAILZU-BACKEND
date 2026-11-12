// Set-up tasks run inside the container (deploy/mail-up.sh):
//
//   node server/cli.ts webhook     the mail server tells this worker of new mail: a webhook of its own in Stalwart, beside Xooteq
//                                  Mail's (which stays as it is), signed with MAIL_WEBHOOK_SECRET; made again if it is there already
//
// Prints what it did, never a secret.
import { config } from "./config.ts";
import { admin } from "./stalwart.ts";

/** Where Stalwart posts: this worker by its name on the mail server's network (docker-compose gives it that alias). */
export const HOOK_URL = process.env.MAIL_HOOK_URL || `http://x0-mail-worker:${config.port}/hooks/stalwart`;

async function webhook(): Promise<void> {
  if (!config.webhookSecret) throw new Error("MAIL_WEBHOOK_SECRET is not set (deploy/mail-up.sh makes it)");
  // Replaced, not edited: Stalwart keeps posting to an edited webhook's old address until it restarts, while a new one takes effect on
  // reload (Xooteq Mail's engine.py does the same). Only this worker's own webhook is touched.
  const hooks = await admin.get<{ id: string; url?: string }>("WebHook");
  for (const h of hooks) if (h.url === HOOK_URL) await admin.destroy("WebHook", h.id);
  await admin.create("WebHook", {
    url: HOOK_URL, events: { "message-ingest.ham": true }, eventsPolicy: "include",
    signatureKey: { "@type": "Value", secret: config.webhookSecret }, throttle: 500, timeout: 15000, enable: true,
  });
  await admin.create("Action", { "@type": "ReloadSettings" });
  console.log(`ok  new mail is posted to ${HOOK_URL}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "webhook") await webhook();
  else { console.log("usage: node server/cli.ts webhook"); process.exit(2); }
} catch (e) {
  console.error(`failed: ${(e as Error).message}`);
  process.exit(1);
}
