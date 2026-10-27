import { expect, type FrameLocator, type Page } from "@playwright/test";

/** What the test host (src/host-page.ts) puts on window. */
export interface HostApi {
  log: { dir: "in" | "out"; at: number; msg: any; origin?: string }[];
  store: { private: Map<string, unknown>; shared: Map<string, unknown> };
  downloads: any[];
  asks: string[];
  autoReply: boolean;
  autoResize: boolean;
  replyDelayMs: number;
  load(artifact: { type: string; content: string; title?: string }, opts?: { id?: string; version?: number; theme?: string; kit?: unknown }): void;
  stream(content: string, done?: boolean): void;
  selectMode(on: boolean): void;
  waitFor(pred: (m: any, e: any) => boolean, o?: { from?: number; timeout?: number }): Promise<any>;
  messages(t?: string, from?: number): any[];
  reset(type?: string): void;
}

declare global {
  interface Window {
    host: HostApi;
  }
}

/** Open the host page and wait for the viewer inside it to say ready. */
export async function openHost(page: Page): Promise<void> {
  await page.goto("/__host");
  await page.waitForFunction(() => window.host?.log.some((e) => e.msg.t === "ready"));
}

export const logLength = (page: Page): Promise<number> => page.evaluate(() => window.host.log.length);

export interface Outcome {
  rendered?: { t: "rendered"; version: number; ms: number };
  errors: { t: "error"; kind: string; message: string; line?: number; col?: number; stack?: string }[];
}

/** Send a `load` and wait until the viewer answers with `rendered` or `error`. */
export async function load(page: Page, artifact: { type: string; content: string; title?: string }, opts: { id?: string; version?: number; theme?: string; kit?: unknown } = {}): Promise<Outcome> {
  const from = await logLength(page);
  await page.evaluate(([a, o]) => window.host.load(a as any, o as any), [artifact, opts] as const);
  return settle(page, from);
}

/** Wait for the first `rendered` or `error` after log index `from`, then give a moment for more errors to arrive. */
export async function settle(page: Page, from: number): Promise<Outcome> {
  await page.evaluate((f) => window.host.waitFor((m) => m.t === "rendered" || m.t === "error", { from: f, timeout: 25_000 }), from);
  await page.waitForTimeout(150);
  return page.evaluate((f) => {
    const msgs = window.host.messages(undefined, f);
    return { rendered: msgs.find((m) => m.t === "rendered"), errors: msgs.filter((m) => m.t === "error") };
  }, from);
}

/** The shell document inside the host page's iframe. */
export const viewer = (page: Page): FrameLocator => page.frameLocator("#frame");
/** An html artifact's own document, one iframe deeper. */
export const htmlDoc = (page: Page): FrameLocator => page.frameLocator("#frame").frameLocator("iframe.tz-frame");

export async function expectNoErrors(page: Page, from = 0): Promise<void> {
  const errors = await page.evaluate((f) => window.host.messages("error", f), from);
  expect(errors).toEqual([]);
}

/** Do something in the viewer and return the first `select` message it causes. */
export async function selected(page: Page, action: () => Promise<unknown>): Promise<any> {
  const from = await logLength(page);
  await action();
  return page.evaluate((f) => window.host.waitFor((m) => m.t === "select", { from: f, timeout: 5000 }), from);
}
