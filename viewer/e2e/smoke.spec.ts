import { expect, test } from "@playwright/test";

test("smoke: the host page loads the viewer and the viewer says ready", async ({ page }) => {
  await page.goto("/__host");
  await page.waitForFunction(() => (window as any).host?.log.some((e: any) => e.msg.t === "ready"));
  const ready = await page.evaluate(() => (window as any).host.log.find((e: any) => e.msg.t === "ready"));
  expect(ready.msg.protocol).toBe(1);
  expect(ready.origin).toBe("null");
});
